// ============================================================
// Cards For Cowboys - Pure Game Logic (headless, no DOM)
// Extracted from play.js for simulation use
// ============================================================

// --- CARD DATABASE ---

const STARTER_TEMPLATES = [
  { id: 'starter_dollar1', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 4 },
  { id: 'starter_dollar1cow', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1 },
  { id: 'starter_bandit', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 1 },
  { id: 'starter_banditcow', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 2 },
  { id: 'starter_bandit2cow2', dollars: 0, cows: 2, bandits: 2, cacti: 3, count: 1 },
  { id: 'starter_dollar2', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1 },
];

const STORE_CARDS = [
  // --- ACT 1 ---
  { id: 'act1_1d_3cost_1cac_a', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 3, cacti: 1, special: null },
  { id: 'act1_1d_3cost_1cac_b', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 3, cacti: 1, special: null },
  { id: 'act1_1d_3cost_1cac_c', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 3, cacti: 1, special: null },
  { id: 'act1_1c_4cost_1cac_a', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act1_1c_4cost_1cac_b', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act1_1c_2cost_2cac_a', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_1c_2cost_2cac_b', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_1c_2cost_2cac_c', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_2cow_if_first', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 3, cacti: 2, special: '2cow_if_first' },
  { id: 'act1_trash_buy_burn', act: 1, dollars: 0, cows: 0, bandits: 0, cost: 2, cacti: 2, special: 'trash_buy_burn_first' },
  { id: 'act1_1d_2cost_2cac', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_1d2c_6cost_2cac_a', act: 1, dollars: 1, cows: 2, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act1_1d2c_6cost_2cac_b', act: 1, dollars: 1, cows: 2, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act1_2d_3cost_2cac_a', act: 1, dollars: 2, cows: 0, bandits: 0, cost: 3, cacti: 2, special: null },
  { id: 'act1_2d_3cost_2cac_b', act: 1, dollars: 2, cows: 0, bandits: 0, cost: 3, cacti: 2, special: null },
  { id: 'act1_3d_losecow_a', act: 1, dollars: 3, cows: -1, bandits: 0, cost: 3, cacti: 1, special: 'lose_cow' },
  { id: 'act1_3d_losecow_b', act: 1, dollars: 3, cows: -1, bandits: 0, cost: 3, cacti: 1, special: 'lose_cow' },

  // --- ACT 2 ---
  { id: 'act2_2c_4cost_2cac', act: 2, dollars: 0, cows: 2, bandits: 0, cost: 4, cacti: 2, special: null },
  { id: 'act2_2c_6cost_2cac', act: 2, dollars: 0, cows: 2, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act2_5c2b_4cost_3cac', act: 2, dollars: 0, cows: 5, bandits: 2, cost: 4, cacti: 3, special: null },
  { id: 'act2_1d1c_4cost_1cac_a', act: 2, dollars: 1, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act2_1d1c_4cost_1cac_b', act: 2, dollars: 1, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act2_1d1c_4cost_1cac_c', act: 2, dollars: 1, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act2_3d_5cost_3cac_a', act: 2, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 3, special: null },
  { id: 'act2_3d_5cost_3cac_b', act: 2, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 3, special: null },
  { id: 'act2_4d1b_2cost_2cac', act: 2, dollars: 4, cows: 0, bandits: 1, cost: 2, cacti: 2, special: null },
  { id: 'act2_trash_to_use_a', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 4, cacti: 2, special: 'trash_to_use' },
  { id: 'act2_trash_to_use_b', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 5, cacti: 2, special: 'trash_to_use' },
  { id: 'act2_draw4', act: 2, dollars: 0, cows: 3, bandits: 0, cost: 5, cacti: 2, special: 'draw4' },
  { id: 'act2_put_on_top', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 5, cacti: 2, special: 'put_on_top' },
  { id: 'act2_trash_for_2', act: 2, dollars: 1, cows: 0, bandits: 0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'act2_look3_rearrange', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 4, cacti: 2, special: 'look3_rearrange' },
  { id: 'act2_copy_next', act: 2, dollars: 2, cows: 0, bandits: 0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'act2_trash_replay', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 5, cacti: 2, special: 'replay_discard' },
  { id: 'act2_3d_dollar1_other', act: 2, dollars: 3, cows: 0, bandits: 0, cost: 6, cacti: 2, special: 'dollar1_other' },

  // --- ACT 3 ---
  { id: 'act3_1c_trash_to_use_a', act: 3, dollars: 0, cows: 1, bandits: 0, cost: 5, cacti: 1, special: 'trash_to_use' },
  { id: 'act3_1c_trash_to_use_b', act: 3, dollars: 0, cows: 1, bandits: 0, cost: 5, cacti: 1, special: 'trash_to_use' },
  { id: 'act3_4d_8cost_1cac', act: 3, dollars: 4, cows: 0, bandits: 0, cost: 8, cacti: 1, special: null },
  { id: 'act3_2d3c_9cost_1cac', act: 3, dollars: 2, cows: 3, bandits: 0, cost: 9, cacti: 1, special: null },
  { id: 'act3_3c_7cost_1cac_a', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 7, cacti: 1, special: null },
  { id: 'act3_3c_7cost_1cac_b', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 7, cacti: 1, special: null },
  { id: 'act3_3d_6cost_1cac', act: 3, dollars: 3, cows: 0, bandits: 0, cost: 6, cacti: 1, special: null },
  { id: 'act3_3d_5cost_2cac_a', act: 3, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 2, special: null },
  { id: 'act3_3d_5cost_2cac_b', act: 3, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 2, special: null },
  { id: 'act3_3c_6cost_2cac_a', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act3_3c_6cost_2cac_b', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act3_4c1b_7cost_2cac', act: 3, dollars: 0, cows: 4, bandits: 1, cost: 7, cacti: 2, special: null },
  { id: 'act3_look3_immediate', act: 3, dollars: 0, cows: 0, bandits: 0, cost: 8, cacti: 2, special: 'look3_immediate' },
  { id: 'act3_4c_9cost_2cac', act: 3, dollars: 0, cows: 4, bandits: 0, cost: 9, cacti: 2, special: null },
  { id: 'act3_2c_trash_to_use', act: 3, dollars: 0, cows: 2, bandits: 0, cost: 10, cacti: 2, special: 'trash_to_use' },
  { id: 'act3_5c2b_4cost_3cac', act: 3, dollars: 0, cows: 5, bandits: 2, cost: 4, cacti: 3, special: null },
  { id: 'act3_3d3c_10cost_3cac', act: 3, dollars: 3, cows: 3, bandits: 0, cost: 10, cacti: 3, special: null },
  { id: 'act3_4c_8cost_3cac_a', act: 3, dollars: 0, cows: 4, bandits: 0, cost: 8, cacti: 3, special: null },
  { id: 'act3_4c_8cost_3cac_b', act: 3, dollars: 0, cows: 4, bandits: 0, cost: 8, cacti: 3, special: null },
  { id: 'act3_5c1b_9cost_3cac', act: 3, dollars: 0, cows: 5, bandits: 1, cost: 9, cacti: 3, special: null },
  { id: 'act3_5c_11cost_3cac', act: 3, dollars: 0, cows: 5, bandits: 0, cost: 11, cacti: 3, special: null },
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

function createPlayer(name) {
  return {
    name,
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

// --- PYRAMID ---

function getActPool(act) {
  return STORE_CARDS.filter(c => c.act === act);
}

function buildPyramid(act) {
  const pool = shuffle(getActPool(act));
  const numRows = 5; // 2 players = 15 cards
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

function applyCardEffects(player, card, isFirstCard) {
  let multiplier = player.copyNextActive ? 2 : 1;
  if (player.copyNextActive) {
    player.copyNextActive = false;
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
  }

  return { dollars, cows, bandits };
}

function countBanditsInDeck(player) {
  return player.deck.reduce((sum, c) => sum + c.bandits, 0);
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
