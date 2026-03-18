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

    // Watch every other human slot for connection drops
    for (let s = 0; s < _numPlayers; s++) {
      if (s === mySlot || !_slotDefs[s] || !_slotDefs[s].isHuman) continue;
      const slotIdx = s;
      const playerName = _slotDefs[slotIdx].name || `Player ${slotIdx + 1}`;
      const unsub = fbOnValue(gameRef(`slots/${slotIdx}/connected`), (snap) => {
        const connected = snap.val();
        if (connected === false) {
          // Start 15-second grace period before declaring game over
          if (!disconnectTimers[slotIdx]) {
            setMessage(`${playerName} lost connection. Waiting 15 seconds…`);
            disconnectTimers[slotIdx] = setTimeout(() => {
              delete disconnectTimers[slotIdx];
              showDisconnectMessage(playerName);
            }, 15000);
          }
        } else if (connected === true) {
          // Reconnected within grace period — cancel timer and resume silently
          if (disconnectTimers[slotIdx]) {
            clearTimeout(disconnectTimers[slotIdx]);
            delete disconnectTimers[slotIdx];
            // Restore game message via render (it will re-set the appropriate message)
            render();
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
      _slotDefs[i] = { name: s.name || `Player ${i + 1}`, isHuman: s.isHuman !== false };
    }
    return { slotDefs: _slotDefs, gameSeed: _gameSeed, numPlayers: _numPlayers };
  }

  // Push local player's full draw state (hand + deck + stats) after every draw action
  async function pushDrawState(player) {
    if (!initialized) return;
    await fbSet(gameRef(`drawState/${mySlot}`), {
      hand: player.hand.map(c => c.id),
      deck: player.deck.map(c => c.id),
      dollars: player.roundDollars,
      cows: player.roundCows,
      bandits: player.roundBandits,
      busted: player.busted,
      stoppedDrawing: player.stoppedDrawing,
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

  function cleanup() {
    unsubscribers.forEach(u => u && u());
    unsubscribers = [];
    // Cancel all pending grace-period timers
    Object.values(disconnectTimers).forEach(t => clearTimeout(t));
    disconnectTimers = {};
    // Cancel server-side onDisconnect handler so normal navigation doesn't fire it
    if (initialized && dbRef) {
      fbOnDisconnect(gameRef(`slots/${mySlot}/connected`)).cancel();
    }
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
    pushSpectatorState,
    cleanup,
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

// --- STARTERS (IDs 26-29 River, 54-57 Rattlesnake, 93-94 Cactus) ---
// River=1 cacti, Cactus=2 cacti, Rattlesnake=3 cacti
const STARTER_TEMPLATES = [
  { id: 'starter_26', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_26.jpg' },
  { id: 'starter_27', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_27.jpg' },
  { id: 'starter_28', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_28.jpg' },
  { id: 'starter_29', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Cards_29.jpg' },
  { id: 'starter_54', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Cards_54.jpg' },
  { id: 'starter_55', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Cards_55.jpg' },
  { id: 'starter_56', dollars: 0, cows: 2, bandits: 2, cacti: 3, count: 1, img: 'Cards_56.jpg' },
  { id: 'starter_57', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1, img: 'Cards_57.jpg' },
  { id: 'starter_93', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1, img: 'Cards_93.jpg' },
  { id: 'starter_94', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 1, img: 'Cards_94.jpg' },
];

// --- STORE CARDS (all player counts; minPlayers field controls inclusion) ---
// Derived from CSV. Color→Cacti: River(Blue)=1, Cactus(Yellow)=2, Rattlesnake(Red)=3
// minPlayers: 2=all, 3=3+P games, 4=4+P games only
const STORE_CARDS = [
  // --- ACT 1 (Tier 1) ---
  // River (Blue) – 1 cacti  [2P: IDs 8-14]
  { id: 'card_8',  img: 'Cards_8.jpg',  act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_9',  img: 'Cards_9.jpg',  act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_10', img: 'Cards_10.jpg', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_11', img: 'Cards_11.jpg', act: 1, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 4, cacti: 1, special: 'trash_to_use' },
  { id: 'card_12', img: 'Cards_12.jpg', act: 1, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'discard_to_player' },
  { id: 'card_13', img: 'Cards_13.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_14', img: 'Cards_14.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [3+P: IDs 1-2]
  { id: 'card_1',  img: 'Cards_1.jpg',  act: 1, minPlayers: 3, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_2',  img: 'Cards_2.jpg',  act: 1, minPlayers: 3, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [4+P: IDs 3-4]
  { id: 'card_3',  img: 'Cards_3.jpg',  act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_4',  img: 'Cards_4.jpg',  act: 1, minPlayers: 4, dollars: 3, cows:  0, bandits:  0, cost: 4, cacti: 1, special: 'trash_to_use' },
  // Rattlesnake (Red) – 3 cacti  [2P: IDs 40-42]
  { id: 'card_40', img: 'Cards_40.jpg', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_41', img: 'Cards_41.jpg', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_42', img: 'Cards_42.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [3+P: IDs 30-31]
  { id: 'card_30', img: 'Cards_30.jpg', act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_31', img: 'Cards_31.jpg', act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [4+P: ID 34]
  { id: 'card_34', img: 'Cards_34.jpg', act: 1, minPlayers: 4, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P: IDs 69-75]
  { id: 'card_69', img: 'Cards_69.jpg', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_70', img: 'Cards_70.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_71', img: 'Cards_71.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_72', img: 'Cards_72.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_73', img: 'Cards_73.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_buy_burn_first' },
  { id: 'card_74', img: 'Cards_74.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },
  { id: 'card_75', img: 'Cards_75.jpg', act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 2, special: null },
  // Cactus (Yellow) – 2 cacti  [4+P: IDs 59-62]
  { id: 'card_59', img: 'Cards_59.jpg', act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_60', img: 'Cards_60.jpg', act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_61', img: 'Cards_61.jpg', act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },
  { id: 'card_62', img: 'Cards_62.jpg', act: 1, minPlayers: 4, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 2, special: null },

  // --- ACT 2 (Tier 2) ---
  // River (Blue) – 1 cacti  [2P: IDs 15-18]
  { id: 'card_15', img: 'Cards_15.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_16', img: 'Cards_16.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_17', img: 'Cards_17.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_18', img: 'Cards_18.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti  [2P: IDs 43-47]
  { id: 'card_43', img: 'Cards_43.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost: 4, cacti: 3, special: null },
  { id: 'card_44', img: 'Cards_44.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'trash_to_use' },
  { id: 'card_45', img: 'Cards_45.jpg', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_46', img: 'Cards_46.jpg', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_47', img: 'Cards_47.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost: 5, cacti: 3, special: 'draw4' },
  // Rattlesnake (Red) – 3 cacti  [3+P: IDs 32-33]
  { id: 'card_32', img: 'Cards_32.jpg', act: 2, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_33', img: 'Cards_33.jpg', act: 2, minPlayers: 3, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'trash_to_use' },
  // Rattlesnake (Red) – 3 cacti  [4+P: IDs 35-37]
  { id: 'card_35', img: 'Cards_35.jpg', act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4, cacti: 3, special: null },
  { id: 'card_36', img: 'Cards_36.jpg', act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4, cacti: 3, special: null },
  { id: 'card_37', img: 'Cards_37.jpg', act: 2, minPlayers: 4, dollars: 0, cows:  5, bandits:  2, cost: 4, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P: IDs 76-84]
  { id: 'card_76', img: 'Cards_76.jpg', act: 2, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'card_77', img: 'Cards_77.jpg', act: 2, minPlayers: 2, dollars: 4, cows:  0, bandits:  1, cost: 3, cacti: 2, special: null },
  { id: 'card_78', img: 'Cards_78.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'look3_rearrange' },
  { id: 'card_79', img: 'Cards_79.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_80', img: 'Cards_80.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'card_81', img: 'Cards_81.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'put_on_top' },
  { id: 'card_82', img: 'Cards_82.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits: -1, cost: 5, cacti: 2, special: 'discard_to_player' },
  { id: 'card_83', img: 'Cards_83.jpg', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'replay_discard' },
  { id: 'card_84', img: 'Cards_84.jpg', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 6, cacti: 2, special: 'dollar1_other' },
  // Cactus (Yellow) – 2 cacti  [3+P: ID 58]
  { id: 'card_58', img: 'Cards_58.jpg', act: 2, minPlayers: 3, dollars: 3, cows:  0, bandits:  0, cost: 6, cacti: 2, special: 'dollar1_other' },
  // Cactus (Yellow) – 2 cacti  [4+P: IDs 63-66]
  { id: 'card_63', img: 'Cards_63.jpg', act: 2, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'card_64', img: 'Cards_64.jpg', act: 2, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_65', img: 'Cards_65.jpg', act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'card_66', img: 'Cards_66.jpg', act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits: -1, cost: 5, cacti: 2, special: 'discard_to_player' },

  // --- ACT 3 (Tier 3) ---
  // River (Blue) – 1 cacti  [2P: IDs 19-25]
  { id: 'card_19', img: 'Cards_19.jpg', act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_20', img: 'Cards_20.jpg', act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_21', img: 'Cards_21.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_22', img: 'Cards_22.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_23', img: 'Cards_23.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_24', img: 'Cards_24.jpg', act: 3, minPlayers: 2, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_25', img: 'Cards_25.jpg', act: 3, minPlayers: 2, dollars: 2, cows:  3, bandits:  0, cost:  9, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [4+P: IDs 5-7]
  { id: 'card_5',  img: 'Cards_5.jpg',  act: 3, minPlayers: 4, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_6',  img: 'Cards_6.jpg',  act: 3, minPlayers: 4, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_7',  img: 'Cards_7.jpg',  act: 3, minPlayers: 4, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti  [2P: IDs 48-53]
  { id: 'card_48', img: 'Cards_48.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  3, bandits:  0, cost: 10, cacti: 3, special: null },
  { id: 'card_49', img: 'Cards_49.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_50', img: 'Cards_50.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_51', img: 'Cards_51.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_52', img: 'Cards_52.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_53', img: 'Cards_53.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  1, cost:  9, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [4+P: IDs 38-39]
  { id: 'card_38', img: 'Cards_38.jpg', act: 3, minPlayers: 4, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_39', img: 'Cards_39.jpg', act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P: IDs 85-92]
  { id: 'card_85', img: 'Cards_85.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  2, bandits: -1, cost: 10, cacti: 2, special: null },
  { id: 'card_86', img: 'Cards_86.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_87', img: 'Cards_87.jpg', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_88', img: 'Cards_88.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_89', img: 'Cards_89.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_90', img: 'Cards_90.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_91', img: 'Cards_91.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost:  8, cacti: 2, special: 'look3_immediate' },
  { id: 'card_92', img: 'Cards_92.jpg', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  9, cacti: 2, special: null },
  // Cactus (Yellow) – 2 cacti  [4+P: IDs 67-68]
  { id: 'card_67', img: 'Cards_67.jpg', act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_68', img: 'Cards_68.jpg', act: 3, minPlayers: 4, dollars: 3, cows:  2, bandits:  0, cost:  8, cacti: 2, special: null },
];

// Build lookup
const CARD_DB = {};
STORE_CARDS.forEach(c => CARD_DB[c.id] = c);

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
    busy: false,
    playerOrder: Array.from({length: n}, (_, i) => i), // G.players[i] → Firebase slot index (SP default: identity)
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
  const active = G.players
    .map((p, i) => ({ p, i }))
    .filter(c => !c.p.busted && c.p.hand.length > 0);
  if (active.length === 0) return [];
  const maxDollars = Math.max(...active.map(c => c.p.roundDollars));
  let leaders = active.filter(c => c.p.roundDollars === maxDollars);
  if (leaders.length > 1) {
    const maxCows = Math.max(...leaders.map(c => c.p.roundCows));
    leaders = leaders.filter(c => c.p.roundCows === maxCows);
  }
  return leaders.map(c => c.i);
}

// Updates all contextual zone indicators:
//   draw phase  → gold crown + border on the current dollar leader
//   buy phase   → pulsing amber border on the active buyer
//   any phase   → red border on busted players
function updateTurnOrderBar() {
  const bar = document.getElementById('turn-order-bar');
  if (!bar) return;

  // Build canonical display order: Firebase slot order (or player index in SP)
  // G.playerOrder[i] = Firebase slot for G.players[i]
  // We want to display in slot order 0,1,2... so sort G.players indices by their slot
  const displayOrder = Array.from({length: G.numPlayers}, (_, i) => i)
    .sort((a, b) => G.playerOrder[a] - G.playerOrder[b]);

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
    const name = pi === 0 ? 'You' : p.name;
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
    const prefix  = i === 0 ? 'player' : 'opp-' + i;
    const crownEl = document.getElementById(prefix + '-crown');
    const zoneEl  = i === 0
      ? document.getElementById('player-zone')
      : document.getElementById('opp-zone-' + i);
    const isLeader = leaders.includes(i);
    const isBusted = G.players[i].busted;
    const isBuying = activeBuyerPlayerIdx === i && !isBusted;
    if (crownEl) crownEl.classList.toggle('crown-visible', isLeader);
    if (zoneEl) {
      zoneEl.classList.toggle('draw-leader', isLeader);
      zoneEl.classList.toggle('zone-busted',  isBusted);
      zoneEl.classList.toggle('zone-buying',   isBuying);
    }
  }
}

function render() {
  if (!G || G.phase === 'start') return;

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
  document.getElementById(prefix + '-discard-count').textContent = player.discard.length;

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

  const showFaceUp = true;

  for (const card of player.hand) {
    const el = renderCardEl(card, showFaceUp, player.busted ? 'busted' : '');
    handEl.appendChild(el);
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
    el.appendChild(b);
  }
}

function clearActions() {
  document.getElementById('actions').innerHTML = '';
  clearCardPreview();
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
function mpSyncDraw() {
  if (!MP.active) return;
  MP.pushDrawState(G.players[0]);
  MP.pushSpectatorState(); // no-op for non-hosts
}

// --- GAME FLOW ---

async function startGame() {
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('opponents-zone').innerHTML = ''; // clear for fresh game

  if (MP.active) {
    setMessage('Connecting to game...');
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
  }

  // Show spectator-link button for MP host
  if (MP.active && MP.isHost) {
    document.getElementById('btn-spectate-link').classList.remove('hidden');
  }

  await setupAct(1);
}

function restartGame() {
  if (MP.active) {
    // In MP mode, can't restart — go back to lobby
    window.location.href = 'gamesetup.html';
    return;
  }
  startGame();
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
      render();
      MP.pushSpectatorState(); // host keeps spectatorState current as opponent draws arrive
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
    startPlayerDraw();
    for (let i = 1; i < G.numPlayers; i++) {
      aiDrawPhase(i); // fire-and-forget, each runs independently
    }
  }
}

// --- DRAW PHASE ---

const ACTIVATABLE_SPECIALS = ['trash_for_2', 'trash_buy_burn_first', 'look3_rearrange', 'replay_discard', 'trash_to_use'];

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
    default: return 'Use';
  }
}

function getDrawButtonText(player) {
  if (player.hand.length === 0) return 'Draw Card';
  if (player.roundBandits >= 2)  return 'One more\u2026';
  if (player.roundBandits === 1) return 'Keep going?';
  if (player.hand.length >= 4)   return 'Push your luck\u2026';
  return 'Draw again?';
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

  buttons.push({ text: 'Stop Drawing', onClick: () => playerStopDraw(), className: 'btn-secondary', disabled: player.hand.length === 0 });

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
      await delay(400);
      if (player.busted) break;
      const extraCard = drawFromDeck(player);
      if (!extraCard) break;
      player.hand.push(extraCard);
      applyCardEffects(player, extraCard, false);
      render();
      mpSyncDraw();
      // Check bust after each draw
      if (player.roundBandits >= 3) {
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
      if (tCard.dollars > 0 && ai.roundBandits >= 2 && ai.roundDollars < getBestAffordableCost(ai)) activate = true;
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
      top3.sort((a, b) => a.bandits - b.bandits);
      ai.deck.unshift(...top3);
      addLog(`${aiLabel} trashed to rearrange top cards.`, 'log-burn');
      render();
    }

    // Handle look3_immediate for AI
    if (card.special === 'look3_immediate' && ai.deck.length >= 2) {
      const top3 = ai.deck.splice(0, Math.min(3, ai.deck.length));
      top3.sort((a, b) => a.bandits - b.bandits);
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

  if (ai.roundBandits >= 2) {
    if (cardsRemaining === 0) return false;
    return (banditsRemaining / cardsRemaining) < cfg.bustThreshold2 * positionMult;
  }

  if (ai.roundBandits === 1) {
    if (cardsRemaining <= 1) return false;
    const bustProb = banditsRemaining / cardsRemaining;
    if (bustProb >= cfg.bustThreshold1 * positionMult) return false;
    if (cfg.dollarBuffer >= 999) return true;  // Wild Bill ignores dollar target
    return ai.roundDollars < getBestAffordableCost(ai);
  }

  // 0 bandits: keep drawing until dollars satisfy the target
  return ai.roundDollars < getBestAffordableCost(ai) + cfg.dollarBuffer;
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
  }
}

// --- BUST ---

async function handleBust(player) {
  player.busted = true;
  addLog(`${player.name} BUSTED with ${player.roundBandits} bandits!`, 'log-bust');
  setMessage(player.name + ' busted!');
  render();
  if (player.isHuman) mpSyncDraw();
  await delay(1500);

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
  setMessage('Trash for $2? Or keep for $1.');
  setActions([
    { text: 'Trash for $2', onClick: () => {
      player.roundDollars += 1; // already got $1, so +1 more = $2 total
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      addLog('You trashed a card for $2 total.', 'log-burn');
      render();
      mpSyncDraw();
      startPlayerDraw();
    }},
    { text: 'Keep for $1', onClick: () => {
      startPlayerDraw();
    }, className: 'btn-secondary' },
  ]);
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
    let order = [];

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
          modal.classList.add('hidden');
          addLog('You rearranged the top cards of your deck.');
          render();
          mpSyncDraw();
          resolve();
        };
        content.appendChild(btn);
      }
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

function handlePutOnTop(player, putOnTopCard) {
  setMessage('Choose a card to return to the top of your deck (its effects are removed).');
  const handEl = document.getElementById('player-hand');
  handEl.innerHTML = '';

  for (const card of player.hand) {
    const el = renderCardEl(card, true, 'clickable');
    el.onclick = () => {
      if (card.uid === putOnTopCard.uid) {
        // Can't return the put_on_top card itself... actually you can
      }
      // Remove card effects
      player.roundDollars -= card.dollars;
      player.roundCows -= card.cows;
      player.roundBandits -= card.bandits;

      // Remove from hand, put on top of deck
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

  setActions([
    { text: 'Skip (Don\'t Return)', onClick: () => {
      addLog('You chose not to return a card.');
      onPlayerDrawDone();
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

  const { winnerIdx, reason, tieLog } = determineBuyWinner(G.players, G.playerOrder);

  if (winnerIdx === 0 && G.players.every(p => p.busted)) {
    addLog(`--- Buy Phase --- (All players busted!)`);
    startBuyPhase(0);
    return;
  }

  if (tieLog) addLog(tieLog, 'log-tie');

  const nonBusted = G.players.map((p, i) => ({ p, i })).filter(c => !c.p.busted).map(c => c.i);
  const winnerName = G.players[winnerIdx].name;

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
  const order = Array.from({length: G.numPlayers}, (_, k) => (startIdx + k) % G.numPlayers);
  mpLog('startBuyPhase:', { startIdx, localIsChooser, order,
    winner: G.players[startIdx]?.name, isHuman: G.players[startIdx]?.isHuman });
  if (MP.active) {
    const winnerIsAI = !G.players[startIdx].isHuman;
    const shouldPush = localIsChooser || (winnerIsAI && MP.isHost);
    mpLog('startBuyPhase push?', { shouldPush, winnerIsAI, isHost: MP.isHost, localIsChooser });
    if (shouldPush) {
      const slotOrder = order.map(i => G.playerOrder[i]);
      mpLog('pushBuyOrder slotOrder:', slotOrder);
      MP.pushBuyOrder(slotOrder);
    }
  }
  applyBuyOrder(order);
}

function applyBuyOrder(order) {
  G.buyOrder = order;
  G.currentBuyerIdx = 0;
  mpLog('applyBuyOrder:', order.map(i => G.players[i]?.name));
  render();
  if (MP.active) MP.pushSpectatorState(); // buy phase begins — spectators see buy order
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
  const card = slot.card;

  player.discard.push(card);
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} bought ${cardLabel(card)} for $${card.cost}.`, 'log-buy');
  revealUncovered(G.pyramid);
  render();
  if (MP.active) MP.pushSpectatorState();

  G.currentBuyerIdx++;

  if (isPyramidEmpty(G.pyramid)) {
    addLog('Store is empty! Round ends.', 'log-score');
    endBuyPhase();
  } else {
    processBuyTurn();
  }
}

// Human burn: push to Firebase (MP, local human only) then apply locally
function executeBurn(player, row, col) {
  if (MP.active && player === G.players[0]) MP.pushBuyAction('burn', row, col);
  executeBurnLocal(player, row, col);
}

function executeBurnLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return;
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} burned ${cardLabel(slot.card)} ($${slot.card.cost}).`, 'log-burn');
  revealUncovered(G.pyramid);
  render();
  if (MP.active) MP.pushSpectatorState();

  G.currentBuyerIdx++;

  if (isPyramidEmpty(G.pyramid)) {
    addLog('Store is empty! Round ends.', 'log-score');
    endBuyPhase();
  } else {
    processBuyTurn();
  }
}

// --- AI BUY ---

async function aiBuyTurn(ai) {
  setMessage(`${ai.name} is buying\u2026`);
  clearActions();
  await delay(1000);

  const available = getAvailablePyramidCards(G.pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= ai.roundDollars);

  if (affordable.length > 0) {
    // Score and pick best
    let best = null;
    let bestScore = -Infinity;
    for (const a of affordable) {
      const score = scoreCardForAI(a.slot.card, ai);
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
  if (card.special === 'copy_next') score += 3;
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

// --- PASS CARD (discard_to_player) ---

// AI picks the opponent with the smallest herd to receive the card;
// tiebreak by lowest Firebase slot index (deterministic on all clients).
function aiPickPassTarget(fromPlayerIdx) {
  return G.players
    .map((p, i) => ({ p, i }))
    .filter(c => c.i !== fromPlayerIdx)
    .sort((a, b) => {
      const herdDiff = a.p.herd - b.p.herd;
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
  if (MP.active) MP.pushSpectatorState(); // spectators see final scores for the round
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
    gameOver();
    return;
  }

  const nextAct = G.currentAct + 1;
  setMessage(`Act ${G.currentAct} complete! Starting Act ${nextAct}...`);
  clearActions();
  addLog(`=== Act ${G.currentAct} complete! ===`, 'log-score');
  await delay(2000);

  await setupAct(nextAct);
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
    MP.cleanup();
  }

  // Log game to global history (MP: host only; SP: always)
  if (!MP.active || MP.isHost) {
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

// --- SPECTATOR LINK ---

function copySpectateLink() {
  if (!MP.active || !MP.code) return;
  const url = `${location.origin}${location.pathname.replace('playgame.html', '')}spectate.html?code=${MP.code}`;
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

// --- INIT ---
preloadImages();
startGame().catch(e => {
  console.error('Game init failed:', e);
  setMessage('Failed to start game. Please refresh.');
});

// determineBuyWinner is defined in shared/tiebreaker.js (loaded before this script)
