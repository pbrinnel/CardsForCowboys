// ============================================================
// Cards For Cowboys - Game Engine
// ============================================================

// ============================================================
// MULTIPLAYER LAYER
// All Firebase interaction is isolated here.
// When MP is inactive every function is a no-op.
// ============================================================

const MP = (() => {
  // Detect if we arrived from the lobby
  const isMP = new URLSearchParams(location.search).has('mp');
  if (!isMP) return { active: false };

  const code    = sessionStorage.getItem('mp_code');
  const role    = sessionStorage.getItem('mp_role');   // 'host' | 'guest'
  const myName  = sessionStorage.getItem('mp_name');

  if (!code || !role || !myName) return { active: false };

  // Dynamic Firebase import (ESM CDN)
  let dbRef = null;      // Firebase ref to /games/{code}
  let db    = null;
  let fbMod = null;      // cached firebase-database module
  let fbSet, fbUpdate, fbOnValue, fbOnDisconnect, fbRemove, fbGet, fbRef;

  // My player index: host = 0, guest = 1
  const myIdx = role === 'host' ? 0 : 1;
  const oppIdx = 1 - myIdx;

  let unsubscribers = [];
  let initialized = false;

  function gameRef(path) {
    return fbRef(db, `games/${code}${path ? '/' + path : ''}`);
  }

  async function init() {
    // Load Firebase dynamically (play.html is not a module, so we import here)
    const fbApp = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    fbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');

    const firebaseConfig = {
      apiKey: "AIzaSyBegwDX84rtHfrYwuMVZcQkcLvaJ9MUOiQ",
      authDomain: "cards-for-cowboys.firebaseapp.com",
      databaseURL: "https://cards-for-cowboys-default-rtdb.firebaseio.com",
      projectId: "cards-for-cowboys",
      storageBucket: "cards-for-cowboys.firebasestorage.app",
      messagingSenderId: "795777888512",
      appId: "1:795777888512:web:560d415f8d34def96dc3e5"
    };

    const app = fbApp.initializeApp(firebaseConfig);
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

    // Handle opponent disconnect
    fbOnDisconnect(dbRef).update({ status: 'disconnected' });
    const unsub = fbOnValue(dbRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      if (data.status === 'disconnected') {
        showDisconnectMessage();
      }
    });
    unsubscribers.push(unsub);
  }

  // Write my player state to Firebase
  async function pushMyState(player) {
    if (!initialized) return;
    await fbUpdate(gameRef(`players/${myIdx}`), serializePlayer(player));
  }

  // Serialize player state for Firebase (strip non-serializable bits)
  function serializePlayer(player) {
    return {
      name: player.name,
      herd: player.herd,
      roundDollars: player.roundDollars,
      roundCows: player.roundCows,
      roundBandits: player.roundBandits,
      busted: player.busted,
      stoppedDrawing: player.stoppedDrawing,
      handCount: player.hand.length,
      deckCount: player.deck.length,
    };
  }

  // Push my full draw state (hand + deck + stats) after every draw action
  async function pushDrawState(player) {
    if (!initialized) return;
    await fbSet(gameRef(`drawState/${myIdx}`), {
      hand: player.hand.map(c => c.id),
      deck: player.deck.map(c => c.id),
      dollars: player.roundDollars,
      cows: player.roundCows,
      bandits: player.roundBandits,
      busted: player.busted,
      stoppedDrawing: player.stoppedDrawing,
    });
  }

  // Live listener for opponent's draw state — calls callback on every update
  function watchOpponentDrawState(callback) {
    if (!initialized) return;
    const unsub = fbOnValue(gameRef(`drawState/${oppIdx}`), (snap) => {
      const val = snap.val();
      if (val) callback(val);
    });
    unsubscribers.push(unsub);
  }

  // Signal that my draw phase is done, including my round stats
  async function signalDrawDone(player) {
    if (!initialized) return;
    await fbSet(gameRef(`drawDone/${myIdx}`), {
      done: true,
      dollars: player.roundDollars,
      cows: player.roundCows,
      bandits: player.roundBandits,
      busted: player.busted,
      handCount: player.hand.length,
    });
  }

  // Wait for opponent's draw done signal, then call callback with their stats
  function waitForOpponentDraw(callback) {
    if (!initialized) return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef(`drawDone/${oppIdx}`), (snap) => {
      const val = snap.val();
      if (val && val.done === true && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(val);
      }
    });
    unsubscribers.push(unsub);
  }

  // Reset all per-round signals at start of each round
  async function resetRound() {
    if (!initialized) return;
    await fbUpdate(dbRef, {
      drawDone: { 0: null, 1: null },
      drawState: { 0: null, 1: null },
      buyAction: null,
      buyOrder: null,
    });
  }

  // Clear actSetup (between acts)
  async function clearActSetup() {
    if (!initialized) return;
    await fbSet(gameRef('actSetup'), null);
  }

  // Push act setup (host only) — shares pyramid card IDs so both clients build same pyramid
  async function pushActSetup(act, cardIds) {
    if (!initialized || role !== 'host') return;
    await fbSet(gameRef('actSetup'), { act, cardIds, ts: Date.now() });
  }

  // Listen for act setup (guest)
  function waitForActSetup(callback) {
    if (!initialized || role !== 'guest') return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef('actSetup'), (snap) => {
      const data = snap.val();
      if (data && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
    unsubscribers.push(unsub);
  }

  // Push buy action (my action: buy or burn at row/col)
  async function pushBuyAction(action, row, col) {
    if (!initialized) return;
    await fbSet(gameRef('buyAction'), { playerIdx: myIdx, action, row, col, ts: Date.now() });
  }

  // Listen for opponent's buy action
  function waitForBuyAction(callback) {
    if (!initialized) return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef('buyAction'), (snap) => {
      const data = snap.val();
      if (data && data.playerIdx === oppIdx && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
    unsubscribers.push(unsub);
  }

  // Push buy order (host decides who goes first)
  async function pushBuyOrder(firstIdx) {
    if (!initialized) return;
    await fbSet(gameRef('buyOrder'), { firstIdx, ts: Date.now() });
  }

  // Listen for buy order
  function waitForBuyOrder(callback) {
    if (!initialized) return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(gameRef('buyOrder'), (snap) => {
      const data = snap.val();
      if (data && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data.firstIdx);
      }
    });
    unsubscribers.push(unsub);
  }

  // Read opponent name from Firebase game record
  async function getOpponentName() {
    if (!initialized) return 'Opponent';
    const snap = await fbGet(dbRef);
    const data = snap.val();
    if (!data) return 'Opponent';
    return role === 'host' ? (data.guestName || 'Opponent') : (data.hostName || 'Opponent');
  }

  function showDisconnectMessage() {
    setMessage('Your opponent disconnected. Game over.');
    setActions([{ text: 'Back to Home', onClick: () => { window.location.href = 'game.html'; } }]);
    cleanup();
  }

  function cleanup() {
    unsubscribers.forEach(u => u && u());
    unsubscribers = [];
    // Cancel the onDisconnect so navigating away after game over
    // doesn't falsely mark the game as disconnected
    if (initialized && dbRef) {
      fbOnDisconnect(dbRef).cancel();
    }
  }

  return {
    active: true,
    code, role, myName, myIdx, oppIdx,
    init,
    pushMyState,
    pushDrawState,
    watchOpponentDrawState,
    signalDrawDone,
    waitForOpponentDraw,
    resetRound,
    clearActSetup,
    pushActSetup,
    waitForActSetup,
    pushBuyAction,
    waitForBuyAction,
    pushBuyOrder,
    waitForBuyOrder,
    getOpponentName,
    cleanup,
  };
})();

// ============================================================
// END MULTIPLAYER LAYER
// ============================================================

const CARD_IMG_PATH = 'assets/cards/All-Cards/';
const BACK_IMG_PATH = 'assets/backs/';
const CACTI_BACK = { 1: 'Blue Inline-01.jpg', 2: 'Yellow Inline-01.jpg', 3: 'Red Inline-01.jpg' };

// --- CARD DATABASE ---

// --- STARTERS (IDs 26-29 River, 54-57 Rattlesnake, 93-94 Cactus) ---
// River=1 cacti, Cactus=2 cacti, Rattlesnake=3 cacti
const STARTER_TEMPLATES = [
  { id: 'starter_26', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_26.jpg' },
  { id: 'starter_27', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_27.jpg' },
  { id: 'starter_28', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_28.jpg' },
  { id: 'starter_29', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_29.jpg' },
  { id: 'starter_54', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Card_54.jpg' },
  { id: 'starter_55', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Card_55.jpg' },
  { id: 'starter_56', dollars: 0, cows: 2, bandits: 2, cacti: 3, count: 1, img: 'Card_56.jpg' },
  { id: 'starter_57', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1, img: 'Card_57.jpg' },
  { id: 'starter_93', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1, img: 'Card_93.jpg' },
  { id: 'starter_94', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 1, img: 'Card_94.jpg' },
];

// --- STORE CARDS (2-player set; 3+P and 4+P cards excluded) ---
// Derived from CSV. Color→Cacti: River(Blue)=1, Cactus(Yellow)=2, Rattlesnake(Red)=3
const STORE_CARDS = [
  // --- ACT 1 (Tier 1, no player restriction) ---
  // River (Blue) – 1 cacti
  { id: 'card_8',  img: 'Card_8.jpg',  act: 1, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_9',  img: 'Card_9.jpg',  act: 1, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_10', img: 'Card_10.jpg', act: 1, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_11', img: 'Card_11.jpg', act: 1, dollars: 3, cows: -1, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_12', img: 'Card_12.jpg', act: 1, dollars: 3, cows: -1, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_13', img: 'Card_13.jpg', act: 1, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_14', img: 'Card_14.jpg', act: 1, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_15', img: 'Card_15.jpg', act: 1, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_16', img: 'Card_16.jpg', act: 1, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_17', img: 'Card_17.jpg', act: 1, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_18', img: 'Card_18.jpg', act: 1, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_40', img: 'Card_40.jpg', act: 1, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_41', img: 'Card_41.jpg', act: 1, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_42', img: 'Card_42.jpg', act: 1, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_69', img: 'Card_69.jpg', act: 1, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_70', img: 'Card_70.jpg', act: 1, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_71', img: 'Card_71.jpg', act: 1, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_72', img: 'Card_72.jpg', act: 1, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_73', img: 'Card_73.jpg', act: 1, dollars: 0, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_buy_burn_first' },
  { id: 'card_74', img: 'Card_74.jpg', act: 1, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },
  { id: 'card_75', img: 'Card_75.jpg', act: 1, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 2, special: null },

  // --- ACT 2 (Tier 2, no player restriction) ---
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_44', img: 'Card_44.jpg', act: 2, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'trash_to_use' },
  { id: 'card_45', img: 'Card_45.jpg', act: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_46', img: 'Card_46.jpg', act: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_47', img: 'Card_47.jpg', act: 2, dollars: 0, cows:  3, bandits:  0, cost: 5, cacti: 3, special: 'draw4' },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_76', img: 'Card_76.jpg', act: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'card_77', img: 'Card_77.jpg', act: 2, dollars: 4, cows:  0, bandits:  1, cost: 3, cacti: 2, special: null },
  { id: 'card_78', img: 'Card_78.jpg', act: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'look3_rearrange' },
  { id: 'card_79', img: 'Card_79.jpg', act: 2, dollars: 0, cows:  2, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_80', img: 'Card_80.jpg', act: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'card_81', img: 'Card_81.jpg', act: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'put_on_top' },
  { id: 'card_82', img: 'Card_82.jpg', act: 2, dollars: 0, cows:  0, bandits: -1, cost: 5, cacti: 2, special: 'trash_to_use' },
  { id: 'card_83', img: 'Card_83.jpg', act: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'replay_discard' },
  { id: 'card_84', img: 'Card_84.jpg', act: 2, dollars: 3, cows:  0, bandits:  0, cost: 6, cacti: 2, special: 'dollar1_other' },

  // --- ACT 3 (Tier 3, no player restriction) ---
  // River (Blue) – 1 cacti
  { id: 'card_19', img: 'Card_19.jpg', act: 3, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_20', img: 'Card_20.jpg', act: 3, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_21', img: 'Card_21.jpg', act: 3, dollars: 3, cows:  0, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_22', img: 'Card_22.jpg', act: 3, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_23', img: 'Card_23.jpg', act: 3, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_24', img: 'Card_24.jpg', act: 3, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_25', img: 'Card_25.jpg', act: 3, dollars: 2, cows:  3, bandits:  0, cost:  9, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_48', img: 'Card_48.jpg', act: 3, dollars: 3, cows:  3, bandits:  0, cost: 10, cacti: 3, special: null },
  { id: 'card_49', img: 'Card_49.jpg', act: 3, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_50', img: 'Card_50.jpg', act: 3, dollars: 0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_51', img: 'Card_51.jpg', act: 3, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_52', img: 'Card_52.jpg', act: 3, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_53', img: 'Card_53.jpg', act: 3, dollars: 0, cows:  5, bandits:  1, cost:  9, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_85', img: 'Card_85.jpg', act: 3, dollars: 0, cows:  2, bandits: -1, cost: 10, cacti: 2, special: null },
  { id: 'card_86', img: 'Card_86.jpg', act: 3, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_87', img: 'Card_87.jpg', act: 3, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_88', img: 'Card_88.jpg', act: 3, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_89', img: 'Card_89.jpg', act: 3, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_90', img: 'Card_90.jpg', act: 3, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_91', img: 'Card_91.jpg', act: 3, dollars: 0, cows:  0, bandits:  0, cost:  8, cacti: 2, special: 'look3_immediate' },
  { id: 'card_92', img: 'Card_92.jpg', act: 3, dollars: 0, cows:  4, bandits:  0, cost:  9, cacti: 2, special: null },
];

// Build lookup
const CARD_DB = {};
STORE_CARDS.forEach(c => CARD_DB[c.id] = c);

function getActPool(act) {
  return STORE_CARDS.filter(c => c.act === act);
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

function createStarterDeck() {
  const deck = [];
  for (const tmpl of STARTER_TEMPLATES) {
    for (let i = 0; i < tmpl.count; i++) {
      const imgFile = tmpl.img;
      deck.push(createCardInstance(tmpl, imgFile));
    }
  }
  return shuffle(deck);
}

function createPlayer(name, isHuman) {
  return {
    name,
    isHuman,
    deck: createStarterDeck(),
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


function initState(players) {
  uidCounter = 0;
  return {
    currentAct: 1,
    phase: 'start',
    roundNumber: 1,
    players: players || [createPlayer('You', true), createPlayer('Cowboy AI', false)],
    pyramid: [],
    log: [],
    buyOrder: [],
    currentBuyerIdx: 0,
    selectedPyramidCard: null,
    busy: false,
  };
}

// --- PYRAMID ---

// Build pyramid from act pool; if cardIds provided (MP), use that fixed order
function buildPyramid(act, cardIds) {
  const numRows = 5; // 2 players
  const needed = (numRows * (numRows + 1)) / 2; // 15

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
    player.deck = shuffle(player.discard);
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

  return { dollars, cows, bandits };
}

// --- LOGGING ---

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
  renderPlayerZone(G.players[1], 'ai');

  // Pyramid
  renderPyramid();
}

function renderPlayerZone(player, prefix) {
  document.getElementById(prefix + '-herd').textContent = player.herd;
  document.getElementById(prefix + '-deck-count').textContent = player.deck.length;
  document.getElementById(prefix + '-discard-count').textContent = player.discard.length;

  // Round stats
  const hasRoundStats = player.hand.length > 0 || G.phase === 'buy';

  if (prefix === 'ai') {
    // AI uses inline stats in the summary bar
    const inlineStats = document.getElementById('ai-round-stats-inline');
    if (hasRoundStats) {
      inlineStats.classList.remove('hidden');
      document.getElementById('ai-round-dollars').textContent = player.roundDollars;
      document.getElementById('ai-round-cows').textContent = player.roundCows;
      document.getElementById('ai-round-bandits').textContent = player.roundBandits;
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

  if (player.deck.length > 0 && G.phase === 'draw' && !player.busted && !player.stoppedDrawing) {
    const nextCard = player.deck[0];
    const el = renderCardEl(nextCard, false); // face-down shows the back
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
    previewEl.appendChild(el);
    const label = document.createElement('div');
    label.className = 'deck-label';
    label.textContent = `Deck (${player.deck.length})`;
    previewEl.appendChild(label);
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

// Push local player's draw state to Firebase (MP only, no-op otherwise)
function mpSyncDraw() {
  if (MP.active) MP.pushDrawState(G.players[0]);
}

// --- GAME FLOW ---

async function startGame() {
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');

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
    const oppName = await MP.getOpponentName();
    // G.players[0] = me (human), G.players[1] = opponent
    // MP.myIdx tracks actual host/guest index for Firebase sync
    const myPlayer  = createPlayer(MP.myName, true);
    const oppPlayer = createPlayer(oppName, false);
    G = initState([myPlayer, oppPlayer]);
    // Rename the 'ai' zone label to show opponent name
    const aiNameEl = document.getElementById('ai-name');
    if (aiNameEl) aiNameEl.textContent = oppName;
  } else {
    G = initState();
  }

  await setupAct(1);
}

function restartGame() {
  if (MP.active) {
    // In MP mode, can't restart — go back to lobby
    window.location.href = 'game.html';
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
    player.deck = shuffle(allCards);
    player.discard = [];
    player.hand = [];
    resetPlayerRound(player);
  }

  if (MP.active) {
    if (MP.role === 'host') {
      // Host builds pyramid and shares card IDs with guest
      G.pyramid = buildPyramid(act);
      const cardIds = G.pyramid.flatMap(row => row.map(slot => slot.card.id));
      // Clear previous actSetup first so guest listener fires fresh
      await MP.clearActSetup();
      await MP.pushActSetup(act, cardIds);
    } else {
      // Guest waits for host's pyramid layout
      setMessage(`Waiting for opponent to set up Act ${act}...`);
      clearActions();
      await new Promise(resolve => {
        MP.waitForActSetup((data) => {
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
  G.playerDrawDone = false;
  G.aiDrawDone = false;

  addLog(`Round ${G.roundNumber} - Draw Phase`);
  render();

  if (MP.active) {
    await MP.resetRound();
    // In MP, "opponent draw" is signaled via Firebase; no local AI
    startPlayerDraw();
    // Set up listener for when opponent signals done
    // Live updates: show opponent's hand as they draw
    MP.watchOpponentDrawState((state) => {
      const opp = G.players[1];
      const findCard = id => STORE_CARDS.find(c => c.id === id) || STARTER_TEMPLATES.find(t => t.id === id);
      // Reconstruct opponent hand and deck from card IDs
      opp.hand = (state.hand || []).map(id => {
        const tmpl = findCard(id);
        return tmpl ? createCardInstance(tmpl) : null;
      }).filter(Boolean);
      opp.deck = (state.deck || []).map(id => {
        const tmpl = findCard(id);
        return tmpl ? createCardInstance(tmpl) : null;
      }).filter(Boolean);
      opp.roundDollars  = state.dollars;
      opp.roundCows     = state.cows;
      opp.roundBandits  = state.bandits;
      opp.busted        = state.busted;
      opp.stoppedDrawing = state.stoppedDrawing;
      render();
    });

    MP.waitForOpponentDraw((stats) => {
      // Final stats already applied by watchOpponentDrawState; just advance phase
      G.aiDrawDone = true;
      checkDrawPhaseComplete();
    });
  } else {
    // Start both players drawing simultaneously
    startPlayerDraw();
    G.aiDrawPromise = aiDrawPhase();
  }
}

// --- DRAW PHASE ---

const ACTIVATABLE_SPECIALS = ['trash_for_2', 'trash_buy_burn_first', 'look3_rearrange', 'replay_discard'];

function getActivatableCards(player) {
  return player.hand.filter(c => c.special && ACTIVATABLE_SPECIALS.includes(c.special));
}

function getSpecialLabel(special) {
  switch (special) {
    case 'trash_for_2': return 'Trash for $2';
    case 'trash_buy_burn_first': return 'Trash for Priority';
    case 'look3_rearrange': return 'Trash & Rearrange Top 3';
    case 'replay_discard': return 'Trash & Replay Discard';
    default: return 'Use';
  }
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
    { text: 'Draw Card', onClick: () => playerDraw() },
  ];

  for (const card of activatable) {
    buttons.push({
      text: getSpecialLabel(card.special),
      onClick: () => activateSpecialCard(player, card),
      className: 'btn-special',
    });
  }

  buttons.push({ text: 'Stop Drawing', onClick: () => playerStopDraw(), className: 'btn-secondary' });

  setMessage('Draw a card or stop drawing.');
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
  if (effects.dollars) effectText += ` $${effects.dollars}`;
  if (effects.cows > 0) effectText += ` +${effects.cows} cow${effects.cows > 1 ? 's' : ''}`;
  if (effects.cows < 0) effectText += ` ${effects.cows} cow`;
  if (effects.bandits) effectText += ` ${effects.bandits} bandit${effects.bandits > 1 ? 's' : ''}`;
  addLog(`You drew: ${card.id.replace(/_/g, ' ')} -${effectText}`);

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

  // Handle special: trash_to_use (jail)
  if (card.special === 'trash_to_use' && player.roundBandits >= 2) {
    G.busy = false;
    await handleJailPrompt(player, card);
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
  G.playerDrawDone = true;
  clearActions();
  render();

  if (MP.active) {
    setMessage('Waiting for opponent to finish drawing...');
    MP.signalDrawDone(G.players[0]); // fire-and-forget is fine
  }

  checkDrawPhaseComplete();
}

function checkDrawPhaseComplete() {
  if (G.playerDrawDone && G.aiDrawDone) {
    onDrawPhaseComplete();
  } else if (G.playerDrawDone) {
    setMessage(MP.active ? 'Waiting for opponent to finish drawing...' : 'Waiting for AI to finish drawing...');
  }
}

// --- AI DRAW PHASE ---

async function aiDrawPhase() {
  const ai = G.players[1];

  await delay(500); // slight stagger so first draws don't land at exact same instant

  if (ai.deck.length === 0 && ai.discard.length === 0) {
    ai.stoppedDrawing = true;
    addLog('AI has no cards to draw.');
    G.aiDrawDone = true;
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

    addLog(`AI drew: ${card.id.replace(/_/g, ' ')} (${ai.roundDollars}$, ${ai.roundCows} cows, ${ai.roundBandits} bandits)`);
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

    // Handle jail auto-use
    if (card.special === 'trash_to_use' && ai.roundBandits >= 2) {
      const idx = ai.hand.indexOf(card);
      if (idx >= 0) {
        ai.hand.splice(idx, 1);
        ai.roundBandits = Math.max(0, ai.roundBandits - 1);
        ai.roundCows -= card.cows;
        addLog('AI used Jail to negate a bandit!', 'log-burn');
        render();
        await delay(500);
      }
    }

    // Handle trash_for_2
    if (card.special === 'trash_for_2') {
      const bestCost = getBestAffordableCost();
      if (ai.roundDollars + 1 >= bestCost && ai.roundDollars < bestCost) {
        ai.roundDollars += 1;
        const idx = ai.hand.indexOf(card);
        if (idx >= 0) ai.hand.splice(idx, 1);
        addLog('AI trashed a card for $2.');
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
      addLog('AI trashed to rearrange top cards.', 'log-burn');
      render();
    }

    // Handle look3_immediate for AI
    if (card.special === 'look3_immediate' && ai.deck.length >= 2) {
      const top3 = ai.deck.splice(0, Math.min(3, ai.deck.length));
      top3.sort((a, b) => a.bandits - b.bandits);
      ai.deck.unshift(...top3);
      addLog('AI rearranged top cards.');
    }

    // Check bust
    if (ai.roundBandits >= 3) {
      await handleBust(ai);
      break;
    }

    // AI decision to continue
    if (!aiShouldDraw(ai)) {
      ai.stoppedDrawing = true;
      addLog('AI stopped drawing.');
    }

    await delay(400); // pace between draws
  }

  G.aiDrawDone = true;
  render();
  checkDrawPhaseComplete();
}

function aiShouldDraw(ai) {
  if (ai.hand.length >= 7) return false;
  if (ai.hand.length < 2) return true;

  const banditsRemaining = countBanditsInDeck(ai);
  const cardsRemaining = ai.deck.length;

  if (ai.roundBandits >= 2) {
    if (cardsRemaining === 0) return false;
    const bustProb = banditsRemaining / cardsRemaining;
    return bustProb < 0.15;
  }

  if (ai.roundBandits === 1) {
    if (cardsRemaining <= 1) return false;
    const bustProb = banditsRemaining / cardsRemaining;
    const bestCost = getBestAffordableCost();
    return bustProb < 0.3 && ai.roundDollars < bestCost;
  }

  const bestCost = getBestAffordableCost();
  if (ai.roundDollars >= bestCost + 2) return false;

  return true;
}

function countBanditsInDeck(player) {
  return player.deck.reduce((sum, c) => sum + c.bandits, 0);
}

function getBestAffordableCost() {
  const available = getAvailablePyramidCards(G.pyramid);
  if (available.length === 0) return 99;
  return Math.max(...available.map(a => a.slot.card.cost));
}

// --- ACTIVATE SPECIAL FROM HAND ---

async function activateSpecialCard(player, card) {
  switch (card.special) {
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

  // Move all drawn cards to discard
  player.discard.push(...player.hand);
  player.hand = [];
  player.roundDollars = 0;
  player.roundCows = 0;
  render();
  if (player.isHuman) mpSyncDraw();

  if (player.isHuman) {
    onPlayerDrawDone();
  }
}

// --- SPECIAL CARD HANDLERS ---

async function handleJailPrompt(player, card) {
  if (!player.isHuman) return;

  setMessage('Use Jail? Trash this card to negate 1 bandit.');
  setActions([
    { text: 'Use Jail', onClick: () => {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.roundBandits = Math.max(0, player.roundBandits - 1);
      player.roundCows -= card.cows;
      addLog('You used Jail to negate a bandit!', 'log-burn');
      render();
      mpSyncDraw();
      if (player.roundBandits >= 3) {
        handleBust(player);
      } else {
        startPlayerDraw();
      }
    }},
    { text: 'Keep Card', onClick: () => {
      if (player.roundBandits >= 3) {
        handleBust(player);
      } else {
        startPlayerDraw();
      }
    }, className: 'btn-secondary' },
  ]);
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

      addLog(`You returned ${card.id.replace(/_/g, ' ')} to top of deck.`);
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

function onDrawPhaseComplete() {
  G.phase = 'buy';

  const me = G.players[0];   // local human
  const opp = G.players[1];  // opponent (AI or remote)

  // Check hasBuyBurnFirst (special card overrides)
  if (me.hasBuyBurnFirst && !me.busted) {
    G.buyOrder = [0, 1];
    addLog('--- Buy Phase --- (You have first buy priority!)');
    G.currentBuyerIdx = 0;
    render();
    startBuyPhaseMP([0, 1]);
    return;
  } else if (opp.hasBuyBurnFirst && !opp.busted) {
    G.buyOrder = [1, 0];
    addLog(`--- Buy Phase --- (${opp.name} has first buy priority!)`);
    G.currentBuyerIdx = 0;
    render();
    startBuyPhaseMP([1, 0]);
    return;
  }

  // Determine who CHOOSES the buy order (most $ chooses, with tiebreakers)
  let chooserIsMe;
  if (me.busted && !opp.busted) {
    chooserIsMe = false;
  } else if (opp.busted && !me.busted) {
    chooserIsMe = true;
  } else if (me.busted && opp.busted) {
    // Both busted, no meaningful choice
    G.buyOrder = [0, 1];
    G.currentBuyerIdx = 0;
    addLog('--- Buy Phase --- (Both busted!)');
    render();
    startBuyPhaseMP([0, 1]);
    return;
  } else if (me.roundDollars > opp.roundDollars) {
    chooserIsMe = true;
  } else if (opp.roundDollars > me.roundDollars) {
    chooserIsMe = false;
  } else if (me.roundCows > opp.roundCows) {
    chooserIsMe = true;
  } else if (opp.roundCows > me.roundCows) {
    chooserIsMe = false;
  } else if (me.hand.length > opp.hand.length) {
    chooserIsMe = true;
  } else if (opp.hand.length > me.hand.length) {
    chooserIsMe = false;
  } else {
    // In MP: host always wins the tiebreak (deterministic, no random needed)
    chooserIsMe = MP.active ? (MP.role === 'host') : Math.random() < 0.5;
  }

  const oppLabel = MP.active ? opp.name : 'AI';

  if (chooserIsMe) {
    addLog(`--- Buy Phase --- You have the most $, choose who buys first.`);
    setMessage(`Buy Phase - You have $${me.roundDollars} vs ${oppLabel}'s $${opp.roundDollars}. Who buys first?`);
    setActions([
      { text: 'I Buy First', onClick: () => {
        addLog('You chose to buy first.');
        startBuyPhaseMP([0, 1]);
      }},
      { text: `${oppLabel} Buys First`, onClick: () => {
        addLog(`You chose ${oppLabel} to buy first.`);
        startBuyPhaseMP([1, 0]);
      }, className: 'btn-secondary' },
    ]);
    render();
  } else {
    if (!MP.active) {
      // AI always buys first when it has the choice
      addLog(`--- Buy Phase --- ${oppLabel} has the most $ and chooses to buy first.`);
      startBuyPhaseMP([1, 0]);
    } else {
      // In MP: opponent (remote) has the choice — we wait for their buy order signal
      addLog(`--- Buy Phase --- ${opp.name} has the most $ and chooses the buy order.`);
      setMessage(`Waiting for ${opp.name} to choose who buys first...`);
      clearActions();
      render();
      // Opponent will push their order; we listen
      MP.waitForBuyOrder((firstIdx) => {
        // firstIdx is 0 (host goes first) or 1 (guest goes first)
        // Convert to local indices: my local idx is 0, opp is 1
        const myLocalFirst = (firstIdx === MP.myIdx);
        const order = myLocalFirst ? [0, 1] : [1, 0];
        addLog(`${opp.name} chose ${myLocalFirst ? 'you' : opp.name} to buy first.`);
        applyBuyOrder(order);
      });
    }
  }
}

// Called after the buy order is determined (locally)
// In MP, if I'm the chooser I also push the order so opponent can receive it
function startBuyPhaseMP(order) {
  if (MP.active) {
    // Push order expressed as game-level firstIdx (0=host, 1=guest)
    // order[0] is local first-buyer (0=me, 1=opp); convert to game idx
    const localFirst = order[0]; // 0=me, 1=opp
    const gameFirst = localFirst === 0 ? MP.myIdx : MP.oppIdx;
    MP.pushBuyOrder(gameFirst);
  }
  applyBuyOrder(order);
}

function applyBuyOrder(order) {
  G.buyOrder = order;
  G.currentBuyerIdx = 0;
  render();
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

  if (player.isHuman) {
    humanBuyTurn(player);
  } else if (MP.active) {
    // Wait for opponent's buy action via Firebase
    mpOpponentBuyTurn(player);
  } else {
    aiBuyTurn(player);
  }
}

function mpOpponentBuyTurn(opp) {
  setMessage(`Waiting for ${opp.name} to buy or burn...`);
  clearActions();
  render();
  MP.waitForBuyAction((data) => {
    // Apply opponent's action locally
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

// Human buy: push to Firebase (MP) then apply locally
function executeBuy(player, row, col) {
  if (MP.active) MP.pushBuyAction('buy', row, col);
  executeBuyLocal(player, row, col);
}

function executeBuyLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return;
  const card = slot.card;

  player.discard.push(card);
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} bought ${card.id.replace(/_/g, ' ')} for $${card.cost}.`, 'log-buy');
  revealUncovered(G.pyramid);
  render();

  G.currentBuyerIdx++;

  if (isPyramidEmpty(G.pyramid)) {
    addLog('Store is empty! Round ends.', 'log-score');
    endBuyPhase();
  } else {
    processBuyTurn();
  }
}

// Human burn: push to Firebase (MP) then apply locally
function executeBurn(player, row, col) {
  if (MP.active) MP.pushBuyAction('burn', row, col);
  executeBurnLocal(player, row, col);
}

function executeBurnLocal(player, row, col) {
  const slot = G.pyramid[row][col];
  if (!slot || slot.removed) return;
  slot.removed = true;
  G.selectedPyramidCard = null;

  addLog(`${player.name} burned ${slot.card.id.replace(/_/g, ' ')}.`, 'log-burn');
  revealUncovered(G.pyramid);
  render();

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
  setMessage('AI is buying...');
  clearActions();
  await delay(1000);

  const available = getAvailablePyramidCards(G.pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= ai.roundDollars);

  if (affordable.length > 0) {
    // Score and pick best
    let best = null;
    let bestScore = -Infinity;
    for (const a of affordable) {
      const score = scoreCardForAI(a.slot.card);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    executeBuy(ai, best.row, best.col);
  } else if (available.length > 0) {
    // Burn cheapest card
    let worst = available[0];
    let worstScore = Infinity;
    for (const a of available) {
      const score = scoreCardForAI(a.slot.card);
      if (score < worstScore) {
        worstScore = score;
        worst = a;
      }
    }
    executeBurn(ai, worst.row, worst.col);
  } else {
    addLog('AI has no available cards to buy or burn.');
    G.currentBuyerIdx++;
    processBuyTurn();
  }
}

function scoreCardForAI(card) {
  let score = 0;
  score += card.cows * 3;
  score += card.dollars * 1.5;
  score -= card.bandits * 2;
  if (card.special === 'trash_to_use') score += 2;
  if (card.special === 'copy_next') score += 3;
  if (card.special === 'draw4') score += 2;
  if (card.special === 'look3_rearrange') score += 1.5;
  if (card.special === 'replay_discard') score += 2;
  if (card.special === 'put_on_top') score += 1;
  if (card.special === 'trash_buy_burn_first') score += 1;
  if (card.special === 'dollar1_other') score -= 0.5;
  if (card.cows < 0) score -= 2;
  if (G.currentAct === 3) score += card.cows * 2;
  return score;
}

// --- END PHASES ---

function endBuyPhase() {
  G.phase = 'score';
  scoreRound();
}

async function scoreRound() {
  // Score cows for non-busted players
  for (const player of G.players) {
    if (!player.busted && player.roundCows !== 0) {
      player.herd = Math.max(0, player.herd + player.roundCows);
      addLog(`${player.name} adds ${player.roundCows} cows to herd (total: ${player.herd}).`, 'log-score');
    }

    // Move drawn cards to discard
    player.discard.push(...player.hand);
    player.hand = [];
  }

  render();
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
  const opp = G.players[1];

  let title;
  if (me.herd > opp.herd) {
    title = 'You Win!';
  } else if (opp.herd > me.herd) {
    title = MP.active ? `${opp.name} Wins!` : 'AI Wins!';
  } else {
    title = 'It\'s a Tie!';
  }

  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-scores').innerHTML =
    `<p style="font-size:1.3rem;margin:1rem 0">Your Herd: <strong>${me.herd}</strong> cows</p>` +
    `<p style="font-size:1.3rem;margin:1rem 0">${opp.name}'s Herd: <strong>${opp.herd}</strong> cows</p>`;

  document.getElementById('gameover-screen').classList.remove('hidden');
  addLog(`Game Over! You: ${me.herd} cows, ${opp.name}: ${opp.herd} cows.`, 'log-score');

  if (MP.active) MP.cleanup();
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

function toggleAiZone() {
  const detail = document.getElementById('ai-detail');
  const toggle = document.getElementById('ai-toggle');
  detail.classList.toggle('collapsed');
  toggle.textContent = detail.classList.contains('collapsed') ? '\u25BC' : '\u25B2';
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
