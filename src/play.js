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

  // Identity is normally handed off via sessionStorage when the lobby navigates
  // to playgame.html. But mobile browsers evict backgrounded tabs aggressively;
  // when the player reopens the tab from history, sessionStorage is gone even
  // though ?mp is still in the URL. Recover identity from the URL or the
  // durable localStorage rejoin record so a bare page reload can resume on its
  // own — no detour back to the home-screen "Rejoin" banner required.
  // `recovered` tells startGame to take the resume path rather than re-init.
  let recovered = false;
  let code      = sessionStorage.getItem('mp_code');
  let mySlotStr = sessionStorage.getItem('mp_slot');  // '0' = host, '1+' = guest
  let myName    = sessionStorage.getItem('mp_name');

  if (!code || mySlotStr === null || !myName) {
    // Recover identity for a fresh page load (evicted mobile tab, opened link).
    // Prefer the URL — it survives tab eviction and works on any device that
    // has the link — then fall back to the durable localStorage rejoin record.
    const qp = new URLSearchParams(location.search);
    const urlCode = qp.get('code');
    const urlSlot = qp.get('slot');
    if (urlCode && urlSlot !== null) {
      code = urlCode;
      mySlotStr = urlSlot;
      myName = qp.get('name') || myName || 'Player';
      recovered = true;
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem('cfc_rejoin') || 'null');
        if (saved && saved.code && saved.slot != null && saved.name) {
          code = saved.code;
          mySlotStr = String(saved.slot);
          myName = saved.name;
          recovered = true;
        }
      } catch (e) {}
    }
    if (recovered) {
      sessionStorage.setItem('mp_code', code);
      sessionStorage.setItem('mp_slot', mySlotStr);
      sessionStorage.setItem('mp_name', myName);
    }
  }

  if (!code || mySlotStr === null || !myName) return { active: false };

  const mySlot = parseInt(mySlotStr, 10);
  const isHost = mySlot === 0;

  // Dynamic Firebase import (ESM CDN)
  let dbRef = null;
  let db    = null;
  let fbMod = null;
  let fbSet, fbUpdate, fbOnValue, fbOnDisconnect, fbRemove, fbGet, fbRef, fbTransaction;

  let unsubscribers     = [];
  let _namedSubs        = {};  // key → unsubscribe; re-subscribing a key replaces the old sub
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

  // Idempotent subscription: re-registering the same key first unsubscribes the old
  // listener. Used for per-round re-arms (drawState watchers) that previously stacked a
  // NEW onValue every round and never released them until game end — by Act 3 a single
  // opponent draw event fired ~10-15 duplicate callbacks, each with a full re-render and
  // (host) a full spectatorState write (audit H1).
  function subscribeNamed(key, r, cb) {
    if (_namedSubs[key]) { try { _namedSubs[key](); } catch (e) {} }
    _namedSubs[key] = fbOnValue(r, cb);
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
    fbTransaction = (r, fn)    => fbMod.runTransaction(r, fn);

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
          // Start a 30-second grace period, then open a 5-minute rejoin window.
          // Mobile players background the tab constantly (reading a text, lock
          // screen); a brief blip must NOT spam every other player. So we stay
          // silent during the grace window and only surface a message once it
          // expires into the countdown. The grace is generous on purpose.
          if (!disconnectTimers[slotIdx] && !rejoinCountdowns[slotIdx]) {
            disconnectTimers[slotIdx] = setTimeout(() => {
              delete disconnectTimers[slotIdx];
              startRejoinCountdown(slotIdx, playerName);
            }, 30000);
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
    return { slotDefs: _slotDefs, gameSeed: _gameSeed, numPlayers: _numPlayers, hiddenHerdMode: data.hiddenHerdMode || false };
  }

  // Push local player's full draw state (hand + deck + stats) after every draw action
  async function pushDrawState(player) {
    if (!initialized) return;
    await fbSet(gameRef(`drawState/${mySlot}`), {
      round: G.roundNumber, // used by receivers to discard stale data from previous rounds
      // act is pinned to 1 since the single-Store rework (roundNumber is now monotonic for
      // the whole game, so round alone is unique). Kept in the payload so the stale-guard
      // shape — and any client still running an older build — stays compatible.
      act: G.currentAct,
      hand: player.hand.map(c => c.id),
      deck: player.deck.map(c => c.id),
      discard: player.discard.map(c => c.id), // full discard so host can reconstruct correctly after reshuffles
      dollars: player.roundDollars,
      cows: player.roundCows,
      bandits: player.roundBandits,
      busted: player.busted,
      stoppedDrawing: player.stoppedDrawing,
      discardCount: player.discard.length,
      hasBuyBurnFirst: player.hasBuyBurnFirst || false,
      hasExtraBuy: player.hasExtraBuy || false,
      dollar1OtherPlayed: player.dollar1OtherPlayed || 0, // card_24 plays (audit C5)
    });
  }

  // Live watch all human opponent draw states; callback(slotIdx, state) on every update.
  // Named subscription: startRound re-arms this every round — the old sub is replaced,
  // not stacked (audit H1).
  function watchOpponentDrawStates(callback) {
    if (!initialized) return;
    for (let s = 0; s < _numPlayers; s++) {
      if (s === mySlot || !_slotDefs[s] || !_slotDefs[s].isHuman) continue;
      const slotIdx = s;
      subscribeNamed(`drawState_${slotIdx}`, gameRef(`drawState/${slotIdx}`), (snap) => {
        const val = snap.val();
        if (val) callback(slotIdx, val);
      });
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
      // Authoritative done-time hand contents (ids). Receivers reconcile the hand from
      // this: late drawState re-fires are ignored once done (stats protection), so
      // without it a reconnect-ordering race could leave a stale hand feeding the
      // buy-order tiebreaker (hand.length / hand[i].cost) — audit R3.
      hand: player.hand.map(c => c.id),
      dollar1OtherPlayed: player.dollar1OtherPlayed || 0,
      hasBuyBurnFirst: player.hasBuyBurnFirst || false,
      hasExtraBuy: player.hasExtraBuy || false,
    });
  }

  // Host-only recovery: force-mark a (stuck/disconnected) human slot's draw as done
  // using last-known stats, so every client's waitForAllHumanDrawsDone advances.
  async function forceSignalDrawDone(slotIdx, stats) {
    if (!initialized) return;
    await fbSet(gameRef(`drawDone/${slotIdx}`), {
      done: true, forced: true,
      round: G.roundNumber, act: G.currentAct,
      dollars: stats.dollars || 0, cows: stats.cows || 0, bandits: stats.bandits || 0,
      busted: !!stats.busted, handCount: 0,
      dollar1OtherPlayed: stats.dollar1OtherPlayed || 0, // last-synced card_24 count (audit C5)
      hasBuyBurnFirst: !!stats.hasBuyBurnFirst, hasExtraBuy: !!stats.hasExtraBuy,
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
    await fbUpdate(dbRef, updates);
  }

  // Push a full game-state snapshot for spectators + rejoin reconstruction (host only).
  // Called at phase boundaries and after every buy/burn action. Uses the SHARED
  // buildSpectatorState() (same serializer as AI_SPEC.push) — the two used to be
  // separate copies that drifted (audit H2); keep them unified so every field added
  // for rejoin (entitlements, aiRngSeeds, drawsDone) reaches both MP and AI snapshots.
  async function pushSpectatorState() {
    if (!initialized || !isHost || !G || G.phase === 'start') return;
    try {
      await fbSet(gameRef('spectatorState'), buildSpectatorState());
      await pushLiveSummary();
    } catch (e) {
      // Non-critical — spectator state is best-effort
      console.warn('[MP] pushSpectatorState failed:', e);
    }
  }

  // Slim public summary for history.html's "Live Now" list (host only).
  // Lets the list render without downloading full game state (hands/decks/
  // pyramid) for every visitor. Full state stays in games/{code} and is
  // loaded only when someone opens spectate.html. Kept in sync because this
  // is called from pushSpectatorState (the single MP spectator chokepoint).
  async function pushLiveSummary() {
    if (!initialized || !isHost || !code || !G || G.phase === 'start') return;
    try {
      await fbSet(fbRef(db, `liveSummary/${code}`), {
        mode: 'mp',
        status: G.phase === 'gameover' ? 'finished' : 'active',
        numPlayers: G.numPlayers,
        players: G.players.map(p => ({ name: p.name, isHuman: p.isHuman })),
        phase: G.phase,
        act: G.currentAct,
        round: G.roundNumber,
        ts: Date.now(),
      });
    } catch (e) { /* best-effort */ }
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
  // Stamps round+act+seq so recipients can reject stale values. `seq` distinguishes a
  // slot's TWO legitimate same-round actions (normal turn = 1, extra buy = 2): the cell
  // is last-writer-wins, and consumers used to null it out after consuming — a slow
  // clear could wipe the actor's second action before others consumed it, and a
  // reconnecting client could apply action #2 as if it were #1 (audit R1). Seq matching
  // replaces clearing entirely: a stale same-round value simply fails the seq check.
  async function pushBuyAction(action, row, col, swap, seq) {
    if (!initialized) return;
    const payload = {
      action, row, col, round: G.roundNumber, act: G.currentAct, seq: seq || 1, ts: Date.now(),
    };
    if (swap) payload.swap = swap; // optional card_4 swap, applied by recipients before the buy/burn
    await fbSet(gameRef(`buyAction/${mySlot}`), payload);
  }

  // Host-only recovery: broadcast a 'skip' action for a stuck slot so every client's
  // waitForBuyAction fires and the buy phase advances past the unresponsive player.
  // Must carry the seq the waiters expect (1 normal turn / 2 extra buy).
  async function forceBuyAction(slotIdx, seq) {
    if (!initialized) return;
    await fbSet(gameRef(`buyAction/${slotIdx}`), {
      action: 'skip', forced: true, seq: seq || 1,
      round: G.roundNumber, act: G.currentAct, ts: Date.now(),
    });
  }

  // Listen for a specific slot's buy action.
  // Captures expected round+act (and seq — see pushBuyAction) so stale values are
  // ignored. Payloads without seq (older clients) pass the seq check for compatibility.
  function waitForBuyAction(slotIdx, expectedSeq, callback) {
    if (!initialized) return;
    const expectedRound = G.roundNumber;
    const expectedAct   = G.currentAct;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef(`buyAction/${slotIdx}`), (snap) => {
      const data = snap.val();
      const matches = data && data.round === expectedRound && data.act === expectedAct
                      && (data.seq === undefined || data.seq === (expectedSeq || 1));
      if (matches && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
    unsubscribers.push(unsub);
  }

  // Watch MY OWN buyAction / drawDone cells for a host-forced signal that raced my
  // real action (R2 tombstones). Named subs — re-arming replaces, never stacks.
  function watchOwnBuyAction(callback) {
    if (!initialized) return;
    subscribeNamed('ownBuyAction', gameRef(`buyAction/${mySlot}`), (snap) => callback(snap.val()));
  }
  function watchOwnDrawDone(callback) {
    if (!initialized) return;
    subscribeNamed('ownDrawDone', gameRef(`drawDone/${mySlot}`), (snap) => callback(snap.val()));
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
    setActions([{ text: 'Back to Home', onClick: () => { window.location.href = 'index.html'; } }]);
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

  // Watch spectatorState continuously — rejoin recovery for transient phases (score/
  // showdown) and for snapshots that appear after a transient fetch miss (audit H3).
  // Named sub: re-arming replaces; call unwatchSpectatorState once resumed.
  function watchSpectatorState(callback) {
    if (!initialized) return;
    subscribeNamed('spectatorState', gameRef('spectatorState'), (snap) => callback(snap.val()));
  }
  function unwatchSpectatorState() {
    if (_namedSubs['spectatorState']) {
      try { _namedSubs['spectatorState'](); } catch (e) {}
      delete _namedSubs['spectatorState'];
    }
  }

  // Fetch the current actSetup (host fresh-start safety, audit H5: a refresh in the
  // window between pushActSetup and the first spectatorState must consume the already-
  // pushed pyramid instead of rebuilding a new random one guests will never see).
  async function fetchActSetup() {
    if (!initialized) return null;
    const snap = await fbGet(gameRef('actSetup'));
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
        await pushLiveSummary();
      } else {
        await fbSet(gameRef('status'), status);
        try { await fbSet(fbRef(db, `liveSummary/${code}/status`), status); } catch (e) {}
      }
    } catch (e) {}
  }

  function cleanup() {
    unsubscribers.forEach(u => u && u());
    unsubscribers = [];
    Object.values(_namedSubs).forEach(u => { try { u && u(); } catch (e) {} });
    _namedSubs = {};
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

  // Host-only: mark the game as disbanded in Firebase (guests detect via watchForDisband).
  // Does NOT delete game data — preserved for debugging/history until manual cleanup.
  async function disband() {
    if (!isHost || !initialized) return;
    cleanup();
    clearRejoinInfo();
    await fbUpdate(dbRef, { status: 'disbanded', disbandedAt: Date.now() });
    try { await fbSet(fbRef(db, `liveSummary/${code}/status`), 'disbanded'); } catch (e) {}
    window.location.href = 'index.html';
  }

  // Guest-only: watch root game ref; if host disbands (status='disbanded') — go home.
  // Also handles legacy deletion (snap.val()===null) in case old host clients still fbRemove.
  function watchForDisband() {
    if (isHost || !initialized) return;
    const unsub = fbOnValue(dbRef, (snap) => {
      const val = snap.val();
      if (val === null || val?.status === 'disbanded') {
        unsub();
        clearRejoinInfo();
        setMessage('The host disbanded the game.');
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
      }
    });
    unsubscribers.push(unsub);
  }

  // 5-8P only: only ONE player may take first-buy priority per round (two copies of
  // card_14 exist under the doubled second deck). Atomically claim it via a per-round
  // transaction (same first-writer-wins pattern as lobby slot claims). Returns true if
  // THIS slot holds the claim (won it now, or already held it). Fail-open on error so a
  // transient Firebase hiccup never eats the player's card.
  async function claimBuyFirst(act, round) {
    if (!initialized) return true;
    try {
      const ref = gameRef(`buyFirstClaim/${act}_${round}`);
      const res = await fbTransaction(ref, (cur) => {
        if (cur === null) return mySlot; // unclaimed → take it
        return;                          // already claimed → abort (no write)
      });
      return res.committed || res.snapshot.val() === mySlot;
    } catch (e) {
      return true; // fail-open
    }
  }

  return {
    active: true,
    code, mySlot, isHost, myName, recovered,
    slotToPlayer: {},  // slotIdx → G.players index; set in startGame()
    init,
    buildPlayersConfig,
    startPresence,
    pushDrawState,
    watchOpponentDrawStates,
    signalDrawDone,
    forceSignalDrawDone,
    waitForAllHumanDrawsDone,
    resetRound,
    clearActSetup,
    pushActSetup,
    waitForActSetup,
    pushBuyAction,
    forceBuyAction,
    waitForBuyAction,
    watchOwnBuyAction,
    watchOwnDrawDone,
    pushBuyOrder,
    waitForBuyOrder,
    pushSpectatorState,
    fetchSpectatorState,
    watchSpectatorState,
    unwatchSpectatorState,
    fetchActSetup,
    setLiveStatus,
    saveRejoinInfo,
    clearRejoinInfo,
    cleanup,
    disband,
    watchForDisband,
    claimBuyFirst,
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
// TRAJECTORY CAPTURE (traj/{code}) — durable, replayable record of human play.
// Captures a compact trajectory (header + per-round deck snapshots + ordered
// decision events + round-boundary canaries) so any FUTURE AI can be scored
// against the human offline, without re-instrumenting the game. Replaces the
// v1 decisionLog "shadow-AI" logger (which anchored everything to one bot).
//
// Versioning (three independent axes, all stamped in the header):
//   TRAJ_SCHEMA_V — record format. Bump on any field/kind change.
//   GAME_V        — game content+logic version. Bump on rules/card-stat changes.
//   cardDbHash    — auto content hash of the card table (backstop under GAME_V).
// Stored data is immutable/append-only; all version handling lives in the
// offline reader (read-time normalization), never a write-time migration.
//
// De-identified: keyed by slotIdx, no player names. Header carries only
// {isHuman, personality} per seat. Research data — never read by clients.
// ============================================================
const TRAJ_SCHEMA_V = 1; // trajectory record format version
const GAME_V        = 3; // bump on any rules / card-stat change (see CLAUDE.md version table)

// Stable content hash of the card-stat table — lets the offline reconstructor
// refuse to replay a trajectory captured under a different card balance.
// Computed lazily (memoized): STARTER_TEMPLATES/STORE_CARDS are defined later in
// the file, so eager evaluation here would hit their temporal dead zone.
let _cardDbHash = null;
function cardDbHash() {
  if (_cardDbHash !== null) return _cardDbHash;
  try {
    const cards = [...STARTER_TEMPLATES, ...STORE_CARDS]
      .map(c => `${c.id}:${c.cows}:${c.dollars}:${c.bandits}:${c.cost || 0}:${c.special || ''}`)
      .sort()
      .join('|');
    let h = 0x811c9dc5; // FNV-1a 32-bit
    for (let i = 0; i < cards.length; i++) {
      h ^= cards.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    _cardDbHash = ('0000000' + h.toString(16)).slice(-8);
  } catch (e) {
    _cardDbHash = 'unknown';
  }
  return _cardDbHash;
}

const TRAJ = (() => {
  let db = null;
  let _fbRef, _fbPush;
  let initialized = false;

  async function init() {
    if (initialized) return;
    const fbApp = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const fbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    const app = fbApp.getApps().length > 0 ? fbApp.getApp() : fbApp.initializeApp(FIREBASE_CONFIG);
    db = fbMod.getDatabase(app);
    _fbRef  = (path) => fbMod.ref(db, path);
    _fbPush = (r, v) => fbMod.push(r, v);
    initialized = true;
  }

  async function push(code, record) {
    try {
      await init();
      await _fbPush(_fbRef(`traj/${code}`), record);
    } catch (e) {
      console.warn('[TRAJ] Failed to log trajectory record:', e);
    }
  }

  return { push };
})();

// Active game code (MP or AI mode), or null if none yet.
function trajGameCode() {
  return MP.active ? (sessionStorage.getItem('mp_code') || null) : (AI_SPEC.code || null);
}

// True for the authoritative client: the MP host, or the single client in AI mode.
// The host writes the header, act setups, AI seats' buys, and canaries (de-duped);
// each human client writes its own seat's snapshots + decisions.
function amTrajHost() {
  return !MP.active || MP.isHost;
}

// Whether trajectory capture should run at all for this game.
// Skipped for 5-8P: the trajectory schema + offline reconstructor are ≤4P-scoped, and
// the ≤4P benchmark corpus shouldn't be diluted with big-game data. Revisit if/when the
// reconstructor learns the 5-8P pyramid geometry (see docs/FIVE_TO_EIGHT_PLAYER_PLAN.md).
function trajActive() {
  // G.isTutorialGame (not TUTORIAL.active) — the active flag drops when the coached
  // steps finish, and the free-play remainder must stay excluded or it writes a
  // headerless (unreplayable) trajectory.
  return !G.isDebug && !G.isTutorialGame && G.numPlayers <= 4 && !!trajGameCode();
}

// Compact card-instance serialization for snapshots (id only — stats come from the card DB).
function trajIds(cards) {
  return (cards || []).map(c => c.id);
}

// FAILSAFE: every capture hook runs through this. Trajectory capture is pure
// research telemetry — nothing in the game protocol reads `traj`, and a write
// is fire-and-forget (TRAJ.push is async and never awaited). This guard makes
// the *synchronous* record-building incapable of throwing into game flow either,
// so a bug here can never crash, stall, or desync a game — it just drops a record.
function trajTry(fn) {
  try { fn(); } catch (e) { console.warn('[TRAJ] capture error (game unaffected):', e); }
}

// --- Header: once per game, host/local client ---
function trajLogHeader() {
  trajTry(() => {
    if (!trajActive() || !amTrajHost()) return;
    const seats = {};
    G.players.forEach(p => { seats[p.slotIdx] = { isHuman: !!p.isHuman, personality: p.personality || null }; });
    TRAJ.push(trajGameCode(), {
      kind: 'hdr', ts: Date.now(),
      schemaV: TRAJ_SCHEMA_V, gameV: GAME_V, cardDbHash: cardDbHash(),
      mode: MP.active ? 'mp' : 'ai',
      gameSeed: G.gameSeed || 0,
      numPlayers: G.numPlayers,
      hiddenHerdMode: !!G.hiddenHerdMode,
      seats,
    });
  });
}

// --- Act setup: pyramid card IDs for an act, host only ---
function trajLogActSetup(act, cardIds) {
  trajTry(() => {
    if (!trajActive() || !amTrajHost()) return;
    TRAJ.push(trajGameCode(), { kind: 'act', ts: Date.now(), act, cardIds });
  });
}

// --- Round snapshot: a seat's deck order + piles at round start ---
// Logged for the local human (every client) and for AI seats (host only).
function trajLogRoundSnaps() {
  trajTry(() => {
    if (!trajActive()) return;
    const code = trajGameCode();
    G.players.forEach(p => {
      const mine = p === G.players[0];
      const aiOnHost = !p.isHuman && amTrajHost();
      if (!mine && !aiOnHost) return; // remote humans log their own seat
      TRAJ.push(code, {
        kind: 'snap', ts: Date.now(),
        act: G.currentAct, round: G.roundNumber, slot: p.slotIdx,
        deck: trajIds(p.deck), hand: trajIds(p.hand), discard: trajIds(p.discard),
        herd: p.herd,
      });
    });
  });
}

// --- Draw event: the local human drew a specific card (outcome, since human shuffles
// use Math.random and aren't reproducible from seed) ---
function trajLogDraw(player, card) {
  trajTry(() => {
    if (!trajActive() || player !== G.players[0]) return;
    TRAJ.push(trajGameCode(), {
      kind: 'd', ts: Date.now(), act: G.currentAct, round: G.roundNumber,
      slot: player.slotIdx, action: 'draw', drew: card.id,
    });
  });
}

// --- Stop event: the local human stopped drawing ---
function trajLogStop(player) {
  trajTry(() => {
    if (!trajActive() || player !== G.players[0]) return;
    TRAJ.push(trajGameCode(), {
      kind: 'd', ts: Date.now(), act: G.currentAct, round: G.roundNumber,
      slot: player.slotIdx, action: 'stop',
    });
  });
}

// --- Special activation: the local human activated a special card. `detail` carries any
// stat/deck-affecting sub-choice (e.g. replay_discard's picked card). ---
function trajLogSpecial(player, special, cardId, detail, phase) {
  trajTry(() => {
    if (!trajActive() || player !== G.players[0]) return;
    const rec = {
      kind: 's', ts: Date.now(), act: G.currentAct, round: G.roundNumber,
      slot: player.slotIdx, special, cardId,
    };
    if (detail != null) rec.detail = detail;
    if (phase != null) rec.phase = phase;
    TRAJ.push(trajGameCode(), rec);
  });
}

// --- Buy/burn event: local human (every client) or AI seat (host only). Remote humans
// log their own via their executeBuy/executeBurn (they never reach this client's). ---
function trajLogBuy(player, action, row, col) {
  trajTry(() => {
    if (!trajActive()) return;
    const mine = player === G.players[0];
    const aiOnHost = !player.isHuman && amTrajHost();
    if (!mine && !aiOnHost) return;
    TRAJ.push(trajGameCode(), {
      kind: 'b', ts: Date.now(), act: G.currentAct, round: G.roundNumber,
      slot: player.slotIdx, action, row, col,
    });
  });
}

// --- Canary: ground-truth herds + pile counts at a round boundary, host only.
// The offline reconstructor asserts replayed state against these to catch engine/
// card-DB drift loudly instead of silently misreconstructing. ---
function trajLogCanary() {
  trajTry(() => {
    if (!trajActive() || !amTrajHost()) return;
    const herds = {}, deckCounts = {}, discardCounts = {};
    G.players.forEach(p => {
      herds[p.slotIdx] = p.herd;
      deckCounts[p.slotIdx] = p.deck.length;
      discardCounts[p.slotIdx] = p.discard.length;
    });
    TRAJ.push(trajGameCode(), {
      kind: 'ck', ts: Date.now(), act: G.currentAct, round: G.roundNumber,
      herds, deckCounts, discardCounts,
    });
  });
}

// ============================================================
// SPECTATOR STATE HELPERS — shared by MP and AI_SPEC
// ============================================================

function serializeCard(c) {
  if (!c) return null;
  return { id: c.id, img: c.img, cacti: c.cacti, dollars: c.dollars, cows: c.cows, bandits: c.bandits, special: c.special || null, cost: c.cost || 0 };
}

function buildSpectatorState() {
  // Per-slot AI RNG stream positions. Restored on rejoin so the rejoiner's future AI
  // shuffles match everyone else's (audit C4: re-seeding from gameSeed mid-game made
  // every post-rejoin AI reshuffle diverge — the streams had advanced everywhere else).
  const aiRngSeeds = {};
  G.players.forEach(p => {
    if (!p.isHuman && _aiRngs[p.slotIdx] && typeof _aiRngs[p.slotIdx].seed === 'number') {
      aiRngSeeds[p.slotIdx] = _aiRngs[p.slotIdx].seed;
    }
  });
  // Draw-phase completion, keyed by SLOT (G.drawsDone is keyed by local player index,
  // which only matches slots on the host — the only writer). Used by resumeDrawPhase
  // to restore AI seats' done flags (audit C3: without it a mid-draw rejoiner waits on
  // AI seats forever).
  const drawsDone = {};
  G.players.forEach((p, i) => { drawsDone[p.slotIdx] = !!G.drawsDone[i]; });
  return {
    phase: G.phase,
    round: G.roundNumber,
    act: G.currentAct,
    numPlayers: G.numPlayers,
    hiddenHerdMode: !!G.hiddenHerdMode,
    pyramid: G.pyramid.map(row => row.map(slot => ({
      card: serializeCard(slot.card),
      faceUp: slot.faceUp,
      removed: slot.removed,
    }))),
    showdownTallies: G.showdownTallies || null,
    aiRngSeeds,
    drawsDone,
    players: G.players.map(p => ({
      slotIdx: p.slotIdx,
      name: p.name,
      isHuman: p.isHuman,
      herd: p.herd,
      // End-of-game herd graph. Also what makes the chart work for a spectator who
      // opened the page mid-game and for the Review link on history.html — neither has
      // seen the earlier rounds, so the snapshot is the only transport.
      herdHistory: p.herdHistory || [],
      bustRounds: p.bustRounds || [],
      roundDollars: p.roundDollars,
      roundCows: p.roundCows,
      roundBandits: p.roundBandits,
      busted: p.busted,
      stoppedDrawing: p.stoppedDrawing,
      // Buy entitlements — restored on rejoin (audit C7: dropping them deadlocked the
      // buy-order wait / softlocked the extra-buy wait after a mid-round refresh).
      hasBuyBurnFirst: p.hasBuyBurnFirst || false,
      hasExtraBuy: p.hasExtraBuy || false,
      extraBuyUsed: p.extraBuyUsed || false,
      dollar1OtherPlayed: p.dollar1OtherPlayed || 0,
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

  // Use liveGames/ path (not games/) to avoid Firebase rules that gate games/ to the lobby flow.
  // Takes the code as an argument — callers snapshot `_code` into a local BEFORE any await and
  // never re-read `_code` afterward. A push() in flight when finish() nulled `_code` used to
  // resume and interpolate `liveSummary/null` (stray node observed live, July 2026 audit).
  function liveRef(code, path) { return _fbRef(`liveGames/${code}${path ? '/' + path : ''}`); }

  async function start(players) {
    const code = generateCode();
    _code = code;
    try {
      await init();
      await _fbSet(liveRef(code), {
        status: 'active',
        mode: 'ai',
        numPlayers: players.length,
        createdAt: Date.now(),
        players: players.map(p => ({ name: p.name, isHuman: p.isHuman })),
      });
    } catch (e) {
      console.error('[AI_SPEC] Failed to start:', e);
      if (_code === code) _code = null;
      return;
    }
    // Best-effort: mark finished if the tab closes mid-game (both the full
    // node and the slim summary used by the Live Now list)
    try { _fbOnDisconnect(liveRef(code, 'status')).set('finished'); } catch (e) {}
    try { _fbOnDisconnect(_fbRef(`liveSummary/${code}/status`)).set('finished'); } catch (e) {}
  }

  async function push() {
    const code = _code; // snapshot — never re-read _code after an await (see liveRef note)
    if (!code || !initialized || !G || G.phase === 'start') return;
    try {
      await _fbSet(liveRef(code, 'spectatorState'), buildSpectatorState());
    } catch (e) { /* non-critical */ }
    // Slim summary for history.html's Live Now list (no full card state)
    try {
      await _fbSet(_fbRef(`liveSummary/${code}`), {
        mode: 'ai',
        status: G.phase === 'gameover' ? 'finished' : 'active',
        numPlayers: G.numPlayers,
        players: G.players.map(p => ({ name: p.name, isHuman: p.isHuman })),
        phase: G.phase,
        act: G.currentAct,
        round: G.roundNumber,
        ts: Date.now(),
      });
    } catch (e) { /* non-critical */ }
  }

  async function finish() {
    if (!_code || !initialized) return;
    const code = _code;
    _code = null; // prevent further pushes
    try {
      await _fbSet(_fbRef(`liveGames/${code}/status`), 'finished');
      await _fbSet(_fbRef(`liveSummary/${code}/status`), 'finished');
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

// --- CARD DATABASE ---
// CARD_IMG_PATH / BACK_IMG_PATH / CACTI_BACK / STARTER_TEMPLATES / STORE_CARDS / CARD_DB all live
// in src/card-db.js now (loaded by playgame.html immediately before this file). It is shared with
// the public Cards List page so the two can never disagree about what is in the game.
// getCardById / getActPool stay here — they need createCardInstance and G.

// Look up a card template by ID and return a fresh card instance (used during rejoin reconstruction)
function getCardById(id) {
  const tmpl = CARD_DB[id];
  if (!tmpl) { console.warn('[rejoin] unknown card id:', id); return null; }
  return createCardInstance(tmpl, tmpl.img);
}

// The cards eligible for one act tier of the Store. Every player count draws from the SAME
// 18-card per-act pool (the minPlayers tier is gone); deprecated cards are never dealt.
function getActPool(act) {
  const pool = STORE_CARDS.filter(c => c.act === act && !c.deprecated);
  // 2-4P take 10/14/18 of the 18 distinct cards — one deck. 5-8P need 24/27/30/33 per act,
  // which exceeds 18, so they play with a SECOND deck: two copies of the act pool (36).
  // buildPyramid wraps each in createCardInstance, so duplicates get distinct uids; only
  // card.id repeats. 33 ≤ 36, so 8P (the largest) still fits.
  if (G.numPlayers >= 5) return pool.concat(pool);
  return pool;
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
    // End-of-game herd graph (src/herd-chart.js). herdHistory[r-1] = herd AFTER round r,
    // written by scoreRound; index [G.roundNumber] is appended at the Showdown. bustRounds
    // holds the round numbers this player busted, so the chart can mark the flat segments.
    // Both are display-only and MP-safe (herd is shared state every client agrees on).
    herdHistory: [],
    bustRounds: [],
    roundDollars: 0,
    roundCows: 0,
    roundBandits: 0,
    busted: false,
    stoppedDrawing: false,
    copyNextActive: false,
    copyNextCard: null,   // the Copy Next card instance currently pending a donor
    copyNextDonor: null,  // the activatable donor card (set when an activatable card is drawn after Copy Next)
    hasBuyBurnFirst: false,
    hasExtraBuy: false,
    extraBuyUsed: false,
    forcedDraws: 0,   // mandatory draws still owed from a "Draw 4" (human path)
    dollar1OtherPlayed: 0, // card_24 plays this round; MP grants +$1/other at draw-phase end (audit C5)
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
    // Optional explicit Store-width override; null = derive from numPlayers (STORE_WIDTH)
    // in pyramidWidth(). Width never needs to be in G unless a future mode sets it directly.
    pyramidWidth: null,
    players: players || [createPlayer('You', true, 0), createPlayer('Cowboy AI', false, 1)],
    pyramid: [],
    log: [],
    buyOrder: [],
    currentBuyerIdx: 0,
    drawsDone: {},
    selectedPyramidCard: null,

    busy: false,
    playerOrder: Array.from({length: n}, (_, i) => i), // G.players[i] → Firebase slot index (SP default: identity)
    seatOrder: Array.from({length: n}, (_, i) => i), // slot indices in clockwise seat order (shuffled at game start)
    gameSeed: 0,
  };
}

// --- PYRAMID ---

// New store layout (June 2026): every row is exactly 7 cards, and the number of rows
// equals the player count (2P→2 … 8P→8). Rows are BRICK-staggered (alternate rows
// shift a half-card) so two cards cover one, solitaire-style. Interior cards are
// covered by 2 below them; the single overhang card at one end of each upper row is
// covered by just 1 — both unlock only when their coverer(s) are removed. Simpler to
// explain and lay out than the old centered triangle (which capped at width 7 then
// added flat rows for 5-8P).
// --- STORE SHAPE (single structure, built once at game start) ---
// The whole game is ONE Store, dealt in three act tiers: Act 3 on top, Act 2 in the middle,
// Act 1 in front (bottom). Play eats it front-to-back, so the act progression is emergent —
// there is no mid-game setup and no act boundary. 2-4P get 6 rows (2 per act), 5-8P get 9
// rows (3 per act); width varies by player count so cards-per-act lands on the design target.
//
//   Players   2    3    4  |  5    6    7    8
//   Width     5    7    9  |  8    9   10   11
//   Rows      6    6    6  |  9    9    9    9
//   Cards/act 10   14   18 | 24   27   30   33
//   Store    30   42   54  | 72   81   90   99
const STORE_WIDTH  = { 2: 5, 3: 7, 4: 9, 5: 8, 6: 9, 7: 10, 8: 11 };
const DEFAULT_PYRAMID_WIDTH = 7;   // fallback only (pre-G calls, e.g. early CSS sizing)

// Cards per row for the CURRENT game. `G.pyramidWidth` is an optional explicit override
// (unset by default) so a future mode can set it directly without a new branch. Every
// function below derives from this; the half-card BRICK offset is width-independent.
function pyramidWidth() {
  if (typeof G === 'undefined' || !G) return DEFAULT_PYRAMID_WIDTH;
  if (G.pyramidWidth) return G.pyramidWidth;                    // explicit override wins
  return STORE_WIDTH[G.numPlayers] || DEFAULT_PYRAMID_WIDTH;
}
function pyramidRowWidth(row) {
  return pyramidWidth();
}
// Rows in one act tier (2-4P → 2, 5-8P → 3) and in the whole Store (3 tiers).
function rowsPerTier() { return (G.numPlayers <= 4) ? 2 : 3; }
function storeRows()   { return rowsPerTier() * 3; }
// The act tier a Store row belongs to: rows 0..(t-1) are Act 3, the middle t are Act 2,
// the front t are Act 1. Used by storeStage() to tell the AI how far along the game is.
function rowAct(row) {
  return 3 - Math.floor(row / rowsPerTier());
}

// How far along the game is, as 1|2|3 — the AI's replacement for the old G.currentAct.
// It is the act tier of the FRONTMOST row that still holds a card: at the start the Act 1
// rows are on offer (stage 1, economy lens), by the end only the Act 3 rows remain (stage 3,
// cow lens). Pure and derived from shared state, so every client computes it identically.
function storeStage() {
  if (!G.pyramid || !G.pyramid.length) return 1;
  for (let row = G.pyramid.length - 1; row >= 0; row--) {
    if (G.pyramid[row].some(slot => slot && !slot.removed)) return rowAct(row);
  }
  return 3; // Store empty — the game is over anyway
}

// Horizontal center of card (row,col) in card-width units (origin = pyramid center).
// All rows are pyramidWidth() wide; odd rows shift a half-card right (BRICK offset) so
// the "2 cover 1" overlap reads correctly. Pure + deterministic → no per-row state.
function pyramidColCenter(row, col) {
  let col0 = -(pyramidWidth() - 1) / 2; // centered
  if (row % 2 === 1) col0 += 0.5;       // brick: odd rows nudged half a card right
  return col0 + col;
}

// Build the whole Store in one pass. Each act tier is shuffled and sliced independently,
// then laid top-to-bottom Act 3 → Act 2 → Act 1, so the front rows a player can reach at
// the start are always Act 1. If cardIds is provided (MP guest / rejoin / tutorial) that
// exact row-major order is used instead.
function buildPyramid(cardIds) {
  const numRows = storeRows();
  const width   = pyramidWidth();
  const perTier = rowsPerTier() * width;   // cards in one act tier

  let selected;
  if (cardIds) {
    // MP: reconstruct cards from shared IDs (ids repeat under the 5-8P double deck; each
    // still gets its own uid via createCardInstance below)
    selected = cardIds.map(id => STORE_CARDS.find(c => c.id === id)).filter(Boolean);
  } else {
    selected = [];
    for (const act of [3, 2, 1]) {          // top tier first — row 0 is the back of the Store
      const pool = shuffle(getActPool(act));
      if (pool.length < perTier) {
        console.warn(`Act ${act} pool has ${pool.length} cards, need ${perTier}. Using all available.`);
      }
      selected.push(...pool.slice(0, Math.min(perTier, pool.length)));
    }
  }

  const pyramid = [];
  let idx = 0;
  for (let row = 0; row < numRows; row++) {
    const rowArr = [];
    const w = pyramidRowWidth(row);
    for (let col = 0; col < w; col++) {
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

// A card is covered if any non-removed card in the row below horizontally overlaps
// it (centers within ~half a card). Geometry-based, so it works for the brick-offset
// rows uniformly: interior cards have 2 coverers, the overhang end card has 1.
function isCardCovered(pyramid, row, col) {
  if (row >= pyramid.length - 1) return false;
  const myX = pyramidColCenter(row, col);
  const nextRow = pyramid[row + 1];
  for (let c = 0; c < nextRow.length; c++) {
    const s = nextRow[c];
    if (s && !s.removed && Math.abs(pyramidColCenter(row + 1, c) - myX) < 0.9) {
      return true;
    }
  }
  return false;
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
  player.copyNextCard = null;
  player.copyNextDonor = null;
  player.hasBuyBurnFirst = false;
  player.hasExtraBuy = false;
  player.extraBuyUsed = false;
  player.forcedDraws = 0;
  player.dollar1OtherPlayed = 0;
}

// --- CARD EFFECTS ---

function applyCardEffects(player, card, isFirstCard) {
  let multiplier = 1;

  // Copy Next interaction: this card is the donor — determine whether to double stats
  // at draw time (regular card) or link Copy Next as a second burnable copy (activatable card).
  if (player.copyNextActive) {
    player.copyNextActive = false;
    if (ACTIVATABLE_SPECIALS.includes(card.special)) {
      // Activatable donor: Copy Next card in hand becomes a second burnable copy of this card.
      // The "bonus" is the extra activation, not doubled draw stats — so multiplier stays 1.
      player.copyNextDonor = card;
      addLog(`Copy Next linked! You can also use the Copy Next card as a second "${getSpecialLabel(card)}".`);
    } else {
      // Regular card: double its draw-time stats.
      multiplier = 2;
      addLog(`Copy Next doubled this card's effects!`);
      player.copyNextCard = null;
    }
  }

  // burn_to_use: contributes nothing at draw time; effects apply only on activation.
  // NOTE: this is now AFTER the copyNextActive check so that Copy Next correctly links
  // to burn_to_use donors instead of skipping them (the old early-return was the bug).
  // swap_revealed (card_4): no draw effect either — it's used during the BUY phase.
  if (card.special === 'burn_to_use' || card.special === 'swap_revealed') {
    return { dollars: 0, cows: 0, bandits: 0 };
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

  // Special: copy_next — arm the pending-donor state
  if (card.special === 'copy_next') {
    player.copyNextActive = true;
    player.copyNextCard = card;
    player.copyNextDonor = null;
  }

  // Special: burn_buy_first — handled in UI
  if (card.special === 'burn_buy_first') { }

  // Special: dollar1_other — gives $1 to each other player.
  // MP: DO NOT grant live (audit C5). A cross-player grant applied at draw time only
  // executes on the drawing client — remote humans never received theirs (their own
  // pushed stats overwrote the bump) and AI copies diverged per client (each client's
  // concurrently-running AI loops read the +$1 at different wall-clock interleavings).
  // Instead the play is COUNTED here and every client applies all grants at one
  // deterministic point: onDrawPhaseComplete, before any buy-order decision reads
  // roundDollars. SP keeps the immediate grant (single client — nothing to desync).
  if (card.special === 'dollar1_other' && G) {
    player.dollar1OtherPlayed = (player.dollar1OtherPlayed || 0) + 1;
    if (!MP.active) {
      for (let i = 0; i < G.numPlayers; i++) {
        if (G.players[i] !== player) G.players[i].roundDollars += 1;
      }
    }
  }

  return { dollars, cows, bandits };
}

// --- LOGGING ---

const SUIT_NAME = { 1: 'River', 2: 'Cactus', 3: 'Rattlesnake' };
const SPECIAL_LABEL = {
  burn_to_use:        'Explosive',
  burn_buy_first:'Use: Buy/Burn 1st',
  '2cow_if_first':     '2 Cows if 1st',
  look3_rearrange:     'Use: Rearrange 3',
  copy_next:           'Copy Next',

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
}

// --- RENDERING ---

function cardImgSrc(card, faceUp) {
  if (!faceUp) {
    return BACK_IMG_PATH + (CACTI_BACK[card.cacti] || 'River Back.jpg');
  }
  return CARD_IMG_PATH + card.img;
}

function setBanditCount(el, n) {
  el.textContent = n;
  el.style.color = n >= 2 ? '#e02020' : n === 1 ? '#b84040' : '';
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

// Returns indices of the players with the largest herd, or [] when there is no
// meaningful standing to show. Unlike getDrawLeaders (which tracks a volatile
// per-round race), this only changes at scoring, so it is rendered quietly.
// Ties show every tied player, mirroring the draw crown.
function getHerdLeaders() {
  if (!G || !G.players) return [];
  // Hidden Herd conceals opponents' totals — a "who's ahead" marker would leak
  // exactly that. Suppress for everyone (marking only yourself still reveals
  // whether you lead). Reveal condition matches renderPlayerZone's concealHerd.
  if (G.hiddenHerdMode && G.phase !== 'showdown') return [];

  const herds = G.players.map(p => p.herd || 0);
  const best  = Math.max(...herds);
  if (best <= 0) return [];                       // round 1: everyone still on 0

  const leaders = [];
  herds.forEach((h, i) => { if (h === best) leaders.push(i); });
  if (leaders.length === herds.length) return []; // dead level — nobody leads
  return leaders;
}

// Top herd's figure turns amber (.herd-top), muted gap ("−4") on everyone else.
// Deliberately static: the draw crown pops because it flips constantly, this
// changes at most once per round, and animating both would make them read as
// the same signal.
function updateHerdStandings() {
  const leaders = getHerdLeaders();
  const best    = leaders.length ? G.players[leaders[0]].herd : 0;

  for (let i = 0; i < G.numPlayers; i++) {
    const prefix = i === 0 ? 'player' : 'opp-' + i;
    const wrapEl = document.getElementById(prefix + '-herd-wrap');
    const gapEl  = document.getElementById(prefix + '-herd-gap');
    const isTop  = leaders.includes(i);
    const gap    = leaders.length && !isTop ? best - (G.players[i].herd || 0) : 0;

    if (wrapEl) wrapEl.classList.toggle('herd-top', isTop);
    if (gapEl)  gapEl.textContent = gap > 0 ? '−' + gap : '';
  }
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

// Snapshot the current game into localStorage for the bug-report page to attach.
function updateBugContext() {
  try {
    if (!G) return;
    const code = (MP.active && sessionStorage.getItem('mp_code')) || '';
    const ctx = {
      mode: MP.active ? 'mp' : 'sp',
      code,
      mySlot: MP.active ? MP.mySlot : null,
      act: G.currentAct, round: G.roundNumber, phase: G.phase,
      numPlayers: G.numPlayers,
      players: (G.players || []).map(p => ({
        name: p.name, isHuman: p.isHuman, slot: p.slotIdx,
        busted: p.busted, stopped: p.stoppedDrawing,
        hand: p.hand ? p.hand.length : 0,
        deck: p.deck ? p.deck.length : 0,
        discard: p.discard ? p.discard.length : 0,
        cows: p.roundCows, dollars: p.roundDollars,
      })),
      ts: Date.now(),
    };
    localStorage.setItem('cfc_bug_context', JSON.stringify(ctx));
  } catch (e) { /* localStorage may be unavailable; ignore */ }
}

function render() {
  if (!G || G.phase === 'start') return;

  // Always clear hover preview on every render (phase changes, store resets, etc.)
  hideCardHoverPreview();

  // Clear card preview whenever nothing is selected
  if (!G.selectedPyramidCard) clearCardPreview();

  // Phase class on body for CSS-driven layout switching
  document.body.classList.remove('phase-draw', 'phase-buy');
  if (G.phase === 'draw') document.body.classList.add('phase-draw');
  else if (G.phase === 'buy' || G.phase === 'score') document.body.classList.add('phase-buy');

  // Player-count class: lets CSS scope the short-viewport pyramid-zone height cap to
  // 5-8P only (where the 11-row pyramid is tall enough to push the hand below the
  // fold). fitPyramid is already a no-op at <5P, so the cap must not apply there.
  document.body.classList.toggle('count-5plus', G.numPlayers >= 5);

  // Header — acts are gone (one Store for the whole game), so it's just the round now
  document.getElementById('round-display').textContent = 'Round ' + G.roundNumber;

  // Keep a lightweight game snapshot in localStorage so the bug-report page can
  // auto-attach context (game code, act/round/phase, per-player counts) to a report.
  updateBugContext();

  // Players
  renderPlayerZone(G.players[0], 'player');
  const oz = document.getElementById('opponents-zone');
  // 5-8P: wrap the 4-7 opponents into a grid instead of one crushed flex row.
  oz.classList.toggle('opp-grid', G.numPlayers >= 5);
  // Render opponents in SEAT order so the right-hand rail matches the top turn-order
  // bar (both derive from G.seatOrder). The raw G.players index order is slot-claim
  // order, not seat order, so iterating 1..n directly mismatched the bar. We also set
  // an explicit CSS `order` per zone so the visual order is correct even for zones
  // created earlier (ensureOpponentZone keeps existing DOM to preserve collapse state).
  const slotToPlayerIdx = MP.active ? (s => MP.slotToPlayer[s]) : (s => s);
  const oppSeatOrder = (G.seatOrder || [])
    .map(slotToPlayerIdx)
    .filter(i => i !== undefined && i !== 0);
  const oppOrder = oppSeatOrder.length === G.numPlayers - 1
    ? oppSeatOrder
    : Array.from({ length: G.numPlayers - 1 }, (_, k) => k + 1); // fallback: index order
  oppOrder.forEach((i, seatPos) => {
    ensureOpponentZone(i, oz);
    renderPlayerZone(G.players[i], 'opp-' + i);
    const zoneEl = document.getElementById('opp-zone-' + i);
    if (zoneEl) zoneEl.style.order = String(seatPos);
  });
  applyOppHands();

  // Pyramid
  renderPyramid();

  // Zone state indicators (crown, bust, active buyer)
  updateZoneStates();

  // Herd standings (top-herd highlight + gap-to-leader)
  updateHerdStandings();

  // Turn order bar
  updateTurnOrderBar();

  // Log
  renderLog();
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
  // Hidden Herd mode: conceal opponents' herd totals until the final showdown.
  // The local player (prefix 'player') always sees their own herd.
  const concealHerd = G.hiddenHerdMode && prefix !== 'player' && G.phase !== 'showdown';
  if (concealHerd) {
    herdEl.textContent = '?';
    applyHerdTier(herdEl, document.getElementById(prefix + '-herd-dust'), 0);
  } else {
    herdEl.textContent = player.herd;
    applyHerdTier(herdEl, document.getElementById(prefix + '-herd-dust'), player.herd);
  }
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
      setBanditCount(document.getElementById(prefix + '-round-bandits'), player.roundBandits);
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
      setBanditCount(document.getElementById('player-round-bandits'), player.roundBandits);
    } else {
      statsEl.classList.add('hidden');
    }
  }

  // Hand
  const handEl = document.getElementById(prefix + '-hand');
  handEl.innerHTML = '';

  {
    const showFaceUp = true;
    // Highlight cards that currently have an active special button in the actions bar
    const activeSpecialUids = (prefix === 'player' && G.phase === 'draw')
      ? new Set(getActivatableCards(player).map(c => c.uid))
      : new Set();
    for (const card of player.hand) {
      // When busted: dim non-bandit cards; give bandit cards a red outline right at render time
      const isBandit = card.bandits > 0;
      const classes = [
        player.busted && !isBandit ? 'busted' : '',
        player.busted && isBandit  ? 'bust-culprit' : '',
        activeSpecialUids.has(card.uid) ? 'card-active-special' : ''
      ].filter(Boolean).join(' ');
      const el = renderCardEl(card, showFaceUp, classes);
      handEl.appendChild(el);
    }
    // Opponents fan their drawn cards into a fixed 3-row space; the local player
    // keeps the normal wrapping hand (intentionally untouched).
    if (prefix !== 'player') {
      const lastCard = handEl.lastElementChild;
      if (lastCard) lastCard.classList.add('card-newest');
      layoutOpponentFan(handEl);
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
    // Lower rows paint in front of upper rows. Set inline so it generalizes past the
    // CSS nth-child cap to the up-to-8 rows of 5-8P games. Odd rows get a half-card
    // horizontal nudge so the solitaire "2 cover 1" overlap reads correctly — see
    // pyramidColCenter().
    rowDiv.style.zIndex = String(row + 1);
    if (row % 2 === 1) rowDiv.classList.add('brick-offset');
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
        // hover handled by delegated listener on #pyramid (see initHoverDelegation)
        rowDiv.appendChild(el);
      }
    }
    pyramidEl.appendChild(rowDiv);
  }
  fitPyramid();
  // This function rebuilds the Store DOM from scratch, dropping any tutorial highlight.
  // Put the current step's hint back, or the buy step says "Buy the highlighted Cow
  // card" with nothing highlighted.
  if (TUTORIAL.active) TUTORIAL.reapplyPyramidHint();
}

// The Store is up to 11 cards wide (11.5 with the brick overhang) × 9 rows, which
// can overflow the fixed-size #pyramid-zone (overflow:hidden → clipped cards). Measure
// the rendered cards and apply a single transform that recenters the pyramid in its
// zone and scales it down to fit both width and height. Only ever scales down (≤1), so
// it's a recenter-only no-op when the pyramid already fits.
function fitPyramid() {
  const pyr = document.getElementById('pyramid');
  const zone = document.getElementById('pyramid-zone');
  if (!pyr || !zone) return;
  pyr.style.transform = 'none';
  pyr.style.transformOrigin = '';
  if (!G || !G.pyramid || !G.pyramid.length) return;
  const els = [...pyr.querySelectorAll('.card, .card-slot')];
  if (!els.length) return;
  let minL = 1e9, maxR = -1e9, minT = 1e9, maxB = -1e9;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (!r.width) continue;
    minL = Math.min(minL, r.left); maxR = Math.max(maxR, r.right);
    minT = Math.min(minT, r.top);  maxB = Math.max(maxB, r.bottom);
  }
  const zr = zone.getBoundingClientRect();
  const pad = 14;
  const natW = maxR - minL, natH = maxB - minT;
  // Vertical budget = from the content's CURRENT top down to the zone bottom, NOT the
  // full zone height: the pyramid sits below the "Store" label, and scaling pivots on
  // the content top (it stays put + scales downward). Using zr.height over-budgeted by
  // the label height, so a height-capped pyramid (8P draw phase, 40vh cap) overshot the
  // zone bottom by the label height and got clipped by overflow:hidden.
  const availH = (zr.bottom - pad) - minT;
  const availW = zr.width - pad * 2;
  // Bail out if nothing is measurable yet rather than scaling by a garbage ratio. A zone
  // that hasn't been laid out (0×0 viewport during navigation, display:none ancestor)
  // yields availH <= 0, and availH/natH then goes NEGATIVE — scale(-0.01) mirrors the
  // whole Store down to nothing and it vanishes. transform was reset to 'none' above, so
  // returning here just leaves it unscaled; the next render/resize fits it properly.
  if (natW <= 0 || natH <= 0 || availW <= 0 || availH <= 0) return;
  const scale = Math.min(1, availW / natW, availH / natH);
  const contentCenter = (minL + maxR) / 2;
  const pyrBox = pyr.getBoundingClientRect();
  // Pivot scaling about the content's center-x and top edge, then slide that center to
  // the zone's center-x. translateX is applied in parent space (origin is the scale
  // pivot, so the center maps to itself under scale → dx lands it on the zone center).
  pyr.style.transformOrigin = `${contentCenter - pyrBox.left}px ${minT - pyrBox.top}px`;
  const dx = (zr.left + zr.width / 2) - contentCenter;
  pyr.style.transform = `translateX(${dx}px) scale(${scale})`;
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
  if (TUTORIAL.active && TUTORIAL.popupVisible) return;
  document.getElementById('message').textContent = text;
}

function setActions(buttons) {
  if (TUTORIAL.active && TUTORIAL.popupVisible) return;
  const el = document.getElementById('actions');
  el.innerHTML = '';
  const ds = document.getElementById('draw-specials');
  if (ds) { ds.innerHTML = ''; ds.style.display = 'none'; }
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
  if (TUTORIAL.active && TUTORIAL.popupVisible) return;
  document.getElementById('actions').innerHTML = '';
  const ds = document.getElementById('draw-specials');
  if (ds) { ds.innerHTML = ''; ds.style.display = 'none'; }
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

    // If another card was drawn before this rAF fired, this card is no longer the
    // last in hand. Animating it now would fly to the wrong slot (a mid-hand card).
    // Skip — render() already showed the card face-up in the correct position.
    const allHandCards = document.querySelectorAll('#player-hand .card');
    if (allHandCards.length && allHandCards[allHandCards.length - 1] !== handCard) return;

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

async function startGame() {
  document.getElementById('showdown-screen').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('opponents-zone').innerHTML = ''; // clear for fresh game

  if (MP.active) {
    const params = new URLSearchParams(location.search);
    // A page refresh / re-navigation must NEVER re-initialize an in-progress game.
    // (Re-running the normal path makes the host rebuild Act 1 and clobber everyone —
    //  the root cause of the May 2026 4-player softlocks; see CLAUDE.md bug #8.)
    // Treat re-entry as a rejoin if the explicit ?rejoin flag is present OR this tab
    // has already started this game code once. The per-tab marker survives an F5 but
    // is absent on a fresh navigation from the lobby for a brand-new code, so a guest
    // joining a new game still takes the normal path.
    // MP.recovered covers the mobile case the marker can't: an evicted tab
    // reopened from history has lost sessionStorage (and thus the marker), so
    // identity was recovered from localStorage — that is always a resume.
    const code = sessionStorage.getItem('mp_code') || '';
    const reentryKey = code ? 'cfc_started_' + code : null;
    const markerSet = reentryKey && sessionStorage.getItem(reentryKey) === '1';
    const isRejoin = params.has('rejoin') || markerSet || MP.recovered;
    setMessage(isRejoin ? 'Reconnecting to your game…' : 'Connecting to game...');
    clearActions();
    try {
      await MP.init();
    } catch (e) {
      setMessage('Failed to connect. Please refresh and try again.');
      console.error(e);
      return;
    }
    const cfg = await MP.buildPlayersConfig();
    if (!cfg) {
      // Game node is gone (host cancelled, disbanded, or cleaned up) — nothing to
      // join or resume. Without this guard the code below throws on cfg.slotDefs.
      setMessage('Game not found — it may have ended.');
      setActions([{ text: 'Back to Home', onClick: () => { window.location.href = 'index.html'; } }]);
      return;
    }
    await MP.startPresence();
    MP.saveRejoinInfo();

    if (isRejoin) {
      // --- Rejoin path: restore G from spectatorState ---
      // Retry up to 3 times with backoff — on mobile the Firebase connection may
      // not have fully established in the first milliseconds after init().
      let state = await MP.fetchSpectatorState();
      if (!state) { await delay(600);  state = await MP.fetchSpectatorState(); }
      if (!state) { await delay(1200); state = await MP.fetchSpectatorState(); }
      if (state) {
        if (reentryKey) sessionStorage.setItem(reentryKey, '1');
        await resumeFromState(state, cfg); // handles transient phases (score/showdown) itself
        return;
      }
      // No game state to restore.
      if (params.has('rejoin') || MP.recovered) {
        // Explicit rejoin OR eviction-recovery reload: NEVER fall through to the
        // fresh-start path (that would call setupStore() and clobber an in-progress
        // game for everyone — bugs #8/#15). But the missing snapshot can also be a
        // transient fetch miss (flaky mobile connectivity), so keep watching and
        // resume the moment one appears instead of dead-ending (audit H3).
        // (Quick Draw used to be the one exception here — it had no snapshot until Act 2.
        //  That mode is gone, so this path now has no exceptions at all.)
        setMessage('Could not restore the game yet — retrying…');
        setActions([{ text: 'Back to Home', onClick: () => { window.location.href = 'index.html'; } }]);
        let resuming = false;
        MP.watchSpectatorState((s) => {
          if (!s || resuming) return;
          resuming = true;
          MP.unwatchSpectatorState();
          if (reentryKey) sessionStorage.setItem(reentryKey, '1');
          resumeFromState(s, cfg);
        });
        return;
      }
      // Marker-only re-entry with no state yet (e.g. refresh during the initial
      // connecting handshake, before any setup was pushed) — fall through and start
      // fresh. Safe on the host: setupStore consumes an already-pushed actSetup for the
      // same act instead of rebuilding (audit H5), so even a refresh in the tiny
      // window between pushActSetup and the first spectatorState can't fork the
      // pyramid guests already consumed.
    }

    // Mark this game as started in this tab so a later refresh resumes instead of
    // re-initializing the game from scratch.
    if (reentryKey) sessionStorage.setItem(reentryKey, '1');

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
    G.hiddenHerdMode = cfg.hiddenHerdMode || false;
  } else {
    // Tutorial mode: skip gamesetup.html entirely
    const isTutorial = new URLSearchParams(location.search).has('tutorial') ||
                       sessionStorage.getItem('tutorial_mode') === '1';
    sessionStorage.removeItem('tutorial_mode');
    if (isTutorial) {
      G = initState(2); // 2-player: human vs AI
      G.players[1].personality = 'sheriff';
      G.gameSeed = 0;
      G.seatOrder = [0, 1];
      G.hiddenHerdMode = false;
      // Sticky per-game marker: TUTORIAL.active flips false when the coached steps end
      // (TUTORIAL.complete()) but the game keeps going as free play. Gates that must
      // exclude the WHOLE tutorial game (traj capture, solo save) check this flag,
      // never TUTORIAL.active — a headerless /traj/{code} leaked from the free-play
      // remainder before this existed (July 2026 audit, game FBEURP).
      G.isTutorialGame = true;
      TUTORIAL.init(G);
    } else {
      // Restore a saved mid-game state (survives page reload / mobile tab eviction)
      // unless gamesetup.html explicitly flagged this as a fresh new game, OR a debug
      // scenario is pending (debug launches are always a fresh game — never resume the
      // last saved solo game, or the debug injection below would be skipped entirely).
      const isNewGame = sessionStorage.getItem('cfc_new_game') === '1' ||
                        !!sessionStorage.getItem('debug_scenario');
      sessionStorage.removeItem('cfc_new_game');
      if (!isNewGame) {
        const saved = loadLocalGame();
        if (saved) {
          const players = saved.players.map(sp => {
            const p = createPlayer(sp.name, sp.isHuman, sp.slotIdx, sp.personality);
            p.herd            = sp.herd            || 0;
            p.herdHistory     = sp.herdHistory     || [];  // herd graph (see buildSpectatorState)
            p.bustRounds      = sp.bustRounds      || [];
            p.roundDollars    = sp.roundDollars    || 0;
            p.roundCows       = sp.roundCows       || 0;
            p.roundBandits    = sp.roundBandits    || 0;
            p.busted          = sp.busted          || false;
            p.stoppedDrawing  = sp.stoppedDrawing  || false;
            p.hasBuyBurnFirst = sp.hasBuyBurnFirst || false;
            p.hasExtraBuy     = sp.hasExtraBuy     || false;
            p.extraBuyUsed    = sp.extraBuyUsed    || false;
            p.forcedDraws     = sp.forcedDraws     || 0;
            p.hand    = (sp.hand    || []).map(id => getCardById(id)).filter(Boolean);
            p.deck    = (sp.deck    || []).map(id => getCardById(id)).filter(Boolean);
            p.discard = (sp.discard || []).map(id => getCardById(id)).filter(Boolean);
            return p;
          });
          G = initState(players.length, players);
          G.gameSeed       = saved.gameSeed || 0;
          G.currentAct     = saved.act;
          G.roundNumber    = saved.round;
          G.hiddenHerdMode = saved.hiddenHerdMode || false;
          G.seatOrder      = saved.seatOrder || seededSeatOrder(players.length, G.gameSeed);
          G.pyramid = saved.pyramid.map(row => row.map(s => ({
            card:    s.id ? getCardById(s.id) : null,
            faceUp:  s.faceUp,
            removed: s.removed,
          })));
          players.forEach((p, i) => { if (!p.isHuman) initAiRng(i, G.gameSeed); });
          render();
          addLog(`Game resumed — Round ${G.roundNumber}`);

          if (saved.phase === 'draw') {
            G.phase = 'draw';
            G.drawsDone = {};
            for (let i = 0; i < G.numPlayers; i++) G.drawsDone[i] = saved.drawsDone?.[i] || false;
            render();
            // Re-run AI draws for any AI not yet done — they draw from their restored deck state.
            // (Don't re-run done AIs: their saved hand/deck/stats are already authoritative.)
            for (let i = 1; i < G.numPlayers; i++) {
              if (!G.players[i].isHuman && !G.drawsDone[i]) aiDrawPhase(i);
            }
            const human = G.players[0];
            if (human.busted || human.stoppedDrawing || G.drawsDone[0]) {
              G.drawsDone[0] = true;
              checkDrawPhaseComplete();
            } else {
              startPlayerDraw();
            }
          } else if (saved.phase === 'buy') {
            G.phase = 'buy';
            G.buyOrder = (saved.buyOrder || []);
            G.currentBuyerIdx = saved.currentBuyerIdx || 0;
            render();
            processBuyTurn();
          } else {
            // 'start', 'score', or unknown — replay the round from the saved checkpoint
            await startRound();
          }
          return;
        }
      }
      // Read player config from sessionStorage (set by gamesetup.html)
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
      G.hiddenHerdMode = sessionStorage.getItem('hidden_herd_mode') === '1';
    }
  }

  // --- Debug scenario injection (SP only) ---
  if (!MP.active) {
    const debugScenario = sessionStorage.getItem('debug_scenario');
    if (debugScenario) {
      sessionStorage.removeItem('debug_scenario');
      if (!applyDebugScenario(debugScenario)) {
        // Unknown name — always stop here. Falling through would start a real, record-writing
        // game on an empty Store (this branch skips setupStore) and would not be flagged isDebug.
        setMessage(`Unknown debug scenario "${debugScenario}" — debug.html and applyDebugScenario have drifted apart. No game started.`);
        return;
      }
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

  trajLogHeader(); // trajectory: header (seed, seats, version stamps) once the game code exists

  await setupStore();
}

// --- SOLO GAME PERSISTENCE (localStorage, survives mobile tab eviction) ---
// Saves the full game state at the start of each round so a page reload
// (or tab eviction on mobile) resumes mid-game instead of restarting Act 1.
// Only used for non-MP, non-tutorial games. Cleared on game-over and restart.

function saveLocalGame() {
  // G.isTutorialGame keeps the free-play remainder after TUTORIAL.complete() from
  // being saved as a normal solo game (same sticky-exclusion rule as trajActive).
  if (MP.active || !G || G.isDebug || G.isTutorialGame) return;
  try {
    localStorage.setItem('cfc_solo_game', JSON.stringify({
      v: 1,
      ts: Date.now(),
      act: G.currentAct,
      round: G.roundNumber,
      phase: G.phase,
      gameSeed: G.gameSeed,
      hiddenHerdMode: G.hiddenHerdMode || false,
      seatOrder: G.seatOrder,
      drawsDone: G.drawsDone || {},
      buyOrder: G.buyOrder || [],
      currentBuyerIdx: G.currentBuyerIdx || 0,
      pyramid: G.pyramid.map(row => row.map(s => ({
        id: s.card ? s.card.id : null, faceUp: s.faceUp, removed: s.removed,
      }))),
      players: G.players.map(p => ({
        name: p.name, isHuman: p.isHuman, slotIdx: p.slotIdx,
        personality: p.personality || null,
        herd: p.herd,
        // Herd graph — without these a solo player who reloads mid-game pushes a
        // truncated history and loses the early rounds from their own Review chart.
        herdHistory: p.herdHistory || [],
        bustRounds: p.bustRounds || [],
        roundDollars: p.roundDollars, roundCows: p.roundCows, roundBandits: p.roundBandits,
        busted: p.busted, stoppedDrawing: p.stoppedDrawing,
        hasBuyBurnFirst: p.hasBuyBurnFirst || false,
        hasExtraBuy: p.hasExtraBuy || false,
        extraBuyUsed: p.extraBuyUsed || false,
        forcedDraws: p.forcedDraws || 0,
        hand:    p.hand.map(c => c.id),
        deck:    p.deck.map(c => c.id),
        discard: p.discard.map(c => c.id),
      })),
    }));
  } catch (e) { /* non-critical — localStorage may be full or blocked */ }
}

function loadLocalGame() {
  try {
    const s = JSON.parse(localStorage.getItem('cfc_solo_game') || 'null');
    if (!s || s.v !== 1 || !s.pyramid || !s.players || !s.act || !s.round) return null;
    return s;
  } catch (e) { return null; }
}

function clearLocalGame() {
  try { localStorage.removeItem('cfc_solo_game'); } catch (e) {}
}

function restartGame() {
  if (MP.active) {
    // In MP mode, can't restart — go back to lobby
    window.location.href = 'index.html';
    return;
  }
  clearLocalGame();
  startGame();
}

// --- REJOIN / GAME RECONSTRUCTION ---

// Rebuild G from a spectatorState snapshot (called during MP rejoin).
// spectatorState.players is ordered by the host's G.players indices (= slot indices for host).
async function reconstructG(state, cfg) {
  // Restore each AI slot's RNG stream POSITION from the snapshot when available.
  // Re-seeding from gameSeed alone is wrong mid-game (audit C4): the streams on every
  // other client have advanced with each shuffle, so a fresh stream makes the
  // rejoiner's next AI reshuffle diverge from the table — silently, for the rest of
  // the game. The fresh seed remains only as a fallback for old snapshots.
  cfg.slotDefs.forEach((def, slotIdx) => {
    if (def.isHuman) return;
    initAiRng(slotIdx, cfg.gameSeed);
    const saved = state.aiRngSeeds && state.aiRngSeeds[slotIdx];
    if (typeof saved === 'number') _aiRngs[slotIdx].seed = saved;
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
      // Herd graph. `|| []` and never `!== undefined`: round 1 has an empty array and
      // Firebase silently drops empty arrays on write (bug #11). Losing these doesn't
      // break the game, it just empties the end-of-game chart — a silent failure.
      p.herdHistory    = sp.herdHistory    || [];
      p.bustRounds     = sp.bustRounds     || [];
      p.roundDollars   = sp.roundDollars   || 0;
      p.roundCows      = sp.roundCows      || 0;
      p.roundBandits   = sp.roundBandits   || 0;
      p.busted         = sp.busted         || false;
      p.stoppedDrawing = sp.stoppedDrawing || false;
      // Buy entitlements (audit C7) — losing these on rejoin deadlocked the buy-order
      // wait (priority holder) or softlocked the extra-buy wait on other clients.
      p.hasBuyBurnFirst = sp.hasBuyBurnFirst || false;
      p.hasExtraBuy     = sp.hasExtraBuy     || false;
      p.extraBuyUsed    = sp.extraBuyUsed    || false;
      p.dollar1OtherPlayed = sp.dollar1OtherPlayed || 0;
      p.hand    = (sp.hand    || []).map(c => c ? getCardById(c.id) : null).filter(Boolean);
      p.deck    = (sp.deck    || []).map(c => c ? getCardById(c.id) : null).filter(Boolean);
      p.discard = (sp.discard || []).map(c => c ? getCardById(c.id) : null).filter(Boolean);
    }
    return p;
  });

  G = initState(cfg.numPlayers, players);
  G.playerOrder = G_playerOrder;
  // NOTE: Store width now derives purely from numPlayers (STORE_WIDTH), which initState
  // already has, so there is no mode flag to restore before the first render. If a future
  // mode ever changes the width again, it MUST be restored here — the reconstructed rows
  // are already that width, and a mismatch misaligns the brick offset and breaks
  // isCardCovered on rejoin.
  G.hiddenHerdMode = cfg.hiddenHerdMode || false;
  G.phase       = state.phase;
  G.currentAct  = state.act;
  G.roundNumber = state.round;
  // Convert host's G.players indices (= slot indices) to local G.players indices
  G.buyOrder       = (state.buyOrder || []).map(s => MP.slotToPlayer[s]).filter(i => i !== undefined);
  G.currentBuyerIdx = state.currentBuyerIdx || 0;
  // Slot-keyed draw-done flags from the snapshot (may be absent in old snapshots).
  // resumeDrawPhase uses these to restore AI seats' completion (audit C3) — humans
  // are re-confirmed through their round-stamped drawDone signals instead.
  G._restoredDrawsDone = state.drawsDone || null;

  // Rebuild pyramid from stored card IDs
  if (state.pyramid) {
    G.pyramid = state.pyramid.map(row => row.map(slot => ({
      card:    slot.card ? getCardById(slot.card.id) : null,
      faceUp:  slot.faceUp,
      removed: slot.removed,
    })));
  }
}

// --- Shared draw-phase sync appliers (used by startRound AND resumeDrawPhase) ---
// These used to be two near-identical inline copies whose guards drifted (the root of
// bugs #1/#2/#11). Keep ONE body so a guard fix always lands in both paths.

// Apply a remote human's live drawState to our local copy of them.
function applyOppDrawState(slotIdx, state) {
  // Ignore stale data from a previous round or act (Firebase fires immediately on
  // subscription with whatever value is in the DB). Both round AND act must match:
  // round resets to 1 at each act boundary (bug #2).
  if (state.round !== undefined && state.round !== G.roundNumber) return;
  if (state.act   !== undefined && state.act   !== G.currentAct)  return;
  const playerIdx = MP.slotToPlayer[slotIdx];
  // Once drawDone has fired for this player, their final stats are authoritative.
  // Ignore any late drawState re-fires (e.g. Firebase reconnect) that could overwrite
  // roundCows/discard with stale mid-draw values and corrupt showdown scoring.
  if (G.drawsDone && G.drawsDone[playerIdx]) return;
  const opp = G.players[playerIdx];
  if (!opp) return;
  const mk = id => { const tmpl = CARD_DB[id]; return tmpl ? createCardInstance(tmpl) : null; };
  opp.hand = (state.hand || []).map(mk).filter(Boolean);
  opp.deck = (state.deck || []).map(mk).filter(Boolean);
  // Sync discard so host always has accurate state (prevents duplication after mid-draw
  // reshuffles). ALWAYS set it (treat absent as empty): Firebase omits empty arrays, so
  // a freshly-reshuffled discard ([]) reads back as undefined. Guarding on `!== undefined`
  // would leave opp.discard STALE and scoreRound's discard.push(...hand) would then
  // double-count those cards (bug #11). Mirror hand/deck's `|| []`.
  opp.discard = (state.discard || []).map(mk).filter(Boolean);
  opp.roundDollars    = state.dollars;
  opp.roundCows       = state.cows;
  opp.roundBandits    = state.bandits;
  opp.busted          = state.busted;
  opp.stoppedDrawing  = state.stoppedDrawing;
  opp.hasBuyBurnFirst = state.hasBuyBurnFirst || false;
  opp.hasExtraBuy     = state.hasExtraBuy     || false;
  opp.dollar1OtherPlayed = state.dollar1OtherPlayed || 0;
  if (state.discardCount !== undefined) opp._syncedDiscardCount = state.discardCount;
  // Do NOT mark a busted opponent done from drawState — drawDone is the sole
  // authoritative done signal (bug #10).
  render();
  MP.pushSpectatorState(); // host keeps spectatorState current (no-op for non-hosts)
}

// Apply a remote human's authoritative drawDone payload to our local copy of them.
function applyOppDoneData(opp, doneData) {
  if (!doneData) return;
  opp.roundDollars    = doneData.dollars;
  opp.roundCows       = doneData.cows;
  opp.roundBandits    = doneData.bandits;
  opp.busted          = doneData.busted;
  opp.hasBuyBurnFirst = doneData.hasBuyBurnFirst || false;
  opp.hasExtraBuy     = doneData.hasExtraBuy     || false;
  // Only overwrite when the signal carries the field (new clients always send it, 0
  // included) — an old client's signal must not wipe a count synced via drawState.
  if (doneData.dollar1OtherPlayed !== undefined) opp.dollar1OtherPlayed = doneData.dollar1OtherPlayed;
  // Reconcile the hand to the authoritative done-time contents (audit R3): once done,
  // drawState re-fires are ignored (stats protection above), so a reconnect-ordering
  // race could leave a stale hand — which feeds the buy-order tiebreaker
  // (hand.length / hand[i].cost) and could pick a different winner on this client.
  if (Array.isArray(doneData.hand)) {
    const mk = id => { const tmpl = CARD_DB[id]; return tmpl ? createCardInstance(tmpl) : null; };
    opp.hand = doneData.hand.map(mk).filter(Boolean);
  } else if (doneData.handCount === 0 && !doneData.forced) {
    // Empty hand: Firebase drops empty arrays, so absence + handCount 0 means [].
    // A FORCED done (handCount stamped 0 with no hand data) keeps the last-synced
    // hand instead — it's the best-known contents for showdown counting.
    opp.hand = [];
  }
}

// Resume draw phase after a rejoin: re-arm Firebase watchers then resume local draw turn.
async function resumeDrawPhase() {
  G.phase = 'draw';
  G.drawsDone = {};
  for (let i = 0; i < G.numPlayers; i++) {
    const p = G.players[i];
    if (i > 0 && !p.isHuman) {
      // AI seats never signal through Firebase — restore their completion from the
      // snapshot, or infer it from their restored state (audit C3: leaving these false
      // made every mid-draw rejoin into an MP game with AI seats wait forever).
      const restored = G._restoredDrawsDone ? !!G._restoredDrawsDone[p.slotIdx] : false;
      G.drawsDone[i] = restored || p.busted || p.stoppedDrawing;
    } else {
      G.drawsDone[i] = false; // humans re-confirm via their round-stamped drawDone signals
    }
  }
  render();

  MP.watchOpponentDrawStates(applyOppDrawState);

  MP.waitForAllHumanDrawsDone((slotIdx, doneData) => {
    const playerIdx = MP.slotToPlayer[slotIdx];
    applyOppDoneData(G.players[playerIdx], doneData);
    G.drawsDone[playerIdx] = true;
    checkDrawPhaseComplete();
  });

  armForcedDrawTombstone(); // R2: adopt a host-forced done instead of drawing past it

  // Any AI seat still mid-draw resumes its loop from the restored deck/hand/stats.
  // Its RNG stream position was restored in reconstructG, so any reshuffle it makes
  // matches the other clients' simulation of the same seat.
  for (let i = 1; i < G.numPlayers; i++) {
    if (!G.players[i].isHuman && !G.drawsDone[i]) aiDrawPhase(i);
  }

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

// Entry point for every MP resume: reconstruct G from a snapshot and re-enter its
// phase. Transient phases (score — a ~1s window each round boundary; showdown — the
// whole reveal animation) can't be re-entered mid-flight, so keep watching the
// snapshot and resume when a resumable phase arrives. The old code showed a dead-end
// "waiting" message with NO listener for these — the player was stranded until they
// manually refreshed again (audit H3).
async function resumeFromState(state, cfg) {
  if (state.phase === 'score' || state.phase === 'showdown') {
    setMessage(state.phase === 'showdown'
      ? 'Showdown in progress — rejoining at the results…'
      : 'Round is being scored — rejoining…');
    clearActions();
    let resuming = false;
    MP.watchSpectatorState((s) => {
      if (!s || resuming) return;
      if (s.phase === 'score' || s.phase === 'showdown') return; // still transient
      resuming = true;
      MP.unwatchSpectatorState();
      resumeFromState(s, cfg);
    });
    return;
  }
  await reconstructG(state, cfg);
  document.getElementById('btn-spectate-link').classList.remove('hidden');
  // Re-arm the disband controls the normal path sets up (the old rejoin path skipped
  // these: a rejoined host lost its Disband button, a rejoined guest stopped watching
  // for disbands).
  if (MP.isHost) document.getElementById('btn-disband').classList.remove('hidden');
  else MP.watchForDisband();
  render();
  addLog(`Rejoined game — Round ${G.roundNumber}`);
  if (state.phase === 'draw') {
    await resumeDrawPhase();
  } else if (state.phase === 'buy') {
    resumeBuyPhase();
  } else if (state.phase === 'gameOver') {
    gameOver();
  } else {
    // Unknown phase (future-proofing): watch until a known one arrives.
    setMessage('Waiting for the current phase to begin…');
    let resuming = false;
    MP.watchSpectatorState((s) => {
      if (!s || resuming) return;
      if (s.phase !== 'draw' && s.phase !== 'buy' && s.phase !== 'gameOver') return;
      resuming = true;
      MP.unwatchSpectatorState();
      resumeFromState(s, cfg);
    });
  }
}

// Build the Store. Runs exactly ONCE, at the start of the game — there is no mid-game
// setup any more, so there is also no between-act deck merge/reshuffle (starter decks are
// already shuffled by createStarterDeck, and decks now just cycle through discard normally).
async function setupStore() {
  G.currentAct  = 1;   // pinned: kept only so MP stamps + trajectory records keep their shape
  G.roundNumber = 1;   // now counts monotonically 1..N for the WHOLE game (never resets)

  for (const player of G.players) resetPlayerRound(player);

  if (MP.active) {
    if (MP.isHost) {
      // If an actSetup already exists, consume it instead of rebuilding (audit H5). A host
      // refresh in the window between pushActSetup and the first spectatorState push falls
      // through to the fresh-start path (no snapshot to resume from); rebuilding here would
      // deal a NEW random Store that guests — who already consumed the original — never see.
      const existing = await MP.fetchActSetup();
      if (existing && Array.isArray(existing.cardIds)) {
        G.pyramid = buildPyramid(existing.cardIds);
        MP.pushSpectatorState();
      } else {
        // Host builds the Store and shares card IDs with guests
        G.pyramid = buildPyramid();
        const cardIds = G.pyramid.flatMap(row => row.map(slot => slot.card.id));
        await MP.clearActSetup();
        await MP.pushActSetup(1, cardIds);
        MP.pushSpectatorState(); // let spectators see the Store immediately
      }
    } else {
      // Guest waits for the host's Store layout
      setMessage('Waiting for the host to set up the Store...');
      clearActions();
      await new Promise(resolve => {
        MP.waitForActSetup(1, (data) => {
          G.pyramid = buildPyramid(data.cardIds);
          resolve();
        });
      });
    }
  } else {
    const pyramidIds = TUTORIAL.active ? TUTORIAL.getPyramidIds() : null;
    G.pyramid = buildPyramid(pyramidIds);
  }

  // trajectory: record the Store layout (host only). Read IDs from the built pyramid so it
  // works on every branch (host/guest/AI), not just where cardIds was computed.
  trajLogActSetup(1, G.pyramid.flatMap(row => row.map(slot => slot.card.id)));

  addLog('--- The Store is stocked. Round 1 begins! ---', 'log-score');
  render();
  startRound();
}

async function startRound() {
  clearForceContinue();
  saveLocalGame(); // snapshot before hand reset — safe restore point for reload recovery
  for (const player of G.players) {
    resetPlayerRound(player);
  }
  trajLogRoundSnaps(); // trajectory: per-seat deck/pile snapshot at round start
  G.selectedPyramidCard = null;
  G.phase = 'draw';
  G.drawsDone = {};
  for (let i = 0; i < G.numPlayers; i++) G.drawsDone[i] = false;

  addLog(`Round ${G.roundNumber} - Draw Phase`);
  render();

  if (TUTORIAL.active) TUTORIAL.onRoundStart(G);

  if (MP.active) {
    await MP.resetRound();
    MP.pushSpectatorState(); // initial draw-phase state for spectators
    armForcedDrawTombstone(); // R2: adopt a host-forced done instead of drawing past it
    startPlayerDraw();

    // Run AI draws locally (deterministic — same on all clients via seeded RNG)
    for (let i = 1; i < G.numPlayers; i++) {
      if (!G.players[i].isHuman) aiDrawPhase(i);
    }

    // Live watch remote human opponents' draw states — shared applier (also used by
    // resumeDrawPhase; the two used to be drift-prone copies). All the load-bearing
    // guards live in applyOppDrawState: round+act staleness (bug #2), authoritative-
    // after-done (stats protection), always-set discard (bug #11), and never marking
    // done from drawState (bug #10 — drawDone below is the sole done signal).
    MP.watchOpponentDrawStates(applyOppDrawState);

    // One-shot done signal per remote human opponent. applyOppDoneData uses the
    // authoritative final stats from the signal itself (avoids the race where drawDone
    // arrives before the last drawState update) and reconciles the hand (audit R3).
    MP.waitForAllHumanDrawsDone((slotIdx, doneData) => {
      const playerIdx = MP.slotToPlayer[slotIdx];
      applyOppDoneData(G.players[playerIdx], doneData);
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

const ACTIVATABLE_SPECIALS = ['burn_buy_first', 'look3_rearrange', 'replay_discard', 'burn_to_use', 'extra_buy'];

function getActivatableCards(player) {
  return player.hand.filter(c => {
    if (c.special && ACTIVATABLE_SPECIALS.includes(c.special)) return true;
    // A Copy Next card becomes activatable once it has been linked to an activatable donor.
    if (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor) return true;
    return false;
  });
}

function getSpecialLabel(card, player) {
  // Copy Next with a linked donor: show what it copies.
  if (card.special === 'copy_next' && player && card === player.copyNextCard && player.copyNextDonor) {
    return `Copy: ${getSpecialLabel(player.copyNextDonor)}`;
  }
  switch (card.special) {
    case 'burn_buy_first': return 'Use for Priority';
    case 'look3_rearrange': return 'Use: Rearrange Top 3';
    case 'replay_discard': return 'Use: Replay Discard';
    case 'burn_to_use': {
      const parts = [];
      if (card.dollars > 0) parts.push(`$${card.dollars}`);
      if (card.bandits < 0) parts.push('−1 Bandit');
      if (card.cows > 0) parts.push(`+${card.cows} Cow`);
      return `Use: ${parts.join(', ')}`;
    }
    case 'extra_buy': return 'Use for Extra Buy/Burn';
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

  // R2 tombstone: the host force-marked our draw done while we were mid-decision (e.g.
  // inside a modal) — the table has our forced stats; don't offer any more draws.
  if (MP.active && G.drawsDone[0]) {
    setMessage('Waiting for other players to finish drawing...');
    clearActions();
    return;
  }

  if (player.deck.length === 0 && player.discard.length === 0) {
    player.stoppedDrawing = true;
    player.forcedDraws = 0;   // truly out of cards — end any Draw-4 obligation
    addLog('You have no cards left to draw.');
    onPlayerDrawDone();
    return;
  }

  // Deck empty but discard available — show shuffle prompt directly (skip in tutorial: draw
  // queue handles it; skip during a forced Draw-4 so we don't offer "Stop" — playerDraw
  // auto-reshuffles instead).
  if (!TUTORIAL.active && player.forcedDraws === 0 && player.deck.length === 0 && player.discard.length > 0) {
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

  const forced = player.forcedDraws > 0;
  const activatable = getActivatableCards(player);

  // Primary buttons always stay in the same positions (Draw left, Stop right)
  const buttons = [
    { text: forced ? `Draw Card (${player.forcedDraws} left)` : getDrawButtonText(player),
      onClick: () => playerDraw(), className: getDrawButtonClass(player) },
  ];

  // During a forced Draw-4 the player must complete all 4 draws — no early stop. The
  // special buttons below stay available so burn-to-use cards can be used between draws.
  if (!forced) {
    buttons.push({ text: 'Stop Drawing', onClick: () => playerStopDraw(), className: 'btn-secondary', disabled: player.hand.length === 0, style: 'margin-left: auto' });
  }

  if (!TUTORIAL.active) {
    setMessage(forced
      ? `Draw 4 — ${player.forcedDraws} mandatory draw${player.forcedDraws > 1 ? 's' : ''} left. Activate cards now if you want them.`
      : getDrawPhaseMessage(player));
  }
  setActions(buttons);  // clears #draw-specials first

  // Special action buttons go in a separate row below Draw/Stop so they never displace them
  if (activatable.length > 0) {
    const ds = document.getElementById('draw-specials');
    ds.style.display = '';
    for (const card of activatable) {
      const b = document.createElement('button');
      b.className = 'btn btn-special';
      b.textContent = getSpecialLabel(card, player);
      b.onclick = () => activateSpecialCard(player, card);
      ds.appendChild(b);
    }
  }

  render();
}

async function playerDraw() {
  if (TUTORIAL.active && !TUTORIAL.isAllowed('draw')) { TUTORIAL.flashBlocked(); return; }
  if (MP.active && G.drawsDone[0]) return; // R2 tombstone: force-continued past us mid-decision
  if (G.busy) return;
  G.busy = true;

  const player = G.players[0];

  // Check if deck is empty and needs reshuffle
  if (player.deck.length === 0) {
    if (player.discard.length === 0) {
      player.stoppedDrawing = true;
      player.forcedDraws = 0;   // nothing left to draw — any Draw-4 obligation ends here
      addLog('No cards left to draw!');
      G.busy = false;
      onPlayerDrawDone();
      return;
    }
    // During a forced Draw-4 the player can't stop, so skip the Shuffle/Stop prompt and
    // let drawFromDeck auto-reshuffle below — reshuffle and continue the mandatory draws.
    if (player.forcedDraws === 0) {
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
  }

  const card = drawFromDeck(player);

  if (!card) {
    player.stoppedDrawing = true;
    addLog('No cards left to draw!');
    G.busy = false;
    onPlayerDrawDone();
    return;
  }

  trajLogDraw(player, card); // trajectory: record the actual drawn card (full sequence)

  const isFirst = player.hand.length === 0;
  player.hand.push(card);

  // Capture before applyCardEffects clears it — needed to double draw4 forced draws below.
  const copyNextWasActive = player.copyNextActive;

  // Apply effects
  const effects = applyCardEffects(player, card, isFirst);

  let effectText = '';
  if (card.special === 'burn_to_use') {
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
  saveLocalGame();

  // This draw satisfies one mandatory draw owed from a prior "Draw 4".
  if (player.forcedDraws > 0) player.forcedDraws--;

  // Handle special: draw4 — grant mandatory draws the player resolves one at a time
  // through this same flow, so burn-to-use cards can be activated between draws (and thus
  // before busting). startPlayerDraw hides "Stop" while forcedDraws > 0. (+= so a Draw 4
  // pulled during another Draw 4 stacks correctly.)
  // Copy Next doubles the forced draws (4 → 8) — same rule as for stat effects.
  if (card.special === 'draw4') {
    const draws = copyNextWasActive ? 8 : 4;
    addLog(copyNextWasActive ? `Copy Next doubled Draw 4 — draw ${draws} more cards!` : 'Draw 4 more cards!');
    player.forcedDraws += draws;
    G.busy = false;
    if (!player.busted) startPlayerDraw();
    animateDrawnCard(card);
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
  if (TUTORIAL.active) TUTORIAL.onActionDone('draw');
  startPlayerDraw();
  animateDrawnCard(card);
}

async function playerStopDraw() {
  if (TUTORIAL.active && !TUTORIAL.isAllowed('stop')) { TUTORIAL.flashBlocked(); return; }
  const player = G.players[0];

  trajLogStop(player); // trajectory: explicit stop event

  player.stoppedDrawing = true;
  saveLocalGame();

  addLog('You stopped drawing.');
  await onPlayerDrawDone();
}

async function onPlayerDrawDone() {
  if (TUTORIAL.active) TUTORIAL.onActionDone('stop');
  G.drawsDone[0] = true;
  clearActions();
  render();

  if (MP.active) {
    setMessage('Waiting for other players to finish drawing...');
    // Await the signal so the write reaches Firebase before we call checkDrawPhaseComplete.
    // Without this, we could enter buy phase locally before the opponent's listener fires,
    // causing a deadlock where we wait for their buy action but they never entered buy phase.
    try {
      await MP.signalDrawDone(G.players[0]);
    } catch (e) {
      console.error('[MP] signalDrawDone failed:', e);
      // Retry once — a missed signal causes a permanent softlock for the opponent
      try { await MP.signalDrawDone(G.players[0]); } catch (e2) { console.error('[MP] signalDrawDone retry failed:', e2); }
    }
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
    // Host-only safety valve: if the wait drags on, let the host force the phase forward.
    armForceContinue(forceDrawPhase);
  }
}

// --- HOST-ONLY "FORCE CONTINUE" SAFETY VALVE ---
// MP games can softlock if a player disconnects or a sync signal is lost. After 30s of
// the host waiting on others, show a host-only button that broadcasts a forcing signal
// through Firebase so every client advances uniformly (skipping the stuck player's turn).
let _forceTimer = null;

function armForceContinue(forceFn) {
  clearForceContinue();
  if (!(MP.active && MP.isHost)) return;
  const phaseAtArm = G.phase;
  _forceTimer = setTimeout(() => {
    _forceTimer = null;
    if (G.phase !== phaseAtArm) return; // phase moved on — nothing to force
    setActions([{
      text: 'Force continue ▸',
      className: 'btn-secondary btn-force',
      onClick: () => {
        clearForceContinue();
        try { forceFn(); } catch (e) { console.error('[force-continue]', e); }
      },
    }]);
    render();
  }, 30000);
}

function clearForceContinue() {
  if (_forceTimer) { clearTimeout(_forceTimer); _forceTimer = null; }
}

// Force every not-yet-done human opponent to "done" using last-known stats.
function forceDrawPhase() {
  addLog('Host force-continued the draw phase.', 'log-score');
  for (let i = 1; i < G.players.length; i++) {
    const p = G.players[i];
    if (!p.isHuman || G.drawsDone[i]) continue;
    addLog(`${p.name} was skipped (no response).`, 'log-score');
    MP.forceSignalDrawDone(p.slotIdx, {
      dollars: p.roundDollars, cows: p.roundCows, bandits: p.roundBandits,
      busted: p.busted, hasBuyBurnFirst: p.hasBuyBurnFirst, hasExtraBuy: p.hasExtraBuy,
      dollar1OtherPlayed: p.dollar1OtherPlayed,
    });
  }
  // The host's own waitForAllHumanDrawsDone listeners fire on these writes and advance.
}

// R2 tombstone (draw phase): if the host force-marked OUR draw done (we looked stuck)
// while we were actually still drawing, every other client consumed the forced stats.
// Adopt those stats and stop, instead of drawing on — cards drawn after the force
// would score only on this client and diverge the table. Armed once per round from
// startRound/resumeDrawPhase (named sub — re-arming replaces).
function armForcedDrawTombstone() {
  if (!MP.active) return;
  MP.watchOwnDrawDone((val) => {
    if (!val || !val.forced || val.done !== true) return;
    if (val.round !== G.roundNumber || val.act !== G.currentAct) return;
    if (G.phase !== 'draw' || G.drawsDone[0]) return;
    const player = G.players[0];
    if (player.busted) return; // bust flow already ends in its own done signal — let it finish
    player.roundDollars = val.dollars || 0;
    player.roundCows    = val.cows    || 0;
    player.roundBandits = val.bandits || 0;
    player.dollar1OtherPlayed = val.dollar1OtherPlayed || 0; // match what others consumed
    player.stoppedDrawing = true;
    addLog('The host continued the game — your draw phase was ended with your last-synced cards.', 'log-score');
    G.drawsDone[0] = true; // startPlayerDraw/playerDraw guard on this — no more draws
    clearActions();
    setMessage('Waiting for other players to finish drawing...');
    render();
    checkDrawPhaseComplete();
  });
}

// Force-skip the current (stuck) buyer; broadcast so all clients advance together.
function forceBuyTurn() {
  const playerIdx = G.buyOrder[G.currentBuyerIdx];
  const player = G.players[playerIdx];
  if (!player) return;
  addLog(`Host force-continued: ${player.name}'s buy turn was skipped.`, 'log-score');
  // Stamp the seq every waiter expects for this turn (2 = the extra-buy re-entry).
  const seq = player.extraBuyUsed ? 2 : 1;
  MP.forceBuyAction(player.slotIdx, seq); // host's own waitForBuyAction fires and advances
}

// Force a default buy order (seat order of non-busted players) when the chooser is stuck.
function forceBuyOrder() {
  const nonBusted = G.players
    .map((p, i) => ({ p, i }))
    .filter(c => !c.p.busted)
    .sort((a, b) => G.seatOrder.indexOf(G.playerOrder[a.i]) - G.seatOrder.indexOf(G.playerOrder[b.i]))
    .map(c => c.i);
  const slotOrder = nonBusted.map(i => G.playerOrder[i]);
  addLog('Host force-continued: buy order set automatically.', 'log-score');
  MP.pushBuyOrder(slotOrder); // host's own waitForBuyOrder fires and applies it
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
    const aiCopyNextWasActive = ai.copyNextActive;
    applyCardEffects(ai, card, isFirst);

    if (card.special === 'burn_to_use') {
      addLog(`${aiLabel} drew: ${cardLabel(card)} – activate to use`);
    } else {
      addLog(`${aiLabel} drew: ${cardLabel(card)} (${ai.roundDollars}$, ${ai.roundCows} cows, ${ai.roundBandits} bandits)`);
    }
    render();
    await delay(800);

    // Handle draw4 — Copy Next doubles forced draws (4 → 8).
    if (card.special === 'draw4' && !ai.busted) {
      const aiDraws = aiCopyNextWasActive ? 8 : 4;
      for (let i = 0; i < aiDraws; i++) {
        if (ai.busted) break;
        // Parity with the human path: BEFORE each mandatory draw, proactively activate a
        // held jail (-1 bandit) card while sitting at 2+ bandits, so the AI gets the same
        // between-draw window to avoid an otherwise-lethal bust (rule: activate before busting).
        if (ai.roundBandits >= 2) {
          const jail = ai.hand.find(c =>
            (c.special === 'burn_to_use' && c.bandits < 0) ||
            (c.special === 'copy_next' && c === ai.copyNextCard && ai.copyNextDonor?.special === 'burn_to_use' && ai.copyNextDonor.bandits < 0)
          );
          if (jail) {
            ai.hand.splice(ai.hand.indexOf(jail), 1);
            const jailEffect = (jail.special === 'copy_next') ? ai.copyNextDonor : jail;
            if (jail.special === 'copy_next') { ai.copyNextDonor = null; ai.copyNextCard = null; }
            ai.roundDollars += jailEffect.dollars;
            ai.roundBandits = Math.max(0, ai.roundBandits + jailEffect.bandits);
            ai.roundCows += jailEffect.cows;
            addLog(`${aiLabel} used a card: -1 bandit negated.`, 'log-burn');
            render();
            await delay(500);
          }
        }
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

    // Handle burn_to_use activation — jail cards only (bandits < 0)
    // Dollar burn_to_use cards are NOT activated mid-draw; they're activated before stopping
    // (where the AI knows it's done drawing) or at buy phase start (after pyramid updates).
    // Activating a dollar card mid-draw then continuing to draw is wasteful — if you bust,
    // the activation was pointless, and the bandit count doesn't gate a purchasing decision.
    // Also activates the Copy Next card if it's linked to a jail donor.
    for (const tCard of ai.hand.filter(c =>
      (c.special === 'burn_to_use' && c.bandits < 0) ||
      (c.special === 'copy_next' && c === ai.copyNextCard && ai.copyNextDonor?.special === 'burn_to_use' && ai.copyNextDonor.bandits < 0)
    )) {
      if (ai.roundBandits < 2) continue;
      const idx = ai.hand.indexOf(tCard);
      if (idx < 0) continue;
      ai.hand.splice(idx, 1);
      const effectCard = (tCard.special === 'copy_next') ? ai.copyNextDonor : tCard;
      if (tCard.special === 'copy_next') { ai.copyNextDonor = null; ai.copyNextCard = null; }
      ai.roundBandits = Math.max(0, ai.roundBandits + effectCard.bandits);
      addLog(`${aiLabel} used a card: -1 bandit negated.`, 'log-burn');
      render();
      await delay(500);
    }


    // Handle look3_rearrange for AI
    if (card.special === 'look3_rearrange' && ai.deck.length >= 2) {
      const idx = ai.hand.indexOf(card);
      if (idx >= 0) ai.hand.splice(idx, 1);
      // Parity with human handleLook3: reshuffle discard in if the draw pile can't fill a top-3.
      // Seeded shuffle (isHuman=false) keeps every client's AI deck identical.
      if (ai.deck.length < 3 && ai.discard.length > 0) {
        ai.deck.push(...shuffleForPlayer(ai.discard, ai.slotIdx, false));
        ai.discard = [];
      }
      const top3 = ai.deck.splice(0, Math.min(3, ai.deck.length));
      // Sort by full personality-weighted score: draw best cards first
      top3.sort((a, b) => scoreCardForAI(a, ai) - scoreCardForAI(b, ai));
      ai.deck.unshift(...top3);
      addLog(`${aiLabel} used a card to rearrange top cards.`, 'log-burn');
      render();
    }

    // Handle look3_immediate for AI
    if (card.special === 'look3_immediate' && ai.deck.length >= 2) {
      // Parity with human handleLook3: reshuffle discard in if the draw pile can't fill a top-3.
      if (ai.deck.length < 3 && ai.discard.length > 0) {
        ai.deck.push(...shuffleForPlayer(ai.discard, ai.slotIdx, false));
        ai.discard = [];
      }
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
      // Before stopping: activate $N burn_to_use cards (including Copy Next copies) if it
      // helps afford a better card.
      for (const tCard of ai.hand.filter(c =>
        (c.special === 'burn_to_use' && c.dollars > 0) ||
        (c.special === 'copy_next' && c === ai.copyNextCard && ai.copyNextDonor?.special === 'burn_to_use' && ai.copyNextDonor.dollars > 0)
      )) {
        const effectCard = (tCard.special === 'copy_next') ? ai.copyNextDonor : tCard;
        const avail = getAvailablePyramidCards(G.pyramid);
        const unlocksBetter = avail.some(a =>
          a.slot.card.cost > ai.roundDollars && a.slot.card.cost <= ai.roundDollars + effectCard.dollars
        );
        if (unlocksBetter) {
          const idx = ai.hand.indexOf(tCard);
          if (idx >= 0) {
            ai.hand.splice(idx, 1);
            if (tCard.special === 'copy_next') { ai.copyNextDonor = null; ai.copyNextCard = null; }
            ai.roundDollars += effectCard.dollars;
            addLog(`${aiLabel} used a card: $${effectCard.dollars}.`, 'log-burn');
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
// affordMult: draw aggression multiplier when AI can't afford any available card
// act1DollarBonus: extra score per dollar on cards bought in Act 1
// act3CowBonus: extra score per cow on cards bought in Act 3
// revealBonus: score bonus for buying a card that uncovers a hidden pyramid slot
const AI_PERSONALITIES = {
  sheriff: {
    bustThreshold2: 0.05,  // almost never draws with 2 bandits
    bustThreshold1: 0.15,  // very cautious at 1 bandit
    dollarBuffer:   0,     // stops as soon as it can afford the best card
    cowWeight:      5,     // was 3 — stopped buying cow cards over obvious junk
    dollarWeight:   2,     // was 1.5 — values economy
    banditPenalty:  4,     // despises bandits in buy scoring
    positionWeight: 0,     // methodical — ignores standings
    denialBurn:     false,
    deckMemory:     0.9,   // near-perfect deck tracking
    lethalBias:     1.5,   // amplifies perceived danger of lethal cards
    affordMult:     1.2,   // doesn't over-draw when pyramid is out of reach
    act1DollarBonus: 1.5,  // economy-focused early — his whole plan
    act3CowBonus:   2.5,   // moderate late-game ramp
    revealBonus:    2.5,   // methodical planner — thinks ahead about what's hidden
  },
  wild_bill: {
    bustThreshold2: 0.35,  // keeps drawing with 2 bandits often
    bustThreshold1: 0.50,  // barely slows down at 1 bandit
    dollarBuffer:   999,   // no dollar target — draws until bust or dry
    cowWeight:      9,     // was 5 — when he survives he now actually buys the best cards
    dollarWeight:   0.5,
    banditPenalty:  0.5,   // will buy card_51 (5 cows, 2 bandits) without flinching
    positionWeight: 0,     // pure chaos — doesn't track position
    denialBurn:     false,
    deckMemory:     0.1,   // barely tracks the deck
    lethalBias:     0.5,   // actively discounts danger signals
    affordMult:     2.0,   // draws extremely hard when he can't afford anything
    act1DollarBonus: 0,    // doesn't care about economy
    act3CowBonus:   4.0,   // goes all-in on cows in Act 3
    revealBonus:    0,     // chaotic — no pyramid planning
  },
  rancher: {
    bustThreshold2: 0.22,  // was 0.15 — bolder with 2 bandits
    bustThreshold1: 0.42,  // was 0.30 — less timid at 1 bandit
    dollarBuffer:   3,     // was 2 — draws more to reach better cards
    maxDraw:        10,    // was 7 — disciplined thresholds let it overdraw $ safely (sim +win, flat bust)
    cowWeight:      9,     // was 6 — closes the gap to evolved optimum
    dollarWeight:   0.5,
    banditPenalty:  20,   // was 1.5 — R5: a Bandit costs ~5 Cows of real value; 2.1x cowWeight is the measured optimum
    positionWeight: 0.4,   // somewhat adapts to standings
    denialBurn:     false,
    deckMemory:     0.6,
    lethalBias:     1.0,
    affordMult:     1.6,   // draws harder when pyramid is out of reach
    act1DollarBonus: 0,    // doesn't value economy bonus — just spends dollars
    act3CowBonus:   3.5,   // serious late-game cow push
    revealBonus:    1.0,   // some pyramid planning, not obsessive
  },
  banker: {
    bustThreshold2: 0.15,
    bustThreshold1: 0.30,
    dollarBuffer:   1,     // stops slightly earlier (wants exactly enough)
    cowWeight:      1.5,   // intentionally low — dollar-first identity
    dollarWeight:   3,     // values income above cows
    banditPenalty:  2,
    positionWeight: 0.3,
    denialBurn:     false,
    deckMemory:     0.8,   // careful accountant tracks the deck well
    lethalBias:     1.2,
    affordMult:     1.2,   // conservative — stops when he can't afford
    act1DollarBonus: 2.5,  // LOVES economy in Act 1 — his defining strategy
    act3CowBonus:   0.5,   // even late he still chases dollars over cows
    revealBonus:    1.0,   // strategic but not committed
  },
  outlaw: {
    bustThreshold2: 0.35,  // was 0.20 — matches Wild Bill at 2 bandits
    bustThreshold1: 0.55,  // was 0.35 — draws hard when trailing
    dollarBuffer:   2,     // was 1
    cowWeight:      8,     // was 4 — the critical fix; now buys correctly
    dollarWeight:   1,
    banditPenalty:  1.0,   // was 2 — willing to buy risky high-cow cards
    positionWeight: 1.5,   // highly position-aware: draws aggressively when trailing
    denialBurn:     true,  // was false — burns the leader's best card when he can't buy
    deckMemory:     0.4,   // plays on feel more than math
    lethalBias:     0.6,   // was 0.8 — more reckless when position demands it
    affordMult:     2.0,   // draws extremely hard when can't afford anything
    act1DollarBonus: 0,    // doesn't care about economy — only position
    act3CowBonus:   3.5,   // closes out strong
    revealBonus:    0.5,   // minimal pyramid planning — plays forward
  },
  deputy: {
    bustThreshold2: 0.10,  // conservative draw — holds back
    bustThreshold1: 0.28,  // was 0.20 — slight loosening
    dollarBuffer:   1,     // was 0 — doesn't just stop at bare minimum
    maxDraw:        10,    // was 7 — disciplined thresholds let it overdraw $ safely (sim +win, flat bust)
    cowWeight:      6,     // was 2 — critical fix; denial work was wasted on bad buys
    dollarWeight:   1.5,   // was 2 — rebalanced
    banditPenalty:  14,   // was 2.5 — R5: a Bandit costs ~5 Cows of real value; 2.1x cowWeight is the measured optimum
    positionWeight: 0.3,
    denialBurn:     true,  // burns the card most valuable to the current leader
    deckMemory:     0.7,
    lethalBias:     1.3,
    affordMult:     1.4,
    act1DollarBonus: 0.5,  // mild economy interest early
    act3CowBonus:   2.5,   // ramps appropriately
    revealBonus:    2.0,   // uses denial + reveals to control the pyramid shape
  },
  greenhorn: {
    bustThreshold2: 0.03,  // almost never draws with 2 bandits
    bustThreshold1: 0.08,  // extremely timid — stops at the first sign of danger
    dollarBuffer:   0,
    cowWeight:      1.0,   // barely registers cows as the objective
    dollarWeight:   3.5,   // hoards dollar engines
    banditPenalty:  6.0,   // terrified of bandits
    positionWeight: 0,
    denialBurn:     false,
    deckMemory:     0.2,   // poor deck tracking — plays blind
    lethalBias:     2.5,   // maximum fear amplification
    affordMult:     1.0,   // doesn't draw harder even when broke
    act1DollarBonus: 3.0,  // obsessively economy-focused in Act 1
    act3CowBonus:   0.3,   // barely pivots to cows even at the end
    revealBonus:    3.5,   // wastes burns on pyramid reveals
  },
  prospector: {
    bustThreshold2: 0.12,
    bustThreshold1: 0.25,
    dollarBuffer:   1.5,
    maxDraw:        10,    // was 7 — disciplined thresholds; sweep shows +3.3pp 2P/+6.8pp 4P at flat bust
    cowWeight:      4.5,   // some cow sense but not sharp
    dollarWeight:   1.5,
    banditPenalty:  10,   // was 2.5 — R5: a Bandit costs ~5 Cows of real value; 2.1x cowWeight is the measured optimum
    positionWeight: 0.2,
    denialBurn:     false,
    deckMemory:     0.55,
    lethalBias:     1.3,
    affordMult:     1.3,
    act1DollarBonus: 1.0,
    act3CowBonus:   1.8,
    revealBonus:    2.0,   // still drawn to shiny pyramid reveals
  },
  drifter: {
    bustThreshold2: 0.18,
    bustThreshold1: 0.35,
    dollarBuffer:   2.5,
    maxDraw:        10,    // was 7 — disciplined thresholds; sweep shows +3.8pp 2P/+7.4pp 4P at +1.2pp bust
    cowWeight:      7.0,   // solid cow buying, no special tricks
    dollarWeight:   0.8,
    banditPenalty:  14,   // was 2.0 — R5: a Bandit costs ~5 Cows of real value; 2.1x cowWeight is the measured optimum
    positionWeight: 0.3,
    denialBurn:     true,  // R6: +3.6pp 2P / +3.9pp 4P (genome-sweep). Costs ~5 herd of its
                           // own score but denies the leader — a relative-position trade.
    deckMemory:     0.65,
    lethalBias:     1.1,
    affordMult:     1.5,
    act1DollarBonus: 0.3,
    act3CowBonus:   2.8,
    revealBonus:    0.8,
  },
  enforcer: {
    bustThreshold2: 0.30,
    bustThreshold1: 0.60,  // draws hard, calibrated not reckless
    dollarBuffer:   3.0,
    maxDraw:        10,    // was 7 — coevolution + sweep: +3.7pp 2P/+5.8pp 4P at +1.5pp bust
    cowWeight:      9.5,   // near-optimal cow buying
    dollarWeight:   1.5,
    banditPenalty:  20,   // was 1.2 — R5: a Bandit costs ~5 Cows of real value; 2.1x cowWeight is the measured optimum
    positionWeight: 0.5,
    denialBurn:     false, // unlike outlaw — wins through efficiency, not denial
    deckMemory:     0.75,  // good tracking; paired with high lethalBias = precise fear
    lethalBias:     1.8,
    affordMult:     1.9,   // draws very hard when pyramid is out of reach
    act1DollarBonus: 0,
    act3CowBonus:   3.0,
    revealBonus:    0.2,
  },
};

function aiShouldDraw(ai) {
  const cfg = AI_PERSONALITIES[ai.personality] || AI_PERSONALITIES.rancher;

  // Hard hand-size cap. Per-personality (cfg.maxDraw); absent = 7. For disciplined
  // personalities whose bandit thresholds already govern stopping, a higher cap lets
  // them overdraw dollars (more cows + earlier buy priority) at no extra bust cost —
  // sim-validated +2-4pp (2P) / up to +8pp (4P) for rancher & deputy. For aggressive
  // bots (wild_bill dollarBuffer 999, outlaw) the cap is a load-bearing bust governor —
  // do NOT raise theirs. See sim/draw-cap-experiment.js.
  if (ai.hand.length >= (cfg.maxDraw ?? 7)) return false;
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

  const cardsRemaining = ai.deck.length;

  // Draw more aggressively if AI can't currently afford any available card
  const canAffordSomething = getAvailablePyramidCards(G.pyramid).some(a => a.slot.card.cost <= ai.roundDollars);
  const affordMult = canAffordSomething ? 1.0 : (cfg.affordMult ?? 1.4);

  if (ai.roundBandits >= 2) {
    if (cardsRemaining === 0) return false;
    const bustProb = calcBustProb(ai, 2, cfg);
    return bustProb < cfg.bustThreshold2 * positionMult * affordMult;
  }

  if (ai.roundBandits === 1) {
    if (cardsRemaining <= 1) return false;
    const bustProb = calcBustProb(ai, 1, cfg);
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

// Returns the perceived bust probability for the next draw, blending exact lethal-card
// counting (deckMemory=1) with a flat prior (deckMemory=0), then amplified by lethalBias.
// With currentBandits=2: lethal = any card with bandits >= 1 (one more busts).
// With currentBandits=1: lethal = cards with bandits >= 2 (single draw to bust).
function calcBustProb(player, currentBandits, cfg) {
  const deck = player.deck;
  if (deck.length === 0) return 0;
  const minLethal = currentBandits === 2 ? 1 : 2;
  const lethalCount = deck.filter(c => (c.bandits || 0) >= minLethal).length;
  const exactProb = lethalCount / deck.length;
  const FLAT_PRIOR = 0.20;
  const memory = cfg.deckMemory ?? 0.5;
  const bias   = cfg.lethalBias  ?? 1.0;
  return (exactProb * memory + FLAT_PRIOR * (1 - memory)) * bias;
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
  if (TUTORIAL.active && !TUTORIAL.isAllowed('activate')) { TUTORIAL.flashBlocked(); return; }
  if (TUTORIAL.active) TUTORIAL.onActionDone('activate');
  trajLogSpecial(player, card.special, card.id); // trajectory: record the activation
  switch (card.special) {
    case 'burn_to_use':
      await handleBurnToUse(player, card);
      break;
    case 'burn_buy_first':
      await handleBurnBuyFirst(player, card);
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
    case 'copy_next':
      await handleCopyNextActivation(player, card);
      break;
  }
  saveLocalGame();
}

// Activates the Copy Next card as a second independent copy of its linked donor.
// Called when the player burns the Copy Next card itself (not the donor).
// Each of donor and Copy Next can be used independently for the same effect.
async function handleCopyNextActivation(player, copyCard) {
  const donor = player.copyNextDonor;
  if (!donor) return;

  switch (donor.special) {
    case 'burn_to_use': {
      const idx = player.hand.indexOf(copyCard);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.copyNextDonor = null; player.copyNextCard = null;
      player.roundDollars += donor.dollars;
      player.roundBandits = Math.max(0, player.roundBandits + donor.bandits);
      player.roundCows += donor.cows;
      const parts = [];
      if (donor.dollars > 0) parts.push(`$${donor.dollars}`);
      if (donor.bandits < 0) parts.push('−1 bandit negated');
      if (donor.cows > 0) parts.push(`+${donor.cows} cow`);
      addLog(`Copy Next used: ${parts.join(', ')}.`, 'log-burn');
      render(); mpSyncDraw(); startPlayerDraw();
      break;
    }
    case 'burn_buy_first': {
      setMessage('Use Copy Next card for Buy Priority?');
      setActions([
        { text: 'Use for Priority', onClick: async () => {
          const won = await claimBuyFirstPriority();
          if (!won) {
            addLog('First-buy priority was already taken this round — card kept.', 'log-burn');
            setMessage('Another player already claimed first buy this round.');
            startPlayerDraw();
            return;
          }
          const idx = player.hand.indexOf(copyCard);
          if (idx >= 0) player.hand.splice(idx, 1);
          player.copyNextDonor = null; player.copyNextCard = null;
          player.hasBuyBurnFirst = true;
          addLog('Copy Next used for buy priority!', 'log-burn');
          render(); mpSyncDraw(); startPlayerDraw();
        }},
        { text: 'Keep Card', onClick: () => { startPlayerDraw(); }, className: 'btn-secondary' },
      ]);
      break;
    }
    case 'look3_rearrange': {
      setMessage('Use Copy Next card to rearrange your top 3?');
      setActions([
        { text: 'Use & Look', onClick: async () => {
          const idx = player.hand.indexOf(copyCard);
          if (idx >= 0) player.hand.splice(idx, 1);
          player.copyNextDonor = null; player.copyNextCard = null;
          addLog('Copy Next used: rearrange top 3.', 'log-burn');
          render();
          await handleLook3(player);
          startPlayerDraw();
        }},
        { text: 'Keep Card', onClick: () => { startPlayerDraw(); }, className: 'btn-secondary' },
      ]);
      break;
    }
    case 'replay_discard': {
      if (player.discard.length === 0) {
        addLog('Copy Next copy: no cards in discard to replay.');
        startPlayerDraw();
        return;
      }
      setMessage('Use Copy Next card to replay a card from your discard?');
      setActions([
        { text: 'Use & Replay', onClick: () => {
          const idx = player.hand.indexOf(copyCard);
          if (idx >= 0) player.hand.splice(idx, 1);
          player.copyNextDonor = null; player.copyNextCard = null;
          const modal = document.getElementById('special-modal');
          const content = document.getElementById('special-modal-content');
          content.innerHTML = '<h2>Choose a Card to Replay</h2>';
          const cardsDiv = document.createElement('div');
          cardsDiv.className = 'modal-cards';
          player.discard.forEach((discardCard, i) => {
            const el = renderCardEl(discardCard, true, 'clickable');
            el.onclick = () => {
              trajLogSpecial(player, 'replay_pick', discardCard.id);
              applyCardEffects(player, discardCard, false);
              player.discard.splice(i, 1);
              player.hand.push(discardCard);
              addLog(`Copy Next replayed: ${discardCard.id.replace(/_/g, ' ')}`, 'log-buy');
              modal.classList.add('hidden');
              render(); mpSyncDraw(); startPlayerDraw();
            };
            cardsDiv.appendChild(el);
          });
          content.appendChild(cardsDiv);
          modal.classList.remove('hidden');
        }},
        { text: 'Keep Card', onClick: () => { startPlayerDraw(); }, className: 'btn-secondary' },
      ]);
      break;
    }
    case 'extra_buy': {
      setMessage('Use Copy Next card for an extra Buy Phase turn?');
      setActions([
        { text: 'Use for Extra Buy/Burn', onClick: () => {
          const idx = player.hand.indexOf(copyCard);
          if (idx >= 0) player.hand.splice(idx, 1);
          player.copyNextDonor = null; player.copyNextCard = null;
          player.hasExtraBuy = true;
          addLog('Copy Next used: extra buy/burn!', 'log-burn');
          render(); mpSyncDraw(); startPlayerDraw();
        }},
        { text: 'Keep Card', onClick: () => { startPlayerDraw(); }, className: 'btn-secondary' },
      ]);
      break;
    }
  }
}

// --- BUST ---

function showBustAnimation() {
  // Pulse each bandit card in sequence so players count them 1-2-3
  // The red outline is already applied at render time via .bust-culprit
  G.players[0].hand
    .filter(c => c.bandits > 0)
    .forEach((c, i) => {
      setTimeout(() => {
        // Scope to #player-hand: an unscoped lookup can match a pyramid card
        // that shares this data-uid and pulse it instead (pyramid renders first
        // in the DOM, so querySelector would return it). See animateDrawnCard.
        const el = document.querySelector(`#player-hand [data-uid="${c.uid}"]`);
        if (!el) return;
        el.classList.add('bust-bandit-pulse');
        el.addEventListener('animationend', () => el.classList.remove('bust-bandit-pulse'), { once: true });
      }, i * 350);
    });
  // Zone border flash + BUSTED stamp are CSS-driven via zone-busted class (added by render())
}

async function handleBust(player) {
  player.busted = true;
  player.forcedDraws = 0;   // busting ends any outstanding Draw-4 obligation
  saveLocalGame();
  if (player.isHuman) {
    clearActions();
    setMessage('BUSTED! Review your hand, then clear it when ready.');
    if (TUTORIAL.active) TUTORIAL.onBust();
  }
  addLog(`${player.name} BUSTED with ${player.roundBandits} bandits!`, 'log-bust');
  render();
  if (player === G.players[0]) showBustAnimation();
  if (player.isHuman) mpSyncDraw();

  if (player === G.players[0]) {
    // Let the player review their hand before clearing — show button after animation lands.
    // In tutorial mode the button also advances the bust-explain step.
    await new Promise(resolve => {
      setTimeout(() => {
        const actionsEl = document.getElementById('actions');
        if (!actionsEl) { resolve(); return; }
        actionsEl.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Clear Hand';
        btn.onclick = () => {
          if (TUTORIAL.active) TUTORIAL.onPopupDismiss();
          resolve();
        };
        actionsEl.appendChild(btn);
      }, 1300);
    });
    if (!TUTORIAL.active) clearActions();

    // Move all drawn cards to discard.
    player.discard.push(...player.hand);
    player.hand = [];
    player.roundDollars = 0;
    player.roundCows = 0;
    render();
    mpSyncDraw();
    await onPlayerDrawDone();
  } else {
    // AI: leave hand visible so player can review it — cleared in applyBuyOrder when buy phase starts.
    await delay(2000);
    render();
  }
}

// --- SPECIAL CARD HANDLERS ---

async function handleBurnToUse(player, card) {
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
  addLog(`You used your ${SUIT_NAME[card.cacti]} Explosive card: ${parts.join(', ')}.`, 'log-burn');
  render();
  mpSyncDraw();
  startPlayerDraw();
}

async function activateCardInBuyPhase(player, card) {
  const idx = player.hand.indexOf(card);
  if (idx < 0) return;
  player.hand.splice(idx, 1);
  if (card.special === 'extra_buy') {
    player.hasExtraBuy = true;
    addLog(`You used your ${SUIT_NAME[card.cacti]} Explosive card: extra buy/burn!`, 'log-burn');
    // NOTE: MP edge case — if a remote human activates this in buy phase, the host's
    // opp.hasExtraBuy stays false (drawState isn't re-synced in buy phase) and the
    // host will skip their extra turn. Rare: Act 2 only, requires holding through draw.
  } else {
    const bonus = card.dollars;
    player.roundDollars += bonus;
    addLog(`You used your ${SUIT_NAME[card.cacti]} Explosive card: +$${bonus}.`, 'log-burn');
  }
  trajLogSpecial(player, card.special, card.id, null, 'buy');
  render();
  humanBuyTurn(player);
}

// Returns true if this player may take first-buy priority this round. In MP 5-8P the
// claim is atomic — only ONE player per round wins it (two card_14 copies exist under
// the doubled deck). In ≤4P / solo there's a single card_14, so it's always granted.
async function claimBuyFirstPriority() {
  // Fields are currentAct/roundNumber — G.act/G.round don't exist. Passing them (audit
  // bug C2) keyed every claim on "undefined_undefined", making the claim once-per-GAME.
  if (MP.active && G.numPlayers >= 5) return await MP.claimBuyFirst(G.currentAct, G.roundNumber);
  return true;
}

async function handleBurnBuyFirst(player, card) {
  setMessage('Use this Explosive card to go 1st in the Buy Phase?');
  setActions([
    { text: 'Use for Priority', onClick: async () => {
      const won = await claimBuyFirstPriority();
      if (!won) {
        // Another player already claimed first buy this round — block (card stays in
        // hand, discards normally at round end) rather than wasting it.
        addLog('First-buy priority was already taken this round — card kept.', 'log-burn');
        setMessage('Another player already claimed first buy this round.');
        startPlayerDraw();
        return;
      }
      player.hasBuyBurnFirst = true;
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.roundCows -= card.cows;
      addLog('You used a card for first buy priority!', 'log-burn');
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
  // If the draw pile can't supply a full peek, reshuffle the discard in first —
  // drawing/peeking past the deck should pull from discard, not just show fewer cards.
  if (player.deck.length < 3 && player.discard.length > 0) {
    const shuffled = shuffleForPlayer(player.discard, player.slotIdx, player.isHuman);
    player.discard = [];
    player.deck.push(...shuffled);
    addLog(`Shuffled ${shuffled.length} cards from discard to look at the top 3.`, 'log-score');
    mpSyncDraw();
  }
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
      peekBtn.className = 'btn btn-secondary modal-peek-btn';
      peekBtn.textContent = 'Peek at Table';
      peekBtn.onclick = () => modal.classList.add('peeking');
      content.appendChild(peekBtn);
    }

    renderModal();
    modal.classList.remove('hidden');
  });
}

async function handleTrashLook3(player, card) {
  setMessage('Use this Explosive card to look at and rearrange your top 3 cards?');
  setActions([
    { text: 'Use & Look', onClick: async () => {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      addLog('You used a card to rearrange top 3.', 'log-burn');
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

  setMessage('Use this Explosive card to replay any card from your discard pile?');
  setActions([
    { text: 'Use & Replay', onClick: () => {
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
          trajLogSpecial(player, 'replay_pick', discardCard.id); // trajectory: which discard was replayed (stat-affecting)
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

async function handleExtraBuy(player, card) {
  setMessage('Use this Explosive card for an extra turn in the Buy Phase?');
  setActions([
    { text: 'Use for Extra Buy/Burn', onClick: () => {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.hasExtraBuy = true;
      addLog('You used a card for an extra buy/burn this round!', 'log-burn');
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

// determineBuyWinner() is defined in sim/tiebreaker.js (loaded via <script> before play.js)

function onDrawPhaseComplete() {
  clearForceContinue();
  G.phase = 'buy';

  // MP: apply the round's deferred dollar1_other (card_24) grants HERE — one
  // deterministic point, on every client, before anything reads roundDollars for the
  // buy order (audit C5; see applyCardEffects). Counts: own plays tracked locally,
  // remote humans' from their authoritative drawDone payload, AI seats' from the
  // identical local simulation — so every client computes the same totals. Runs
  // exactly once per round (checkDrawPhaseComplete's phase guard gates entry).
  if (MP.active) {
    G.players.forEach(src => {
      const n = src.dollar1OtherPlayed || 0;
      if (n <= 0) return;
      G.players.forEach(p => { if (p !== src) p.roundDollars += n; });
      addLog(`${src.name}'s card gives +$${n} to everyone else.`, 'log-score');
    });
  }

  mpLog('onDrawPhaseComplete — player stats:', G.players.map((p, i) => ({
    i, name: p.name, slot: G.playerOrder[i],
    dollars: p.roundDollars, cows: p.roundCows, busted: p.busted,
    hasBuyBurnFirst: p.hasBuyBurnFirst, handLen: p.hand.length,
  })));

  // Why the round's first buyer goes first — shown by aiBuyTurn on the first buy
  // turn (audit F2: the reason used to live only in the collapsed log). Only set
  // in branches where the order STARTS with the player who earned it; a chooser
  // sending someone else first leaves it null (that player earned nothing).
  G._buyOrderReason = null;

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
      armForceContinue(forceBuyOrder); // host-only: auto-set order if chooser stalls
      MP.waitForBuyOrder((slotOrder) => {
        clearForceContinue();
        const localOrder = slotOrder.map(s => MP.slotToPlayer[s]);
        mpLog('waitForBuyOrder (hasBuyBurnFirst remote priority) fired:', localOrder);
        applyBuyOrder(localOrder);
      });
    } else {
      G._buyOrderReason = 'played Buy/Burn 1st';
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
    G._buyOrderReason = 'only player not busted';
    startBuyPhase(soloIdx, soloIdx === 0);
    return;
  }

  if (winnerIdx === 0 && TUTORIAL.active) {
    // Auto-resolve in tutorial — player always goes first
    addLog(`--- Buy Phase --- You go first ($${G.players[0].roundDollars}).`);
    startBuyPhase(0, true);
  } else if (winnerIdx === 0) {
    addLog(`--- Buy Phase --- You choose buy order (${reason}).`);
    showChooseFirstUI(nonBusted, reason);
  } else if (!G.players[winnerIdx].isHuman) {
    addLog(`--- Buy Phase --- ${winnerName} goes first (${reason}).`);
    G._buyOrderReason = reason;
    startBuyPhase(winnerIdx);
  } else {
    // Remote human wins — wait for their buy order push
    addLog(`--- Buy Phase --- ${winnerName} chooses buy order (${reason}).`);
    setMessage(`${winnerName} won the draw (${reason}) — waiting for them to choose who buys first...`);
    clearActions();
    render();
    armForceContinue(forceBuyOrder); // host-only: auto-set order if chooser stalls
    MP.waitForBuyOrder((slotOrder) => {
      clearForceContinue();
      const localOrder = slotOrder.map(s => MP.slotToPlayer[s]);
      mpLog('waitForBuyOrder (remote winner chose) fired:', { slotOrder, localOrder, names: localOrder.map(i => G.players[i]?.name) });
      const firstLocalIdx = localOrder[0];
      const firstPlayer = G.players[firstLocalIdx];
      addLog(`${winnerName} chose ${firstLocalIdx === 0 ? 'you' : firstPlayer.name} to buy first.`);
      applyBuyOrder(localOrder);
    });
  }
}

function showChooseFirstUI(nonBustedIndices, reason) {
  // R2 tombstone: while we're choosing, the host's force valve may push a default
  // order (we looked stuck). Adopt it instead of applying a conflicting local choice —
  // everyone else consumed the forced order, so our own would diverge the turn chain.
  // `resolved` also swallows the echo of our OWN push (waitForBuyOrder fires on it).
  let resolved = false;
  if (MP.active) {
    MP.waitForBuyOrder((slotOrder) => {
      if (resolved) return;
      resolved = true;
      addLog('The host set the buy order automatically.', 'log-score');
      const localOrder = slotOrder.map(s => MP.slotToPlayer[s]).filter(i => i !== undefined);
      applyBuyOrder(localOrder);
    });
  }
  // Sort buttons into seat order so the list matches the turn order bar.
  const sorted = [...nonBustedIndices].sort((a, b) =>
    G.seatOrder.indexOf(G.playerOrder[a]) - G.seatOrder.indexOf(G.playerOrder[b])
  );
  // Say WHY the player gets to choose (audit F2): choosing the order is the
  // reward for winning the draw, and the reason used to be visible only in the
  // collapsed log — new players thought the prompt was arbitrary.
  setMessage(reason ? `You won the draw — ${reason}. Who buys first?`
                    : 'Buy Phase — Who goes first?');
  setActions(sorted.map(i => ({
    text: i === 0 ? 'I Go First' : `${G.players[i].name} Goes First`,
    onClick: () => {
      if (resolved) return; // forced order already applied — buttons are stale
      resolved = true;
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
  // Flush busted AI hands to discard now that buy phase is starting
  G.players.forEach(p => {
    if (p.busted && !p.isHuman && p.hand.length > 0) {
      p.discard.push(...p.hand);
      p.hand = [];
      p.roundDollars = 0;
      p.roundCows = 0;
    }
  });
  G.buyOrder = order;
  G.currentBuyerIdx = 0;
  mpLog('applyBuyOrder:', order.map(i => G.players[i]?.name));
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push(); // buy phase begins — spectators see buy order
  processBuyTurn();
}

function processBuyTurn() {
  clearForceContinue();
  saveLocalGame();
  // Host: refresh the snapshot AFTER the turn pointer advanced. executeBuy/BurnLocal
  // push before advanceOrExtraBuy increments, so without this the snapshot's
  // currentBuyerIdx points at the buyer who ALREADY acted for the whole wait window —
  // a rejoiner then replays that turn (phantom AI buy / wait on a consumed buyAction /
  // local double-buy). Audit C6.
  if (MP.active) MP.pushSpectatorState();
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
  armForceContinue(forceBuyTurn); // host-only: skip this buyer if they never respond
  // Expected seq: 1 for the normal turn, 2 for the extra-buy turn (extraBuyUsed is set
  // before this re-entry). Seq matching replaced the old consume-then-clear pattern —
  // a stale same-round value now simply fails the seq check instead of needing a null
  // write that could race the actor's second action (audit R1).
  const expectedSeq = opp.extraBuyUsed ? 2 : 1;
  MP.waitForBuyAction(opp.slotIdx, expectedSeq, (data) => {
    mpLog('waitForBuyAction fired for', opp.name, data);
    clearForceContinue();
    // A remote human may have used Card 4 this turn — apply the swap before their buy/burn
    // so every client mutates the shared state in the same order. A false return means
    // this client's state diverged from the actor's (target or card_4 not found) — log
    // loudly; a silently dropped swap is how card_4 desyncs compound (audit C1).
    if (data.swap && !applySwapLocal(opp, data.swap)) {
      console.warn('[MP] swap from', opp.name, 'could not be applied on this client — state divergence', data.swap);
    }
    if (data.action === 'skip') {
      // Forced skip (host recovery) — advance past this player's turn unconditionally
      // (don't honor extra-buy, which would re-enter the wait).
      addLog(`${opp.name}'s turn was skipped.`, 'log-score');
      G.currentBuyerIdx++;
      if (isPyramidEmpty(G.pyramid)) endBuyPhase();
      else processBuyTurn();
    } else {
      // Apply the opponent's buy/burn. If the target cell is already gone on THIS
      // client (pyramid divergence or a stale re-fire), executeBuy/BurnLocal no-op
      // and return false WITHOUT advancing the turn — so we must advance here, or the
      // buy-turn chain dies and the round softlocks until manual Force Continue
      // (bug #16: busted-host buy-phase freeze, game M9RBXA 6/20). Advancing keeps every
      // client moving; the host's authoritative spectatorState reconciles pyramid state.
      const applied = data.action === 'buy'
        ? executeBuyLocal(opp, data.row, data.col)
        : executeBurnLocal(opp, data.row, data.col);
      if (!applied) {
        mpLog('mpOpponentBuyTurn: target cell already gone — advancing turn', { opp: opp.name, data });
        G.currentBuyerIdx++;
        if (isPyramidEmpty(G.pyramid)) endBuyPhase();
        else processBuyTurn();
      }
    }
  });
}

function humanBuyTurn(player) {
  G.selectedPyramidCard = null;
  // R2 tombstone: if the host force-skipped OUR turn while we were deciding (we looked
  // stuck — asleep tab, slow network), every other client advances past us. Without
  // this watcher we'd still apply our buy locally and diverge for the rest of the game.
  // Token-guarded so a fire after we acted normally (turn pointer moved) is a no-op.
  if (MP.active) {
    const token = { round: G.roundNumber, act: G.currentAct, buyerIdx: G.currentBuyerIdx };
    MP.watchOwnBuyAction((data) => {
      if (!data || !data.forced || data.action !== 'skip') return;
      if (data.round !== token.round || data.act !== token.act) return;
      if (G.phase !== 'buy' || G.currentBuyerIdx !== token.buyerIdx) return;
      if (G.buyOrder[G.currentBuyerIdx] !== 0) return; // no longer our turn
      addLog('The host continued the game — your buy turn was skipped.', 'log-score');
      G.selectedPyramidCard = null;
      clearActions();
      G.currentBuyerIdx++;
      if (isPyramidEmpty(G.pyramid)) endBuyPhase();
      else processBuyTurn();
    });
  }
  const available = getAvailablePyramidCards(G.pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= player.roundDollars);

  if (!TUTORIAL.active) {
    if (affordable.length > 0) {
      setMessage(`Buy Phase - You have $${player.roundDollars}. Click a card to buy or burn.`);
    } else {
      setMessage(`Buy Phase - You have $${player.roundDollars} (can't afford any). Click a card to burn.`);
    }
  }

  clearActions();
  const actions = player.hand.filter(c =>
    (c.special === 'burn_to_use' && c.dollars > 0) ||
    (c.special === 'extra_buy' && !player.hasExtraBuy)
  ).map(c => {
    const label = c.special === 'extra_buy' ? 'Use for Extra Buy/Burn'
                : `Use: $${c.dollars}`;
    return { text: label, onClick: () => activateCardInBuyPhase(player, c), className: 'btn-burn' };
  });
  // Swap card (card_4): usable IN ADDITION to your normal buy/burn, if any face-up target exists.
  const swapCard = player.hand.find(c => c.special === 'swap_revealed');
  if (swapCard && gatherSwapCandidates(player).total > 0) {
    actions.push({ text: 'Swap', onClick: () => openSwapModal(player, swapCard), className: 'btn-burn' });
  }
  if (actions.length > 0) setActions(actions);
  render();
  if (TUTORIAL.active) TUTORIAL.onBuyPhaseStart();
}

function onPyramidCardClick(row, col) {
  if (G.phase !== 'buy') return;
  const playerIdx = G.buyOrder[G.currentBuyerIdx];
  if (playerIdx !== 0) return; // not human's turn
  if (TUTORIAL.active) {
    // Allow clicking only the hinted pyramid card
    const buyOk  = TUTORIAL.isAllowed('buy',  { row, col });
    const burnOk = TUTORIAL.isAllowed('burn', { row, col });
    if (!buyOk && !burnOk) { TUTORIAL.flashBlocked(); return; }
  }

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
  buttons.push({ text: 'Burn Card', onClick: () => executeBurn(player, row, col), className: 'btn-burn' });
  buttons.push({ text: 'Cancel', onClick: () => {
    G.selectedPyramidCard = null;
    humanBuyTurn(player);
  }, className: 'btn-secondary' });

  setActions(buttons);
}

// Human buy: push to Firebase (MP, local human only) then apply locally.
// seq 1 = normal turn, 2 = extra buy (extraBuyUsed is set before the re-entry) — see
// pushBuyAction (audit R1).
function executeBuy(player, row, col) {
  trajLogBuy(player, 'buy', row, col); // trajectory: before state changes (gates seat/host internally)
  if (MP.active && player === G.players[0]) MP.pushBuyAction('buy', row, col, player._pendingSwap, player.extraBuyUsed ? 2 : 1);
  player._pendingSwap = null;
  if (TUTORIAL.active && player === G.players[0]) TUTORIAL.onActionDone('buy');
  executeBuyLocal(player, row, col);
}

// Returns true if the buy was applied, false if the target cell was already gone
// (a no-op). Callers that drive the MP turn chain (mpOpponentBuyTurn) MUST advance
// the turn themselves on a false result — see the note there. Local human / AI
// callers ignore the return value (unchanged behavior).
function executeBuyLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return false;
  clearActions();
  const card = slot.card;

  player.discard.push(card);
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} bought ${cardLabel(card)} for $${card.cost}.`, 'log-buy');
  revealUncovered(G.pyramid);
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push();

  advanceOrExtraBuy(player);
  return true;
}

// After a buy/burn action: grant extra buy if eligible, otherwise advance to next buyer.
// Returns true if the caller should return early (extra buy granted or pyramid empty mid-extra).
function advanceOrExtraBuy(player) {
  // Local human with extra buy available
  if (player === G.players[0] && player.hasExtraBuy && !player.extraBuyUsed) {
    if (!isPyramidEmpty(G.pyramid)) {
      player.extraBuyUsed = true;
      addLog(`Extra buy/burn! Buy or burn one more card from the pyramid.`, 'log-buy');
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
  if (TUTORIAL.active && player === G.players[0] && !TUTORIAL.isAllowed('burn', { row, col })) {
    TUTORIAL.flashBlocked(); return;
  }
  trajLogBuy(player, 'burn', row, col); // trajectory: before state changes (gates seat/host internally)
  if (MP.active && player === G.players[0]) MP.pushBuyAction('burn', row, col, player._pendingSwap, player.extraBuyUsed ? 2 : 1);
  player._pendingSwap = null;
  if (TUTORIAL.active && player === G.players[0]) TUTORIAL.onActionDone('burn');
  executeBurnLocal(player, row, col);
}

// Returns true if the burn was applied, false if the target cell was already gone
// (a no-op) — see executeBuyLocal's note. mpOpponentBuyTurn advances on a false result.
function executeBurnLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return false;
  clearActions();
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} burned ${cardLabel(slot.card)} ($${slot.card.cost}).`, 'log-burn');
  revealUncovered(G.pyramid);
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push();

  advanceOrExtraBuy(player);
  return true;
}

// --- SWAP CARD (card_4, special 'swap_revealed') ---
// Used during your buy turn, IN ADDITION to your normal buy/burn. You trade Card 4 for any
// face-up card on the table: an available Store card, an opponent's drawn hand card, or the
// top of an opponent's discard. It's a true positional STEAL — the card you take goes into
// your deck (it only scores in a FUTURE round, never the current one, since herds are locked
// at the start of the buy phase); Card 4 takes the exact slot the taken card vacated (back
// into that opponent's hand/discard, or into that Store pyramid cell).

// Build the grouped candidate list for the swap picker. Returns { groups, total }.
// One group for the Store (pyramid) and one per opponent (their hand + discard top).
function gatherSwapCandidates(player) {
  const groups = [];
  let total = 0;
  const pyr = getAvailablePyramidCards(G.pyramid).map(a => ({
    kind: 'pyramid', row: a.row, col: a.col, card: a.slot.card,
  }));
  if (pyr.length) { groups.push({ label: 'Store', items: pyr }); total += pyr.length; }
  G.players.forEach((opp) => {
    if (opp === player) return;
    const items = [];
    opp.hand.forEach((c) => items.push({ kind: 'hand', victimSlot: opp.slotIdx, card: c }));
    if (opp.discard.length) {
      items.push({ kind: 'discard', victimSlot: opp.slotIdx, card: opp.discard[opp.discard.length - 1] });
    }
    if (items.length) { groups.push({ label: opp.name, items }); total += items.length; }
  });
  return { groups, total };
}

// Apply a swap to local game state. Runs identically on every client: the human activator
// applies it locally and rebroadcasts the spec inside their buyAction (MP); AI swaps are
// recomputed deterministically per client (no broadcast). spec = {kind, victimSlot, row, col,
// takenId, card4Uid}. Targets are resolved by stable keys (pyramid row/col; pile by card id)
// so they survive the per-client uid differences. Returns true if applied.
function applySwapLocal(player, spec) {
  // Resolve & validate the target BEFORE mutating, so a stale spec can't half-apply.
  let taken = null, place = null, victimName = null;
  if (spec.kind === 'pyramid') {
    const slot = G.pyramid?.[spec.row]?.[spec.col];
    if (!slot || slot.removed || !slot.card) return false;
    taken = slot.card;
    place = (c4) => { slot.card = c4; };  // Card 4 takes the cell (stays face-up, not removed)
  } else {
    const victim = G.players.find(p => p.slotIdx === spec.victimSlot);
    if (!victim) return false;
    victimName = victim.name;
    const pile = spec.kind === 'hand' ? victim.hand : victim.discard;
    let ti = spec.kind === 'discard' ? pile.length - 1 : -1;
    if (ti < 0 || pile[ti]?.id !== spec.takenId) ti = pile.findIndex(c => c.id === spec.takenId);
    if (ti < 0 || !pile[ti]) return false;
    taken = pile[ti];
    place = (c4) => { pile[ti] = c4; };
  }
  // Resolve Card 4 in the activator's hand by card ID, not uid: uids are per-client
  // counters, so on every client except the activator the spec's uid matches nothing
  // (or worse, collides with an unrelated card) — audit bug C1, which made MP swaps
  // apply only on the activator's client. card4Id is unambiguous (one card_4 per hand).
  // The uid path remains only as a fallback for legacy specs without card4Id.
  const c4idx = spec.card4Id
    ? player.hand.findIndex(c => c.id === spec.card4Id)
    : player.hand.findIndex(c => c.uid === spec.card4Uid);
  if (c4idx < 0) return false;                 // activator no longer holds Card 4
  const card4 = player.hand.splice(c4idx, 1)[0];
  place(card4);                                // true swap: Card 4 fills the vacated slot
  // True positional swap: the taken card takes Card 4's exact spot in your hand (visible in
  // your play area, in draw order). It does NOT re-score this round — herds are locked at the
  // start of the buy phase and the card never runs through applyCardEffects — so at round end
  // it moves to your discard with the rest of your hand (like a bought card) and scores in a
  // future round whenever you next draw it — once your discard reshuffles back into your deck.
  player.hand.splice(c4idx, 0, taken);
  revealUncovered(G.pyramid);
  addLog(`${player.name} used a Swap card to take ${cardLabel(taken)}${victimName ? ` from ${victimName}` : ''}.`, 'log-buy');
  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push();
  return true;
}

// Human-initiated swap: open the grouped picker modal.
function openSwapModal(player, swapCard) {
  const { groups } = gatherSwapCandidates(player);
  const modal = document.getElementById('special-modal');
  const content = document.getElementById('special-modal-content');
  document.getElementById('btn-peek-restore').onclick = () => modal.classList.remove('peeking');
  content.innerHTML =
    '<h2>Swap &mdash; take any face-up card</h2>' +
    '<p class="swap-sub">Your Swap card takes its place. The card you take goes into your hand where the Swap card was &mdash; it scores in a later round when you draw it, not now. You still buy or burn normally this turn.</p>';
  for (const g of groups) {
    const section = document.createElement('div');
    section.className = 'swap-group';
    const h = document.createElement('div');
    h.className = 'swap-group-label';
    h.textContent = g.label;
    section.appendChild(h);
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'modal-cards';
    for (const item of g.items) {
      const el = renderCardEl(item.card, true, 'clickable');
      el.onclick = () => {
        modal.classList.remove('peeking');
        modal.classList.add('hidden');
        const spec = {
          kind: item.kind, victimSlot: item.victimSlot ?? null,
          row: item.row ?? null, col: item.col ?? null,
          takenId: item.card.id, card4Uid: swapCard.uid, card4Id: swapCard.id,
        };
        // Compact string detail — the traj rules validate `detail` as a string ≤20 chars,
        // so passing the spec object made every swap record fail validation and drop.
        // Format: p{row},{col}:{id} | h{victimSlot}:{id} | d{victimSlot}:{id}, with
        // card_N → N and starter_N → sN.
        const shortId = spec.takenId.replace('card_', '').replace('starter_', 's');
        const detail = spec.kind === 'pyramid'
          ? `p${spec.row},${spec.col}:${shortId}`
          : `${spec.kind[0]}${spec.victimSlot}:${shortId}`;
        trajLogSpecial(player, 'swap_revealed', swapCard.id, detail, 'buy');
        if (applySwapLocal(player, spec)) player._pendingSwap = spec; // carried on next buyAction (MP)
        humanBuyTurn(player);
      };
      cardsDiv.appendChild(el);
    }
    section.appendChild(cardsDiv);
    content.appendChild(section);
  }
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => { modal.classList.remove('peeking'); modal.classList.add('hidden'); humanBuyTurn(player); };
  content.appendChild(cancel);
  // Peek at Table — drops the modal's dimming/blur so you can read the board before deciding
  // (mirrors the rearrange-top-3 modal). #btn-peek-restore (bottom bar) brings it back.
  const peekBtn = document.createElement('button');
  peekBtn.className = 'btn btn-secondary modal-peek-btn';
  peekBtn.textContent = 'Peek at Table';
  peekBtn.onclick = () => modal.classList.add('peeking');
  content.appendChild(peekBtn);
  modal.classList.remove('hidden');
}

// --- AI BUY ---

async function aiBuyTurn(ai) {
  // During tutorial the AI passes so the pyramid stays fully scripted
  if (TUTORIAL.active) {
    setMessage(`${ai.name} passes.`);
    await delay(800);
    G.currentBuyerIdx++;
    processBuyTurn();
    return;
  }
  // First buy turn of the round: say why this player goes first (audit F2) \u2014
  // G._buyOrderReason is only set when the first buyer earned the spot.
  setMessage(G.currentBuyerIdx === 0 && G._buyOrderReason
    ? `${ai.name} buys first \u2014 ${G._buyOrderReason}\u2026`
    : `${ai.name} is buying\u2026`);
  clearActions();
  await delay(1000);

  const cfg = AI_PERSONALITIES[ai.personality] || AI_PERSONALITIES.rancher;

  // Highest buy-score reachable at a given dollar budget (mirrors the real buy pick at 4906,
  // incl. reveal bonus). Used to decide whether activating a $-card is worth it.
  const bestScoredAffordable = (avail, budget) => {
    let best = -Infinity;
    for (const a of avail) {
      if ((a.slot.card.cost || 0) > budget) continue;
      const s = scoreCardForAI(a.slot.card, ai) + pyramidRevealBonus(a.row, a.col, cfg.revealBonus);
      if (s > best) best = s;
    }
    return best;
  };

  // Always activate extra_buy if held (free extra action; no condition needed)
  if (!ai.hasExtraBuy) {
    const extraCard = ai.hand.find(c => c.special === 'extra_buy');
    if (extraCard) {
      ai.hand.splice(ai.hand.indexOf(extraCard), 1);
      ai.hasExtraBuy = true;
      addLog(`${ai.name} used a card for extra buy/burn!`, 'log-burn');
    }
  }

  // Activate dollar-producing hand cards if doing so lets the AI buy a HIGHER-SCORED card —
  // not only one it couldn't otherwise afford at all (see AI_FUTURE_IMPROVEMENTS #1).
  for (const tCard of ai.hand.filter(c =>
    c.special === 'burn_to_use' && c.dollars > 0
  )) {
    const bonus = tCard.dollars;
    const avail = getAvailablePyramidCards(G.pyramid);
    const improves = bestScoredAffordable(avail, ai.roundDollars + bonus)
                   > bestScoredAffordable(avail, ai.roundDollars);
    if (improves) {
      ai.hand.splice(ai.hand.indexOf(tCard), 1);
      ai.roundDollars += bonus;
      addLog(`${ai.name} used a card: +$${bonus}.`, 'log-burn');
    }
  }

  // Swap card (card_4): AI grabs the single highest-value AVAILABLE STORE card for free.
  // Restricted to the pyramid (never opponents' hands) so the choice is identical on every
  // client — the pyramid is shared/synced, opponent-hand views may differ. Only swaps when
  // the best Store card clearly beats whatever the AI could already afford this turn.
  const aiSwapCard = ai.hand.find(c => c.special === 'swap_revealed');
  if (aiSwapCard) {
    const avail2 = getAvailablePyramidCards(G.pyramid);
    let target = null, tScore = -Infinity;
    for (const a of avail2) {
      const s = scoreCardForAI(a.slot.card, ai);
      if (s > tScore || (s === tScore && (!target || a.slot.card.cost > target.slot.card.cost))) {
        tScore = s; target = a;
      }
    }
    const bestAffordable = Math.max(0, ...avail2
      .filter(a => a.slot.card.cost <= ai.roundDollars)
      .map(a => scoreCardForAI(a.slot.card, ai)));
    if (target && tScore >= 6 && tScore > bestAffordable) {
      applySwapLocal(ai, {
        kind: 'pyramid', victimSlot: null, row: target.row, col: target.col,
        takenId: target.slot.card.id, card4Uid: aiSwapCard.uid, card4Id: aiSwapCard.id,
      });
    }
  }

  const available = getAvailablePyramidCards(G.pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= ai.roundDollars);

  if (affordable.length > 0) {
    // Score and pick best; add reveal bonus for cards that uncover hidden pyramid slots
    let best = null;
    let bestScore = -Infinity;
    for (const a of affordable) {
      const score = scoreCardForAI(a.slot.card, ai) + pyramidRevealBonus(a.row, a.col, cfg.revealBonus);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    executeBuy(ai, best.row, best.col);
  } else if (available.length > 0) {
    // Burn: denial personalities target the card most valuable to the current leader;
    // all others burn the card with lowest value to themselves.
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
      // Stage-aware: late in the Store, with few cards left, deny the leader's best card
      const actProgress = storeStage() / 3;
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
  if (card.special === 'burn_to_use') score += 2;
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

  if (card.special === 'burn_buy_first') score += 1;
  if (card.special === 'dollar1_other') score -= 0.5;
  if (card.cows < 0) score -= 2;
  const stage = storeStage();  // 1|2|3 from the Store's frontmost live tier (was G.currentAct)
  if (stage === 1) score += card.dollars * (cfg.act1DollarBonus ?? 1);  // early: economy bonus (per personality)
  if (stage === 3) score += card.cows    * (cfg.act3CowBonus    ?? 2);  // late:  cow bonus (per personality)
  return score;
}

// Returns a bonus score for buying a card that would uncover hidden cards above it.
// A card at (row, col) is covered by its children at (row+1, col) and (row+1, col+1).
// So parent A is at (row-1, col) — also covered by sibling (row, col+1).
// And parent B is at (row-1, col-1) — also covered by sibling (row, col-1).
function pyramidRevealBonus(row, col, revealBonus) {
  if (row === 0) return 0;
  const bonus_per_reveal = revealBonus ?? 1.5;
  let bonus = 0;
  // Parent A: (row-1, col), revealed if sibling (row, col+1) is also gone
  if (col < row) {
    const parentA = G.pyramid[row - 1][col];
    if (parentA && !parentA.removed && !parentA.faceUp) {
      const siblingA = G.pyramid[row][col + 1];
      if (!siblingA || siblingA.removed) bonus += bonus_per_reveal;
    }
  }
  // Parent B: (row-1, col-1), revealed if sibling (row, col-1) is also gone
  if (col > 0) {
    const parentB = G.pyramid[row - 1][col - 1];
    if (parentB && !parentB.removed && !parentB.faceUp) {
      const siblingB = G.pyramid[row][col - 1];
      if (!siblingB || siblingB.removed) bonus += bonus_per_reveal;
    }
  }
  return bonus;
}

// --- END PHASES ---

function endBuyPhase() {
  clearForceContinue();
  G.phase = 'score';
  scoreRound();
}

async function scoreRound() {
  // Score cows for non-busted players
  G.players.forEach((player, playerIdx) => {
    if (!player.busted && player.roundCows !== 0) {
      player.herd = Math.max(0, player.herd + player.roundCows);
      const prefix = playerIdx === 0 ? 'player' : `opp-${playerIdx}`;
      // Hidden Herd mode: don't reveal opponents' running totals (or even that they
      // scored) via the log or the bump animation — only the cows-this-round count.
      const concealHerd = G.hiddenHerdMode && playerIdx !== 0;
      if (concealHerd) {
        addLog(`${player.name} adds ${player.roundCows} cows to their herd.`, 'log-score');
      } else {
        addLog(`${player.name} adds ${player.roundCows} cows to herd (total: ${player.herd}).`, 'log-score');
        triggerHerdBump(prefix);
      }
    }
    // Herd-graph capture — OUTSIDE the scoring guard on purpose: a busted or zero-cow
    // player still needs a point this round, or their series goes ragged and the x-axis
    // stops meaning "round". Indexed assignment (not push) keeps index↔round exact and
    // makes this idempotent if endBuyPhase ever double-fires (force-continue edge).
    player.herdHistory[G.roundNumber - 1] = player.herd;
    // player.busted is still set here — resetPlayerRound doesn't clear it until startRound.
    if (player.busted && !player.bustRounds.includes(G.roundNumber)) {
      player.bustRounds.push(G.roundNumber);
    }
  });

  // Move all remaining drawn cards to each player's own discard
  for (const player of G.players) {
    player.discard.push(...player.hand);
    player.hand = [];
  }

  trajLogCanary(); // trajectory: ground-truth herds + pile counts at round end (drift check)

  render();
  if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push(); // spectators see final scores for the round
  await delay(1000);

  // The Store is built once and never rebuilt, so emptying it ends the GAME (there is no
  // act boundary to fall through to any more).
  if (isPyramidEmpty(G.pyramid)) {
    await startShowdown();
  } else {
    G.roundNumber++;
    if (TUTORIAL.active) TUTORIAL.nextRound(G);
    await startRound();
  }
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

  G.showdownTallies = [];

  // Score each player one at a time.
  // Note: special card effects (copy_next, burn_to_use, etc.) do NOT apply here —
  // the showdown counts only each card's raw printed cows/dollars values.
  // The Math.max(0, ...) clamp is now a DEAD GUARD, kept deliberately: no live card has
  // negative Cows (0 of 54 Store cards, 0 of 10 starters — only deprecated card_71 did), so
  // rules.html no longer mentions them at all. Keep the clamp anyway, so reintroducing a
  // negative-Cow card can't silently start subtracting at showdown without a rules update.
  for (const { player, allCards, i } of playerData) {
    const totalCows = allCards.reduce((s, c) => s + Math.max(0, c.cows || 0), 0);

    const oldHerd = player.herd;
    player.herd   = player.herd + totalCows;
    const gained  = player.herd - oldHerd;

    // Herd-graph final point, appended INSIDE this loop on purpose: the loop pushes a
    // spectatorState per player, so appending after it would leave every intermediate
    // snapshot carrying final herds but no final graph point — a rejoiner landing there
    // would reconstruct an inconsistent chart. Index G.roundNumber sits one past the last
    // round, which is what herd-chart.js reads as the Showdown column.
    player.herdHistory[G.roundNumber] = player.herd;

    G.showdownTallies.push({ name: player.name, totalCows, gained, finalHerd: player.herd });

    // Build tally display
    const tallyEl = document.getElementById(`showdown-tally-${i}`);

    tallyEl.innerHTML = totalCows > 0
      ? `<span class="tally-cows">+${totalCows} cows → Final Herd: ${player.herd}</span>`
      : `<span class="tally-zero">No scoring cards → Final Herd: ${player.herd}</span>`;
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
    addLog(`Showdown: ${name} — +${totalCows} cows = ${player.herd} total.`, 'log-score');

    await delay(650);

    // Push live score update so spectators see herds update one by one
    if (MP.active) MP.pushSpectatorState(); else AI_SPEC.push();
  }

  await delay(300);
  // Pause so the last herd bump lands before the winner is crowned, then resolve.
  await delay(500);
  showShowdownResult();
}

// Every card a player owns at the Showdown — what gets laid face-up on the table.
function showdownCollection(player) {
  return [...player.deck, ...player.hand, ...player.discard];
}

// ── Showdown tiebreak ────────────────────────────────────────────────────────
// Deliberately mirrors the buy-order ladder (sim/tiebreaker.js) so players reuse
// ONE mental model: primary resource → wealth → volume.
//   1. most Cows in Herd  2. most $ across your collection  3. most cards
// Unlike the buy-order version this ladder STOPS at step 3 — no card-by-card
// cost walk and no random pick. Players still level after "most cards" genuinely
// share the win, and showShowdownResult still renders that as a tie.
//
// Bandits look like the obvious thematic tiebreak and are a TRAP: only 4 of the
// 54 live Store cards carry any (2 more remove one), so nearly every player's
// Bandits come from the identical 10-card starter deck and the step would almost
// always tie. $ discriminates (28 of 54 Store cards carry $1–4, and identical
// starters mean any difference is purely what you bought).
//
// MP-safe: every input is shared state all clients already agree on — collection
// contents and each card's printed `dollars`. It is exactly what the Showdown
// lays out face-up. Counts PRINTED $ only; one-shot effects don't apply here.
function resolveShowdownWinners(players) {
  let top = players.slice();
  let reason = 'most Cows';

  const narrow = (scoreFn, label) => {
    if (top.length <= 1) return;
    const best = Math.max(...top.map(scoreFn));
    const next = top.filter(p => scoreFn(p) === best);
    if (next.length < top.length) reason = label;
    top = next;
  };

  narrow(p => p.herd, 'most Cows');
  narrow(p => showdownCollection(p).reduce((s, c) => s + (c.dollars || 0), 0), 'most $');
  narrow(p => showdownCollection(p).length, 'most cards');

  return { winners: top, reason };
}

// Crown the winning player's section inline on the showdown screen and reveal the
// action footer (Play Again / Review / Home). Replaces the old separate game-over screen.
function showShowdownResult() {
  G.phase = 'gameOver';
  const me = G.players[0];

  const { winners: topPlayers, reason: winReason } = resolveShowdownWinners(G.players);
  if (topPlayers.length === 1 && winReason !== 'most Cows') {
    addLog(`Herds tied — ${topPlayers[0].name} wins on ${winReason}.`);
  }

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

  document.getElementById('showdown-winner-title').textContent = title;

  // Crown the winning section(s) — sections render in G.players order.
  const sections = document.querySelectorAll('#showdown-players .showdown-player');
  G.players.forEach((p, i) => {
    if (topPlayers.includes(p) && sections[i]) sections[i].classList.add('showdown-winner');
  });

  // Herd graph — one mount point covers BOTH the live showdown and a rejoin into an
  // already-finished game, because gameOver() funnels through here too. Guarded: if
  // herd-chart.js failed to load, or this game predates herdHistory, the container
  // just stays empty rather than showing a blank frame.
  const chartEl = document.getElementById('showdown-chart');
  if (chartEl && window.CFC_HerdChart) {
    window.CFC_HerdChart.render(chartEl, {
      players: G.players,
      round: G.roundNumber,
      phase: G.phase,
      youIndex: 0,
      animate: true, // mounts once here; spectate re-renders per snapshot so it doesn't
    });
  }

  document.getElementById('showdown-footer').classList.remove('hidden');

  const logParts = G.players.map(p => `${p === me ? 'You' : p.name}: ${p.herd}`).join(', ');
  addLog(`Game Over! ${logParts}.`, 'log-score');

  finalizeGame(topPlayers);
}

// Rejoin into an already-finished game: there is no live showdown animation to ride,
// so render the showdown board statically (cards face-up, final herds) then crown + show actions.
function gameOver() {
  const screen = document.getElementById('showdown-screen');
  const playersDiv = document.getElementById('showdown-players');
  const me = G.players[0];

  playersDiv.innerHTML = '';
  document.getElementById('showdown-footer').classList.add('hidden');
  screen.classList.remove('hidden');

  G.players.forEach((player) => {
    const allCards = [...player.deck, ...player.hand, ...player.discard];
    const section = document.createElement('div');
    section.className = 'showdown-player';

    const nameEl = document.createElement('div');
    nameEl.className = 'showdown-player-name';
    nameEl.textContent = player === me ? 'You' : player.name;

    const herdEl = document.createElement('div');
    herdEl.className = 'showdown-player-herd';
    herdEl.innerHTML = `Herd: <strong class="showdown-herd-val">${player.herd}</strong>`;

    const grid = document.createElement('div');
    grid.className = 'showdown-card-grid';
    allCards.forEach(card => {
      const el = renderCardEl(card, true);
      el.onclick = (e) => { e.stopPropagation(); showCardZoom(cardImgSrc(card, true)); };
      grid.appendChild(el);
    });

    section.appendChild(nameEl);
    section.appendChild(herdEl);
    section.appendChild(grid);
    playersDiv.appendChild(section);
  });

  showShowdownResult();
}

// End-of-game bookkeeping (MP cleanup, history log, review link). DOM result display
// lives in showShowdownResult(); this only handles persistence/cleanup.
function finalizeGame(topPlayers) {
  clearLocalGame(); // game over — don't restore this session on next load
  // Capture before AI_SPEC.finish() nulls _code
  const gameCode = MP.active ? (sessionStorage.getItem('mp_code') || null) : (AI_SPEC.code || null);

  if (MP.active) {
    MP.pushSpectatorState(); // spectators see final game-over state
    if (MP.isHost) MP.setLiveStatus('finished'); // remove from live-games list
    MP.clearRejoinInfo();    // game is over — don't offer rejoin from home screen
    MP.cleanup();
  } else {
    AI_SPEC.push();   // spectators see final game-over state
    AI_SPEC.finish(); // remove from live-games list

    if (gameCode && !G.isDebug) {
      const reviewLink = document.getElementById('gameover-review-link');
      const base = location.pathname.replace('playgame.html', '');
      reviewLink.href = `${location.origin}${base}spectate.html?code=${gameCode}&ai=1`;
      reviewLink.classList.remove('hidden');
    }
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
      // actsCompleted is vestigial since the single-Store rework (there are no act
      // boundaries left, so it is always 1). Kept because the rules require the field
      // and old entries carry a meaningful 1-3.
      actsCompleted: G.currentAct,
      totalRounds: G.roundNumber,
      gameV: GAME_V,   // leaderboard on history.html ranks gameV >= 3 only
      gameCode,
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

// --- HEADER HOME LINK ---

// The header brand is a real <a href="index.html"> so middle/cmd-click opens the
// home page in a new tab. This guard only fires for a plain click (which would
// navigate THIS tab away from a live game) — a modified click is left alone
// because the game tab survives it.
function confirmLeaveGame(e) {
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return true;
  if (!G || G.phase === 'gameover' || G.phase === 'showdown') return true;
  const msg = MP.active
    ? 'Leave this game and go back to the home page? The other players will be left waiting.'
    : 'Leave this game and go back to the home page? Your progress will be lost.';
  return confirm(msg);
}

// --- RULES MODAL ---

function showRules() {
  window.open('rules.html', '_blank');
}

function closeRules() {
  // no-op: rules now open in a new tab
}

// --- DECK VIEWER ---

function showDeck() {
  if (!G) return;
  const player = G.players[0];
  const allCards = [...player.deck, ...player.discard, ...player.hand]
    .filter(c => !c._tutorialTemp);

  const body = document.getElementById('deck-modal-body');
  body.innerHTML = '';

  // 2-row × 3-column layout: rows = Starters/Purchased, columns = River/Cactus/Rattlesnake.
  // Suits are not labeled; row label sits on the left.
  function renderRow(label, actFilter) {
    const cards = allCards.filter(actFilter);
    if (cards.length === 0) return;
    const row = document.createElement('div');
    row.className = 'deck-row';
    const rowLabel = document.createElement('div');
    rowLabel.className = 'deck-row-label';
    rowLabel.textContent = label;
    row.appendChild(rowLabel);
    const suitsEl = document.createElement('div');
    suitsEl.className = 'deck-row-suits';
    for (const cacti of [1, 2, 3]) {
      const col = document.createElement('div');
      col.className = 'deck-col';
      for (const card of cards.filter(c => c.cacti === cacti)) {
        const el = renderCardEl(card, true);
        el.dataset.cacti = card.cacti;
        col.appendChild(el);
      }
      suitsEl.appendChild(col);
    }
    row.appendChild(suitsEl);
    body.appendChild(row);
  }

  renderRow('Starters', c => c.act === 0);
  renderRow('Purchased', c => c.act > 0);

  document.getElementById('deck-modal').classList.remove('hidden');
  if (TUTORIAL.active) TUTORIAL.onActionDone('open_deck');
}

function closeDeck() {
  if (TUTORIAL.active && TUTORIAL.deckCloseBlocked()) return;
  document.getElementById('deck-modal').classList.add('hidden');
  if (TUTORIAL.active) TUTORIAL.onActionDone('close_deck');
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

function initHoverDelegation() {
  function attachDelegated(containerEl, getCard) {
    containerEl.addEventListener('mouseover', (e) => {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
      const card = getCard(cardEl);
      if (card) showCardHoverPreview(cardEl, card);
    });
    containerEl.addEventListener('mouseout', (e) => {
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      if (e.relatedTarget && cardEl.contains(e.relatedTarget)) return;
      hideCardHoverPreview();
    });
  }

  attachDelegated(document.getElementById('player-hand'), (el) => {
    if (!G) return null;
    return G.players[0].hand.find(c => c.uid === +el.dataset.uid) || null;
  });

  attachDelegated(document.getElementById('pyramid'), (el) => {
    if (!G) return null;
    const row = +el.dataset.row;
    const col = +el.dataset.col;
    if (isNaN(row) || isNaN(col)) return null;
    const slot = G.pyramid?.[row]?.[col];
    return (slot && slot.faceUp && !slot.removed) ? slot.card : null;
  });

  // Opponent fans live in dynamically-created zones, so delegate on the static
  // #opponents-zone container. uids are globally unique → search every opponent.
  attachDelegated(document.getElementById('opponents-zone'), (el) => {
    if (!G) return null;
    const uid = +el.dataset.uid;
    for (let i = 1; i < G.players.length; i++) {
      const c = G.players[i].hand.find(cc => cc.uid === uid);
      if (c) return c;
    }
    return null;
  });

  // Opponent fans are sized from the live container width, which changes when the
  // window resizes (zones are flex:1 and reflow with player count / viewport).
  let fanResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(fanResizeTimer);
    fanResizeTimer = setTimeout(() => { relayoutOpponentFans(); fitPyramid(); }, 120);
  });
}

// Re-runs the fan layout for every opponent hand from its current DOM cards.
// Pure geometry off the live container width — safe to call on resize.
function relayoutOpponentFans() {
  if (!G) return;
  for (let i = 1; i < G.numPlayers; i++) {
    const handEl = document.getElementById('opp-' + i + '-hand');
    if (handEl) layoutOpponentFan(handEl);
  }
}

// Flat overlap "fan" for an opponent's drawn cards (opp zones only — never the
// local player's hand). Cards spread across up to 3 rows (oldest top-left →
// newest bottom-right); rows are added before any overlap, and only once all 3
// rows are full do the cards start overlapping — tighter as the count grows, so
// nothing is ever clipped or needs a scrollbar. Newest card always sits on top.
function layoutOpponentFan(handEl) {
  const cards = Array.from(handEl.children).filter(el => el.classList.contains('card'));
  const N = cards.length;
  handEl.style.position = 'relative';
  if (N === 0) { handEl.style.height = ''; return; }

  // Card size here must match `.opp-zone .hand .card` in play.css.
  const cardW = 52, cardH = 73, gap = 6, rowGap = 6;
  let W = handEl.clientWidth;
  if (!W) {
    // Not laid out yet (clientWidth reads 0 before first layout settles) — borrow
    // the container's width; relayoutOpponentFans re-runs once layout settles.
    // NOT a fixed 240px: in the 5-8P grid the cell is ~90px, so 240 laid the fan
    // out wider than the cell and overflow:hidden clipped the whole hand away.
    W = (handEl.parentElement && handEl.parentElement.clientWidth) || 240;
  }
  // Never compute against less than one card — keeps the overlap math valid. A
  // cell narrower than a single card clips by ~(cardW − cell) at most, by design.
  W = Math.max(W, cardW);

  const perRowNoOverlap = Math.max(1, Math.floor((W + gap) / (cardW + gap)));
  // Prefer adding rows (up to 3) over overlapping — "spread evenly across rows".
  const rows = Math.min(3, Math.max(1, Math.ceil(N / perRowNoOverlap)));

  // Distribute cards across the rows, earlier (upper) rows taking any remainder
  // so the oldest cards sit top-left and the newest end bottom-right.
  const base = Math.floor(N / rows);
  const rem  = N % rows;
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const k = base + (r < rem ? 1 : 0);
    const top = r * (cardH + rowGap);
    const fullWidth = k * cardW + (k - 1) * gap;
    let step, startX;
    if (fullWidth <= W) {
      step = cardW + gap;
      startX = 0;                        // left-anchor so draw order reads left→right
    } else {
      step = (W - cardW) / (k - 1);     // overlap to fit exactly → tightens as k grows
      startX = 0;
    }
    for (let c = 0; c < k; c++, idx++) {
      const el = cards[idx];
      el.style.position = 'absolute';
      el.style.left = (startX + c * step) + 'px';
      el.style.top = top + 'px';
      el.style.zIndex = String(idx);    // global draw order → newest on top everywhere
    }
  }
  handEl.style.height = (rows * cardH + (rows - 1) * rowGap) + 'px';
}

function showCardHoverPreview(cardEl, card) {
  // Hover-capable pointers only. On touch, a tap fires mouseover but mouseleave is
  // unreliable (especially when the hovered card is removed by the buy that follows),
  // leaving the preview stuck over half the screen. The tap→confirm dialog already
  // shows a big card on mobile, so nothing is lost by skipping this.
  if (!window.matchMedia('(hover: hover)').matches) return;
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
  if (top < 8) top = 8;   // never clip the preview off the top of the viewport
  preview.style.left = left + 'px';
  preview.style.top = top + 'px';
  preview.classList.remove('hidden');
}

function hideCardHoverPreview() {
  document.getElementById('card-hover-preview').classList.add('hidden');
}

// --- COLLAPSIBLE SECTIONS ---

// Opponent hand visibility is remembered independently per viewport (wide vs
// mobile), session-only \u2014 no persistence across reloads. Defaults: expanded on
// wide screens, collapsed on mobile. Crossing the breakpoint shows whatever the
// other bucket is currently set to. Collapse itself reuses the existing
// `.collapsed` class (max-height/opacity/padding/transition already styled);
// this only decides which opponent zones carry it.
const OPP_HANDS_MQ = window.matchMedia('(max-width: 768px)');
const oppHandsPref = { wide: 'open', mobile: 'closed' };
function oppHandsBucket() { return OPP_HANDS_MQ.matches ? 'mobile' : 'wide'; }
// Apply the current viewport bucket's preference to every opponent zone.
function applyOppHands() {
  if (typeof G === 'undefined' || !G || !G.numPlayers) return;
  const collapsed = oppHandsPref[oppHandsBucket()] === 'closed';
  for (let j = 1; j < G.numPlayers; j++) {
    const detail = document.getElementById('opp-' + j + '-detail');
    const toggle = document.getElementById('opp-' + j + '-toggle');
    if (!detail) continue;
    detail.classList.toggle('collapsed', collapsed);
    if (toggle) toggle.textContent = collapsed ? '\u25bc' : '\u25b2';
  }
}
// Clicking any opponent header toggles all opponent hands for the current viewport only.
function toggleOppZone() {
  const b = oppHandsBucket();
  oppHandsPref[b] = oppHandsPref[b] === 'open' ? 'closed' : 'open';
  applyOppHands();
}
OPP_HANDS_MQ.addEventListener('change', applyOppHands);

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
          '<span class="herd-number-wrap" id="' + prefix + '-herd-wrap">' +
            '<strong id="' + prefix + '-herd" class="herd-number">0</strong>' +
            '<span class="herd-gap" id="' + prefix + '-herd-gap"></span>' +
            '<span class="herd-dust" id="' + prefix + '-herd-dust"></span>' +
          '</span>' +
        '</span>' +
        '<span class="deck-display">Deck: <strong id="' + prefix + '-deck-count">10</strong></span>' +
        '<span id="' + prefix + '-round-stats-inline" class="ai-inline-stats hidden">' +
          '<span class="sep">|</span>' +
          '$<strong id="' + prefix + '-round-dollars">0</strong>' +
          '<span class="hud-stat-icon-wrap"><img src="assets/symbols/hud-cow.png" class="hud-stat-icon" alt="Cows"><strong id="' + prefix + '-round-cows">0</strong></span>' +
          '<span class="hud-stat-icon-wrap"><img src="assets/symbols/hud-bandit.png" class="hud-stat-icon" alt="Bandits"><strong id="' + prefix + '-round-bandits">0</strong></span>' +
        '</span>' +
      '</div>' +
      '<span id="' + prefix + '-toggle" class="collapse-toggle">▼</span>' +
    '</div>' +
    '<div id="' + prefix + '-detail" class="collapsible">' +
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
  // Load backs and starters immediately — needed before first render.
  const eager = new Set();
  for (const back of Object.values(CACTI_BACK)) eager.add(BACK_IMG_PATH + back);
  for (const tmpl of STARTER_TEMPLATES) eager.add(CARD_IMG_PATH + tmpl.img);
  for (const src of eager) { const img = new Image(); img.src = src; }

  // Defer store card images until the browser is idle.
  const deferred = STORE_CARDS.map(c => CARD_IMG_PATH + c.img).filter(s => !eager.has(s));
  const load = typeof requestIdleCallback === 'function' ? requestIdleCallback : setTimeout;
  load(() => { for (const src of deferred) { const img = new Image(); img.src = src; } });
}

// --- DEBUG SCENARIOS ---

function applyDebugScenario(name) {
  const DEBUG_SEED = 12345;

  // Returns a deck with `specialId` first, then 9 starter cards
  function debugDeck(specialId) {
    const special = specialId ? getCardById(specialId) : null;
    const starters = STARTER_TEMPLATES.slice(0, 9).map(t => createCardInstance(t));
    return special ? [special, ...starters] : starters;
  }

  // Leaves `keep` cards in the BACKMOST row (row 0 = the Act 3 tier) and clears everything
  // in front of them — the real end-of-game shape, since play eats the Store front-to-back.
  // Row 0 is uncovered once the rows below are gone, so all `keep` cards are buyable and
  // storeStage() reads 3. (The old version kept the front 3 ROWS, which was ~6 cards on the
  // retired triangle Store but is 27 on the single Store — nowhere near a showdown.)
  function nearEndPyramid(pyramid, keep = 6) {
    for (let r = 0; r < pyramid.length; r++) {
      for (let c = 0; c < pyramid[r].length; c++) {
        pyramid[r][c].removed = !(r === 0 && c < keep);
        pyramid[r][c].faceUp = true;
      }
    }
    revealUncovered(pyramid);
  }

  // Exactly one card left, in the back row. Buying it empties the Store → showdown.
  function oneCardPyramid(pyramid) {
    nearEndPyramid(pyramid, 1);
  }

  // Back-fills a per-round herd ramp so the end-of-game herd chart (src/herd-chart.js) has a
  // real series to draw. scoreRound only writes the CURRENT round, so a scenario that jumps
  // straight to round N must supply rounds 1..N-1 itself — without this the chart renders a
  // full N-round axis with nothing plotted. One staggered bust per player gives the ✕ marks
  // (and the flat segment they explain) something to land on.
  function seedHerdHistory(players, rounds) {
    players.forEach((p, i) => {
      const bustRound = 2 + (i % 3);        // staggered so the ✕ marks don't overlap
      const scoring = Math.max(1, rounds - 2);  // rounds 1..N-1, minus the one that busted
      let herd = 0;
      p.bustRounds = [bustRound];
      p.herdHistory = [];
      for (let r = 1; r < rounds; r++) {
        if (r !== bustRound) herd = Math.min(p.herd, herd + Math.round(p.herd / scoring));
        p.herdHistory[r - 1] = herd;
      }
    });
  }

  // Returns a deck: [copy_next (card_20), donor card, ...padding starters]
  function makeCopyNextScenario(donorId, extraDeckIds) {
    const baseOrder = ['card_20', donorId, ...(extraDeckIds || [
      'starter_91', 'starter_92', 'starter_93', 'starter_94',
      'starter_91', 'starter_92', 'starter_93', 'starter_94',
    ])];
    const players = [createPlayer('You', true, 0), createPlayer('Cowboy AI', false, 1)];
    players[0].deck = baseOrder.map(id => getCardById(id)).filter(Boolean);
    G = initState(2, players);
    G.roundNumber = 1;
    G.gameSeed = DEBUG_SEED;
    G.pyramid = buildPyramid();
    initAiRng(1, DEBUG_SEED);
  }

  // NOTE: there is no `act` argument. The Store is built ONCE with all three act tiers
  // (single-Store rework, July 2026), so every scenario starts at storeStage() 1 with the
  // Act 1 tier on offer — there is no way to start "in Act 2". The old `act` parameter was
  // inert and its callers' "Act N" labels were fiction; both are gone.
  function makeSpecialScenario(specialCardId, extraNames) {
    const numPlayers = extraNames ? extraNames.length + 1 : 2;
    const players = [createPlayer('You', true, 0)];
    players[0].deck = debugDeck(specialCardId);
    const aiNames = extraNames || ['Cowboy AI'];
    for (let i = 0; i < aiNames.length; i++) {
      players.push(createPlayer(aiNames[i], false, i + 1));
    }
    G = initState(numPlayers, players);
    G.roundNumber = 1;
    G.gameSeed = DEBUG_SEED;
    G.pyramid = buildPyramid();
    for (let i = 1; i < numPlayers; i++) initAiRng(i, DEBUG_SEED);
  }

  const AI3 = ['Buffalo Bill', 'Jesse James', 'Wild Mary'];
  const AI7 = ['Buffalo Bill', 'Jesse James', 'Wild Mary', 'Doc Holliday',
               'Annie Oakley', 'Black Bart', 'Calamity Jane'];

  // 20 bandit-free cards (mixed suits/values, all LIVE) → a deck nobody can bust on, so
  // every seat can draw its whole deck into hand. Used by the 8-player stress scenario.
  const NO_BANDIT_POOL = [
    'starter_91', 'starter_92', 'starter_93', 'starter_94', 'starter_61', 'starter_33',
    'card_79', 'card_80', 'card_48', 'card_49', 'card_28', 'card_29',
    'card_88', 'card_90', 'card_52', 'card_53', 'card_26', 'card_70', 'card_74', 'card_54',
  ];
  function noBanditDeck() {
    return NO_BANDIT_POOL.map(id => getCardById(id)).filter(Boolean);
  }

  // 20 bandit-free, money-free (cows only) cards, all LIVE. An AI holding these banks $0 all
  // round, so it never reaches its dollar target (dollarBuffer) and keeps drawing to the hard
  // hand cap in aiShouldDraw (cfg.maxDraw — 10 for every Hard bot, incl. the default rancher)
  // instead of stopping early. The money-free deck alone does this; it does NOT depend on the
  // Store being expensive (the front row on offer is the CHEAP Act 1 tier, cost 2-5).
  const NO_MONEY_POOL = [
    'card_79', 'card_80', 'card_48', 'card_49', 'card_28', 'card_29',
    'card_88', 'card_58', 'card_59', 'card_32', 'card_28', 'card_29',
    'card_58', 'card_88', 'card_32', 'card_48', 'card_79', 'card_59', 'card_49', 'card_80',
  ];
  function noMoneyDeck() {
    return NO_MONEY_POOL.map(id => getCardById(id)).filter(Boolean);
  }

  // 2P with a stacked human deck, drawn in the given order (the human deck is NOT shuffled
  // at deal, so position N in the array is the Nth card you draw).
  function stackedDeck(order) {
    const players = [createPlayer('You', true, 0), createPlayer('Cowboy AI', false, 1)];
    players[0].deck = order.map(id => getCardById(id)).filter(Boolean);
    G = initState(2, players);
    G.roundNumber = 1;
    G.gameSeed = DEBUG_SEED;
    G.pyramid = buildPyramid();
    initAiRng(1, DEBUG_SEED);
  }

  // Shared setup for the two end-of-game scenarios: 4P, round 9, competitive herds, and a
  // back-filled herdHistory so the showdown herd chart has a real series to draw.
  function makeEndGame(rounds = 9) {
    const names = ['Buffalo Bill', 'Jesse James', 'Wild Mary'];
    const herds = [32, 29, 35, 28];
    const players = [createPlayer('You', true, 0), ...names.map((n, i) => createPlayer(n, false, i + 1))];
    players.forEach((p, i) => { p.herd = herds[i]; });
    seedHerdHistory(players, rounds);
    G = initState(4, players);
    G.roundNumber = rounds;
    G.gameSeed = DEBUG_SEED;
    G.pyramid = buildPyramid();
    for (let i = 1; i <= 3; i++) initAiRng(i, DEBUG_SEED);
  }

  const SCENARIOS = {
    // 6 cards left in the back (Act 3) row — a couple of rounds from the Store emptying.
    near_showdown() {
      makeEndGame();
      nearEndPyramid(G.pyramid, 6);
    },

    // Maximum-on-screen stress test: 8 players (you + 7 AI) on a full 99-card Store
    // (11 wide × 9 rows). Nobody can bust (bandit-free decks). The human holds a varied
    // 20-card deck and draws it all manually. The AI seats hold money-free (cows only)
    // decks, so they bank $0, never reach their dollar target, and draw to the hard hand
    // cap in aiShouldDraw (cfg.maxDraw = 10 for the default rancher). Exercises the 8P
    // opponent rail, pyramid fit/scaling, and big hand fans at once. (The cap is core AI
    // logic, so a ~20-card hand is human-only.)
    stress_8p() {
      const players = [createPlayer('You', true, 0),
                       ...AI7.map((n, i) => createPlayer(n, false, i + 1))];
      players[0].deck = noBanditDeck();
      for (let i = 1; i < players.length; i++) players[i].deck = noMoneyDeck();
      G = initState(8, players);
      G.roundNumber = 1;
      G.gameSeed = DEBUG_SEED;
      G.pyramid = buildPyramid();
      for (let i = 1; i <= 7; i++) initAiRng(i, DEBUG_SEED);
    },

    // --- LIVE mechanics (cards that can still be dealt) ---
    special_burn_to_use()        { makeSpecialScenario('card_77'); },  // Explosive $2, River
    special_burn_to_use_card16() { makeSpecialScenario('card_16'); },  // Explosive $3, Rattlesnake
    special_burn_to_use_card22() { makeSpecialScenario('card_22'); },  // Explosive $3, Rattlesnake

    // --- RETIRED mechanics: every card below is `deprecated: true` and can never be dealt.
    // Kept as the pre-deletion regression harness (docs/DEAD_CODE_INVENTORY.md) — run the
    // scenario, then delete it together with its mechanic. getCardById still resolves
    // deprecated cards, which is why they run at all.
    special_2cow_if_first()      { makeSpecialScenario('card_15'); },
    special_burn_buy_first()     { makeSpecialScenario('card_14'); },
    special_look3_rearrange()    { makeSpecialScenario('card_19'); },
    special_copy_next()          { makeSpecialScenario('card_20'); },
    special_extra_buy()          { makeSpecialScenario('card_21'); },
    special_replay_discard()     { makeSpecialScenario('card_23'); },
    special_dollar1_other()      { makeSpecialScenario('card_24'); },
    special_swap_revealed()      { makeSpecialScenario('card_4', AI3); },
    special_look3_immediate()    { makeSpecialScenario('card_31'); },

    // RETIRED (card_4 is deprecated). Full Swap test — 4P, since card_4 was 4P-only. You draw
    // card_4 first (the human deck isn't shuffled at deal). Each opponent's discard is
    // pre-seeded with a cow card so the discard-top swap source is testable immediately
    // (opponents otherwise start round 1 with an empty discard); their hands fill from their
    // own draws. So all three swap sources are exercisable: Store, opponent hand, discard top.
    // Draw card_4, Stop, then use "Swap Card 4" on your buy turn.
    swap_card() {
      const players = [createPlayer('You', true, 0), ...AI3.map((n, i) => createPlayer(n, false, i + 1))];
      players[0].deck = debugDeck('card_4'); // card_4 on top, drawn immediately
      for (let i = 1; i < players.length; i++) {
        players[i].discard = [createCardInstance(getCardById('card_28'))]; // 3 cows → discard-top target
      }
      G = initState(4, players);
      G.roundNumber = 1;
      G.gameSeed = DEBUG_SEED;
      G.pyramid = buildPyramid();
      for (let i = 1; i <= 3; i++) initAiRng(i, DEBUG_SEED);
    },

    // Store down to a single available card, in the back (Act 3) row. Buy it to empty the
    // Store and trigger the showdown immediately — the quick way to test the showdown
    // sequence, the tiebreak ladder, and the end-of-game herd chart.
    one_card_showdown() {
      makeEndGame();
      oneCardPyramid(G.pyramid);
    },

    // Same as one_card_showdown but with Hidden Herd mode on — opponents' herds show as
    // "?" until the showdown reveal. Tests the hidden-herd concealment + reveal path.
    // This is the ONLY way to enable Hidden Herd now that gamesetup no longer offers it
    // (see CLAUDE.md "Game Mode / Setup Flags") — keep it.
    one_card_showdown_hidden() {
      SCENARIOS.one_card_showdown();
      G.hiddenHerdMode = true;
    },

    // Tests buy-phase Explosive dollar activation.
    // Deck is stacked: draw starter ($1), starter ($1), then card_77 (burn_to_use +$2, $0 on draw).
    // Stop after drawing all three — you'll have $2 and card_77 in hand.
    // Can't afford a $4 cow card (card_79/80) yet; activate card_77 in buy phase to reach $4.
    buy_phase_burn_to_use() {
      stackedDeck([
        'starter_91',  // $1
        'starter_92',  // $1 → $2 total; not enough for $4 cards
        'card_77',     // burn_to_use +$2 (gives $0 on draw — hold it for buy phase)
        'starter_93', 'starter_94', 'starter_91', 'starter_92', 'starter_93',
        'starter_94', 'starter_91',
      ]);
    },

    // Tests buy-phase activation with every dollar-producing card in hand at once.
    // 4 activatable Explosives: card_77/78 (+$2 each) + card_16/22 (+$3 each) = up to +$10.
    // They all give $0 on draw, so the only way to reach the back rows' expensive cards is
    // to Use them during the buy phase.
    buy_phase_all_activatable() {
      stackedDeck([
        'card_77',     // Explosive +$2 ($0 on draw)
        'card_78',     // Explosive +$2 ($0 on draw)
        'card_16',     // Explosive +$3 ($0 on draw)
        'card_22',     // Explosive +$3 ($0 on draw)  → up to +$10
        'starter_91', 'starter_92', 'starter_93', 'starter_94', 'starter_91', 'starter_92',
      ]);
    },

    // Plain Draw 4 (card_54, LIVE). 4 mandatory draws resolved one at a time through the
    // normal flow: "Stop" is hidden while forcedDraws > 0 and returns once it hits 0.
    // Only 1 bandit total, so it always completes — this is the happy path, not a bust test.
    draw4_basic() {
      stackedDeck([
        'card_54',    // 3 cows + Draw 4 → 4 mandatory draws
        'starter_91', // forced 1: $1
        'card_79',    // forced 2: 1 cow
        'starter_92', // forced 3: $1
        'card_30',    // forced 4: 4 cows + 1 bandit
        'starter_93', 'starter_94', 'card_48', 'starter_91', 'starter_92',
      ]);
    },

    // Draw-4 CHAINING — the live edge case (rules.html documents it). A Draw 4 pulled during
    // another Draw 4's forced draws decrements once and THEN adds 4, so the obligation stacks
    // instead of resetting. Watch the "N mandatory draws left" counter: 4 → 3 → 6.
    draw4_chain() {
      stackedDeck([
        'card_54',    // Draw 4 → 4 forced
        'starter_91', // forced 1 → 3 left
        'card_54',    // forced 2 → decrements to 2, then +4 → 6 left
        'starter_92', 'starter_93', 'starter_94', 'card_79', 'card_80', 'starter_91', 'starter_92',
      ]);
    },

    // Cards 84/85 (LIVE, new in gameV 3): PASSIVE −1 Bandit + Draw 4 — not Explosives, so
    // there is nothing to activate; the bandit comes off automatically on draw. Sit at 2
    // bandits, draw card_84 to drop to 1 and owe 4, then chain into card_85 mid-obligation.
    draw4_minus_bandit() {
      stackedDeck([
        'card_43',    // 2 bandits (one more busts you)
        'card_84',    // −1 bandit → 1, and Draw 4
        'card_30',    // forced 1: 4 cows + 1 bandit → back to 2
        'starter_91', // forced 2
        'card_85',    // forced 3: −1 bandit → 1, and chains +4 → 5 left
        'starter_92', 'starter_93', 'starter_94', 'card_79', 'card_80',
      ]);
    },

    // RETIRED (card_50 is deprecated). Draw into "Draw 4" holding 2 bandits with a
    // burn-to-use "−1 bandit" jail card as the first forced draw — the activate-before-bust
    // window (bug #12). Every live Explosive is now a pure dollar card, so nothing reachable
    // exercises this any more; the mechanic is kept in case a jail card is ever un-deprecated.
    draw4_jail_2bandits() {
      stackedDeck([
        'card_17',    // 1 bandit
        'card_60',    // 1 bandit   → 2 bandits banked before Draw 4
        'card_54',    // Draw 4
        'card_50',    // burn-to-use -1 bandit (the "right after" card)
        'card_30',    // 1 bandit
        'starter_91', // safe $1
        'starter_94', // safe $1
        'card_43',    // 2 bandits — lethal on the last forced draw unless the jail card is used
      ]);
    },

    // Copy Next → burn_to_use jail (-1 bandit): both Copy Next card and the jail card
    // become activatable independently. Draw card_20, then card_50 — no bandits applied
    // at draw time. Then 2 bandits follow, but you hold two separate -1 bandit activations:
    // use both to cancel them and keep drawing safely.
    copy_next_jail() {
      makeCopyNextScenario('card_50', [
        'card_17',    // 1 bandit
        'card_60',    // 1 bandit → 2 total; hold both jails to cancel them
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_94',
      ]);
    },

    // Copy Next → burn_to_use dollar (+$2): both become activatable for $2 each.
    // Draw card_20, then card_77 (burn_to_use $2, $0 on draw) — both sit in hand ready
    // to activate for $2 apiece during buy phase → up to $4 from two activations.
    copy_next_dollar() {
      makeCopyNextScenario('card_77', [
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_91',
        'starter_92',
        'starter_93',
      ]);
    },

    // Copy Next → burn_to_use ($3 Explosive, $0 on draw): Copy Next card becomes a second
    // independent Explosive copy. Each can be used for +$3 in the buy/draw phase, for a
    // combined +$6 from both copies (2× the card's $3 value).
    copy_next_burn_to_use() {
      makeCopyNextScenario('card_16', [
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_91',
        'starter_92',
        'starter_93',
      ]);
    },

    // Copy Next → burn_buy_first: Copy Next card becomes a second "Use for Priority" you
    // can activate independently. Use either (or both) during draw phase to gain buy priority.
    copy_next_priority() {
      makeCopyNextScenario('card_14', [
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_91',
        'starter_92',
        'starter_93',
      ]);
    },

    // Copy Next → look3_rearrange: Copy Next becomes a second "Peek at Top 3" you can
    // activate. Use either during draw phase to view and re-order the top 3 deck cards.
    copy_next_look3() {
      makeCopyNextScenario('card_19', [
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_91',
        'starter_92',
        'starter_93',
      ]);
    },

    // Copy Next → replay_discard: Copy Next becomes a second "Use & Replay". Discard is
    // pre-seeded with a cow card and a dollar card so the replay modal has meaningful options.
    copy_next_replay() {
      makeCopyNextScenario('card_23', [
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_91',
        'starter_92',
        'starter_93',
      ]);
      // Seed discard with cards worth replaying
      const replayable = ['card_79', 'card_74', 'card_16'].map(id => getCardById(id)).filter(Boolean);
      G.players[0].discard.push(...replayable);
    },

    // Copy Next → extra_buy: Copy Next becomes a second "1 Extra Buy/Burn" activation.
    // Both can be used independently during draw phase for a bonus buy/burn each.
    copy_next_extra_buy() {
      makeCopyNextScenario('card_21', [
        'starter_91',
        'starter_92',
        'starter_93',
        'starter_91',
        'starter_92',
        'starter_93',
      ]);
    },

    // Copy Next → Draw 4: Copy Next doubles the forced draws (4 → 8). Stats also doubled
    // (3 cows → 6). Deck is stacked with 2 bandits at positions 3 and 7 of the 8 forced
    // draws, so the jail card (card_50) at position 4 is critical — activate it between
    // draws to avoid busting on the second bandit before the 8 draws are done.
    copy_next_draw4() {
      stackedDeck([
        'card_20',    // Copy Next → arms copyNextActive
        'card_54',    // Draw 4 → 6 cows (doubled) + 8 forced draws
        'starter_91', // forced draw 1: safe $1
        'card_17',    // forced draw 2: 1 bandit (1 total)
        'card_50',    // forced draw 3: burn_to_use −1 bandit (activate between draws!)
        'starter_92', // forced draw 4: safe $1
        'starter_93', // forced draw 5: safe $1
        'card_60',    // forced draw 6: 1 bandit (1 or 2 total depending on jail use)
        'starter_94', // forced draw 7: safe $1
        'starter_91', // forced draw 8: safe $1
      ]);
    },

    // Copy Next → Copy Next → regular card: chaining two Copy Nexts in a row.
    // Drawing the second card_20 while copyNextActive "doubles" the first Copy Next
    // (which has no stats, so no visible effect) then resets copyNextActive — meaning
    // the THIRD card drawn gets doubled. Demonstrates that chaining through a second
    // Copy Next re-arms the doubling for the next card.
    copy_next_chain() {
      stackedDeck([
        'card_20',    // first Copy Next → activates copyNextActive
        'card_20',    // second Copy Next consumed as donor → re-arms copyNextActive
        'card_79',    // 1 cow (regular) → drawn with multiplier=2 → 2 cows
        'starter_91', 'starter_92', 'starter_93', 'starter_91', 'starter_92', 'starter_93',
      ]);
    },
  };

  const fn = SCENARIOS[name];
  if (!fn) {
    // Do NOT fall through. startGame's debug branch skips setupStore(), so continuing here
    // starts an unplayable 0-row-Store game that is ALSO not flagged isDebug — meaning it
    // writes gameHistory/liveSummary/traj records like a real game. Returning false makes
    // the caller stop cleanly instead. This fires when debug.html and SCENARIOS drift apart.
    console.error(`Unknown debug scenario "${name}". Known:`, Object.keys(SCENARIOS).sort().join(', '));
    return false;
  }
  fn();
  G.isDebug = true;
  addLog(`[DEBUG] Scenario: ${name}`, 'log-score');
  return true;
}

// --- INIT ---
preloadImages();
initHoverDelegation();
startGame().catch(e => {
  console.error('Game init failed:', e);
  setMessage('Failed to start game. Please refresh.');
});

// determineBuyWinner is defined in sim/tiebreaker.js (loaded before this script)
