// ============================================================
// Cards For Cowboys - Game Engine
// ============================================================

// ============================================================
// MULTIPLAYER LAYER
// All Firebase interaction is isolated here.
// When MP is inactive every function is a no-op.
// ============================================================

// Shared Firebase config — used by both the MP layer and the game history writer
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBegwDX84rtHfrYwuMVZcQkcLvaJ9MUOiQ",
  authDomain: "cards-for-cowboys.firebaseapp.com",
  databaseURL: "https://cards-for-cowboys-default-rtdb.firebaseio.com",
  projectId: "cards-for-cowboys",
  storageBucket: "cards-for-cowboys.firebasestorage.app",
  messagingSenderId: "795777888512",
  appId: "1:795777888512:web:560d415f8d34def96dc3e5"
};

const MP = (() => {
  // Detect if we arrived from the lobby
  const isMP = new URLSearchParams(location.search).has('mp');
  if (!isMP) return { active: false };

  const code      = sessionStorage.getItem('mp_code');
  const mySlotStr = sessionStorage.getItem('mp_slot');  // '0' = host, '1+' = guest
  const myName    = sessionStorage.getItem('mp_name');

  if (!code || mySlotStr === null || !myName) return { active: false };

  const mySlot = parseInt(mySlotStr, 10);
  const isHost = mySlot === 0;

  // Dynamic Firebase import (ESM CDN)
  let dbRef = null;
  let db    = null;
  let fbMod = null;
  let fbSet, fbUpdate, fbOnValue, fbOnDisconnect, fbRemove, fbGet, fbRef;

  let unsubscribers     = [];
  let initialized       = false;
  let disconnectTimers  = {};  // slotIdx → setTimeout handle
  let rejoinCountdowns  = {};  // slotIdx → { interval } for 5-min rejoin window

  // Populated by buildPlayersConfig()
  let _slotDefs   = [];
  let _numPlayers = 0;
  let _gameSeed   = 0;

  function gameRef(path) {
    return fbRef(db, `games/${code}${path ? '/' + path : ''}`);
  }

  async function init() {
    const fbApp = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    fbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');

    const app = fbApp.initializeApp(FIREBASE_CONFIG);
    db = fbMod.getDatabase(app);

    fbRef       = (db_, path_) => fbMod.ref(db_, path_);
    fbSet       = (r, v)       => fbMod.set(r, v);
    fbUpdate    = (r, v)       => fbMod.update(r, v);
    fbOnValue   = (r, cb)      => fbMod.onValue(r, cb);
    fbOnDisconnect = (r)       => fbMod.onDisconnect(r);
    fbRemove    = (r)          => fbMod.remove(r);
    fbGet       = (r)          => fbMod.get(r);

    dbRef = gameRef();
    initialized = true;

    // Per-slot presence: arm the onDisconnect now (before we mark ourselves connected
    // in startPresence), so the server-side handler is registered before the game starts.
    fbOnDisconnect(gameRef(`slots/${mySlot}/connected`)).set(false);
  }

  // Call after buildPlayersConfig() so _slotDefs and _numPlayers are populated.
  // Marks this slot as connected and watches opponents for unexpected disconnects.
  async function startPresence() {
    if (!initialized) return;

    // Announce ourselves as connected
    await fbSet(gameRef(`slots/${mySlot}/connected`), true);

    // Auto-reconnect: whenever Firebase re-establishes the WebSocket, re-assert presence
    // (handles mobile background, brief network blips without requiring a page rejoin)
    const connUnsub = fbOnValue(fbRef(db, '.info/connected'), async (snap) => {
      if (snap.val() === true && initialized) {
        fbOnDisconnect(gameRef(`slots/${mySlot}/connected`)).set(false);
        await fbSet(gameRef(`slots/${mySlot}/connected`), true);
      }
    });
    unsubscribers.push(connUnsub);

    // Watch every other human slot for connection drops
    for (let s = 0; s < _numPlayers; s++) {
      if (s === mySlot || !_slotDefs[s] || !_slotDefs[s].isHuman) continue;
      const slotIdx = s;
      const playerName = _slotDefs[slotIdx].name || `Player ${slotIdx + 1}`;
      const unsub = fbOnValue(gameRef(`slots/${slotIdx}/connected`), (snap) => {
        const connected = snap.val();
        if (connected === false) {
          // Start 15-second grace period, then open a 5-minute rejoin window
          if (!disconnectTimers[slotIdx] && !rejoinCountdowns[slotIdx]) {
            setMessage(`${playerName} lost connection. Waiting 15 seconds…`);
            disconnectTimers[slotIdx] = setTimeout(() => {
              delete disconnectTimers[slotIdx];
              startRejoinCountdown(slotIdx, playerName);
            }, 15000);
          }
        } else if (connected === true) {
          // Reconnected — cancel any pending timers and resume
          if (disconnectTimers[slotIdx]) {
            clearTimeout(disconnectTimers[slotIdx]);
            delete disconnectTimers[slotIdx];
            render();
          }
          if (rejoinCountdowns[slotIdx]) {
            clearInterval(rejoinCountdowns[slotIdx].interval);
            delete rejoinCountdowns[slotIdx];
            setMessage(`${playerName} has rejoined!`);
            setTimeout(() => { if (G && G.phase) render(); }, 2000);
          }
        }
        // connected === null means slot entry doesn't exist yet — ignore
      });
      unsubscribers.push(unsub);
    }
  }

  // Read game config from Firebase: slotDefs, gameSeed, numPlayers
  async function buildPlayersConfig() {
    if (!initialized) return null;
    const snap = await fbGet(dbRef);
    const data = snap.val();
    if (!data) return null;
    _numPlayers = data.numPlayers || 2;
    _gameSeed   = data.gameSeed   || 0;
    _slotDefs   = [];
    for (let i = 0; i < _numPlayers; i++) {
      const s = (data.slots && data.slots[i]) || {};
      _slotDefs[i] = { name: s.name || `Player ${i + 1}`, isHuman: s.isHuman !== false, personality: s.personality || null };
    }
    return { slotDefs: _slotDefs, gameSeed: _gameSeed, numPlayers: _numPlayers, quickStartMode: data.quickStartMode || false };
  }

  // Push local player's full draw state (hand + deck + stats) after every draw action
  async function pushDrawState(player) {
    if (!initialized) return;
    await fbSet(gameRef(`drawState/${mySlot}`), {
      round: G.roundNumber, // used by receivers to discard stale data from previous rounds
      hand: player.hand.map(c => c.id),
      deck: player.deck.map(c => c.id),
      dollars: player.roundDollars,
      cows: player.roundCows,
      bandits: player.roundBandits,
      busted: player.busted,
      stoppedDrawing: player.stoppedDrawing,
      discardCount: player.discard.length, // current round's discard pile size
    });
  }

  // Live watch all human opponent draw states; callback(slotIdx, state) on every update
  function watchOpponentDrawStates(callback) {
    if (!initialized) return;
    for (let s = 0; s < _numPlayers; s++) {
      if (s === mySlot || !_slotDefs[s] || !_slotDefs[s].isHuman) continue;
      const slotIdx = s;
      const unsub = fbOnValue(gameRef(`drawState/${slotIdx}`), (snap) => {
        const val = snap.val();
        if (val) callback(slotIdx, val);
      });
      unsubscribers.push(unsub);
    }
  }

  // Signal that my draw phase is done
  async function signalDrawDone(player) {
    if (!initialized) return;
    await fbSet(gameRef(`drawDone/${mySlot}`), {
      done: true,
      round: G.roundNumber,
      act: G.currentAct,
      dollars: player.roundDollars,
      cows: player.roundCows,
      bandits: player.roundBandits,
      busted: player.busted,
      handCount: player.hand.length,
      hasBuyBurnFirst: player.hasBuyBurnFirst || false,
      hasExtraBuy: player.hasExtraBuy || false,
    });
  }

  // For each human opponent slot, fires slotDoneCallback(slotIdx) when they signal done
  function waitForAllHumanDrawsDone(slotDoneCallback) {
    if (!initialized) return;
    const expectedRound = G.roundNumber;
    const expectedAct   = G.currentAct;
    for (let s = 0; s < _numPlayers; s++) {
      if (s === mySlot || !_slotDefs[s] || !_slotDefs[s].isHuman) continue;
      let fired = false;
      let unsub = null;
      const slotIdx = s;
      unsub = fbOnValue(gameRef(`drawDone/${slotIdx}`), (snap) => {
        const val = snap.val();
        const matches = val && val.done === true
                        && val.round === expectedRound && val.act === expectedAct;
        if (matches && !fired) {
          fired = true;
          if (unsub) unsub();
          slotDoneCallback(slotIdx, val); // pass final stats to avoid race with drawState
        }
      });
      unsubscribers.push(unsub);
    }
  }

  // Push this player's pass-card choice (fromSlot = mySlot, toSlot = Firebase slot index)
  async function pushPassCard(cardId, toSlot) {
    if (!initialized) return;
    await fbSet(gameRef(`passCard/${mySlot}`), { cardId, toSlot, ts: Date.now() });
  }

  // One-shot listener for a specific player's pass-card choice
  function waitForPassCard(fromSlot, callback) {
    if (!initialized) return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef(`passCard/${fromSlot}`), (snap) => {
      const val = snap.val();
      if (val && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(val); // { cardId, toSlot }
      }
    });
    unsubscribers.push(unsub);
  }

  // Push this player's card pick for a given Quick Start draft round
  async function pushDraftPick(round, cardId) {
    if (!initialized) return;
    await fbSet(gameRef(`draftPick/${round}/${mySlot}`), cardId);
  }

  // Wait for all human opponent slots to pick in a given draft round.
  // Returns a Promise<{slotIdx: cardId, ...}> resolving when all picks are received.
  function waitForDraftRoundPicks(round) {
    if (!initialized) return Promise.resolve({});
    return new Promise(resolve => {
      const result = {};
      const pending = new Set();
      for (let s = 0; s < _numPlayers; s++) {
        if (s === mySlot || !_slotDefs[s] || !_slotDefs[s].isHuman) continue;
        pending.add(s);
      }
      if (pending.size === 0) { resolve({}); return; }
      for (const slotIdx of [...pending]) {
        let fired = false;
        let unsub = null;
        unsub = fbOnValue(gameRef(`draftPick/${round}/${slotIdx}`), (snap) => {
          const cardId = snap.val();
          if (cardId && !fired) {
            fired = true;
            if (unsub) unsub();
            result[slotIdx] = cardId;
            pending.delete(slotIdx);
            if (pending.size === 0) resolve(result);
          }
        });
        unsubscribers.push(unsub);
      }
    });
  }

  // Reset all per-round signals at start of each round
  async function resetRound() {
    if (!initialized) return;
    // Only clear own draw slots — never clear opponents' done signals.
    // If we cleared all slots here, a fast opponent who finishes before our
    // resetRound fires would have their done signal wiped, causing a deadlock.
    const updates = {
      [`drawDone/${mySlot}`]:  null,
      [`drawState/${mySlot}`]: null,
    };
    for (let i = 0; i < _numPlayers; i++) {
      updates[`passCard/${i}`] = null;
    }
    await fbUpdate(dbRef, updates);
  }

  // Serialize a card object to the minimal data spectate.html needs
  function serializeCard(c) {
    if (!c) return null;
    return {
      id: c.id, img: c.img, cacti: c.cacti,
      dollars: c.dollars, cows: c.cows, bandits: c.bandits,
      special: c.special || null, cost: c.cost || 0,
    };
  }

  // Push a full game-state snapshot for spectators (host only).
  // Called at phase boundaries and after every buy/burn action.
  async function pushSpectatorState() {
    if (!initialized || !isHost || !G || G.phase === 'start') return;
    try {
      const state = {
        phase: G.phase,
        round: G.roundNumber,
        act: G.currentAct,
        numPlayers: G.numPlayers,
        pyramid: G.pyramid.map(row => row.map(slot => ({
          card: serializeCard(slot.card),
          faceUp: slot.faceUp,
          removed: slot.removed,
        }))),
        players: G.players.map(p => ({
          slotIdx: p.slotIdx,
          name: p.name,
          isHuman: p.isHuman,
          herd: p.herd,
          roundDollars: p.roundDollars,
          roundCows: p.roundCows,
          roundBandits: p.roundBandits,
          busted: p.busted,
          stoppedDrawing: p.stoppedDrawing,
          hand: p.hand.map(serializeCard),
          deck: p.deck.map(c => ({ id: c.id, cacti: c.cacti })),
          discard: p.discard.map(c => ({ id: c.id, cacti: c.cacti })),
          personality: p.personality || null,
        })),
        buyOrder: G.buyOrder || [],
        currentBuyerIdx: G.currentBuyerIdx || 0,
        ts: Date.now(),
      };
      await fbSet(gameRef('spectatorState'), state);
    } catch (e) {
      // Non-critical — spectator state is best-effort
      console.warn('[MP] pushSpectatorState failed:', e);
    }
  }

  // Clear actSetup (between acts)
  async function clearActSetup() {
    if (!initialized) return;
    await fbSet(gameRef('actSetup'), null);
  }

  // Push act setup (host only) — shares pyramid card IDs so all clients build the same pyramid
  async function pushActSetup(act, cardIds) {
    if (!initialized || !isHost) return;
    await fbSet(gameRef('actSetup'), { act, cardIds, ts: Date.now() });
  }

  // Listen for act setup (non-host).
  // Validates act number so stale Firebase data from a prior act is never consumed.
  function waitForActSetup(expectedAct, callback) {
    if (!initialized || isHost) return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef('actSetup'), (snap) => {
      const data = snap.val();
      if (data && data.act === expectedAct && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
    unsubscribers.push(unsub);
  }

  // Push local player's buy action (buy or burn at row/col).
  // Stamps round+act so recipients can reject stale values from previous rounds.
  async function pushBuyAction(action, row, col) {
    if (!initialized) return;
    await fbSet(gameRef(`buyAction/${mySlot}`), {
      action, row, col, round: G.roundNumber, act: G.currentAct, ts: Date.now(),
    });
  }

  // Clear an opponent's buy action after we've consumed it.
  // This prevents the NEXT waitForBuyAction call for the same slot in the same
  // round from immediately re-firing with the stale same-round value (which would
  // hit slot.removed and silently skip processBuyTurn, hanging the buy phase).
  async function clearBuyAction(slotIdx) {
    if (!initialized) return;
    await fbSet(gameRef(`buyAction/${slotIdx}`), null);
  }

  // Listen for a specific slot's buy action.
  // Captures expected round+act so stale values from prior rounds are ignored.
  function waitForBuyAction(slotIdx, callback) {
    if (!initialized) return;
    const expectedRound = G.roundNumber;
    const expectedAct   = G.currentAct;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef(`buyAction/${slotIdx}`), (snap) => {
      const data = snap.val();
      const matches = data && data.round === expectedRound && data.act === expectedAct;
      if (matches && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
    unsubscribers.push(unsub);
  }

  // Push buy order as array of Firebase slot indices [first, second, ...]
  // Stamps round+act so recipients can reject stale values from previous rounds.
  async function pushBuyOrder(slotOrder) {
    if (!initialized) return;
    await fbSet(gameRef('buyOrder'), {
      slotOrder, round: G.roundNumber, act: G.currentAct, ts: Date.now(),
    });
  }

  // Listen for buy order; callback receives the slotOrder array.
  // Captures expected round+act at registration time so a stale value
  // (from a prior round still in Firebase) is silently ignored.
  function waitForBuyOrder(callback) {
    if (!initialized) return;
    const expectedRound = G.roundNumber;
    const expectedAct   = G.currentAct;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef('buyOrder'), (snap) => {
      const data = snap.val();
      const matches = data && data.round === expectedRound && data.act === expectedAct;
      if (matches && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data.slotOrder);
      }
    });
    unsubscribers.push(unsub);
  }

  function showDisconnectMessage(playerName) {
    const who = playerName ? `${playerName} disconnected.` : 'A player disconnected.';
    setMessage(`${who} Game over.`);
    setActions([{ text: 'Back to Home', onClick: () => { window.location.href = 'gamesetup.html'; } }]);
    cleanup();
  }

  // After 15-second grace period, starts a 5-minute countdown giving the player time to rejoin.
  // If they reconnect (connected=true), the countdown is cancelled in startPresence's watcher.
  function startRejoinCountdown(slotIdx, playerName) {
    const REJOIN_MS = 5 * 60 * 1000;
    const endTime = Date.now() + REJOIN_MS;
    const pad = n => String(n).padStart(2, '0');
    const tick = () => {
      const remaining = Math.max(0, endTime - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setMessage(`${playerName} disconnected. Game ends in ${mins}:${pad(secs)} if they don't rejoin.`);
      if (remaining <= 0) {
        clearInterval(rejoinCountdowns[slotIdx].interval);
        delete rejoinCountdowns[slotIdx];
        showDisconnectMessage(playerName);
      }
    };
    tick();
    rejoinCountdowns[slotIdx] = { interval: setInterval(tick, 1000) };
  }

  // Persist rejoin info to localStorage so index.html can offer a "Rejoin" button
  function saveRejoinInfo() {
    try { localStorage.setItem('cfc_rejoin', JSON.stringify({ code, slot: mySlot, name: myName, ts: Date.now() })); } catch (e) {}
  }
  function clearRejoinInfo() {
    try { localStorage.removeItem('cfc_rejoin'); } catch (e) {}
  }

  // Fetch the latest spectatorState snapshot from Firebase (used during rejoin)
  async function fetchSpectatorState() {
    if (!initialized) return null;
    const snap = await fbGet(gameRef('spectatorState'));
    return snap.val();
  }

  // Write status (and player metadata) to games/{code} for live-game tracking.
  // 'active' includes player names/modes so history.html can display them without
  // reading the full slots subtree. 'finished' is a simple status-only write.
  async function setLiveStatus(status) {
    if (!initialized || !isHost) return;
    try {
      if (status === 'active' && G) {
        await fbUpdate(gameRef(), {
          status: 'active',
          mode: 'mp',
          numPlayers: G.numPlayers,
          players: G.players.map(p => ({ name: p.name, isHuman: p.isHuman })),
        });
      } else {
        await fbSet(gameRef('status'), status);
      }
    } catch (e) {}
  }

  function cleanup() {
    unsubscribers.forEach(u => u && u());
    unsubscribers = [];
    // Cancel all pending grace-period timers and rejoin countdown intervals
    Object.values(disconnectTimers).forEach(t => clearTimeout(t));
    disconnectTimers = {};
    Object.values(rejoinCountdowns).forEach(r => clearInterval(r.interval));
    rejoinCountdowns = {};
    // Cancel server-side onDisconnect handler so normal navigation doesn't fire it
    if (initialized && dbRef) {
      fbOnDisconnect(gameRef(`slots/${mySlot}/connected`)).cancel();
    }
  }

  // Host-only: delete the game from Firebase (guests detect deletion via watchForDisband)
  async function disband() {
    if (!isHost || !initialized) return;
    cleanup();
    clearRejoinInfo();
    await fbRemove(dbRef);
    window.location.href = 'index.html';
  }

  // Guest-only: watch root game ref; if deleted, host disbanded — go home
  function watchForDisband() {
    if (isHost || !initialized) return;
    const unsub = fbOnValue(dbRef, (snap) => {
      if (snap.val() === null) {
        unsub();
        clearRejoinInfo();
        setMessage('The host disbanded the game.');
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
      }
    });
    unsubscribers.push(unsub);
  }

  return {
    active: true,
    code, mySlot, isHost, myName,
    slotToPlayer: {},  // slotIdx → G.players index; set in startGame()
    init,
    buildPlayersConfig,
    startPresence,
    pushDrawState,
    watchOpponentDrawStates,
    signalDrawDone,
    waitForAllHumanDrawsDone,
    resetRound,
    clearActSetup,
    pushActSetup,
    waitForActSetup,
    pushBuyAction,
    clearBuyAction,
    waitForBuyAction,
    pushBuyOrder,
    waitForBuyOrder,
    pushPassCard,
    waitForPassCard,
    pushDraftPick,
    waitForDraftRoundPicks,
    pushSpectatorState,
    fetchSpectatorState,
    setLiveStatus,
    saveRejoinInfo,
    clearRejoinInfo,
    cleanup,
    disband,
    watchForDisband,
  };
})();

// ============================================================
// END MULTIPLAYER LAYER
// ============================================================

// ============================================================
// GAME HISTORY — writes a record to Firebase on every game end
// Works in both SP and MP mode (MP: host only to avoid duplicates)
// ============================================================
const HISTORY = (() => {
  let db = null;
  let _fbRef, _fbPush;
  let initialized = false;

  async function init() {
    if (initialized) return;
    const fbApp = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const fbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    // Re-use existing default app if MP layer already initialised it, otherwise create one
    const app = fbApp.getApps().length > 0 ? fbApp.getApp() : fbApp.initializeApp(FIREBASE_CONFIG);
    db = fbMod.getDatabase(app);
    _fbRef  = (path) => fbMod.ref(db, path);
    _fbPush = (r, v) => fbMod.push(r, v);
    initialized = true;
  }

  async function logGame(data) {
    try {
      await init();
      await _fbPush(_fbRef('gameHistory'), data);
    } catch (e) {
      console.warn('[HISTORY] Failed to log game:', e);
    }
  }

  return { logGame };
})();

// ============================================================
// SPECTATOR STATE HELPERS — shared by MP and AI_SPEC
// ============================================================

function serializeCard(c) {
  if (!c) return null;
  return { id: c.id, img: c.img, cacti: c.cacti, dollars: c.dollars, cows: c.cows, bandits: c.bandits, special: c.special || null, cost: c.cost || 0 };
}

function buildSpectatorState() {
  return {
    phase: G.phase,
    round: G.roundNumber,
    act: G.currentAct,
    numPlayers: G.numPlayers,
    pyramid: G.pyramid.map(row => row.map(slot => ({
      card: serializeCard(slot.card),
      faceUp: slot.faceUp,
      removed: slot.removed,
    }))),
    players: G.players.map(p => ({
      slotIdx: p.slotIdx,
      name: p.name,
      isHuman: p.isHuman,
      herd: p.herd,
      roundDollars: p.roundDollars,
      roundCows: p.roundCows,
      roundBandits: p.roundBandits,
      busted: p.busted,
      stoppedDrawing: p.stoppedDrawing,
      hand: p.hand.map(serializeCard),
      deck: p.deck.map(c => ({ id: c.id, cacti: c.cacti })),
      discard: p.discard.map(c => ({ id: c.id, cacti: c.cacti })),
      personality: p.personality || null,
    })),
    buyOrder: G.buyOrder || [],
    currentBuyerIdx: G.currentBuyerIdx || 0,
    ts: Date.now(),
  };
}

// ============================================================
// AI SPECTATE — Firebase presence for single-player (vs AI) games
// Writes games/{code} so spectators can watch from history.html
// ============================================================
const AI_SPEC = (() => {
  let db = null;
  let _fbRef, _fbSet, _fbRemove, _fbOnDisconnect;
  let initialized = false;
  let _code = null;

  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  async function init() {
    if (initialized) return;
    const fbApp = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const fbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    const app = fbApp.getApps().length > 0 ? fbApp.getApp() : fbApp.initializeApp(FIREBASE_CONFIG);
    db = fbMod.getDatabase(app);
    _fbRef          = (path) => fbMod.ref(db, path);
    _fbSet          = (r, v) => fbMod.set(r, v);
    _fbRemove       = (r)    => fbMod.remove(r);
    _fbOnDisconnect = (r)    => fbMod.onDisconnect(r);
    initialized = true;
  }

  // Use liveGames/ path (not games/) to avoid Firebase rules that gate games/ to the lobby flow
  function liveRef(path) { return _fbRef(`liveGames/${_code}${path ? '/' + path : ''}`); }

  async function start(players) {
    _code = generateCode();
    try {
      await init();
      await _fbSet(liveRef(), {
        status: 'active',
        mode: 'ai',
        numPlayers: players.length,
        createdAt: Date.now(),
        players: players.map(p => ({ name: p.name, isHuman: p.isHuman })),
      });
    } catch (e) {
      console.error('[AI_SPEC] Failed to start:', e);
      _code = null;
      return;
    }
    // Best-effort: mark finished if the tab closes mid-game
    try { _fbOnDisconnect(liveRef('status')).set('finished'); } catch (e) {}
  }

  async function push() {
    if (!_code || !initialized || !G || G.phase === 'start') return;
    try {
      await _fbSet(liveRef('spectatorState'), buildSpectatorState());
    } catch (e) { /* non-critical */ }
  }

  async function finish() {
    if (!_code || !initialized) return;
    const code = _code;
    _code = null; // prevent further pushes
    try {
      await _fbSet(_fbRef(`liveGames/${code}/status`), 'finished');
      // Remove the entry after 2 minutes so it doesn't clutter the DB
      setTimeout(async () => {
        try { await _fbRemove(_fbRef(`liveGames/${code}`)); } catch (e) {}
      }, 2 * 60 * 1000);
    } catch (e) {}
  }

  return {
    get active() { return !!_code; },
    get code() { return _code; },
    start, push, finish,
  };
})();

// Verbose MP debug logging — toggle with ?mpDebug=1 in URL
const MP_DEBUG = new URLSearchParams(location.search).has('mpDebug');
function mpLog(...args) {
  if (!MP_DEBUG || !MP.active) return;
  const role = MP.isHost ? 'HOST' : `GUEST-${MP.mySlot}`;
  console.log(`%c[MP:${role}]`, 'color:#b07c1a;font-weight:bold', ...args);
}

const CARD_IMG_PATH = 'assets/cards/All-Cards/';
const BACK_IMG_PATH = 'assets/backs/';
const CACTI_BACK = { 1: 'Blue Inline-01.jpg', 2: 'Yellow Inline-01.jpg', 3: 'Red Inline-01.jpg' };

// --- CARD DATABASE ---

// --- STARTERS (IDs 91-94 River, 61-64 Rattlesnake, 33-34 Cactus) ---
// River=1 cacti, Cactus=2 cacti, Rattlesnake=3 cacti
const STARTER_TEMPLATES = [
  { id: 'starter_91', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_91.jpg' },
  { id: 'starter_92', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_92.jpg' },
  { id: 'starter_93', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_93.jpg' },
  { id: 'starter_94', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_94.jpg' },
  { id: 'starter_61', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1, img: 'Cards_61.jpg' },
  { id: 'starter_62', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Cards_62.jpg' },
  { id: 'starter_63', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Cards_63.jpg' },
  { id: 'starter_64', dollars: 0, cows: 2, bandits: 2, cacti: 3, count: 1, img: 'Cards_64.jpg' },
  { id: 'starter_33', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1, img: 'Cards_33.jpg' },
  { id: 'starter_34', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 1, img: 'Cards_34.jpg' },
];

// --- STORE CARDS (all player counts; minPlayers field controls inclusion) ---
// Derived from CSV. Color→Cacti: River(Blue)=1, Cactus(Yellow)=2, Rattlesnake(Red)=3
// minPlayers: 2=all, 3=3+P games, 4=4+P games only
const STORE_CARDS = [
  // --- ACT 1 ---
  // River (Blue) – 1 cacti  [2P: IDs 74-80]
  { id: 'card_74', img: 'Cards_74.jpg', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_75', img: 'Cards_75.jpg', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_76', img: 'Cards_76.jpg', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_77', img: 'Cards_77.jpg', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'trash_to_use' },
  { id: 'card_78', img: 'Cards_78.jpg', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'trash_to_use' },
  { id: 'card_79', img: 'Cards_79.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_80', img: 'Cards_80.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [3+P: ID 65]
  { id: 'card_65', img: 'Cards_65.jpg', act: 1, minPlayers: 3, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [4+P: IDs 68-70]
  { id: 'card_68', img: 'Cards_68.jpg', act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_69', img: 'Cards_69.jpg', act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_70', img: 'Cards_70.jpg', act: 1, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'trash_to_use' },
  // Rattlesnake (Red) – 3 cacti  [2P: IDs 46-49]
  { id: 'card_46', img: 'Cards_46.jpg', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_47', img: 'Cards_47.jpg', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_48', img: 'Cards_48.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_49', img: 'Cards_49.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [3+P: IDs 35-37]
  { id: 'card_35', img: 'Cards_35.jpg', act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_36', img: 'Cards_36.jpg', act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_37', img: 'Cards_37.jpg', act: 1, minPlayers: 3, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [4+P: ID 40]
  { id: 'card_40', img: 'Cards_40.jpg', act: 1, minPlayers: 4, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P: IDs 10-15]
  { id: 'card_10', img: 'Cards_10.jpg', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_11', img: 'Cards_11.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_12', img: 'Cards_12.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_13', img: 'Cards_13.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_14', img: 'Cards_14.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_buy_burn_first' },
  { id: 'card_15', img: 'Cards_15.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },
  // Cactus (Yellow) – 2 cacti  [4+P: IDs 1-3]
  { id: 'card_1',  img: 'Cards_1.jpg',  act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_2',  img: 'Cards_2.jpg',  act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_3',  img: 'Cards_3.jpg',  act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },

  // --- ACT 2 ---
  // River (Blue) – 1 cacti  [2P: IDs 81-83]
  { id: 'card_81', img: 'Cards_81.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_82', img: 'Cards_82.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_83', img: 'Cards_83.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [3+P: IDs 66-67]
  { id: 'card_66', img: 'Cards_66.jpg', act: 2, minPlayers: 3, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_67', img: 'Cards_67.jpg', act: 2, minPlayers: 3, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti  [2P: IDs 50-54]
  { id: 'card_50', img: 'Cards_50.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'trash_to_use' },
  { id: 'card_51', img: 'Cards_51.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost: 4, cacti: 3, special: null },
  { id: 'card_52', img: 'Cards_52.jpg', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_53', img: 'Cards_53.jpg', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_54', img: 'Cards_54.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost: 5, cacti: 3, special: 'draw4' },
  // Rattlesnake (Red) – 3 cacti  [3+P: IDs 38-39]
  { id: 'card_38', img: 'Cards_38.jpg', act: 2, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_39', img: 'Cards_39.jpg', act: 2, minPlayers: 3, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'trash_to_use' },
  // Rattlesnake (Red) – 3 cacti  [4+P: IDs 41-43]
  { id: 'card_41', img: 'Cards_41.jpg', act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4, cacti: 3, special: null },
  { id: 'card_42', img: 'Cards_42.jpg', act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4, cacti: 3, special: null },
  { id: 'card_43', img: 'Cards_43.jpg', act: 2, minPlayers: 4, dollars: 0, cows:  5, bandits:  2, cost: 4, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P: IDs 16-24]
  { id: 'card_16', img: 'Cards_16.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'card_17', img: 'Cards_17.jpg', act: 2, minPlayers: 2, dollars: 4, cows:  0, bandits:  1, cost: 3, cacti: 2, special: null },
  { id: 'card_18', img: 'Cards_18.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_19', img: 'Cards_19.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'look3_rearrange' },
  { id: 'card_20', img: 'Cards_20.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'card_21', img: 'Cards_21.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'extra_buy' },
  { id: 'card_22', img: 'Cards_22.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'put_on_top' },
  { id: 'card_23', img: 'Cards_23.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'replay_discard' },
  { id: 'card_24', img: 'Cards_24.jpg', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 6, cacti: 2, special: 'dollar1_other' },
  // Cactus (Yellow) – 2 cacti  [4+P: IDs 4-7]
  { id: 'card_4',  img: 'Cards_4.jpg',  act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits: -1, cost: 0, cacti: 2, special: 'discard_to_player' },
  { id: 'card_5',  img: 'Cards_5.jpg',  act: 2, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'card_6',  img: 'Cards_6.jpg',  act: 2, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_7',  img: 'Cards_7.jpg',  act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },

  // --- ACT 3 ---
  // River (Blue) – 1 cacti  [2P: IDs 84-90]
  { id: 'card_84', img: 'Cards_84.jpg', act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_85', img: 'Cards_85.jpg', act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_86', img: 'Cards_86.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_87', img: 'Cards_87.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_88', img: 'Cards_88.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_89', img: 'Cards_89.jpg', act: 3, minPlayers: 2, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_90', img: 'Cards_90.jpg', act: 3, minPlayers: 2, dollars: 2, cows:  3, bandits:  0, cost:  9, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [4+P: IDs 71-73]
  { id: 'card_71', img: 'Cards_71.jpg', act: 3, minPlayers: 4, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_72', img: 'Cards_72.jpg', act: 3, minPlayers: 4, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_73', img: 'Cards_73.jpg', act: 3, minPlayers: 4, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti  [2P: IDs 55-60]
  { id: 'card_55', img: 'Cards_55.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  3, bandits:  0, cost: 10, cacti: 3, special: null },
  { id: 'card_56', img: 'Cards_56.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_57', img: 'Cards_57.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_58', img: 'Cards_58.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_59', img: 'Cards_59.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_60', img: 'Cards_60.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  1, cost:  9, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [4+P: IDs 44-45]
  { id: 'card_44', img: 'Cards_44.jpg', act: 3, minPlayers: 4, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_45', img: 'Cards_45.jpg', act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P: IDs 25-32]
  { id: 'card_25', img: 'Cards_25.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  2, bandits: -1, cost: 10, cacti: 2, special: null },
  { id: 'card_26', img: 'Cards_26.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_27', img: 'Cards_27.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_28', img: 'Cards_28.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_29', img: 'Cards_29.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_30', img: 'Cards_30.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_31', img: 'Cards_31.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost:  8, cacti: 2, special: 'look3_immediate' },
  { id: 'card_32', img: 'Cards_32.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  9, cacti: 2, special: null },
  // Cactus (Yellow) – 2 cacti  [4+P: IDs 8-9]
  { id: 'card_8',  img: 'Cards_8.jpg',  act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_9',  img: 'Cards_9.jpg',  act: 3, minPlayers: 4, dollars: 3, cows:  2, bandits:  0, cost:  8, cacti: 2, special: null },
];

// Build lookup
const CARD_DB = {};
STORE_CARDS.forEach(c => CARD_DB[c.id] = c);
STARTER_TEMPLATES.forEach(c => CARD_DB[c.id] = c);

// Look up a card template by ID and return a fresh card instance (used during rejoin reconstruction)
function getCardById(id) {
  const tmpl = CARD_DB[id];
  if (!tmpl) { console.warn('[rejoin] unknown card id:', id); return null; }
  return createCardInstance(tmpl, tmpl.img);
}

function getActPool(act) {
  return STORE_CARDS.filter(c => c.act === act && c.minPlayers <= G.numPlayers);
}

// --- UTILITY ---

let uidCounter = 0;
function uid() { return ++uidCounter; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- SEEDED RNG for AI deck shuffles in MP mode ---
// Each AI slot gets an independent LCG seeded from gameSeed XOR slotIdx.
// All clients initialize the same seeds, so AI draws are deterministic everywhere.
let _aiRngs = {}; // slotIdx → { seed }

function initAiRng(slotIdx, gameSeed) {
  _aiRngs[slotIdx] = { seed: ((gameSeed ^ (slotIdx * 0x9e3779b9)) >>> 0) || 1 };
}

function _nextAiRng(slotIdx) {
  const r = _aiRngs[slotIdx];
  // Linear congruential generator (Numerical Recipes constants)
  r.seed = (Math.imul(1664525, r.seed) + 1013904223) >>> 0;
  return r.seed / 4294967296;
}

function _seededShuffle(arr, slotIdx) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(_nextAiRng(slotIdx) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Seeded shuffle of seat order using gameSeed (distinct constant from AI RNG so they don't alias).
// Returns a shuffled copy of [0, 1, ..., n-1] (slot/player indices).
function seededSeatOrder(n, gameSeed) {
  let seed = ((gameSeed ^ 0xdeadbeef) >>> 0) || 1;
  function next() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const arr = Array.from({length: n}, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Use seeded shuffle for AI slots in MP; regular shuffle otherwise
function shuffleForPlayer(arr, slotIdx, isHuman) {
  if (MP.active && !isHuman && _aiRngs[slotIdx] !== undefined) {
    return _seededShuffle(arr, slotIdx);
  }
  return shuffle(arr);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// --- GAME STATE ---

let G = null; // global game state
const pendingAnimCardUids = new Set(); // UIDs of cards drawn this tick, to receive flip-in animation

function createCardInstance(template, imgFile) {
  return {
    uid: uid(),
    id: template.id,
    img: imgFile || template.img || template.imgs[0],
    dollars: template.dollars,
    cows: template.cows,
    bandits: template.bandits,
    cacti: template.cacti,
    cost: template.cost || 0,
    special: template.special || null,
    act: template.act || 0,
  };
}

function createStarterDeck(slotIdx, isHuman) {
  const deck = [];
  for (const tmpl of STARTER_TEMPLATES) {
    for (let i = 0; i < tmpl.count; i++) {
      deck.push(createCardInstance(tmpl, tmpl.img));
    }
  }
  return shuffleForPlayer(deck, slotIdx, isHuman);
}

function createPlayer(name, isHuman, slotIdx = 0, personality = null) {
  return {
    name,
    isHuman,
    slotIdx,
    personality: isHuman ? null : (personality || 'rancher'),
    deck: createStarterDeck(slotIdx, isHuman),
    discard: [],
    hand: [],
    herd: 0,
    roundDollars: 0,
    roundCows: 0,
    roundBandits: 0,
    busted: false,
    stoppedDrawing: false,
    copyNextActive: false,
    hasBuyBurnFirst: false,
    hasExtraBuy: false,
    extraBuyUsed: false,
  };
}


function initState(numPlayers, players) {
  uidCounter = 0;
  const n = numPlayers || 2;
  return {
    numPlayers: n,
    currentAct: 1,
    phase: 'start',
    roundNumber: 1,
    players: players || [createPlayer('You', true, 0), createPlayer('Cowboy AI', false, 1)],
    pyramid: [],
    log: [],
    buyOrder: [],
    currentBuyerIdx: 0,
    drawsDone: {},
    selectedPyramidCard: null,
    awaitingPutOnTopCard: null, // set while player is choosing a card to put on top of deck
    busy: false,
    playerOrder: Array.from({length: n}, (_, i) => i), // G.players[i] → Firebase slot index (SP default: identity)
    seatOrder: Array.from({length: n}, (_, i) => i), // slot indices in clockwise seat order (shuffled at game start)
    gameSeed: 0,
  };
}

// --- PYRAMID ---

// Build pyramid from act pool; if cardIds provided (MP), use that fixed order
function buildPyramid(act, cardIds) {
  const numRows = G.numPlayers + 3; // 2P→5, 3P→6, 4P→7
  const needed = (numRows * (numRows + 1)) / 2;

  let selected;
  if (cardIds) {
    // MP: reconstruct cards from shared IDs
    selected = cardIds.map(id => STORE_CARDS.find(c => c.id === id)).filter(Boolean);
  } else {
    const pool = shuffle(getActPool(act));
    if (pool.length < needed) {
      console.warn(`Act ${act} only has ${pool.length} cards, need ${needed}. Using all available.`);
    }
    selected = pool.slice(0, Math.min(needed, pool.length));
  }

  const pyramid = [];
  let idx = 0;
  for (let row = 0; row < numRows; row++) {
    const rowArr = [];
    for (let col = 0; col <= row; col++) {
      if (idx < selected.length) {
        const card = createCardInstance(selected[idx]);
        const faceUp = (row === numRows - 1);
        rowArr.push({ card, faceUp, removed: false });
        idx++;
      }
    }
    pyramid.push(rowArr);
  }
  return pyramid;
}

function isCardCovered(pyramid, row, col) {
  if (row >= pyramid.length - 1) return false;
  const nextRow = pyramid[row + 1];
  const leftBelow = nextRow[col];
  const rightBelow = nextRow[col + 1];
  const leftPresent = leftBelow && !leftBelow.removed;
  const rightPresent = rightBelow && !rightBelow.removed;
  return leftPresent || rightPresent;
}

function revealUncovered(pyramid) {
  let revealed = [];
  for (let row = 0; row < pyramid.length; row++) {
    for (let col = 0; col < pyramid[row].length; col++) {
      const slot = pyramid[row][col];
      if (!slot.removed && !slot.faceUp && !isCardCovered(pyramid, row, col)) {
        slot.faceUp = true;
        revealed.push(slot);
      }
    }
  }
  return revealed;
}

function getAvailablePyramidCards(pyramid) {
  const cards = [];
  for (let row = 0; row < pyramid.length; row++) {
    for (let col = 0; col < pyramid[row].length; col++) {
      const slot = pyramid[row][col];
      if (!slot.removed && slot.faceUp) {
        cards.push({ row, col, slot });
      }
    }
  }
  return cards;
}

function isPyramidEmpty(pyramid) {
  for (const row of pyramid) {
    for (const slot of row) {
      if (!slot.removed) return false;
    }
  }
  return true;
}

// --- DECK OPERATIONS ---

function drawFromDeck(player) {
  if (player.deck.length === 0) {
    if (player.discard.length === 0) return null;
    player.deck = shuffleForPlayer(player.discard, player.slotIdx, player.isHuman);
    player.discard = [];
    // Cut: move top card to bottom
    if (player.deck.length > 1) {
      player.deck.push(player.deck.shift());
    }
    addLog(`${player.name}'s deck is empty! Shuffled ${player.deck.length} cards from discard into a new deck.`, 'log-score');
  }
  return player.deck.shift();
}

// Checks if deck is empty and prompts human before auto-reshuffling
async function playerDrawWithReshuffleCheck() {
  const player = G.players[0];
  if (player.deck.length === 0 && player.discard.length > 0) {
    return new Promise(resolve => {
      setMessage(`Your deck is empty! Shuffle ${player.discard.length} cards from discard into a new deck?`);
      setActions([
        { text: 'Shuffle Discard', onClick: () => {
          player.deck = shuffle(player.discard);
          player.discard = [];
          if (player.deck.length > 1) {
            player.deck.push(player.deck.shift());
          }
          addLog(`You shuffled ${player.deck.length} cards from discard into a new deck.`, 'log-score');
          render();
          mpSyncDraw();
          resolve(true);
        }},
        { text: 'Stop Drawing', onClick: () => {
          player.stoppedDrawing = true;
          addLog('You stopped drawing.');
          resolve(false);
        }, className: 'btn-secondary' },
      ]);
    });
  }
  return true; // deck has cards, proceed
}

function resetPlayerRound(player) {
  player.hand = [];
  player.roundDollars = 0;
  player.roundCows = 0;
  player.roundBandits = 0;
  player.busted = false;
  player.stoppedDrawing = false;
  player.copyNextActive = false;
  player.hasBuyBurnFirst = false;
  player.hasExtraBuy = false;
  player.extraBuyUsed = false;
  if (G) G.awaitingPutOnTopCard = null;
}

// --- CARD EFFECTS ---

function applyCardEffects(player, card, isFirstCard) {
  // Special: trash_to_use — card contributes nothing when drawn; effects apply only on activation
  if (card.special === 'trash_to_use') {
    return { dollars: 0, cows: 0, bandits: 0 };
  }

  let multiplier = player.copyNextActive ? 2 : 1;
  if (player.copyNextActive) {
    player.copyNextActive = false;
    addLog(`Copy Next Card doubled this card's effects!`);
  }

  let dollars = card.dollars * multiplier;
  let cows = card.cows * multiplier;
  let bandits = card.bandits * multiplier;

  // Special: 2cow_if_first
  if (card.special === '2cow_if_first' && isFirstCard) {
    cows = 2;
    addLog(`Drawn first! 2 Cows instead of normal effect.`);
  }

  player.roundDollars += dollars;
  player.roundCows += cows;
  player.roundBandits += bandits;

  // Special: copy_next
  if (card.special === 'copy_next') {
    player.copyNextActive = true;
  }

  // Special: trash_buy_burn_first
  if (card.special === 'trash_buy_burn_first') {
    // Will handle in UI - player can choose to trash for priority
  }

  // Special: dollar1_other — gives $1 to each other player
  if (card.special === 'dollar1_other' && G) {
    for (let i = 0; i < G.numPlayers; i++) {
      if (G.players[i] !== player) G.players[i].roundDollars += 1;
    }
  }

  return { dollars, cows, bandits };
}

// --- LOGGING ---

const SUIT_NAME = { 1: 'River', 2: 'Cactus', 3: 'Rattlesnake' };
const SPECIAL_LABEL = {
  trash_to_use:        'Trash to Use',
  discard_to_player:   'Discard to Player',
  trash_buy_burn_first:'Trash: Buy/Burn 1st',
  '2cow_if_first':     '2 Cows if 1st',
  trash_for_2:         'Trash for $2',
  look3_rearrange:     'Trash: Rearrange 3',
  copy_next:           'Copy Next',
  put_on_top:          'Put on Top',
  replay_discard:      'Replay Discard',
  dollar1_other:       '+$1 to Others',
  draw4:               '& Draw 4',
  look3_immediate:     'Look at Top 3',
};

function cardLabel(card) {
  const suit = SUIT_NAME[card.cacti] || '?';
  const parts = [];
  if (card.dollars > 0)  parts.push(`$${card.dollars}`);
  if (card.cows   > 0)   parts.push(`${card.cows} Cow${card.cows > 1 ? 's' : ''}`);
  if (card.cows   < 0)   parts.push(`${card.cows} Cow`);
  if (card.bandits > 0)  parts.push(`${card.bandits} Bandit${card.bandits > 1 ? 's' : ''}`);
  if (card.bandits < 0)  parts.push(`-1 Bandit`);
  if (card.special && SPECIAL_LABEL[card.special]) parts.push(`(${SPECIAL_LABEL[card.special]})`);
  return suit + (parts.length ? ': ' + parts.join(', ') : '');
}

function addLog(text, className) {
  if (!G) return;
  G.log.unshift({ text, className: className || '' });
  if (G.log.length > 50) G.log.pop();
  renderLog();
}

// --- RENDERING ---

function cardImgSrc(card, faceUp) {
  if (!faceUp) {
    return BACK_IMG_PATH + (CACTI_BACK[card.cacti] || 'Blue Inline-01.jpg');
  }
  return CARD_IMG_PATH + card.img;
}

function renderCardEl(card, faceUp, extraClasses) {
  const div = document.createElement('div');
  div.className = 'card' + (extraClasses ? ' ' + extraClasses : '');
  div.dataset.uid = card.uid;
  const img = document.createElement('img');
  img.src = cardImgSrc(card, faceUp);
  img.alt = card.id;
  img.draggable = false;
  div.appendChild(img);
  if (faceUp) {
    div.onclick = (e) => {
      e.stopPropagation();
      showCardZoom(cardImgSrc(card, true));
    };
  }
  return div;
}

// Returns indices of all non-busted players currently leading on dollars
// (then cows as tiebreak). Only meaningful during the draw phase.
function getDrawLeaders() {
  if (!G || G.phase !== 'draw') return [];
  let candidates = G.players
    .map((p, i) => ({ p, i }))
    .filter(c => !c.p.busted && c.p.hand.length > 0);
  if (candidates.length === 0) return [];

  function narrowBy(scoreFn) {
    if (candidates.length <= 1) return;
    const best = Math.max(...candidates.map(scoreFn));
    candidates = candidates.filter(c => scoreFn(c) === best);
  }

  // Mirror the tiebreaker chain from shared/tiebreaker.js (deterministic steps only).
  // Only show multiple crowns when it comes down to the random tiebreaker.
  narrowBy(c => c.p.roundDollars);
  narrowBy(c => c.p.roundCows);
  narrowBy(c => c.p.hand.length);

  if (candidates.length > 1) {
    const maxLen = Math.max(...candidates.map(c => c.p.hand.length));
    for (let i = 0; i < maxLen; i++) {
      const prev = candidates.slice();
      narrowBy(c => (c.p.hand[i] && c.p.hand[i].cost) || 0);
      if (candidates.length < prev.length) break;
    }
  }

  // If still multiple, it's a complete tie — show all (random step decides, multi-crown is OK).
  return candidates.map(c => c.i);
}

// Updates all contextual zone indicators:
//   draw phase  → gold crown + border on the current dollar leader
//   buy phase   → pulsing amber border on the active buyer
//   any phase   → red border on busted players
function updateTurnOrderBar() {
  const bar = document.getElementById('turn-order-bar');
  if (!bar) return;

  // Display players in seat order (G.seatOrder is a shuffled array of slot indices).
  // Convert each seat slot to the corresponding G.players index.
  const slotToPlayerIdx = MP.active
    ? (s => MP.slotToPlayer[s])
    : (s => s);
  const displayOrder = G.seatOrder.map(slotToPlayerIdx).filter(i => i !== undefined);

  // Determine which player index is currently "active"
  let activeIdx = -1;
  if (G.phase === 'buy' && G.buyOrder && G.currentBuyerIdx < G.buyOrder.length) {
    activeIdx = G.buyOrder[G.currentBuyerIdx];
  } else if (G.phase === 'draw') {
    const leaders = getDrawLeaders();
    activeIdx = leaders.length === 1 ? leaders[0] : -1;
  }

  const parts = [];
  displayOrder.forEach((pi, idx) => {
    if (idx > 0) parts.push('<span class="tor-arrow">›</span>');
    const p = G.players[pi];
    const name = p.name;
    let cls = 'tor-player';
    if (pi === activeIdx) cls += ' tor-active';
    else if (p.busted) cls += ' tor-busted';
    parts.push(`<span class="${cls}">${name}</span>`);
  });

  bar.innerHTML = parts.join('');
  bar.classList.toggle('hidden', G.numPlayers <= 1);
}

function updateZoneStates() {
  const leaders = getDrawLeaders();
  const activeBuyerPlayerIdx =
    G.phase === 'buy' && G.buyOrder && G.currentBuyerIdx < G.buyOrder.length
      ? G.buyOrder[G.currentBuyerIdx]
      : -1;

  for (let i = 0; i < G.numPlayers; i++) {
    const prefix   = i === 0 ? 'player' : 'opp-' + i;
    const crownEl  = document.getElementById(prefix + '-crown');
    const doneEl   = document.getElementById(prefix + '-done-mark');
    const zoneEl   = i === 0
      ? document.getElementById('player-zone')
      : document.getElementById('opp-zone-' + i);
    const isLeader = leaders.includes(i);
    const isBusted = G.players[i].busted;
    const isBuying = activeBuyerPlayerIdx === i && !isBusted;
    const isDone   = G.phase === 'draw' && !!G.drawsDone[i];
    if (crownEl) crownEl.classList.toggle('crown-visible', isLeader);
    if (doneEl)  doneEl.classList.toggle('hidden', !isDone);
    if (zoneEl) {
      zoneEl.classList.toggle('draw-leader', isLeader);
      zoneEl.classList.toggle('zone-busted',  isBusted);
      zoneEl.classList.toggle('zone-buying',   isBuying);
      zoneEl.classList.toggle('zone-draw-done', isDone);
    }
  }
}

function render() {
  if (!G || G.phase === 'start' || G.phase === 'draft') return;

  // Always clear hover preview on every render (phase changes, store resets, etc.)
  hideCardHoverPreview();

  // Clear card preview whenever nothing is selected
  if (!G.selectedPyramidCard) clearCardPreview();

  // Phase class on body for CSS-driven layout switching
  document.body.classList.remove('phase-draw', 'phase-buy');
  if (G.phase === 'draw') document.body.classList.add('phase-draw');
  else if (G.phase === 'buy' || G.phase === 'score') document.body.classList.add('phase-buy');

  // Header
  document.getElementById('act-display').textContent = 'Act ' + G.currentAct;
  document.getElementById('round-display').textContent = 'Round ' + G.roundNumber;

  // Players
  renderPlayerZone(G.players[0], 'player');
  const oz = document.getElementById('opponents-zone');
  for (let i = 1; i < G.numPlayers; i++) {
    ensureOpponentZone(i, oz);
    renderPlayerZone(G.players[i], 'opp-' + i);
  }

  // Pyramid
  renderPyramid();

  // Zone state indicators (crown, bust, active buyer)
  updateZoneStates();

  // Turn order bar
  updateTurnOrderBar();
}

const HERD_TIERS = [
  { max: 5,        size: '0.9rem', weight: 400, color: '#7aaa7a', shadow: 'none',                                                       spacing: '0px',   bump: 1.2,  dustW0: '10px', dustH0: '6px',  dustW1: '18px', dustH1: '11px', pulse: false },
  { max: 15,       size: '1.2rem', weight: 600, color: '#3a8c3a', shadow: 'none',                                                       spacing: '0px',   bump: 1.28, dustW0: '12px', dustH0: '8px',  dustW1: '22px', dustH1: '14px', pulse: false },
  { max: 35,       size: '1.6rem', weight: 700, color: '#2b7a2b', shadow: 'none',                                                       spacing: '0.5px', bump: 1.35, dustW0: '14px', dustH0: '9px',  dustW1: '26px', dustH1: '17px', pulse: false },
  { max: 70,       size: '2.1rem', weight: 700, color: '#1a6e1a', shadow: '0 1px 4px rgba(26,94,26,0.25)',                              spacing: '0.5px', bump: 1.42, dustW0: '16px', dustH0: '10px', dustW1: '30px', dustH1: '20px', pulse: false },
  { max: 110,      size: '2.6rem', weight: 800, color: '#145c14', shadow: '0 2px 8px rgba(20,92,20,0.35)',                              spacing: '1px',   bump: 1.5,  dustW0: '20px', dustH0: '13px', dustW1: '36px', dustH1: '24px', pulse: true  },
  { max: Infinity, size: '3.1rem', weight: 900, color: '#0d4d0d', shadow: '0 0 12px rgba(46,204,113,0.5), 0 2px 6px rgba(13,77,13,0.4)', spacing: '1.5px', bump: 1.6,  dustW0: '24px', dustH0: '16px', dustW1: '44px', dustH1: '28px', pulse: true  },
];

function applyHerdTier(numEl, dustEl, n) {
  const t = HERD_TIERS.find(tier => n <= tier.max);
  numEl.style.setProperty('--herd-size',    t.size);
  numEl.style.setProperty('--herd-weight',  t.weight);
  numEl.style.setProperty('--herd-color',   t.color);
  numEl.style.setProperty('--herd-shadow',  t.shadow);
  numEl.style.setProperty('--herd-spacing', t.spacing);
  numEl.style.setProperty('--bump-scale',   t.bump);
  if (dustEl) {
    dustEl.style.setProperty('--dust-w0', t.dustW0);
    dustEl.style.setProperty('--dust-h0', t.dustH0);
    dustEl.style.setProperty('--dust-w1', t.dustW1);
    dustEl.style.setProperty('--dust-h1', t.dustH1);
  }
  if (t.pulse) {
    numEl.classList.add('pulsing');
  } else {
    numEl.classList.remove('pulsing');
  }
}

function triggerHerdBump(prefix) {
  const numEl  = document.getElementById(prefix + '-herd');
  const dustEl = document.getElementById(prefix + '-herd-dust');
  if (!numEl) return;
  numEl.classList.remove('bumping');
  if (dustEl) dustEl.classList.remove('puffing');
  void numEl.offsetWidth;
  numEl.classList.add('bumping');
  if (dustEl) dustEl.classList.add('puffing');
  numEl.addEventListener('animationend', () => numEl.classList.remove('bumping'), { once: true });
  if (dustEl) dustEl.addEventListener('animationend', () => dustEl.classList.remove('puffing'), { once: true });
}

function renderPlayerZone(player, prefix) {
  const herdEl = document.getElementById(prefix + '-herd');
  herdEl.textContent = player.herd;
  applyHerdTier(herdEl, document.getElementById(prefix + '-herd-dust'), player.herd);
  document.getElementById(prefix + '-deck-count').textContent = player.deck.length;
  // For remote players, use the synced discard count (current pile size, not cumulative),
  // since their local discard array isn't kept in sync after reshuffles.
  const discardCount = (prefix !== 'player' && player._syncedDiscardCount !== undefined)
    ? player._syncedDiscardCount
    : player.discard.length;
  document.getElementById(prefix + '-discard-count').textContent = discardCount;

  // Round stats
  const hasRoundStats = player.hand.length > 0 || G.phase === 'buy';

  if (prefix !== 'player') {
    // Opponents use inline stats in their summary bar
    const inlineStats = document.getElementById(prefix + '-round-stats-inline');
    if (hasRoundStats) {
      inlineStats.classList.remove('hidden');
      document.getElementById(prefix + '-round-dollars').textContent = player.roundDollars;
      document.getElementById(prefix + '-round-cows').textContent = player.roundCows;
      document.getElementById(prefix + '-round-bandits').textContent = player.roundBandits;
    } else {
      inlineStats.classList.add('hidden');
    }
  } else {
    // Player uses the standard round-stats bar
    const statsEl = document.getElementById('player-round-stats');
    if (hasRoundStats) {
      statsEl.classList.remove('hidden');
      document.getElementById('player-round-dollars').textContent = player.roundDollars;
      document.getElementById('player-round-cows').textContent = player.roundCows;
      document.getElementById('player-round-bandits').textContent = player.roundBandits;
    } else {
      statsEl.classList.add('hidden');
    }
  }

  // Hand
  const handEl = document.getElementById(prefix + '-hand');
  handEl.innerHTML = '';

  if (prefix === 'player' && G.awaitingPutOnTopCard) {
    // Re-render put_on_top selection UI so concurrent render() calls don't wipe it
    renderPutOnTopSelection(player, G.awaitingPutOnTopCard);
  } else {
    const showFaceUp = true;
    // Highlight cards that currently have an active special button in the actions bar
    const activeSpecialUids = (prefix === 'player' && G.phase === 'draw')
      ? new Set(getActivatableCards(player).map(c => c.uid))
      : new Set();
    for (const card of player.hand) {
      const classes = [player.busted ? 'busted' : '', activeSpecialUids.has(card.uid) ? 'card-active-special' : '']
        .filter(Boolean).join(' ');
      const el = renderCardEl(card, showFaceUp, classes);
      el.addEventListener('mouseenter', () => showCardHoverPreview(el, card));
      el.addEventListener('mouseleave', hideCardHoverPreview);
      handEl.appendChild(el);
    }
  }

  // Deck preview (show back of next card)
  renderDeckPreview(player, prefix);
}

function renderDeckPreview(player, prefix) {
  const previewEl = document.getElementById(prefix + '-deck-preview');
  previewEl.innerHTML = '';

  const canPeek = prefix === 'player' && G.phase === 'draw' && player.deck.length > 0;

  if (player.deck.length > 0 && G.phase === 'draw' && !player.busted && !player.stoppedDrawing) {
    const nextCard = player.deck[0];
    const el = renderCardEl(nextCard, false); // face-down shows the back
    if (canPeek) el.classList.add('deck-peek-clickable');
    previewEl.appendChild(el);
    const label = document.createElement('div');
    label.className = 'deck-label';
    label.textContent = prefix === 'player' ? 'Next' : `Deck (${player.deck.length})`;
    previewEl.appendChild(label);
  } else if (player.deck.length > 0) {
    // Show deck pile indicator even when not drawing
    const nextCard = player.deck[0];
    const el = renderCardEl(nextCard, false);
    el.style.opacity = '0.4';
    if (canPeek) el.classList.add('deck-peek-clickable');
    previewEl.appendChild(el);
    const label = document.createElement('div');
    label.className = 'deck-label';
    label.textContent = `Deck (${player.deck.length})`;
    previewEl.appendChild(label);
  }

  if (canPeek) {
    previewEl.style.cursor = 'pointer';
    previewEl.onclick = showDeckPeek;
  } else {
    previewEl.style.cursor = '';
    previewEl.onclick = null;
  }
}

function renderPyramid() {
  const pyramidEl = document.getElementById('pyramid');
  pyramidEl.innerHTML = '';

  for (let row = 0; row < G.pyramid.length; row++) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'pyramid-row';
    for (let col = 0; col < G.pyramid[row].length; col++) {
      const slot = G.pyramid[row][col];
      if (!slot || !slot.card) continue; // defensive: skip corrupted slots
      if (slot.removed) {
        const empty = document.createElement('div');
        empty.className = 'card-slot';
        rowDiv.appendChild(empty);
      } else {
        const classes = [];
        if (G.phase === 'buy' && slot.faceUp && G.buyOrder[G.currentBuyerIdx] === 0) {
          const human = G.players[0];
          if (!human.busted) {
            classes.push('clickable');
            if (slot.card.cost <= human.roundDollars) {
              classes.push('affordable');
            } else {
              classes.push('dimmed');
            }
          }
        }
        if (G.selectedPyramidCard && G.selectedPyramidCard.row === row && G.selectedPyramidCard.col === col) {
          classes.push('selected');
        }
        const el = renderCardEl(slot.card, slot.faceUp, classes.join(' '));
        if (slot.faceUp && slot.card.cost) {
          const costLabel = document.createElement('div');
          costLabel.className = 'card-cost';
          costLabel.textContent = '$' + slot.card.cost;
          el.appendChild(costLabel);
        }
        el.dataset.row = row;
        el.dataset.col = col;
        if (classes.includes('clickable')) {
          el.onclick = () => onPyramidCardClick(row, col);
        }
        if (slot.faceUp) {
          el.addEventListener('mouseenter', () => showCardHoverPreview(el, slot.card));
          el.addEventListener('mouseleave', hideCardHoverPreview);
        }
        rowDiv.appendChild(el);
      }
    }
    pyramidEl.appendChild(rowDiv);
  }
}

function renderLog() {
  const logEl = document.getElementById('game-log');
  logEl.innerHTML = '';
  for (const entry of G.log.slice(0, 20)) {
    const div = document.createElement('div');
    div.textContent = entry.text;
    if (entry.className) div.className = entry.className;
    logEl.appendChild(div);
  }
}

function setMessage(text) {
  document.getElementById('message').textContent = text;
}

function setActions(buttons) {
  const el = document.getElementById('actions');
  el.innerHTML = '';
  for (const btn of buttons) {
    const b = document.createElement('button');
    b.className = 'btn' + (btn.className ? ' ' + btn.className : '');
    b.textContent = btn.text;
    b.onclick = btn.onClick;
    if (btn.disabled) b.disabled = true;
    if (btn.style) b.style.cssText = btn.style;
    el.appendChild(b);
  }
}

function clearActions() {
  document.getElementById('actions').innerHTML = '';
  clearCardPreview();
}

// Animate a drawn card: fly from the deck preview position to the hand slot,
// then flip back-to-face. Falls back to flip-only if no deck card is visible.
// rAF ensures we target the final DOM element after all synchronous renders.
function animateDrawnCard(card) {
  requestAnimationFrame(() => {
    const handCard = document.querySelector(`#player-hand [data-uid="${card.uid}"]`);
    if (!handCard) return;
    const img = handCard.querySelector('img');
    if (!img) return;

    const faceSrc = img.src;
    const backSrc = cardImgSrc(card, false);

    const deckCard = document.querySelector('#player-deck-preview .card');
    if (deckCard) {
      const deckRect = deckCard.getBoundingClientRect();
      const handRect = handCard.getBoundingClientRect();

      // Build a face-down flyer positioned over the deck card
      const flyer = document.createElement('div');
      const flyImg = document.createElement('img');
      flyImg.src = backSrc;
      flyImg.alt = card.id;
      flyImg.draggable = false;
      flyImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      flyer.appendChild(flyImg);
      Object.assign(flyer.style, {
        position: 'fixed',
        left: `${deckRect.left}px`,
        top: `${deckRect.top}px`,
        width: `${deckRect.width}px`,
        height: `${deckRect.height}px`,
        zIndex: '500',
        pointerEvents: 'none',
        borderRadius: '6px',
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
      });
      document.body.appendChild(flyer);

      // Hide the destination card slot while the flyer is in flight
      handCard.style.visibility = 'hidden';

      // Translate using center-to-center so scale (if sizes differ) stays aligned
      const dx = (handRect.left + handRect.width / 2) - (deckRect.left + deckRect.width / 2);
      const dy = (handRect.top + handRect.height / 2) - (deckRect.top + deckRect.height / 2);
      const sx = handRect.width / deckRect.width;
      const sy = handRect.height / deckRect.height;

      const anim = flyer.animate([
        { transform: 'translate(0,0) scale(1,1)' },
        { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
      ], { duration: 260, easing: 'cubic-bezier(0.4,0,0.2,1)', fill: 'forwards' });

      anim.onfinish = () => {
        flyer.remove();
        handCard.style.visibility = '';
        doCardFlip(handCard, img, backSrc, faceSrc);
      };
    } else {
      // Deck is now empty — no preview to fly from, just flip
      doCardFlip(handCard, img, backSrc, faceSrc);
    }
  });
}

function doCardFlip(el, img, backSrc, faceSrc) {
  img.src = backSrc;
  el.classList.add('card-flip-out');
  el.addEventListener('animationend', () => {
    el.classList.remove('card-flip-out');
    img.src = faceSrc;
    el.classList.add('card-flip-in');
    el.addEventListener('animationend', () => {
      el.classList.remove('card-flip-in');
    }, { once: true });
  }, { once: true });
}

function setCardPreview(card) {
  const el = document.getElementById('card-preview');
  el.innerHTML = '';
  if (!card) { el.classList.add('hidden'); return; }
  const cardEl = renderCardEl(card, true);
  cardEl.classList.add('preview-card');
  el.appendChild(cardEl);
  el.classList.remove('hidden');
}

function clearCardPreview() {
  const el = document.getElementById('card-preview');
  el.innerHTML = '';
  el.classList.add('hidden');
}

// Push local player's draw state to Firebase (MP only, no-op otherwise).
// Host also pushes a full spectatorState snapshot so spectators see all players.
// In AI mode, push to AI_SPEC so the game is watchable from history.html.
function mpSyncDraw() {
  if (MP.active) {
    MP.pushDrawState(G.players[0]);
    MP.pushSpectatorState(); // no-op for non-hosts
  } else {
    AI_SPEC.push();
  }
}

// --- GAME FLOW ---

// ============================================================
// QUICK START DRAFT
// ============================================================

// Seeded shuffle for draft pack dealing — all MP clients derive identical packs from gameSeed
function seededDraftShuffle(arr, gameSeed) {
  const a = [...arr];
  let seed = ((gameSeed ^ 0x5a5a5a5a) >>> 0) || 1;
  function next() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// AI picks the highest-cost card; tiebreak by most cows, then card id for determinism
function aiDraftPick(pack) {
  if (!pack || pack.length === 0) return null;
  return pack.slice().sort((a, b) => {
    if (b.cost !== a.cost) return b.cost - a.cost;
    if (b.cows !== a.cows) return b.cows - a.cows;
    return a.id.localeCompare(b.id);
  })[0].id;
}

// Append a line to the draft overlay's running log
function addDraftLog(text) {
  const log = document.getElementById('draft-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = 'draft-log-entry';
  entry.textContent = text;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// Show the current pack in the draft overlay; resolves with the card ID the human picks
function showDraftPackAndWait(pack, round) {
  return new Promise(resolve => {
    document.getElementById('draft-round-label').textContent =
      `Round ${round + 1} of 4 \u2014 ${pack.length} cards to choose from`;

    const grid = document.getElementById('draft-card-grid');
    const msgEl = document.getElementById('draft-message');
    grid.innerHTML = '';
    msgEl.textContent = 'Pick a card to add to your deck.';

    let picked = false;
    pack.forEach(card => {
      const el = renderCardEl(card, true);
      // Override renderCardEl's default zoom-on-click so clicking picks the card
      el.onclick = (e) => {
        if (picked) return;
        picked = true;
        e.stopPropagation();
        // Highlight chosen card, dim the rest
        grid.querySelectorAll('.card').forEach(c => {
          c.classList.add('draft-unchosen');
        });
        el.classList.remove('draft-unchosen');
        el.classList.add('draft-selected');
        msgEl.textContent = G.numPlayers > 1 ? 'Waiting for others\u2026' : '';
        resolve(card.id);
      };
      grid.appendChild(el);
    });
  });
}

async function runQuickStartDraft() {
  G.phase = 'draft';

  const overlay = document.getElementById('draft-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('draft-log').innerHTML = '';

  // Deal packs: seeded so all MP clients compute the same initial layout
  const pool = seededDraftShuffle(getActPool(1), G.gameSeed);
  const neededCards = G.numPlayers * 6;
  if (pool.length < neededCards) {
    console.warn(`[Draft] Act 1 pool has ${pool.length} cards, need ${neededCards}.`);
  }

  // packs[playerIdx] = cards currently held by that player
  let packs = [];
  for (let i = 0; i < G.numPlayers; i++) {
    const templates = pool.slice(i * 6, i * 6 + 6);
    packs.push(templates.map(c => createCardInstance(c)));
  }

  addLog('--- Quick Start Draft begins! ---', 'log-score');

  // 4 draft rounds
  for (let round = 0; round < 4; round++) {
    const picks = new Array(G.numPlayers).fill(null);

    // Local human always at index 0
    const humanPickId = await showDraftPackAndWait(packs[0], round);
    picks[0] = humanPickId;

    if (MP.active) {
      await MP.pushDraftPick(round, humanPickId);
      document.getElementById('draft-message').textContent = 'Waiting for other players\u2026';
      // Receive human opponent picks from Firebase; compute AI picks locally
      const opponentPicks = await MP.waitForDraftRoundPicks(round);
      for (let i = 1; i < G.numPlayers; i++) {
        const p = G.players[i];
        picks[i] = p.isHuman ? opponentPicks[p.slotIdx] : aiDraftPick(packs[i]);
      }
    } else {
      for (let i = 1; i < G.numPlayers; i++) {
        picks[i] = aiDraftPick(packs[i]);
      }
    }

    // Apply picks: add chosen card to player's discard; pass remaining to next player
    const newPacks = new Array(G.numPlayers);
    for (let i = 0; i < G.numPlayers; i++) {
      const pickedId = picks[i];
      const pickedCard = packs[i].find(c => c.id === pickedId);
      if (pickedCard) {
        G.players[i].discard.push(pickedCard);
        if (i === 0) {
          const costStr = pickedCard.cost > 0 ? ` (cost $${pickedCard.cost})` : '';
          addDraftLog(`Round ${round + 1}: You drafted Card ${pickedCard.id.replace('card_', '')}${costStr}.`);
          addLog(`Draft round ${round + 1}: You drafted Card ${pickedCard.id.replace('card_', '')}${costStr}.`);
        }
      }
      newPacks[(i + 1) % G.numPlayers] = packs[i].filter(c => c.id !== pickedId);
    }
    packs = newPacks;

    if (round < 3) {
      document.getElementById('draft-message').textContent = 'Passing cards to next player\u2026';
      await delay(700);
    }
  }

  // Done — remaining 2 cards per pack are discarded
  document.getElementById('draft-round-label').textContent = 'Draft complete!';
  document.getElementById('draft-card-grid').innerHTML = '';
  document.getElementById('draft-message').textContent = '';
  addDraftLog('Remaining cards trashed. Starting Act 2\u2026');
  addLog('Quick Start Draft complete \u2014 4 cards drafted into each deck.', 'log-score');

  await delay(1600);
  overlay.classList.add('hidden');

  await setupAct(2);
}

async function startGame() {
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('opponents-zone').innerHTML = ''; // clear for fresh game

  if (MP.active) {
    const isRejoin = new URLSearchParams(location.search).has('rejoin');
    setMessage(isRejoin ? 'Reconnecting to game...' : 'Connecting to game...');
    clearActions();
    try {
      await MP.init();
    } catch (e) {
      setMessage('Failed to connect. Please refresh and try again.');
      console.error(e);
      return;
    }
    const cfg = await MP.buildPlayersConfig();
    await MP.startPresence();
    MP.saveRejoinInfo();

    if (isRejoin) {
      // --- Rejoin path: restore G from spectatorState ---
      const state = await MP.fetchSpectatorState();
      if (!state) {
        setMessage('Could not restore game — the game may have ended.');
        setActions([{ text: 'Back to Home', onClick: () => { window.location.href = 'gamesetup.html'; } }]);
        return;
      }
      await reconstructG(state, cfg);
      if (MP.active) document.getElementById('btn-spectate-link').classList.remove('hidden');
      render();
      addLog(`Rejoined game — Act ${G.currentAct}, Round ${G.roundNumber}`);
      if (state.phase === 'draw') {
        await resumeDrawPhase();
      } else if (state.phase === 'buy') {
        resumeBuyPhase();
      } else if (state.phase === 'gameOver') {
        gameOver();
      } else {
        // Fallback: re-arm spectator state and wait
        setMessage('Waiting for the current phase to begin…');
      }
      return;
    }

    // --- Normal path ---
    // Initialize seeded RNG for each AI slot
    cfg.slotDefs.forEach((def, slotIdx) => {
      if (!def.isHuman) initAiRng(slotIdx, cfg.gameSeed);
    });

    // G.players[0] = local human; remaining slots in order skipping mySlot
    const G_playerOrder = [MP.mySlot];
    for (let s = 0; s < cfg.numPlayers; s++) {
      if (s !== MP.mySlot) G_playerOrder.push(s);
    }

    // slotToPlayer: Firebase slot index → G.players index
    MP.slotToPlayer = {};
    G_playerOrder.forEach((slotIdx, i) => { MP.slotToPlayer[slotIdx] = i; });

    const players = G_playerOrder.map((slotIdx) => {
      const def = cfg.slotDefs[slotIdx];
      return createPlayer(def.name, def.isHuman, slotIdx, def.personality);
    });

    G = initState(cfg.numPlayers, players);
    G.playerOrder = G_playerOrder;
    G.gameSeed = cfg.gameSeed || 0;
    // Randomize seat order (clockwise rotation) using gameSeed — deterministic on all clients
    G.seatOrder = seededSeatOrder(cfg.numPlayers, G.gameSeed);
    G.quickStartMode = cfg.quickStartMode || false;
  } else {
    // Read player config from sessionStorage (set by game.html for 3P/4P)
    const storedCount = parseInt(sessionStorage.getItem('player_count') || '2', 10);
    const storedDefs = JSON.parse(sessionStorage.getItem('player_defs') || 'null');
    if (storedDefs && storedDefs.length >= 2) {
      const players = storedDefs.map((d, i) => createPlayer(d.name, d.isHuman, i, d.personality));
      G = initState(storedCount, players);
    } else {
      G = initState(2);
    }
    // Generate a random seed for SP mode (used for tiebreaking and seat order)
    G.gameSeed = (Math.random() * 0xFFFFFFFF) >>> 0 || 1;
    G.seatOrder = seededSeatOrder(G.numPlayers, G.gameSeed);
    G.quickStartMode = sessionStorage.getItem('quick_start_mode') === '1';
  }

  // --- Debug scenario injection (SP only) ---
  if (!MP.active) {
    const debugScenario = sessionStorage.getItem('debug_scenario');
    if (debugScenario) {
      sessionStorage.removeItem('debug_scenario');
      applyDebugScenario(debugScenario);
      render();
      startRound();
      return;
    }
  }

  // Show spectator-link button for MP players; also shown for AI after AI_SPEC.start() sets the code
  if (MP.active) {
    document.getElementById('btn-spectate-link').classList.remove('hidden');
    if (MP.isHost) {
      document.getElementById('btn-disband').classList.remove('hidden');
    } else {
      MP.watchForDisband();
    }
  }

  // Register this game as live so history.html can show it with a spectate button
  if (MP.active && MP.isHost) await MP.setLiveStatus('active');
  else if (!MP.active) {
    await AI_SPEC.start(G.players);
    // Now that we have a code, show the spectate link button
    if (AI_SPEC.active) document.getElementById('btn-spectate-link').classList.remove('hidden');
  }

  if (G.quickStartMode) {
    await runQuickStartDraft();
  } else {
    await setupAct(1);
  }
}

function restartGame() {
  if (MP.active) {
    // In MP mode, can't restart — go back to lobby
    window.location.href = 'gamesetup.html';
    return;
  }
  startGame();
}

// --- REJOIN / GAME RECONSTRUCTION ---

// Rebuild G from a spectatorState snapshot (called during MP rejoin).
// spectatorState.players is ordered by the host's G.players indices (= slot indices for host).
async function reconstructG(state, cfg) {
  // Re-init AI RNGs from seed (mid-game rejoin can't restore exact RNG state, but game state
  // is fully restored from spectatorState so AI card choices going forward are fine)
  cfg.slotDefs.forEach((def, slotIdx) => {
    if (!def.isHuman) initAiRng(slotIdx, cfg.gameSeed);
  });

  // Build G.playerOrder with local player at index 0
  const G_playerOrder = [MP.mySlot];
  for (let s = 0; s < cfg.numPlayers; s++) {
    if (s !== MP.mySlot) G_playerOrder.push(s);
  }
  MP.slotToPlayer = {};
  G_playerOrder.forEach((slotIdx, i) => { MP.slotToPlayer[slotIdx] = i; });

  // state.players is ordered by host's slot order (slot 0 first, then 1, etc.)
  const slotToStatePlayer = {};
  state.players.forEach(sp => { slotToStatePlayer[sp.slotIdx] = sp; });

  const players = G_playerOrder.map((slotIdx) => {
    const def = cfg.slotDefs[slotIdx];
    const sp = slotToStatePlayer[slotIdx];
    const p = createPlayer(def.name, def.isHuman, slotIdx, def.personality || sp?.personality);
    if (sp) {
      p.herd           = sp.herd           || 0;
      p.roundDollars   = sp.roundDollars   || 0;
      p.roundCows      = sp.roundCows      || 0;
      p.roundBandits   = sp.roundBandits   || 0;
      p.busted         = sp.busted         || false;
      p.stoppedDrawing = sp.stoppedDrawing || false;
      p.hand    = (sp.hand    || []).map(c => c ? getCardById(c.id) : null).filter(Boolean);
      p.deck    = (sp.deck    || []).map(c => c ? getCardById(c.id) : null).filter(Boolean);
      p.discard = (sp.discard || []).map(c => c ? getCardById(c.id) : null).filter(Boolean);
    }
    return p;
  });

  G = initState(cfg.numPlayers, players);
  G.playerOrder = G_playerOrder;
  G.phase       = state.phase;
  G.currentAct  = state.act;
  G.roundNumber = state.round;
  // Convert host's G.players indices (= slot indices) to local G.players indices
  G.buyOrder       = (state.buyOrder || []).map(s => MP.slotToPlayer[s]).filter(i => i !== undefined);
  G.currentBuyerIdx = state.currentBuyerIdx || 0;

  // Rebuild pyramid from stored card IDs
  if (state.pyramid) {
    G.pyramid = state.pyramid.map(row => row.map(slot => ({
      card:    slot.card ? getCardById(slot.card.id) : null,
      faceUp:  slot.faceUp,
      removed: slot.removed,
    })));
  }
}

// Resume draw phase after a rejoin: re-arm Firebase watchers then resume local draw turn.
async function resumeDrawPhase() {
  G.phase = 'draw';
  G.drawsDone = {};
  for (let i = 0; i < G.numPlayers; i++) G.drawsDone[i] = false;
  render();

  const findCard = id => CARD_DB[id];
  MP.watchOpponentDrawStates((slotIdx, drawState) => {
    if (drawState.round !== undefined && drawState.round !== G.roundNumber) return;
    const playerIdx = MP.slotToPlayer[slotIdx];
    const opp = G.players[playerIdx];
    if (!opp) return;
    opp.hand = (drawState.hand || []).map(id => {
      const tmpl = findCard(id);
      return tmpl ? createCardInstance(tmpl) : null;
    }).filter(Boolean);
    opp.deck = (drawState.deck || []).map(id => {
      const tmpl = findCard(id);
      return tmpl ? createCardInstance(tmpl) : null;
    }).filter(Boolean);
    opp.roundDollars    = drawState.dollars;
    opp.roundCows       = drawState.cows;
    opp.roundBandits    = drawState.bandits;
    opp.busted          = drawState.busted;
    opp.stoppedDrawing  = drawState.stoppedDrawing;
    opp.hasBuyBurnFirst = drawState.hasBuyBurnFirst || false;
    opp.hasExtraBuy     = drawState.hasExtraBuy     || false;
    if (drawState.discardCount !== undefined) opp._syncedDiscardCount = drawState.discardCount;
    render();
    if (MP.isHost) MP.pushSpectatorState();
  });

  MP.waitForAllHumanDrawsDone((slotIdx, doneData) => {
    const playerIdx = MP.slotToPlayer[slotIdx];
    const opp = G.players[playerIdx];
    if (doneData) {
      opp.roundDollars    = doneData.dollars;
      opp.roundCows       = doneData.cows;
      opp.roundBandits    = doneData.bandits;
      opp.busted          = doneData.busted;
      opp.hasBuyBurnFirst = doneData.hasBuyBurnFirst || false;
      opp.hasExtraBuy     = doneData.hasExtraBuy     || false;
    }
    G.drawsDone[playerIdx] = true;
    checkDrawPhaseComplete();
  });

  const localPlayer = G.players[0];
  if (localPlayer.busted || localPlayer.stoppedDrawing) {
    // Already done drawing before disconnect — signal done and wait for buy phase
    G.drawsDone[0] = true;
    setMessage('Waiting for other players to finish drawing...');
    await MP.signalDrawDone(localPlayer);
    checkDrawPhaseComplete();
  } else {
    // Resume draw turn from where we left off
    startPlayerDraw();
  }
}

// Resume buy phase after a rejoin: G.buyOrder and G.currentBuyerIdx already restored.
function resumeBuyPhase() {
  G.phase = 'buy';
  render();
  processBuyTurn();
}

async function setupAct(act) {
  G.currentAct = act;
  G.roundNumber = 1;

  // Between acts, merge everything back and reshuffle
  for (const player of G.players) {
    const allCards = [...player.deck, ...player.discard, ...player.hand];
    player.deck = shuffleForPlayer(allCards, player.slotIdx, player.isHuman);
    player.discard = [];
    player.hand = [];
    resetPlayerRound(player);
  }

  if (MP.active) {
    if (MP.isHost) {
      // Host builds pyramid and shares card IDs with guest
      G.pyramid = buildPyramid(act);
      const cardIds = G.pyramid.flatMap(row => row.map(slot => slot.card.id));
      // Clear previous actSetup first so guest listener fires fresh
      await MP.clearActSetup();
      await MP.pushActSetup(act, cardIds);
      MP.pushSpectatorState(); // let spectators see the new pyramid immediately
    } else {
      // Guest waits for host's pyramid layout
      setMessage(`Waiting for opponent to set up Act ${act}...`);
      clearActions();
      await new Promise(resolve => {
        MP.waitForActSetup(act, (data) => {
          G.pyramid = buildPyramid(act, data.cardIds);
          resolve();
        });
      });
    }
  } else {
    G.pyramid = buildPyramid(act);
  }

  addLog(`--- Act ${act} begins! ---`, 'log-score');
  render();
  startRound();
}

async function startRound() {
  for (const player of G.players) {
    resetPlayerRound(player);
  }
  G.selectedPyramidCard = null;
  G.phase = 'draw';
  G.drawsDone = {};
  for (let i = 0; i < G.numPlayers; i++) G.drawsDone[i] = false;

  addLog(`Round ${G.roundNumber} - Draw Phase`);
  render();

  if (MP.active) {
    await MP.resetRound();
    MP.pushSpectatorState(); // initial draw-phase state for spectators
    startPlayerDraw();

    // Run AI draws locally (deterministic — same on all clients via seeded RNG)
    for (let i = 1; i < G.numPlayers; i++) {
      if (!G.players[i].isHuman) aiDrawPhase(i);
    }

    // Live watch remote human opponents' draw states
    const findCard = id => STORE_CARDS.find(c => c.id === id) || STARTER_TEMPLATES.find(t => t.id === id);
    MP.watchOpponentDrawStates((slotIdx, state) => {
      // Ignore stale data from a previous round (Firebase fires immediately on subscription
      // with whatever value is in the DB, which may still be the busted state from last round).
      if (state.round !== undefined && state.round !== G.roundNumber) return;
      const playerIdx = MP.slotToPlayer[slotIdx];
      const opp = G.players[playerIdx];
      opp.hand = (state.hand || []).map(id => {
        const tmpl = findCard(id);
        return tmpl ? createCardInstance(tmpl) : null;
      }).filter(Boolean);
      opp.deck = (state.deck || []).map(id => {
        const tmpl = findCard(id);
        return tmpl ? createCardInstance(tmpl) : null;
      }).filter(Boolean);
      opp.roundDollars      = state.dollars;
      opp.roundCows         = state.cows;
      opp.roundBandits      = state.bandits;
      opp.busted            = state.busted;
      opp.stoppedDrawing    = state.stoppedDrawing;
      opp.hasBuyBurnFirst   = state.hasBuyBurnFirst || false;
      opp.hasExtraBuy       = state.hasExtraBuy     || false;
      if (state.discardCount !== undefined) opp._syncedDiscardCount = state.discardCount;
      // If opponent busted this round, treat them as done immediately (don't wait for
      // the drawDone signal which fires after a 2s animation delay on their side).
      if (state.busted && !G.drawsDone[playerIdx]) {
        G.drawsDone[playerIdx] = true;
        render();
        MP.pushSpectatorState();
        checkDrawPhaseComplete();
      } else {
        render();
        MP.pushSpectatorState(); // host keeps spectatorState current as opponent draws arrive
      }
    });

    // One-shot done signal per remote human opponent
    MP.waitForAllHumanDrawsDone((slotIdx, doneData) => {
      const playerIdx = MP.slotToPlayer[slotIdx];
      const opp = G.players[playerIdx];
      // Use authoritative final stats from the done signal itself to avoid
      // a race condition where drawDone arrives before the last drawState update.
      if (doneData) {
        opp.roundDollars    = doneData.dollars;
        opp.roundCows       = doneData.cows;
        opp.roundBandits    = doneData.bandits;
        opp.busted          = doneData.busted;
        opp.hasBuyBurnFirst = doneData.hasBuyBurnFirst || false;
      }
      G.drawsDone[playerIdx] = true;
      checkDrawPhaseComplete();
    });
  } else {
    // Start all players drawing simultaneously
    AI_SPEC.push(); // push initial draw-phase state for spectators
    startPlayerDraw();
    for (let i = 1; i < G.numPlayers; i++) {
      aiDrawPhase(i); // fire-and-forget, each runs independently
    }
  }
}

// --- DRAW PHASE ---

const ACTIVATABLE_SPECIALS = ['trash_for_2', 'trash_buy_burn_first', 'look3_rearrange', 'replay_discard', 'trash_to_use', 'extra_buy'];

function getActivatableCards(player) {
  return player.hand.filter(c => c.special && ACTIVATABLE_SPECIALS.includes(c.special));
}

function getSpecialLabel(card) {
  switch (card.special) {
    case 'trash_for_2': return 'Trash for $2';
    case 'trash_buy_burn_first': return 'Trash for Priority';
    case 'look3_rearrange': return 'Trash & Rearrange Top 3';
    case 'replay_discard': return 'Trash & Replay Discard';
    case 'trash_to_use': {
      const parts = [];
      if (card.dollars > 0) parts.push(`$${card.dollars}`);
      if (card.bandits < 0) parts.push('-1 Bandit');
      if (card.cows > 0) parts.push(`+${card.cows} Cow`);
      return `Activate (${parts.join(', ')})`;
    }
    case 'extra_buy': return 'Trash for Extra Buy/Burn';
    default: return 'Use';
  }
}

function getDrawButtonText(player) {
  return 'Draw Card';
}

function getDrawButtonClass(player) {
  if (player.roundBandits >= 2)  return 'btn-draw btn-draw-danger';
  if (player.roundBandits === 1) return 'btn-draw btn-draw-warn';
  return 'btn-draw';
}

function getDrawPhaseMessage(player) {
  if (player.hand.length === 0)  return 'Draw your first card.';
  if (player.roundBandits >= 2)  return 'Two bandits in hand.';
  if (player.roundBandits === 1) return 'One bandit in hand.';
  return 'Keep drawing or bank what you have.';
}

function startPlayerDraw() {
  G.phase = 'draw';
  const player = G.players[0];

  if (player.deck.length === 0 && player.discard.length === 0) {
    player.stoppedDrawing = true;
    addLog('You have no cards left to draw.');
    onPlayerDrawDone();
    return;
  }

  // Deck empty but discard available — show shuffle prompt directly
  if (player.deck.length === 0 && player.discard.length > 0) {
    setMessage(`Your deck is empty! Shuffle ${player.discard.length} cards from discard into a new deck?`);
    setActions([
      { text: 'Shuffle Discard', onClick: () => {
        player.deck = shuffle(player.discard);
        player.discard = [];
        if (player.deck.length > 1) {
          player.deck.push(player.deck.shift());
        }
        addLog(`You shuffled ${player.deck.length} cards from discard into a new deck.`, 'log-score');
        render();
        mpSyncDraw();
        startPlayerDraw();
      }},
      { text: 'Stop Drawing', onClick: () => {
        player.stoppedDrawing = true;
        addLog('You stopped drawing.');
        onPlayerDrawDone();
      }, className: 'btn-secondary' },
    ]);
    render();
    return;
  }

  const activatable = getActivatableCards(player);
  const buttons = [
    { text: getDrawButtonText(player), onClick: () => playerDraw(), className: getDrawButtonClass(player) },
  ];

  for (const card of activatable) {
    buttons.push({
      text: getSpecialLabel(card),
      onClick: () => activateSpecialCard(player, card),
      className: 'btn-special',
    });
  }

  buttons.push({ text: 'Stop Drawing', onClick: () => playerStopDraw(), className: 'btn-secondary', disabled: player.hand.length === 0, style: 'margin-left: auto' });

  setMessage(getDrawPhaseMessage(player));
  setActions(buttons);
  render();
}

async function playerDraw() {
  if (G.busy) return;
  G.busy = true;

  const player = G.players[0];

  // Check if deck is empty and needs reshuffle
  if (player.deck.length === 0) {
    if (player.discard.length === 0) {
      player.stoppedDrawing = true;
      addLog('No cards left to draw!');
      G.busy = false;
      onPlayerDrawDone();
      return;
    }
    G.busy = false;
    const proceed = await playerDrawWithReshuffleCheck();
    if (!proceed) {
      onPlayerDrawDone();
      return;
    }
    // After reshuffle, return to draw prompt so player can see the new deck
    render();
    startPlayerDraw();
    return;
  }

  const card = drawFromDeck(player);

  if (!card) {
    player.stoppedDrawing = true;
    addLog('No cards left to draw!');
    G.busy = false;
    onPlayerDrawDone();
    return;
  }

  const isFirst = player.hand.length === 0;
  player.hand.push(card);

  // Apply effects
  const effects = applyCardEffects(player, card, isFirst);

  let effectText = '';
  if (card.special === 'trash_to_use') {
    effectText = 'activate to use';
  } else {
    if (effects.dollars) effectText += `$${effects.dollars}`;
    if (effects.cows > 0) effectText += ` +${effects.cows} cow${effects.cows > 1 ? 's' : ''}`;
    if (effects.cows < 0) effectText += ` ${effects.cows} cow`;
    if (effects.bandits) effectText += ` ${effects.bandits} bandit${effects.bandits > 1 ? 's' : ''}`;
  }
  addLog(`You drew: ${cardLabel(card)}` + (effectText ? ` – ${effectText}` : ''));

  render();
  mpSyncDraw();

  // Handle special: draw4
  if (card.special === 'draw4') {
    addLog('Draw 4 more cards!');
    G.busy = false;
    for (let i = 0; i < 4; i++) {
      await delay(700);
      if (player.busted) break;
      const extraCard = drawFromDeck(player);
      if (!extraCard) {
        addLog('Deck and discard both empty — draw 4 cut short.');
        break;
      }
      player.hand.push(extraCard);
      applyCardEffects(player, extraCard, false);
      render();
      animateDrawnCard(extraCard);
      mpSyncDraw();
      // Check bust after each draw — busting during draw 4 is possible
      if (player.roundBandits >= 3) {
        addLog(`Busted on draw ${i + 1} of 4!`, 'log-bust');
        await handleBust(player);
        return;
      }
    }
    render();
    if (!player.busted) {
      startPlayerDraw();
    }
    return;
  }

  // Handle special: look3_immediate
  if (card.special === 'look3_immediate') {
    G.busy = false;
    await handleLook3(player);
    if (!player.busted) {
      startPlayerDraw();
    }
    return;
  }

  // Check bust
  if (player.roundBandits >= 3) {
    G.busy = false;
    await handleBust(player);
    return;
  }

  G.busy = false;
  startPlayerDraw();
  animateDrawnCard(card);
}

function playerStopDraw() {
  const player = G.players[0];
  player.stoppedDrawing = true;

  // Handle put_on_top special
  const putOnTopCard = player.hand.find(c => c.special === 'put_on_top');
  if (putOnTopCard && player.hand.length > 1) {
    handlePutOnTop(player, putOnTopCard);
    return;
  }

  addLog('You stopped drawing.');
  onPlayerDrawDone();
}

function onPlayerDrawDone() {
  G.drawsDone[0] = true;
  clearActions();
  render();

  if (MP.active) {
    setMessage('Waiting for other players to finish drawing...');
    MP.signalDrawDone(G.players[0]); // fire-and-forget is fine
  }

  checkDrawPhaseComplete();
}

function checkDrawPhaseComplete() {
  if (G.phase !== 'draw') return; // guard: only fire once, prevent re-entry
  const allDone = G.players.every((_, i) => G.drawsDone[i]);
  if (allDone) {
    onDrawPhaseComplete();
  } else if (G.drawsDone[0]) {
    const waiting = G.numPlayers - 1;
    setMessage(MP.active
      ? 'Waiting for other players to finish drawing...'
      : `Waiting for ${waiting > 1 ? 'opponents' : 'AI'} to finish drawing...`);
  }
}

// --- AI DRAW PHASE ---

async function aiDrawPhase(playerIdx) {
  const ai = G.players[playerIdx];
  const aiLabel = ai.name;

  await delay(400 + playerIdx * 150); // slight stagger per AI

  if (ai.deck.length === 0 && ai.discard.length === 0) {
    ai.stoppedDrawing = true;
    addLog(`${aiLabel} has no cards to draw.`);
    G.drawsDone[playerIdx] = true;
    checkDrawPhaseComplete();
    return;
  }

  while (!ai.busted && !ai.stoppedDrawing) {
    const card = drawFromDeck(ai);
    if (!card) {
      ai.stoppedDrawing = true;
      break;
    }

    const isFirst = ai.hand.length === 0;
    ai.hand.push(card);
    applyCardEffects(ai, card, isFirst);

    if (card.special === 'trash_to_use') {
      addLog(`${aiLabel} drew: ${cardLabel(card)} – activate to use`);
    } else {
      addLog(`${aiLabel} drew: ${cardLabel(card)} (${ai.roundDollars}$, ${ai.roundCows} cows, ${ai.roundBandits} bandits)`);
    }
    render();
    await delay(800);

    // Handle draw4
    if (card.special === 'draw4' && !ai.busted) {
      for (let i = 0; i < 4; i++) {
        if (ai.busted) break;
        const extra = drawFromDeck(ai);
        if (!extra) break;
        ai.hand.push(extra);
        applyCardEffects(ai, extra, false);
        render();
        await delay(500);
        if (ai.roundBandits >= 3) {
          await handleBust(ai);
          break;
        }
      }
      if (ai.busted) break;
    }

    // Handle trash_to_use activation
    for (const tCard of ai.hand.filter(c => c.special === 'trash_to_use')) {
      let activate = false;
      if (tCard.bandits < 0 && ai.roundBandits >= 2) activate = true;
      if (tCard.dollars > 0 && ai.roundBandits >= 2) {
        // Only activate if these dollars actually bridge the gap to an available card
        const avail = getAvailablePyramidCards(G.pyramid);
        const bridgesGap = avail.some(a =>
          a.slot.card.cost > ai.roundDollars && a.slot.card.cost <= ai.roundDollars + tCard.dollars
        );
        if (bridgesGap) activate = true;
      }
      if (!activate) continue;
      const idx = ai.hand.indexOf(tCard);
      if (idx < 0) continue;
      ai.hand.splice(idx, 1);
      ai.roundDollars += tCard.dollars;
      ai.roundBandits = Math.max(0, ai.roundBandits + tCard.bandits);
      ai.roundCows += tCard.cows;
      const label = tCard.dollars > 0 ? `$${tCard.dollars}` : '-1 bandit negated';
      addLog(`${aiLabel} activated card: ${label}.`, 'log-burn');
      render();
      await delay(500);
    }

    // Handle trash_for_2
    if (card.special === 'trash_for_2') {
      const bestCost = getBestAffordableCost(ai);
      if (ai.roundDollars + 1 >= bestCost && ai.roundDollars < bestCost) {
        ai.roundDollars += 1;
        const idx = ai.hand.indexOf(card);
        if (idx >= 0) ai.hand.splice(idx, 1);
        addLog(`${aiLabel} trashed a card for $2.`);
        render();
      }
    }

    // Handle look3_rearrange for AI
    if (card.special === 'look3_rearrange' && ai.deck.length >= 2) {
      const idx = ai.hand.indexOf(card);
      if (idx >= 0) ai.hand.splice(idx, 1);
      const top3 = ai.deck.splice(0, Math.min(3, ai.deck.length));
      // Sort by full personality-weighted score: draw best cards first
      top3.sort((a, b) => scoreCardForAI(a, ai) - scoreCardForAI(b, ai));
      ai.deck.unshift(...top3);
      addLog(`${aiLabel} trashed to rearrange top cards.`, 'log-burn');
      render();
    }

    // Handle look3_immediate for AI
    if (card.special === 'look3_immediate' && ai.deck.length >= 2) {
      const top3 = ai.deck.splice(0, Math.min(3, ai.deck.length));
      // Sort by full personality-weighted score: draw best cards first
      top3.sort((a, b) => scoreCardForAI(a, ai) - scoreCardForAI(b, ai));
      ai.deck.unshift(...top3);
      addLog(`${aiLabel} rearranged top cards.`);
    }

    // Check bust
    if (ai.roundBandits >= 3) {
      await handleBust(ai);
      break;
    }

    // AI decision to continue
    if (!aiShouldDraw(ai)) {
      // Before stopping: activate $N trash_to_use cards if it helps afford a better card
      for (const tCard of ai.hand.filter(c => c.special === 'trash_to_use' && c.dollars > 0)) {
        const avail = getAvailablePyramidCards(G.pyramid);
        const unlocksBetter = avail.some(a =>
          a.slot.card.cost > ai.roundDollars && a.slot.card.cost <= ai.roundDollars + tCard.dollars
        );
        if (unlocksBetter) {
          const idx = ai.hand.indexOf(tCard);
          if (idx >= 0) {
            ai.hand.splice(idx, 1);
            ai.roundDollars += tCard.dollars;
            addLog(`${aiLabel} activated card: $${tCard.dollars}.`, 'log-burn');
            render();
            await delay(500);
          }
        }
      }
      ai.stoppedDrawing = true;
      addLog(`${aiLabel} stopped drawing.`);
    }

    await delay(400); // pace between draws
  }

  G.drawsDone[playerIdx] = true;
  render();
  checkDrawPhaseComplete();
}

// --- AI Personality Configs ---
// bustThreshold2/1: max bust-probability willing to accept with 2/1 bandits in hand
// dollarBuffer: keeps drawing until dollars >= bestCost + buffer (999 = no target)
// cowWeight / dollarWeight / banditPenalty: buy-phase scoring multipliers
const AI_PERSONALITIES = {
  sheriff: {
    bustThreshold2: 0.05,  // almost never draws with 2 bandits
    bustThreshold1: 0.15,  // very cautious at 1 bandit
    dollarBuffer:   0,     // stops as soon as it can afford the best card
    cowWeight:      3,
    dollarWeight:   1.5,
    banditPenalty:  4,     // despises bandits in buy scoring
    positionWeight: 0,     // methodical — ignores standings
    denialBurn:     false,
  },
  wild_bill: {
    bustThreshold2: 0.35,  // keeps drawing with 2 bandits often
    bustThreshold1: 0.50,  // barely slows down at 1 bandit
    dollarBuffer:   999,   // no dollar target — draws until bust or dry
    cowWeight:      5,
    dollarWeight:   0.5,
    banditPenalty:  0.5,
    positionWeight: 0,     // pure chaos — doesn't track position
    denialBurn:     false,
  },
  rancher: {
    bustThreshold2: 0.15,
    bustThreshold1: 0.30,
    dollarBuffer:   2,
    cowWeight:      6,     // cows above everything
    dollarWeight:   0.5,
    banditPenalty:  2,
    positionWeight: 0.4,   // somewhat adapts to standings
    denialBurn:     false,
  },
  banker: {
    bustThreshold2: 0.15,
    bustThreshold1: 0.30,
    dollarBuffer:   1,     // stops slightly earlier (wants exactly enough)
    cowWeight:      1.5,
    dollarWeight:   3,     // values income above cows
    banditPenalty:  2,
    positionWeight: 0.3,
    denialBurn:     false,
  },
  outlaw: {
    bustThreshold2: 0.20,  // medium base risk
    bustThreshold1: 0.35,
    dollarBuffer:   1,
    cowWeight:      4,
    dollarWeight:   1,
    banditPenalty:  2,
    positionWeight: 1.5,   // highly position-aware: draws aggressively when trailing, locks in when leading
    denialBurn:     false,
  },
  deputy: {
    bustThreshold2: 0.10,  // conservative draw
    bustThreshold1: 0.20,
    dollarBuffer:   0,
    cowWeight:      2,
    dollarWeight:   2,
    banditPenalty:  3,
    positionWeight: 0.3,
    denialBurn:     true,  // burns the card most valuable to the current leader
  },
};

function aiShouldDraw(ai) {
  const cfg = AI_PERSONALITIES[ai.personality] || AI_PERSONALITIES.rancher;

  if (ai.hand.length >= 7) return false;
  if (ai.hand.length < 2) return true;

  // Position modifier: scale bust thresholds up when trailing (draw more aggressively),
  // down when leading (lock in the advantage). positionWeight=0 disables this entirely.
  let positionMult = 1.0;
  if (cfg.positionWeight > 0 && G.numPlayers > 1) {
    const opponents = G.players.filter(p => p !== ai);
    const maxOpponentHerd = opponents.length > 0 ? Math.max(...opponents.map(p => p.herd)) : 0;
    const herdDeficit = maxOpponentHerd - ai.herd; // positive = trailing, negative = leading
    const rawMult = 1 + (herdDeficit / 10) * cfg.positionWeight;
    positionMult = Math.max(0.5, Math.min(2.0, rawMult));
  }

  const banditsRemaining = countBanditsInDeck(ai);
  const cardsRemaining = ai.deck.length;

  // Draw more aggressively if AI can't currently afford any available card
  const canAffordSomething = getAvailablePyramidCards(G.pyramid).some(a => a.slot.card.cost <= ai.roundDollars);
  const affordMult = canAffordSomething ? 1.0 : 1.4;

  if (ai.roundBandits >= 2) {
    if (cardsRemaining === 0) return false;
    return (banditsRemaining / cardsRemaining) < cfg.bustThreshold2 * positionMult * affordMult;
  }

  if (ai.roundBandits === 1) {
    if (cardsRemaining <= 1) return false;
    const bustProb = banditsRemaining / cardsRemaining;
    if (bustProb >= cfg.bustThreshold1 * positionMult * affordMult) return false;
    if (cfg.dollarBuffer >= 999) return true;  // Wild Bill ignores dollar target
    return ai.roundDollars < getBestAffordableCost(ai);
  }

  // 0 bandits: dynamic buffer — only accumulate extra if a more expensive card exists
  const avail0 = getAvailablePyramidCards(G.pyramid);
  const bestCost0 = getBestAffordableCost(ai);
  const maxCost0 = avail0.length > 0 ? Math.max(...avail0.map(a => a.slot.card.cost)) : bestCost0;
  const effectiveBuffer = Math.min(cfg.dollarBuffer, Math.max(0, maxCost0 - bestCost0));
  return ai.roundDollars < bestCost0 + effectiveBuffer;
}

function countBanditsInDeck(player) {
  return player.deck.reduce((sum, c) => sum + c.bandits, 0);
}

// Returns the cost of the highest-scored available card for this AI.
// Stops chasing cards the personality wouldn't actually want to buy.
function getBestAffordableCost(ai) {
  const available = getAvailablePyramidCards(G.pyramid);
  if (available.length === 0) return 99;
  if (!ai) return Math.max(...available.map(a => a.slot.card.cost));
  let bestScore = -Infinity;
  let bestCost  = 0;
  for (const a of available) {
    const score = scoreCardForAI(a.slot.card, ai);
    if (score > bestScore) { bestScore = score; bestCost = a.slot.card.cost; }
  }
  return bestCost;
}

// --- ACTIVATE SPECIAL FROM HAND ---

async function activateSpecialCard(player, card) {
  switch (card.special) {
    case 'trash_to_use':
      await handleTrashToUse(player, card);
      break;
    case 'trash_for_2':
      await handleTrashFor2(player, card);
      break;
    case 'trash_buy_burn_first':
      await handleTrashBuyBurnFirst(player, card);
      break;
    case 'look3_rearrange':
      await handleTrashLook3(player, card);
      break;
    case 'replay_discard':
      await handleReplayDiscard(player, card);
      break;
    case 'extra_buy':
      await handleExtraBuy(player, card);
      break;
  }
}

// --- BUST ---

function showBustAnimation() {
  const overlay = document.createElement('div');
  overlay.className = 'bust-overlay';

  for (let i = 1; i <= 3; i++) {
    const bandit = document.createElement('img');
    bandit.src = 'assets/symbols/1 Bandit-01.png';
    bandit.className = `bust-bandit bust-bandit-${i}`;
    bandit.alt = 'Bandit';
    overlay.appendChild(bandit);
  }

  const text = document.createElement('div');
  text.className = 'bust-text';
  text.textContent = 'BUSTED!';
  overlay.appendChild(text);

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2400);
}

async function handleBust(player) {
  player.busted = true;
  if (player.isHuman) {
    clearActions();
    setMessage(player.name + ' busted!');
  }
  addLog(`${player.name} BUSTED with ${player.roundBandits} bandits!`, 'log-bust');
  render();
  if (player === G.players[0]) showBustAnimation();
  if (player.isHuman) mpSyncDraw();
  await delay(2000);

  // Move all drawn cards to discard, but keep discard_to_player cards in hand
  // so resolvePassCards() can prompt the player to choose a recipient.
  const toPass = player.hand.filter(c => c.special === 'discard_to_player');
  player.discard.push(...player.hand.filter(c => c.special !== 'discard_to_player'));
  player.hand = toPass;
  player.roundDollars = 0;
  player.roundCows = 0;
  render();
  if (player.isHuman) mpSyncDraw();

  if (player.isHuman) {
    onPlayerDrawDone();
  }
}

// --- SPECIAL CARD HANDLERS ---

async function handleTrashToUse(player, card) {
  const idx = player.hand.indexOf(card);
  if (idx < 0) return;
  player.hand.splice(idx, 1);
  player.roundDollars += card.dollars;
  player.roundBandits = Math.max(0, player.roundBandits + card.bandits);
  player.roundCows += card.cows;
  const parts = [];
  if (card.dollars > 0) parts.push(`$${card.dollars}`);
  if (card.bandits < 0) parts.push('-1 bandit negated');
  if (card.cows > 0) parts.push(`+${card.cows} cow`);
  addLog(`You activated ${SUIT_NAME[card.cacti]} card: ${parts.join(', ')}.`, 'log-burn');
  render();
  mpSyncDraw();
  startPlayerDraw();
}

async function handleTrashFor2(player, card) {
  // Clicking "Trash for $2" is the decision — execute immediately.
  // Card already gave $1 via applyCardEffects; add 1 more for $2 total.
  player.roundDollars += 1;
  const idx = player.hand.indexOf(card);
  if (idx >= 0) player.hand.splice(idx, 1);
  addLog('You trashed a card for $2 total.', 'log-burn');
  render();
  mpSyncDraw();
  startPlayerDraw();
}

async function handleTrashBuyBurnFirst(player, card) {
  setMessage('Trash this card to buy/burn first this round?');
  setActions([
    { text: 'Trash for Priority', onClick: () => {
      player.hasBuyBurnFirst = true;
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.roundCows -= card.cows;
      addLog('You trashed for first buy priority!', 'log-burn');
      render();
      mpSyncDraw();
      startPlayerDraw();
    }},
    { text: 'Keep Card', onClick: () => {
      startPlayerDraw();
    }, className: 'btn-secondary' },
  ]);
}

async function handleLook3(player) {
  const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
  if (top3.length === 0) {
    startPlayerDraw();
    return;
  }

  return new Promise(resolve => {
    const modal = document.getElementById('special-modal');
    const content = document.getElementById('special-modal-content');
    const peekRestore = document.getElementById('btn-peek-restore');
    let order = [];

    peekRestore.onclick = () => modal.classList.remove('peeking');

    function renderModal() {
      content.innerHTML = '<h2>Rearrange Top Cards</h2><p>Click cards in the order you want them (top of deck first).</p>';
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'modal-cards';
      top3.forEach((card, i) => {
        const el = renderCardEl(card, true, order.includes(i) ? 'selected' : 'clickable');
        if (order.includes(i)) {
          const num = document.createElement('div');
          num.className = 'order-number';
          num.textContent = order.indexOf(i) + 1;
          el.appendChild(num);
        }
        el.onclick = () => {
          if (order.includes(i)) {
            order = order.filter(x => x !== i);
          } else {
            order.push(i);
          }
          renderModal();
        };
        cardsDiv.appendChild(el);
      });
      content.appendChild(cardsDiv);

      if (order.length === top3.length) {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Confirm Order';
        btn.onclick = () => {
          const reordered = order.map(i => top3[i]);
          player.deck.unshift(...reordered);
          modal.classList.remove('peeking');
          modal.classList.add('hidden');
          addLog('You rearranged the top cards of your deck.');
          render();
          mpSyncDraw();
          resolve();
        };
        content.appendChild(btn);
      }

      // Peek button — always shown at bottom
      const peekBtn = document.createElement('button');
      peekBtn.className = 'btn btn-secondary btn-small modal-peek-btn';
      peekBtn.textContent = '👁 Peek at stats';
      peekBtn.onclick = () => modal.classList.add('peeking');
      content.appendChild(peekBtn);
    }

    renderModal();
    modal.classList.remove('hidden');
  });
}

async function handleTrashLook3(player, card) {
  setMessage('Trash this card to look at and rearrange your top 3 cards?');
  setActions([
    { text: 'Trash & Look', onClick: async () => {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      addLog('You trashed to rearrange top 3.', 'log-burn');
      render();
      await handleLook3(player);
      startPlayerDraw();
    }},
    { text: 'Keep Card', onClick: () => {
      startPlayerDraw();
    }, className: 'btn-secondary' },
  ]);
}

async function handleReplayDiscard(player, card) {
  if (player.discard.length === 0) {
    addLog('No cards in discard to replay.');
    startPlayerDraw();
    return;
  }

  setMessage('Trash this card to replay any card from your discard pile?');
  setActions([
    { text: 'Trash & Replay', onClick: () => {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);

      // Show discard pile for selection
      const modal = document.getElementById('special-modal');
      const content = document.getElementById('special-modal-content');
      content.innerHTML = '<h2>Choose a Card to Replay</h2>';
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'modal-cards';

      player.discard.forEach((discardCard, i) => {
        const el = renderCardEl(discardCard, true, 'clickable');
        el.onclick = () => {
          // Apply the replayed card's effects
          applyCardEffects(player, discardCard, false);
          player.discard.splice(i, 1);
          player.hand.push(discardCard);
          addLog(`You replayed: ${discardCard.id.replace(/_/g, ' ')}`, 'log-buy');
          modal.classList.add('hidden');
          render();
          mpSyncDraw();
          startPlayerDraw();
        };
        cardsDiv.appendChild(el);
      });

      content.appendChild(cardsDiv);
      modal.classList.remove('hidden');
    }},
    { text: 'Keep Card', onClick: () => {
      startPlayerDraw();
    }, className: 'btn-secondary' },
  ]);
}

function renderPutOnTopSelection(player, putOnTopCard) {
  const handEl = document.getElementById('player-hand');
  handEl.innerHTML = '';
  for (const card of player.hand) {
    if (card.uid === putOnTopCard.uid) {
      const el = renderCardEl(card, true, 'dimmed');
      handEl.appendChild(el);
      continue;
    }
    const el = renderCardEl(card, true, 'clickable');
    el.addEventListener('mouseenter', () => showCardHoverPreview(el, card));
    el.addEventListener('mouseleave', hideCardHoverPreview);
    el.onclick = () => {
      G.awaitingPutOnTopCard = null;
      player.roundDollars -= card.dollars;
      player.roundCows -= card.cows;
      player.roundBandits -= card.bandits;
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.deck.unshift(card);
      addLog(`You returned ${cardLabel(card)} to top of deck.`);
      render();
      mpSyncDraw();
      onPlayerDrawDone();
    };
    handEl.appendChild(el);
  }
}

function handlePutOnTop(player, putOnTopCard) {
  G.awaitingPutOnTopCard = putOnTopCard;
  setMessage('Choose another drawn card to return to the top of your deck (its effects are removed).');
  renderPutOnTopSelection(player, putOnTopCard);
  setActions([
    { text: 'Skip (Don\'t Return)', onClick: () => {
      G.awaitingPutOnTopCard = null;
      addLog('You chose not to return a card.');
      onPlayerDrawDone();
    }, className: 'btn-secondary' },
  ]);
}

async function handleExtraBuy(player, card) {
  setMessage('Trash this card to get an extra buy or burn with your remaining $ after your first buy/burn?');
  setActions([
    { text: 'Trash for Extra Buy/Burn', onClick: () => {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.hasExtraBuy = true;
      addLog('You trashed for an extra buy/burn this round!', 'log-burn');
      render();
      mpSyncDraw();
      startPlayerDraw();
    }},
    { text: 'Keep Card', onClick: () => {
      startPlayerDraw();
    }, className: 'btn-secondary' },
  ]);
}

// --- BUY PHASE ---

// determineBuyWinner() is defined in shared/tiebreaker.js (loaded via <script> before play.js)

function onDrawPhaseComplete() {
  G.phase = 'buy';

  mpLog('onDrawPhaseComplete — player stats:', G.players.map((p, i) => ({
    i, name: p.name, slot: G.playerOrder[i],
    dollars: p.roundDollars, cows: p.roundCows, busted: p.busted,
    hasBuyBurnFirst: p.hasBuyBurnFirst, handLen: p.hand.length,
  })));

  // Check hasBuyBurnFirst (special card overrides normal order)
  const priorityIdx = G.players.findIndex((p, i) => p.hasBuyBurnFirst && !p.busted);
  if (priorityIdx >= 0) {
    const lbl = priorityIdx === 0 ? 'You have' : `${G.players[priorityIdx].name} has`;
    addLog(`--- Buy Phase --- (${lbl} first buy priority!)`);
    if (MP.active && priorityIdx > 0) {
      // Remote human has priority — they will push the buy order from their side
      setMessage(`Waiting for ${G.players[priorityIdx].name} to choose who buys first...`);
      clearActions();
      render();
      MP.waitForBuyOrder((slotOrder) => {
        const localOrder = slotOrder.map(s => MP.slotToPlayer[s]);
        mpLog('waitForBuyOrder (hasBuyBurnFirst remote priority) fired:', localOrder);
        applyBuyOrder(localOrder);
      });
    } else {
      startBuyPhase(priorityIdx, priorityIdx === 0);
    }
    return;
  }

  const tieSeed = (G.gameSeed ^ (G.roundNumber * 2654435761)) >>> 0;
  const { winnerIdx, reason, tieLog } = determineBuyWinner(G.players, G.playerOrder, tieSeed);

  if (winnerIdx === 0 && G.players.every(p => p.busted)) {
    addLog(`--- Buy Phase --- (All players busted!)`);
    startBuyPhase(0);
    return;
  }

  if (tieLog) addLog(tieLog, 'log-tie');

  const nonBusted = G.players.map((p, i) => ({ p, i })).filter(c => !c.p.busted).map(c => c.i);
  const winnerName = G.players[winnerIdx].name;

  // Only one non-busted player — skip the order prompt entirely
  if (nonBusted.length === 1) {
    const soloIdx = nonBusted[0];
    addLog(`--- Buy Phase --- ${soloIdx === 0 ? 'You go' : G.players[soloIdx].name + ' goes'} first (only non-busted player).`);
    startBuyPhase(soloIdx, soloIdx === 0);
    return;
  }

  if (winnerIdx === 0) {
    addLog(`--- Buy Phase --- You choose buy order (${reason}).`);
    showChooseFirstUI(nonBusted);
  } else if (!G.players[winnerIdx].isHuman) {
    addLog(`--- Buy Phase --- ${winnerName} goes first (${reason}).`);
    startBuyPhase(winnerIdx);
  } else {
    // Remote human wins — wait for their buy order push
    addLog(`--- Buy Phase --- ${winnerName} chooses buy order (${reason}).`);
    setMessage(`Waiting for ${winnerName} to choose who buys first...`);
    clearActions();
    render();
    MP.waitForBuyOrder((slotOrder) => {
      const localOrder = slotOrder.map(s => MP.slotToPlayer[s]);
      mpLog('waitForBuyOrder (remote winner chose) fired:', { slotOrder, localOrder, names: localOrder.map(i => G.players[i]?.name) });
      const firstLocalIdx = localOrder[0];
      const firstPlayer = G.players[firstLocalIdx];
      addLog(`${winnerName} chose ${firstLocalIdx === 0 ? 'you' : firstPlayer.name} to buy first.`);
      applyBuyOrder(localOrder);
    });
  }
}

function showChooseFirstUI(nonBustedIndices) {
  setMessage('Buy Phase — Who goes first?');
  setActions(nonBustedIndices.map(i => ({
    text: i === 0 ? 'I Go First' : `${G.players[i].name} Goes First`,
    onClick: () => {
      addLog(i === 0 ? 'You chose to go first.' : `You chose ${G.players[i].name} to go first.`);
      startBuyPhase(i, true); // local player made this choice — always push to Firebase
    },
    className: i === 0 ? '' : 'btn-secondary',
  })));
  render();
}

// Build buy order starting from startIdx, rotating through all players.
// localIsChooser: true when the local human player made the choice (from showChooseFirstUI).
// Needed because the push condition must fire even when they chose someone *else* first.
function startBuyPhase(startIdx, localIsChooser = false) {
  // Rotate through G.seatOrder (randomized at game start) from winner's position.
  // seatOrder is an array of slot indices in clockwise seat order.
  // In SP mode slot === player index, so rotation is still correct.
  const winnerSlot = G.playerOrder[startIdx];
  const seatPos = G.seatOrder.indexOf(winnerSlot);
  const n = G.numPlayers;
  const slotRotation = Array.from({length: n}, (_, k) => G.seatOrder[(seatPos + k) % n]);
  const slotToPlayer = MP.active
    ? (s => MP.slotToPlayer[s])
    : (s => s);
  const order = slotRotation.map(slotToPlayer);
  mpLog('startBuyPhase:', { startIdx, localIsChooser, order,
    winner: G.players[startIdx]?.name, isHuman: G.players[startIdx]?.isHuman });
  if (MP.active) {
    const winnerIsAI = !G.players[startIdx].isHuman;
    const shouldPush = localIsChooser || (winnerIsAI && MP.isHost);
    mpLog('startBuyPhase push?', { shouldPush, winnerIsAI, isHost: MP.isHost, localIsChooser });
    if (shouldPush) {
      mpLog('pushBuyOrder slotOrder:', slotRotation);
      MP.pushBuyOrder(slotRotation);
    }
  }
  applyBuyOrder(order);
}

function applyBuyOrder(order) {
  G.buyOrder = order;
  G.currentBuyerIdx = 0;
  mpLog('applyBuyOrder:', order.map(i => G.players[i]?.name));
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push(); // buy phase begins — spectators see buy order
  processBuyTurn();
}

function processBuyTurn() {
  if (G.currentBuyerIdx >= G.buyOrder.length) {
    endBuyPhase();
    return;
  }

  // Check if pyramid is empty
  if (isPyramidEmpty(G.pyramid)) {
    endBuyPhase();
    return;
  }

  const playerIdx = G.buyOrder[G.currentBuyerIdx];
  const player = G.players[playerIdx];

  if (player.busted) {
    G.currentBuyerIdx++;
    processBuyTurn();
    return;
  }

  mpLog('processBuyTurn:', { playerIdx, name: player.name, isHuman: player.isHuman, busted: player.busted });
  if (playerIdx === 0) {
    // Local human's turn
    humanBuyTurn(player);
  } else if (!player.isHuman) {
    // AI player — run locally (deterministic on all clients)
    aiBuyTurn(player);
  } else {
    // Remote human — wait for their Firebase action (MP only)
    mpOpponentBuyTurn(player);
  }
}

function mpOpponentBuyTurn(opp) {
  mpLog('mpOpponentBuyTurn: waiting for', opp.name, 'slot', opp.slotIdx);
  setMessage(`Waiting for ${opp.name} to buy or burn...`);
  clearActions();
  render();
  MP.waitForBuyAction(opp.slotIdx, (data) => {
    mpLog('waitForBuyAction fired for', opp.name, data);
    // Clear the consumed action so the NEXT waitForBuyAction for this slot in the
    // same round doesn't immediately re-fire with this stale same-round value.
    MP.clearBuyAction(opp.slotIdx);
    if (data.action === 'buy') {
      executeBuyLocal(opp, data.row, data.col);
    } else {
      executeBurnLocal(opp, data.row, data.col);
    }
  });
}

function humanBuyTurn(player) {
  G.selectedPyramidCard = null;
  const available = getAvailablePyramidCards(G.pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= player.roundDollars);

  if (affordable.length > 0) {
    setMessage(`Buy Phase - You have $${player.roundDollars}. Click a card to buy or burn.`);
  } else {
    setMessage(`Buy Phase - You have $${player.roundDollars} (can't afford any). Click a card to burn.`);
  }

  clearActions();
  render();
}

function onPyramidCardClick(row, col) {
  if (G.phase !== 'buy') return;
  const playerIdx = G.buyOrder[G.currentBuyerIdx];
  if (playerIdx !== 0) return; // not human's turn

  const player = G.players[0];
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed || !slot.faceUp) return;

  G.selectedPyramidCard = { row, col };
  render();

  const canAfford = slot.card.cost <= player.roundDollars;

  setCardPreview(slot.card);
  setMessage(canAfford ? `Buy for $${slot.card.cost} or burn?` : `Can't afford — burn to remove?`);

  const buttons = [];
  if (canAfford) {
    buttons.push({ text: `Buy ($${slot.card.cost})`, onClick: () => executeBuy(player, row, col) });
  }
  buttons.push({ text: 'Burn', onClick: () => executeBurn(player, row, col), className: 'btn-burn' });
  buttons.push({ text: 'Cancel', onClick: () => {
    G.selectedPyramidCard = null;
    humanBuyTurn(player);
  }, className: 'btn-secondary' });

  setActions(buttons);
}

// Human buy: push to Firebase (MP, local human only) then apply locally
function executeBuy(player, row, col) {
  if (MP.active && player === G.players[0]) MP.pushBuyAction('buy', row, col);
  executeBuyLocal(player, row, col);
}

function executeBuyLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return;
  clearActions();
  const card = slot.card;

  player.discard.push(card);
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} bought ${cardLabel(card)} for $${card.cost}.`, 'log-buy');
  revealUncovered(G.pyramid);
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push();

  if (advanceOrExtraBuy(player)) return;
}

// After a buy/burn action: grant extra buy if eligible, otherwise advance to next buyer.
// Returns true if the caller should return early (extra buy granted or pyramid empty mid-extra).
function advanceOrExtraBuy(player) {
  // Local human with extra buy available
  if (player === G.players[0] && player.hasExtraBuy && !player.extraBuyUsed) {
    if (!isPyramidEmpty(G.pyramid)) {
      player.extraBuyUsed = true;
      addLog(`Extra buy/burn! Spend your remaining $${player.roundDollars}.`, 'log-buy');
      humanBuyTurn(player);
      return true;
    }
  }
  // Remote human opponent with extra buy (MP only)
  if (MP.active && player !== G.players[0] && player.isHuman && player.hasExtraBuy && !player.extraBuyUsed) {
    if (!isPyramidEmpty(G.pyramid)) {
      player.extraBuyUsed = true;
      addLog(`${player.name} uses their extra buy/burn!`, 'log-buy');
      mpOpponentBuyTurn(player);
      return true;
    }
  }
  G.currentBuyerIdx++;
  if (isPyramidEmpty(G.pyramid)) {
    addLog('Store is empty! Round ends.', 'log-score');
    endBuyPhase();
  } else {
    processBuyTurn();
  }
  return false;
}

// Human burn: push to Firebase (MP, local human only) then apply locally
function executeBurn(player, row, col) {
  if (MP.active && player === G.players[0]) MP.pushBuyAction('burn', row, col);
  executeBurnLocal(player, row, col);
}

function executeBurnLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return;
  clearActions();
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} burned ${cardLabel(slot.card)} ($${slot.card.cost}).`, 'log-burn');
  revealUncovered(G.pyramid);
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push();

  advanceOrExtraBuy(player);
}

// --- AI BUY ---

async function aiBuyTurn(ai) {
  setMessage(`${ai.name} is buying\u2026`);
  clearActions();
  await delay(1000);

  const available = getAvailablePyramidCards(G.pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= ai.roundDollars);

  if (affordable.length > 0) {
    // Score and pick best; add reveal bonus for cards that uncover hidden pyramid slots
    let best = null;
    let bestScore = -Infinity;
    for (const a of affordable) {
      const score = scoreCardForAI(a.slot.card, ai) + pyramidRevealBonus(a.row, a.col);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    executeBuy(ai, best.row, best.col);
  } else if (available.length > 0) {
    // Burn: denial personalities target the card most valuable to the current leader;
    // all others burn the card with lowest value to themselves.
    const cfg = AI_PERSONALITIES[ai.personality] || AI_PERSONALITIES.rancher;
    let burnTarget = null;

    if (cfg.denialBurn) {
      // Find the current leader among opponents (tiebreak: lowest Firebase slot index)
      const leader = G.players
        .filter(p => p !== ai)
        .sort((a, b) => {
          const diff = b.herd - a.herd;
          if (diff !== 0) return diff;
          return G.playerOrder[G.players.indexOf(a)] - G.playerOrder[G.players.indexOf(b)];
        })[0];
      if (leader) {
        let bestLeaderScore = -Infinity;
        for (const a of available) {
          const score = scoreCardForAI(a.slot.card, leader);
          if (score > bestLeaderScore) { bestLeaderScore = score; burnTarget = a; }
        }
      }
    }

    if (!burnTarget) {
      // Act-aware: in late acts with a sparse pyramid, deny the leader's best card
      const actProgress = G.currentAct / 3;
      const pyramidDensity = Math.min(1, available.length / Math.max(1, G.numPlayers * 2));
      if (actProgress * (1 - pyramidDensity) > 0.4) {
        const leader = G.players.filter(p => p !== ai).sort((a, b) => b.herd - a.herd)[0];
        if (leader) {
          let bestLeaderScore = -Infinity;
          for (const a of available) {
            const score = scoreCardForAI(a.slot.card, leader);
            if (score > bestLeaderScore) { bestLeaderScore = score; burnTarget = a; }
          }
        }
      }
    }

    if (!burnTarget) {
      // Default: burn the card with lowest value to self
      let worstScore = Infinity;
      for (const a of available) {
        const score = scoreCardForAI(a.slot.card, ai);
        if (score < worstScore) { worstScore = score; burnTarget = a; }
      }
    }

    executeBurn(ai, burnTarget.row, burnTarget.col);
  } else {
    addLog(`${ai.name} has no available cards to buy or burn.`);
    G.currentBuyerIdx++;
    processBuyTurn();
  }
}

function scoreCardForAI(card, ai) {
  const cfg = AI_PERSONALITIES[(ai && ai.personality)] || AI_PERSONALITIES.rancher;
  let score = 0;
  score += card.cows * cfg.cowWeight;
  score += card.dollars * cfg.dollarWeight;
  score -= card.bandits * cfg.banditPenalty;
  // Special ability bonuses (fixed; personality differences come from the weights above)
  if (card.special === 'trash_to_use') score += 2;
  if (card.special === 'copy_next') {
    // Value copy_next based on deck quality: good deck = more valuable copy
    if (ai && ai.deck.length > 0) {
      const avgDeckQuality = ai.deck.reduce((sum, c) =>
        sum + c.cows * cfg.cowWeight + c.dollars * cfg.dollarWeight, 0) / ai.deck.length;
      score += Math.max(1.5, Math.min(6, avgDeckQuality));
    } else {
      score += 3;
    }
  }
  if (card.special === 'draw4') score += 2;
  if (card.special === 'look3_rearrange') score += 1.5;
  if (card.special === 'replay_discard') score += 2;
  if (card.special === 'put_on_top') score += 1;
  if (card.special === 'trash_buy_burn_first') score += 1;
  if (card.special === 'dollar1_other') score -= 0.5;
  if (card.cows < 0) score -= 2;
  if (G.currentAct === 1) score += card.dollars * 1;  // Act 1: favour economy cards
  if (G.currentAct === 3) score += card.cows   * 2;  // Act 3: favour cow cards
  return score;
}

// Returns a bonus score for buying a card that would uncover hidden cards above it.
// A card at (row, col) is covered by its children at (row+1, col) and (row+1, col+1).
// So parent A is at (row-1, col) — also covered by sibling (row, col+1).
// And parent B is at (row-1, col-1) — also covered by sibling (row, col-1).
function pyramidRevealBonus(row, col) {
  if (row === 0) return 0;
  const REVEAL_BONUS = 1.5;
  let bonus = 0;
  // Parent A: (row-1, col), revealed if sibling (row, col+1) is also gone
  if (col < row) {
    const parentA = G.pyramid[row - 1][col];
    if (parentA && !parentA.removed && !parentA.faceUp) {
      const siblingA = G.pyramid[row][col + 1];
      if (!siblingA || siblingA.removed) bonus += REVEAL_BONUS;
    }
  }
  // Parent B: (row-1, col-1), revealed if sibling (row, col-1) is also gone
  if (col > 0) {
    const parentB = G.pyramid[row - 1][col - 1];
    if (parentB && !parentB.removed && !parentB.faceUp) {
      const siblingB = G.pyramid[row][col - 1];
      if (!siblingB || siblingB.removed) bonus += REVEAL_BONUS;
    }
  }
  return bonus;
}

// --- PASS CARD (discard_to_player) ---

// AI passes the curse card to the current leader (largest herd);
// tiebreak by lowest Firebase slot index (deterministic on all clients).
function aiPickPassTarget(fromPlayerIdx) {
  return G.players
    .map((p, i) => ({ p, i }))
    .filter(c => c.i !== fromPlayerIdx)
    .sort((a, b) => {
      const herdDiff = b.p.herd - a.p.herd;  // descending: target leader first
      if (herdDiff !== 0) return herdDiff;
      return G.playerOrder[a.i] - G.playerOrder[b.i];
    })[0].i;
}

// Resolve all discard_to_player cards across all players before hands are cleared.
// Processes players in index order; each card is resolved separately.
async function resolvePassCards() {
  const findCardTemplate = id =>
    STORE_CARDS.find(c => c.id === id) || STARTER_TEMPLATES.find(t => t.id === id);

  for (let pi = 0; pi < G.numPlayers; pi++) {
    const player = G.players[pi];
    const passCards = player.hand.filter(c => c.special === 'discard_to_player');
    for (const card of passCards) {
      await resolveSinglePassCard(pi, card, findCardTemplate);
    }
  }
}

async function resolveSinglePassCard(fromIdx, card, findCardTemplate) {
  const fromPlayer = G.players[fromIdx];
  const fromName = fromIdx === 0 ? 'You' : fromPlayer.name;
  let toIdx;

  if (fromIdx === 0) {
    // Local human — prompt to choose a recipient
    const opponents = G.players.map((p, i) => ({ p, i })).filter(c => c.i !== fromIdx);
    setMessage('Pass card to an opponent — choose who receives it:');
    clearActions();
    render();
    toIdx = await new Promise(resolve => {
      setActions(opponents.map(({ p, i }) => ({
        text: p.name,
        onClick: () => resolve(i),
      })));
    });
    clearActions();
    if (MP.active) {
      await MP.pushPassCard(card.id, G.playerOrder[toIdx]);
    }

  } else if (!fromPlayer.isHuman) {
    // AI — deterministic, same on all clients
    toIdx = aiPickPassTarget(fromIdx);
    // Host logs on behalf of AI (others run same logic silently)

  } else {
    // Remote human in MP — wait for their Firebase push
    const fromSlot = G.playerOrder[fromIdx];
    setMessage(`Waiting for ${fromPlayer.name} to pass a card...`);
    render();
    const data = await new Promise(resolve => MP.waitForPassCard(fromSlot, resolve));
    toIdx = MP.slotToPlayer[data.toSlot];
  }

  // Move card from fromPlayer's hand to toPlayer's discard
  fromPlayer.hand = fromPlayer.hand.filter(c => c !== card);
  G.players[toIdx].discard.push(card);

  const toName = toIdx === 0 ? 'you' : G.players[toIdx].name;
  addLog(`${fromName} passes a card to ${toName}.`, 'log-info');
  render();
}

// --- END PHASES ---

function endBuyPhase() {
  G.phase = 'score';
  scoreRound();
}

async function scoreRound() {
  // Score cows for non-busted players
  G.players.forEach((player, playerIdx) => {
    if (!player.busted && player.roundCows !== 0) {
      player.herd = Math.max(0, player.herd + player.roundCows);
      addLog(`${player.name} adds ${player.roundCows} cows to herd (total: ${player.herd}).`, 'log-score');
      const prefix = playerIdx === 0 ? 'player' : `opp-${playerIdx}`;
      triggerHerdBump(prefix);
    }
  });

  // Resolve any discard_to_player cards before hands are cleared
  await resolvePassCards();

  // Move all remaining drawn cards to each player's own discard
  for (const player of G.players) {
    player.discard.push(...player.hand);
    player.hand = [];
  }

  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push(); // spectators see final scores for the round
  await delay(1000);

  // Check if pyramid empty (end of act)
  if (isPyramidEmpty(G.pyramid)) {
    await endAct();
  } else {
    G.roundNumber++;
    await startRound();
  }
}

async function endAct() {
  if (G.currentAct >= 3) {
    await startShowdown();
    return;
  }

  const nextAct = G.currentAct + 1;
  setMessage(`Act ${G.currentAct} complete! Starting Act ${nextAct}...`);
  clearActions();
  addLog(`=== Act ${G.currentAct} complete! ===`, 'log-score');
  await delay(2000);

  await setupAct(nextAct);
}

async function startShowdown() {
  G.phase = 'showdown';

  const screen = document.getElementById('showdown-screen');
  const playersDiv = document.getElementById('showdown-players');
  const footer = document.getElementById('showdown-footer');

  playersDiv.innerHTML = '';
  footer.classList.add('hidden');
  screen.classList.remove('hidden');

  const me = G.players[0];

  // Build a section for each player
  const playerData = G.players.map((player, i) => {
    const allCards = [...player.deck, ...player.hand, ...player.discard];

    const section = document.createElement('div');
    section.className = 'showdown-player';

    const nameEl = document.createElement('div');
    nameEl.className = 'showdown-player-name';
    nameEl.textContent = player === me ? 'You' : player.name;

    const herdEl = document.createElement('div');
    herdEl.className = 'showdown-player-herd';
    herdEl.innerHTML = `Herd: <strong class="showdown-herd-val" id="showdown-herd-${i}">${player.herd}</strong>`;

    const grid = document.createElement('div');
    grid.className = 'showdown-card-grid';

    const cardEls = allCards.map(card => {
      const el = renderCardEl(card, false); // face-down to start
      grid.appendChild(el);
      return { el, card };
    });

    const tally = document.createElement('div');
    tally.className = 'showdown-tally hidden';
    tally.id = `showdown-tally-${i}`;

    section.appendChild(nameEl);
    section.appendChild(herdEl);
    section.appendChild(grid);
    section.appendChild(tally);
    playersDiv.appendChild(section);

    return { player, allCards, cardEls, i };
  });

  // Wait for the title animation to land
  await delay(900);

  // Flip all players' cards face-up simultaneously, staggered within each player
  function flipCardFaceUp(el, card, delayMs) {
    return new Promise(resolve => {
      setTimeout(() => {
        el.classList.add('card-flip-out');
        setTimeout(() => {
          el.querySelector('img').src = cardImgSrc(card, true);
          el.onclick = (e) => { e.stopPropagation(); showCardZoom(cardImgSrc(card, true)); };
          el.classList.remove('card-flip-out');
          void el.offsetWidth; // force reflow so card-flip-in registers as a new animation
          el.classList.add('card-flip-in');
          setTimeout(() => {
            el.classList.remove('card-flip-in');
            resolve();
          }, 290);
        }, 300); // flip-out: 0.12s delay + 0.18s anim
      }, delayMs);
    });
  }

  const flipPromises = playerData.flatMap(({ cardEls }) =>
    cardEls.map(({ el, card }, j) => flipCardFaceUp(el, card, j * 65))
  );
  await Promise.all(flipPromises);

  await delay(700);

  // Score each player one at a time
  for (const { player, allCards, i } of playerData) {
    const totalCows    = allCards.reduce((s, c) => s + (c.cows    || 0), 0);
    const totalDollars = allCards.reduce((s, c) => s + (c.dollars || 0), 0);
    const bonusCows    = Math.floor(totalDollars / 2);
    const newCows      = totalCows + bonusCows;

    const oldHerd  = player.herd;
    player.herd    = Math.max(0, player.herd + newCows);
    const gained   = player.herd - oldHerd;

    // Build tally display
    const tallyEl = document.getElementById(`showdown-tally-${i}`);
    let formulaParts = [];
    if (totalCows !== 0)  formulaParts.push(`<span class="tally-cows">${totalCows > 0 ? '+' : ''}${totalCows} cows from cards</span>`);
    if (bonusCows  > 0)   formulaParts.push(`<span class="tally-bonus">+${bonusCows} bonus (from $${totalDollars})</span>`);

    const formulaHTML = formulaParts.length
      ? formulaParts.join(' + ')
      : '<span class="tally-zero">No scoring cards</span>';

    tallyEl.innerHTML =
      `<span class="tally-formula">${formulaHTML}</span>` +
      `<span class="tally-total">${gained >= 0 ? '+' : ''}${gained} → Final Herd: ${player.herd}</span>`;
    tallyEl.classList.remove('hidden');

    await delay(350);

    // Animate the herd counter
    const herdVal = document.getElementById(`showdown-herd-${i}`);
    if (herdVal) {
      herdVal.textContent = player.herd;
      herdVal.classList.add('showdown-herd-bump');
      setTimeout(() => herdVal.classList.remove('showdown-herd-bump'), 700);
    }

    const name = player === me ? 'You' : player.name;
    addLog(`Showdown: ${name} — ${totalCows} cows + ${bonusCows} bonus ($${totalDollars}) = ${player.herd} total.`, 'log-score');

    await delay(650);
  }

  await delay(300);
  footer.classList.remove('hidden');
}

function revealWinner() {
  document.getElementById('showdown-screen').classList.add('hidden');
  gameOver();
}

function gameOver() {
  G.phase = 'gameOver';
  const me = G.players[0];

  const maxHerd = Math.max(...G.players.map(p => p.herd));
  const topPlayers = G.players.filter(p => p.herd === maxHerd);

  let title;
  if (topPlayers.length === 1 && topPlayers[0] === me) {
    title = 'You Win!';
  } else if (topPlayers.some(p => p === me)) {
    title = "It's a Tie!";
  } else if (topPlayers.length === 1) {
    title = `${topPlayers[0].name} Wins!`;
  } else {
    title = "It's a Tie!";
  }

  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-scores').innerHTML = G.players.map(p =>
    `<p style="font-size:1.1rem;margin:0.75rem 0">${p === me ? 'You' : p.name}: <strong>${p.herd}</strong> cows</p>`
  ).join('');

  document.getElementById('gameover-screen').classList.remove('hidden');
  const logParts = G.players.map(p => `${p === me ? 'You' : p.name}: ${p.herd}`).join(', ');
  addLog(`Game Over! ${logParts}.`, 'log-score');

  if (MP.active) {
    MP.pushSpectatorState(); // spectators see final game-over state
    if (MP.isHost) MP.setLiveStatus('finished'); // remove from live-games list
    MP.clearRejoinInfo();    // game is over — don't offer rejoin from home screen
    MP.cleanup();
  } else {
    AI_SPEC.push();   // spectators see final game-over state
    AI_SPEC.finish(); // remove from live-games list
  }

  // Log game to global history (MP: host only; SP: always; never for debug games)
  if (!G.isDebug && (!MP.active || MP.isHost)) {
    const winnerName = topPlayers.length === 1 ? topPlayers[0].name : null;
    HISTORY.logGame({
      ts: Date.now(),
      mode: MP.active ? 'mp' : 'ai',
      numPlayers: G.numPlayers,
      players: G.players.map(p => ({
        name: p.name,
        isHuman: p.isHuman,
        herd: p.herd,
        isWinner: topPlayers.includes(p),
      })),
      winner: winnerName,
      actsCompleted: G.currentAct,
      totalRounds: G.roundNumber,
    });
  }
}

// --- DISBAND GAME (host only) ---

function disbandGame() {
  if (!MP.active || !MP.isHost) return;
  if (!confirm('Disband this game? All players will be sent back to the home screen.')) return;
  MP.disband();
}

// --- SPECTATOR LINK ---

function copySpectateLink() {
  const code = MP.active ? MP.code : AI_SPEC.code;
  if (!code) return;
  const base = `${location.origin}${location.pathname.replace('playgame.html', '')}spectate.html?code=${code}`;
  const url = MP.active ? base : `${base}&ai=1`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btn-spectate-link');
    const prev = btn.textContent;
    btn.textContent = '\u2713 Copied!';
    setTimeout(() => { btn.textContent = prev; }, 2000);
  });
}

// --- RULES MODAL ---

function showRules() {
  document.getElementById('rules-modal').classList.remove('hidden');
}

function closeRules() {
  document.getElementById('rules-modal').classList.add('hidden');
}

// --- DECK VIEWER ---

function showDeck() {
  if (!G) return;
  const player = G.players[0];
  const allCards = [...player.deck, ...player.discard, ...player.hand];

  const body = document.getElementById('deck-modal-body');
  body.innerHTML = '';

  // Group cards: starters vs purchased (by act)
  const starters = allCards.filter(c => c.act === 0);
  const purchased = allCards.filter(c => c.act > 0);

  function renderGroup(label, cards) {
    if (cards.length === 0) return;
    const heading = document.createElement('h3');
    heading.textContent = label + ' (' + cards.length + ')';
    body.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'deck-grid';
    for (const card of cards) {
      const el = renderCardEl(card, true);
      grid.appendChild(el);
    }
    body.appendChild(grid);
  }

  renderGroup('Starter Cards', starters);
  renderGroup('Purchased Cards', purchased);

  document.getElementById('deck-modal').classList.remove('hidden');
}

function closeDeck() {
  document.getElementById('deck-modal').classList.add('hidden');
}

// --- DECK PEEK (draw phase only — shows ordered backs of draw pile) ---

function showDeckPeek() {
  if (!G || G.phase !== 'draw') return;
  const player = G.players[0];
  if (player.deck.length === 0) return;

  document.getElementById('deck-peek-title').textContent =
    `Draw Pile \u2014 ${player.deck.length} card${player.deck.length !== 1 ? 's' : ''}`;

  const body = document.getElementById('deck-peek-body');
  body.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'deck-grid';

  player.deck.forEach((card, i) => {
    const slot = document.createElement('div');
    slot.className = 'deck-peek-slot';

    const el = renderCardEl(card, false); // face-down back only
    slot.appendChild(el);

    const pos = document.createElement('div');
    pos.className = 'deck-peek-pos';
    pos.textContent = i === 0 ? 'Next' : `#${i + 1}`;
    slot.appendChild(pos);

    grid.appendChild(slot);
  });

  body.appendChild(grid);
  document.getElementById('deck-peek-modal').classList.remove('hidden');
}

function closeDeckPeek() {
  document.getElementById('deck-peek-modal').classList.add('hidden');
}

// --- CARD ZOOM ---

function showCardZoom(imgSrc) {
  const overlay = document.getElementById('card-zoom');
  const img = document.getElementById('card-zoom-img');
  img.src = imgSrc;
  overlay.classList.remove('hidden');
}

function closeCardZoom() {
  document.getElementById('card-zoom').classList.add('hidden');
}

function showCardHoverPreview(cardEl, card) {
  const preview = document.getElementById('card-hover-preview');
  const img = document.getElementById('card-hover-img');
  img.src = cardImgSrc(card, true);
  const rect = cardEl.getBoundingClientRect();
  const previewW = 180;
  const previewH = 252; // approx card aspect ratio
  let left = rect.right + 10;
  let top = rect.top;
  if (left + previewW > window.innerWidth) left = rect.left - previewW - 10;
  if (top + previewH > window.innerHeight) top = window.innerHeight - previewH - 8;
  preview.style.left = left + 'px';
  preview.style.top = top + 'px';
  preview.classList.remove('hidden');
}

function hideCardHoverPreview() {
  document.getElementById('card-hover-preview').classList.add('hidden');
}

// --- COLLAPSIBLE SECTIONS ---

function toggleOppZone(i) {
  // Determine the new state from the clicked zone, then apply to all opponent zones
  const clickedDetail = document.getElementById('opp-' + i + '-detail');
  const nowCollapsed = !clickedDetail.classList.contains('collapsed');
  for (let j = 1; j < G.numPlayers; j++) {
    const detail = document.getElementById('opp-' + j + '-detail');
    const toggle = document.getElementById('opp-' + j + '-toggle');
    if (!detail) continue;
    detail.classList.toggle('collapsed', nowCollapsed);
    toggle.textContent = nowCollapsed ? '\u25BC' : '\u25B2';
  }
}

function ensureOpponentZone(i, container) {
  if (document.getElementById('opp-zone-' + i)) return; // already present — preserve collapse state
  const prefix = 'opp-' + i;
  const div = document.createElement('div');
  div.id = 'opp-zone-' + i;
  div.className = 'opp-zone';
  div.innerHTML =
    '<div class="ai-summary" onclick="toggleOppZone(' + i + ')">' +
      '<div class="ai-summary-left">' +
        '<span class="zone-label" style="margin:0">' + G.players[i].name +
          ' <span id="' + prefix + '-crown" class="draw-crown">\uD83D\uDC51</span>' +
          '<span id="' + prefix + '-done-mark" class="done-draw-mark hidden">\u2713</span>' +
        '</span>' +
        '<span class="herd-display">' +
          '<span>Herd</span>' +
          '<span class="herd-number-wrap">' +
            '<strong id="' + prefix + '-herd" class="herd-number">0</strong>' +
            '<span class="herd-dust" id="' + prefix + '-herd-dust"></span>' +
          '</span>' +
        '</span>' +
        '<span class="deck-display">Deck: <strong id="' + prefix + '-deck-count">10</strong></span>' +
        '<span id="' + prefix + '-round-stats-inline" class="ai-inline-stats hidden">' +
          '<span class="sep">|</span>' +
          '$<strong id="' + prefix + '-round-dollars">0</strong>' +
          '<span class="ai-stat-cow">\uD83D\uDC04<strong id="' + prefix + '-round-cows">0</strong></span>' +
          '<span class="ai-stat-bandit">B:<strong id="' + prefix + '-round-bandits">0</strong></span>' +
        '</span>' +
      '</div>' +
      '<span id="' + prefix + '-toggle" class="collapse-toggle">\u25BC</span>' +
    '</div>' +
    '<div id="' + prefix + '-detail" class="collapsible collapsed">' +
      '<div class="player-info">' +
        '<span class="discard-display">Discard: <strong id="' + prefix + '-discard-count">0</strong></span>' +
      '</div>' +
      '<div class="hand-row">' +
        '<div id="' + prefix + '-deck-preview"></div>' +
        '<div id="' + prefix + '-hand" class="hand"></div>' +
      '</div>' +
    '</div>';
  container.appendChild(div);
}

function toggleLog() {
  const detail = document.getElementById('log-detail');
  const toggle = document.getElementById('log-toggle');
  detail.classList.toggle('collapsed');
  toggle.textContent = detail.classList.contains('collapsed') ? '\u25BC' : '\u25B2';
}

// --- IMAGE PRELOADER ---

function preloadImages() {
  const imgs = new Set();
  for (const tmpl of STARTER_TEMPLATES) {
    imgs.add(CARD_IMG_PATH + tmpl.img);
  }
  for (const card of STORE_CARDS) {
    imgs.add(CARD_IMG_PATH + card.img);
  }
  for (const back of Object.values(CACTI_BACK)) {
    imgs.add(BACK_IMG_PATH + back);
  }
  for (const src of imgs) {
    const img = new Image();
    img.src = src;
  }
}

// --- DEBUG SCENARIOS ---

function applyDebugScenario(name) {
  const DEBUG_SEED = 12345;

  // Returns a deck with `specialId` first, then 9 starter cards
  function debugDeck(specialId, slotIdx) {
    const special = STORE_CARDS.find(c => c.id === specialId);
    const starters = STARTER_TEMPLATES.slice(0, 9).map(t => createCardInstance(t));
    return special ? [createCardInstance(special), ...starters] : starters;
  }

  // Leaves only the top 3 rows of the pyramid (~6 cards for 4P) — a few buys from game end.
  // Cards are taken bottom-up, so near-end state = bottom rows already cleared.
  function nearEndPyramid(pyramid) {
    const keepRows = 3; // rows 0, 1, 2 (apex down)
    for (let r = keepRows; r < pyramid.length; r++) {
      for (const slot of pyramid[r]) { slot.removed = true; slot.faceUp = true; }
    }
    revealUncovered(pyramid);
  }

  function makeSpecialScenario(specialCardId, act, extraNames) {
    const numPlayers = extraNames ? extraNames.length + 1 : 2;
    const players = [createPlayer('You', true, 0)];
    players[0].deck = debugDeck(specialCardId, 0);
    const aiNames = extraNames || ['Cowboy AI'];
    for (let i = 0; i < aiNames.length; i++) {
      players.push(createPlayer(aiNames[i], false, i + 1));
    }
    G = initState(numPlayers, players);
    G.currentAct = act;
    G.roundNumber = 1;
    G.gameSeed = DEBUG_SEED;
    G.pyramid = buildPyramid(act);
    for (let i = 1; i < numPlayers; i++) initAiRng(i, DEBUG_SEED);
  }

  const AI3 = ['Buffalo Bill', 'Jesse James', 'Wild Mary'];

  const SCENARIOS = {
    near_showdown() {
      const names = ['Buffalo Bill', 'Jesse James', 'Wild Mary'];
      const herds  = [32, 29, 35, 28];
      const players = [createPlayer('You', true, 0), ...names.map((n, i) => createPlayer(n, false, i + 1))];
      players.forEach((p, i) => { p.herd = herds[i]; });
      G = initState(4, players);
      G.currentAct = 3;
      G.roundNumber = 9;
      G.gameSeed = DEBUG_SEED;
      G.pyramid = buildPyramid(3);
      nearEndPyramid(G.pyramid);
      for (let i = 1; i <= 3; i++) initAiRng(i, DEBUG_SEED);
    },

    special_trash_to_use()       { makeSpecialScenario('card_77', 1); },
    special_2cow_if_first()      { makeSpecialScenario('card_15', 1); },
    special_trash_buy_burn()     { makeSpecialScenario('card_14', 1); },
    special_trash_for_2()        { makeSpecialScenario('card_16', 2); },
    special_look3_rearrange()    { makeSpecialScenario('card_19', 2); },
    special_copy_next()          { makeSpecialScenario('card_20', 2); },
    special_put_on_top()         { makeSpecialScenario('card_22', 2); },
    special_extra_buy()          { makeSpecialScenario('card_21', 2); },
    special_replay_discard()     { makeSpecialScenario('card_23', 2); },
    special_dollar1_other()      { makeSpecialScenario('card_24', 2); },
    special_discard_to_player()  { makeSpecialScenario('card_4',  2, AI3); },
    special_look3_immediate()    { makeSpecialScenario('card_31', 3); },
  };

  const fn = SCENARIOS[name];
  if (!fn) { console.warn('Unknown debug scenario:', name); return; }
  fn();
  G.isDebug = true;
  addLog(`[DEBUG] Scenario: ${name}`, 'log-score');
}

// --- INIT ---
preloadImages();
startGame().catch(e => {
  console.error('Game init failed:', e);
  setMessage('Failed to start game. Please refresh.');
});

// determineBuyWinner is defined in shared/tiebreaker.js (loaded before this script)
