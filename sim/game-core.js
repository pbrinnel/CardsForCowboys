// ============================================================
// Cards For Cowboys - Pure Game Logic (headless, no DOM)
// Extracted from play.js for simulation use
// ============================================================

// --- CARD DATABASE ---
// Synced from play.js STARTER_TEMPLATES + STORE_CARDS (source of truth: CSV).
// ⚠️ Guarded by `node sim/test-card-sync.js` — run it after ANY card edit on either side.
//    Do not hand-edit this array; the July 2026 card_84/card_85 drift is what the guard exists
//    to catch. Regenerate mechanically from play.js instead.
//
// 54 LIVE cards, exactly 18 per act. `deprecated: true` = cut in the July 2026 single-Store
// rework; retained so historical card ids still resolve, but getActPool filters them so they
// can never be dealt. The old `minPlayers` tier (3+P / 4+P card sets) is GONE — every player
// count draws from the same per-act pool (5-8P doubles it; see getActPool).
// bandits: -1 = auto-reduces roundBandits by 1 when drawn.

const STARTER_TEMPLATES = [
  { id: 'starter_91', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1 },
  { id: 'starter_92', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1 },
  { id: 'starter_93', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1 },
  { id: 'starter_94', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1 },
  { id: 'starter_61', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1 },
  { id: 'starter_62', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1 },
  { id: 'starter_63', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1 },
  { id: 'starter_64', dollars: 0, cows: 2, bandits: 2, cacti: 3, count: 1 },
  { id: 'starter_33', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1 },
  { id: 'starter_34', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 1 },
];

const STORE_CARDS = [
  // --- ACT 1 (18 live) ---
  // River (Blue) – 1 cacti
  { id: 'card_70',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_74',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null },
  { id: 'card_77',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_78',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_79',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_80',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_35',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_36',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_37',   act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_40',   act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_46',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_47',   act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_48',   act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_49',   act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_1',    act: 1, dollars:  1, cows:  0, bandits:  0, cost:  2, cacti: 2, special: null },
  { id: 'card_10',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  2, cacti: 2, special: null },
  { id: 'card_11',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null },
  { id: 'card_12',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null },

  // --- ACT 2 (18 live) ---
  // River (Blue) – 1 cacti
  { id: 'card_66',   act: 2, dollars:  1, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_67',   act: 2, dollars:  0, cows:  2, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_81',   act: 2, dollars:  1, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_82',   act: 2, dollars:  1, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_83',   act: 2, dollars:  0, cows:  2, bandits:  0, cost:  6, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_5',    act: 2, dollars:  3, cows:  0, bandits:  0, cost:  3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_16',   act: 2, dollars:  3, cows:  0, bandits:  0, cost:  3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_22',   act: 2, dollars:  3, cows:  0, bandits:  0, cost:  3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_38',   act: 2, dollars:  0, cows:  3, bandits:  0, cost:  5, cacti: 3, special: 'draw4' },
  { id: 'card_41',   act: 2, dollars:  2, cows:  1, bandits:  0, cost:  4, cacti: 3, special: null },
  { id: 'card_42',   act: 2, dollars:  2, cows:  1, bandits:  0, cost:  4, cacti: 3, special: null },
  { id: 'card_43',   act: 2, dollars:  0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_51',   act: 2, dollars:  0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_52',   act: 2, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_53',   act: 2, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_54',   act: 2, dollars:  0, cows:  3, bandits:  0, cost:  5, cacti: 3, special: 'draw4' },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_6',    act: 2, dollars:  2, cows:  0, bandits:  0, cost:  4, cacti: 2, special: null },
  { id: 'card_18',   act: 2, dollars:  0, cows:  2, bandits:  0, cost:  4, cacti: 2, special: null },

  // --- ACT 3 (18 live) ---
  // River (Blue) – 1 cacti
  { id: 'card_72',   act: 3, dollars:  0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_73',   act: 3, dollars:  4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_86',   act: 3, dollars:  3, cows:  0, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_88',   act: 3, dollars:  0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_89',   act: 3, dollars:  4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_90',   act: 3, dollars:  2, cows:  3, bandits:  0, cost:  9, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_45',   act: 3, dollars:  0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_57',   act: 3, dollars:  0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_58',   act: 3, dollars:  0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_59',   act: 3, dollars:  0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_9',    act: 3, dollars:  3, cows:  2, bandits:  0, cost:  8, cacti: 2, special: null },
  { id: 'card_26',   act: 3, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_28',   act: 3, dollars:  0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_29',   act: 3, dollars:  0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_30',   act: 3, dollars:  0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_32',   act: 3, dollars:  0, cows:  4, bandits:  0, cost:  9, cacti: 2, special: null },
  { id: 'card_84',   act: 3, dollars:  0, cows:  0, bandits: -1, cost:  5, cacti: 2, special: 'draw4' },
  { id: 'card_85',   act: 3, dollars:  0, cows:  0, bandits: -1, cost:  5, cacti: 2, special: 'draw4' },

  // --- DEPRECATED (never dealt; retained so historical ids still resolve) ---
  // was Act 1
  { id: 'card_2',    act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null, deprecated: true },
  { id: 'card_3',    act: 1, dollars:  0, cows:  1, bandits:  0, cost:  3, cacti: 2, special: '2cow_if_first', deprecated: true },
  { id: 'card_13',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null, deprecated: true },
  { id: 'card_14',   act: 1, dollars:  0, cows:  0, bandits:  0, cost:  2, cacti: 2, special: 'burn_buy_first', deprecated: true },
  { id: 'card_15',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  3, cacti: 2, special: '2cow_if_first', deprecated: true },
  { id: 'card_65',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null, deprecated: true },
  { id: 'card_68',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  { id: 'card_69',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  { id: 'card_75',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  { id: 'card_76',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  // was Act 2
  { id: 'card_4',    act: 2, dollars:  0, cows:  0, bandits:  0, cost:  6, cacti: 2, special: 'swap_revealed', deprecated: true },
  { id: 'card_7',    act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'copy_next', deprecated: true },
  { id: 'card_17',   act: 2, dollars:  4, cows:  0, bandits:  1, cost:  3, cacti: 2, special: null, deprecated: true },
  { id: 'card_19',   act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'look3_rearrange', deprecated: true },
  { id: 'card_20',   act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'copy_next', deprecated: true },
  { id: 'card_21',   act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'extra_buy', deprecated: true },
  { id: 'card_23',   act: 2, dollars:  0, cows:  0, bandits:  0, cost:  5, cacti: 2, special: 'replay_discard', deprecated: true },
  { id: 'card_24',   act: 2, dollars:  3, cows:  0, bandits:  0, cost:  6, cacti: 2, special: 'dollar1_other', deprecated: true },
  { id: 'card_39',   act: 2, dollars:  0, cows:  0, bandits: -1, cost:  4, cacti: 3, special: 'burn_to_use', deprecated: true },
  { id: 'card_50',   act: 2, dollars:  0, cows:  0, bandits: -1, cost:  4, cacti: 3, special: 'burn_to_use', deprecated: true },
  // was Act 3
  { id: 'card_8',    act: 3, dollars:  0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null, deprecated: true },
  { id: 'card_25',   act: 3, dollars:  0, cows:  2, bandits: -1, cost: 10, cacti: 2, special: null, deprecated: true },
  { id: 'card_27',   act: 3, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null, deprecated: true },
  { id: 'card_31',   act: 3, dollars:  0, cows:  0, bandits:  0, cost:  8, cacti: 2, special: 'look3_immediate', deprecated: true },
  { id: 'card_44',   act: 3, dollars:  0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null, deprecated: true },
  { id: 'card_55',   act: 3, dollars:  3, cows:  3, bandits:  0, cost: 10, cacti: 3, special: null, deprecated: true },
  { id: 'card_56',   act: 3, dollars:  0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null, deprecated: true },
  { id: 'card_60',   act: 3, dollars:  0, cows:  5, bandits:  1, cost:  9, cacti: 3, special: null, deprecated: true },
  { id: 'card_71',   act: 3, dollars:  0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null, deprecated: true },
  { id: 'card_87',   act: 3, dollars:  0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null, deprecated: true },
];

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

// --- CARD CREATION ---

function createCardInstance(template) {
  return {
    uid: uid(),
    id: template.id,
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
      deck.push(createCardInstance(tmpl));
    }
  }
  return shuffle(deck);
}

function createPlayer(name, personality) {
  return {
    name,
    personality: personality || null,
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
    copyNextCard: null,
    copyNextDonor: null,
    hasBuyBurnFirst: false,
    hasExtraBuy: false,
    extraBuyUsed: false,
  };
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
}

// --- THE STORE ---
//
// ONE Store, built ONCE at the start of the game (July 2026 single-Store rework). It holds
// three ACT TIERS laid back-to-front: Act 3 at row 0, Act 2 in the middle, Act 1 at the front
// (the only face-up row). Play eats it front-to-back, so act progression is EMERGENT — there
// is no per-act rebuild and no between-act deck reshuffle.
//
// Rows are uniform width and ODD rows are brick-offset a half card, so "2 cover 1" overlap is
// GEOMETRIC, not index-based. Mirrors play.js STORE_WIDTH / rowsPerTier / storeRows / rowAct /
// pyramidColCenter / buildPyramid / isCardCovered / storeStage.
//
//   Players    2    3    4  |  5    6    7    8
//   Width      5    7    9  |  8    9   10   11
//   Rows       6    6    6  |  9    9    9    9
//   Cards/act 10   14   18  | 24   27   30   33
//   Store     30   42   54  | 72   81   90   99
//
// SIGNATURE NOTE: play.js reads G.numPlayers from a global. The sim has no G, so BUILD-time
// helpers take numPlayers explicitly, while QUERY-time helpers derive their geometry from the
// pyramid itself (width = row length, rowsPerTier = rows / 3). That keeps every existing
// call site — isCardCovered(pyramid, row, col), revealUncovered(pyramid) — unchanged.
const STORE_WIDTH = { 2: 5, 3: 7, 4: 9, 5: 8, 6: 9, 7: 10, 8: 11 };
const DEFAULT_PYRAMID_WIDTH = 7;   // fallback only

// The cards eligible for one act tier. Every player count draws from the SAME 18-card per-act
// pool; deprecated cards are never dealt. 2-4P take 10/14/18 of the 18 (one deck); 5-8P need
// 24-33, which exceeds 18, so they play with a SECOND deck (36). createCardInstance gives each
// its own uid, so only card.id repeats.
function getActPool(act, numPlayers) {
  const pool = STORE_CARDS.filter(c => c.act === act && !c.deprecated);
  if (numPlayers >= 5) return pool.concat(pool);
  return pool;
}

// --- build-time geometry (takes numPlayers) ---
function pyramidWidth(numPlayers) { return STORE_WIDTH[numPlayers] || DEFAULT_PYRAMID_WIDTH; }
function rowsPerTier(numPlayers)  { return (numPlayers <= 4) ? 2 : 3; }
function storeRows(numPlayers)    { return rowsPerTier(numPlayers) * 3; }

// --- query-time geometry (derives from the pyramid) ---
function rowsPerTierOf(pyramid) { return pyramid.length / 3; }

// The act tier a row belongs to: rows 0..(t-1) are Act 3, the middle t are Act 2, the front t
// are Act 1.
function rowAct(pyramid, row) { return 3 - Math.floor(row / rowsPerTierOf(pyramid)); }

// Horizontal center of (row,col) in card-width units (origin = Store center). All rows are the
// same width; odd rows shift a half card right (BRICK offset).
function pyramidColCenter(pyramid, row, col) {
  let col0 = -(pyramid[row].length - 1) / 2;  // centered
  if (row % 2 === 1) col0 += 0.5;             // brick
  return col0 + col;
}

// How far along the game is, as 1|2|3 — the AI's "which act am I in" lens, replacing the
// retired G.currentAct. It is the act tier of the FRONTMOST row still holding a card: at the
// start the Act 1 rows are on offer (stage 1, economy lens); by the end only Act 3 remains
// (stage 3, cow lens). Pure and derived from shared state, so every client agrees.
function storeStage(pyramid) {
  if (!pyramid || !pyramid.length) return 1;
  for (let row = pyramid.length - 1; row >= 0; row--) {
    if (pyramid[row].some(slot => slot && !slot.removed)) return rowAct(pyramid, row);
  }
  return 3;  // Store empty — the game is over anyway
}

// Build the whole Store in one pass. Each act tier is shuffled and sliced independently, then
// laid top-to-bottom Act 3 → Act 2 → Act 1, so the front rows reachable at the start are Act 1.
function buildPyramid(numPlayers) {
  numPlayers = numPlayers || 2;
  const numRows = storeRows(numPlayers);
  const width   = pyramidWidth(numPlayers);
  const perTier = rowsPerTier(numPlayers) * width;   // cards in one act tier

  const selected = [];
  for (const act of [3, 2, 1]) {                     // top tier first — row 0 is the back
    const pool = shuffle(getActPool(act, numPlayers));
    selected.push(...pool.slice(0, Math.min(perTier, pool.length)));
  }

  const pyramid = [];
  let idx = 0;
  for (let row = 0; row < numRows; row++) {
    const rowArr = [];
    for (let col = 0; col < width; col++) {
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

// A card is covered if any non-removed card in the row below horizontally overlaps it (centers
// within ~half a card). Geometry-based, so the brick offset is handled uniformly: interior
// cards have 2 coverers, the one overhang end card per row has 1.
function isCardCovered(pyramid, row, col) {
  if (row >= pyramid.length - 1) return false;
  const myX = pyramidColCenter(pyramid, row, col);
  const nextRow = pyramid[row + 1];
  for (let c = 0; c < nextRow.length; c++) {
    const s = nextRow[c];
    if (s && !s.removed && Math.abs(pyramidColCenter(pyramid, row + 1, c) - myX) < 0.9) {
      return true;
    }
  }
  return false;
}

function revealUncovered(pyramid) {
  for (let row = 0; row < pyramid.length; row++) {
    for (let col = 0; col < pyramid[row].length; col++) {
      const slot = pyramid[row][col];
      if (!slot.removed && !slot.faceUp && !isCardCovered(pyramid, row, col)) {
        slot.faceUp = true;
      }
    }
  }
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
    if (player.deck.length > 1) {
      player.deck.push(player.deck.shift());
    }
  }
  return player.deck.shift();
}

// --- CARD EFFECTS ---

// Activatable specials that give nothing at draw time (effects deferred to activation)
const ACTIVATABLE_ON_DRAW = new Set(['burn_to_use', 'extra_buy']);

function applyCardEffects(player, card, isFirstCard) {
  let multiplier = 1;

  if (player.copyNextActive) {
    player.copyNextActive = false;
    if (ACTIVATABLE_ON_DRAW.has(card.special)) {
      // Activatable donor: link Copy Next as a second burnable copy; no stat doubling.
      player.copyNextDonor = card;
    } else {
      multiplier = 2;
      player.copyNextCard = null;
    }
  }

  // burn_to_use / extra_buy give nothing at draw time (after copyNextActive is handled above)
  if (ACTIVATABLE_ON_DRAW.has(card.special)) {
    return { dollars: 0, cows: 0, bandits: 0 };
  }

  let dollars = card.dollars * multiplier;
  let cows = card.cows * multiplier;
  let bandits = card.bandits * multiplier;

  if (card.special === '2cow_if_first' && isFirstCard) {
    cows = 2;
  }

  player.roundDollars += dollars;
  player.roundCows += cows;
  player.roundBandits += bandits;

  if (card.special === 'copy_next') {
    player.copyNextActive = true;
    player.copyNextCard = card;
    player.copyNextDonor = null;
  }

  return { dollars, cows, bandits };
}

function countBanditsInDeck(player) {
  return player.deck.reduce((sum, c) => sum + Math.max(0, c.bandits), 0);
}

// --- EXPORTS ---

module.exports = {
  STARTER_TEMPLATES,
  STORE_CARDS,
  shuffle,
  createCardInstance,
  createStarterDeck,
  createPlayer,
  resetPlayerRound,
  getActPool,
  STORE_WIDTH,
  pyramidWidth,
  rowsPerTier,
  storeRows,
  rowAct,
  pyramidColCenter,
  storeStage,
  buildPyramid,
  isCardCovered,
  revealUncovered,
  getAvailablePyramidCards,
  isPyramidEmpty,
  drawFromDeck,
  applyCardEffects,
  countBanditsInDeck,
  resetUidCounter() { uidCounter = 0; },
};
