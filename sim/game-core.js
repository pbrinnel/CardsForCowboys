// ============================================================
// Cards For Cowboys - Pure Game Logic (headless, no DOM)
// Extracted from play.js for simulation use
// ============================================================

// --- CARD DATABASE ---
// Synced from play.js STARTER_TEMPLATES + STORE_CARDS (source of truth: CSV).
// minPlayers: 2=all, 3=3+P games, 4=4+P games only.
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
  // --- ACT 1 ---
  // River (Blue) – 1 cacti  [2P]
  { id: 'card_74', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_75', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_76', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_77', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_78', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_79', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_80', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [3+P]
  { id: 'card_65', act: 1, minPlayers: 3, dollars: 0, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [4+P]
  { id: 'card_68', act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_69', act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: null },
  { id: 'card_70', act: 1, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'burn_to_use' },
  // Rattlesnake (Red) – 3 cacti  [2P]
  { id: 'card_46', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_47', act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_48', act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_49', act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [3+P]
  { id: 'card_35', act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_36', act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_37', act: 1, minPlayers: 3, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [4+P]
  { id: 'card_40', act: 1, minPlayers: 4, dollars: 0, cows:  2, bandits:  0, cost: 5, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P]
  { id: 'card_10', act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_11', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_12', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_13', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_14', act: 1, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 2, cacti: 2, special: 'burn_buy_first' },
  { id: 'card_15', act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },
  // Cactus (Yellow) – 2 cacti  [4+P]
  { id: 'card_1',  act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_2',  act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 2, cacti: 2, special: null },
  { id: 'card_3',  act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 3, cacti: 2, special: '2cow_if_first' },

  // --- ACT 2 ---
  // River (Blue) – 1 cacti  [2P]
  { id: 'card_81', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_82', act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_83', act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [3+P]
  { id: 'card_66', act: 2, minPlayers: 3, dollars: 1, cows:  1, bandits:  0, cost: 4, cacti: 1, special: null },
  { id: 'card_67', act: 2, minPlayers: 3, dollars: 0, cows:  2, bandits:  0, cost: 6, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti  [2P]
  { id: 'card_50', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'burn_to_use' },
  { id: 'card_51', act: 2, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost: 4, cacti: 3, special: null },
  { id: 'card_52', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_53', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5, cacti: 3, special: null },
  { id: 'card_54', act: 2, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost: 5, cacti: 3, special: 'draw4' },
  // Rattlesnake (Red) – 3 cacti  [3+P]
  { id: 'card_38', act: 2, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3, cacti: 3, special: null },
  { id: 'card_39', act: 2, minPlayers: 3, dollars: 0, cows:  0, bandits: -1, cost: 4, cacti: 3, special: 'burn_to_use' },
  // Rattlesnake (Red) – 3 cacti  [4+P]
  { id: 'card_41', act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4, cacti: 3, special: null },
  { id: 'card_42', act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4, cacti: 3, special: null },
  { id: 'card_43', act: 2, minPlayers: 4, dollars: 0, cows:  5, bandits:  2, cost: 4, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P]
  { id: 'card_16', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_17', act: 2, minPlayers: 2, dollars: 4, cows:  0, bandits:  1, cost: 3, cacti: 2, special: null },
  { id: 'card_18', act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_19', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'look3_rearrange' },
  { id: 'card_20', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'card_21', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'extra_buy' },
  { id: 'card_22', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_23', act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, cacti: 2, special: 'replay_discard' },
  { id: 'card_24', act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 6, cacti: 2, special: 'dollar1_other' },
  // Cactus (Yellow) – 2 cacti  [4+P]
  { id: 'card_4',  act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits:  0, cost: 6, cacti: 2, special: 'swap_revealed' },
  { id: 'card_5',  act: 2, minPlayers: 4, dollars: 3, cows:  0, bandits:  0, cost: 3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_6',  act: 2, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 4, cacti: 2, special: null },
  { id: 'card_7',  act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits:  0, cost: 4, cacti: 2, special: 'copy_next' },

  // --- ACT 3 ---
  // River (Blue) – 1 cacti  [2P]
  { id: 'card_84', act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_85', act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_86', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_87', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_88', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_89', act: 3, minPlayers: 2, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_90', act: 3, minPlayers: 2, dollars: 2, cows:  3, bandits:  0, cost:  9, cacti: 1, special: null },
  // River (Blue) – 1 cacti  [4+P]
  { id: 'card_71', act: 3, minPlayers: 4, dollars: 0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null },
  { id: 'card_72', act: 3, minPlayers: 4, dollars: 0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_73', act: 3, minPlayers: 4, dollars: 4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti  [2P]
  { id: 'card_55', act: 3, minPlayers: 2, dollars: 3, cows:  3, bandits:  0, cost: 10, cacti: 3, special: null },
  { id: 'card_56', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_57', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_58', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_59', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_60', act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  1, cost:  9, cacti: 3, special: null },
  // Rattlesnake (Red) – 3 cacti  [4+P]
  { id: 'card_44', act: 3, minPlayers: 4, dollars: 0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null },
  { id: 'card_45', act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti  [2P]
  { id: 'card_25', act: 3, minPlayers: 2, dollars: 0, cows:  2, bandits: -1, cost: 10, cacti: 2, special: null },
  { id: 'card_26', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_27', act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_28', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_29', act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_30', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_31', act: 3, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost:  8, cacti: 2, special: 'look3_immediate' },
  { id: 'card_32', act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  9, cacti: 2, special: null },
  // Cactus (Yellow) – 2 cacti  [4+P]
  { id: 'card_8',  act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_9',  act: 3, minPlayers: 4, dollars: 3, cows:  2, bandits:  0, cost:  8, cacti: 2, special: null },
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
    minPlayers: template.minPlayers || 2,
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

// --- PYRAMID ---

// Returns cards for a given act filtered by player count.
function getActPool(act, numPlayers) {
  return STORE_CARDS.filter(c => c.act === act && c.minPlayers <= numPlayers);
}

// Pyramid row counts: 2P=5 rows (15 slots), 3P=6 rows (21), 4P=7 rows (28).
function getNumRows(numPlayers) {
  if (numPlayers >= 4) return 7;
  if (numPlayers >= 3) return 6;
  return 5;
}

function buildPyramid(act, numPlayers) {
  numPlayers = numPlayers || 2;
  const pool = shuffle(getActPool(act, numPlayers));
  const numRows = getNumRows(numPlayers);
  const needed = (numRows * (numRows + 1)) / 2;
  const selected = pool.slice(0, Math.min(needed, pool.length));

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
  return (leftBelow && !leftBelow.removed) || (rightBelow && !rightBelow.removed);
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
  getNumRows,
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
