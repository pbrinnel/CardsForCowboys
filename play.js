// ============================================================
// Cards For Cowboys - Game Engine
// ============================================================

const CARD_IMG_PATH = 'assets/cards/';

// --- CARD DATABASE ---

const STARTER_TEMPLATES = [
  { id: 'starter_dollar1', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 4,
    imgs: ['starters/1d_0c_0b_1cac_a.jpg','starters/1d_0c_0b_1cac_b.jpg','starters/1d_0c_0b_1cac_c.jpg','starters/1d_0c_0b_1cac_d.jpg'] },
  { id: 'starter_dollar1cow', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1,
    imgs: ['starters/1d_1c_0b_2cac.jpg'] },
  { id: 'starter_bandit', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 2,
    imgs: ['starters/0d_0c_1b_2cac.jpg','starters/0d_0c_1b_2cac.jpg'] },
  { id: 'starter_banditcow', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 2,
    imgs: ['starters/0d_1c_1b_3cac_a.jpg','starters/0d_1c_1b_3cac_b.jpg'] },
  { id: 'starter_dollar2', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1,
    imgs: ['starters/2d_0c_0b_3cac.jpg'] },
];

const STORE_CARDS = [
  // --- ACT 1 ---
  { id: 'act1_1d_3cost_1cac_a', img: 'act1/1d_0c_0b_3cost_1cac_a.jpg', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 3, cacti: 1, special: null },
  { id: 'act1_1d_3cost_1cac_b', img: 'act1/1d_0c_0b_3cost_1cac_b.jpg', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 3, cacti: 1, special: null },
  { id: 'act1_1d_3cost_1cac_c', img: 'act1/1d_0c_0b_3cost_1cac_c.jpg', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 3, cacti: 1, special: null },
  { id: 'act1_1c_4cost_1cac_a', img: 'act1/0d_1c_0b_4cost_1cac_a.jpg', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act1_1c_4cost_1cac_b', img: 'act1/0d_1c_0b_4cost_1cac_b.jpg', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act1_1c_2cost_2cac_a', img: 'act1/0d_1c_0b_2cost_2cac_a.jpg', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_1c_2cost_2cac_b', img: 'act1/0d_1c_0b_2cost_2cac_b.jpg', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_1c_2cost_2cac_c', img: 'act1/0d_1c_0b_2cost_2cac_c.jpg', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_2cow_if_first', img: 'act1/0d_1c_0b_3cost_2cac_2cow_if_first.jpg', act: 1, dollars: 0, cows: 1, bandits: 0, cost: 3, cacti: 2, special: '2cow_if_first' },
  { id: 'act1_trash_buy_burn', img: 'act1/0d_0c_0b_2cost_2cac_trash_buy_burn_first.jpg', act: 1, dollars: 0, cows: 0, bandits: 0, cost: 2, cacti: 2, special: 'trash_buy_burn_first' },
  { id: 'act1_1d_2cost_2cac', img: 'act1/1d_0c_0b_2cost_2cac.jpg', act: 1, dollars: 1, cows: 0, bandits: 0, cost: 2, cacti: 2, special: null },
  { id: 'act1_1d2c_5cost_2cac_a', img: 'act1/1d_2c_0b_5cost_2cac_a.jpg', act: 1, dollars: 1, cows: 2, bandits: 0, cost: 5, cacti: 2, special: null },
  { id: 'act1_1d2c_5cost_2cac_b', img: 'act1/1d_2c_0b_5cost_2cac_b.jpg', act: 1, dollars: 1, cows: 2, bandits: 0, cost: 5, cacti: 2, special: null },
  { id: 'act1_2d_3cost_2cac_a', img: 'act1/2d_0c_0b_3cost_2cac_a.jpg', act: 1, dollars: 2, cows: 0, bandits: 0, cost: 3, cacti: 2, special: null },
  { id: 'act1_2d_3cost_2cac_b', img: 'act1/2d_0c_0b_3cost_2cac_b.jpg', act: 1, dollars: 2, cows: 0, bandits: 0, cost: 3, cacti: 2, special: null },
  { id: 'act1_3d_losecow_a', img: 'act1/3d_0c_0b_3cost_2cac_lose_cow_a.jpg', act: 1, dollars: 3, cows: -1, bandits: 0, cost: 3, cacti: 2, special: 'lose_cow' },
  { id: 'act1_3d_losecow_b', img: 'act1/3d_0c_0b_3cost_2cac_lose_cow_b.jpg', act: 1, dollars: 3, cows: -1, bandits: 0, cost: 3, cacti: 2, special: 'lose_cow' },

  // --- ACT 2 ---
  { id: 'act2_2c_4cost_2cac', img: 'act2/0d_2c_0b_4cost_2cac_a.jpg', act: 2, dollars: 0, cows: 2, bandits: 0, cost: 4, cacti: 2, special: null },
  { id: 'act2_2c_6cost_1cac', img: 'act2/0d_2c_0b_6cost_1cac.jpg', act: 2, dollars: 0, cows: 2, bandits: 0, cost: 6, cacti: 1, special: null },
  { id: 'act2_3c2b_4cost_3cac', img: 'act2/0d_3c_2b_4cost_3cac.jpg', act: 2, dollars: 0, cows: 3, bandits: 2, cost: 4, cacti: 3, special: null },
  { id: 'act2_1d1c_4cost_1cac_a', img: 'act2/1d_1c_0b_4cost_1cac_a.jpg', act: 2, dollars: 1, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act2_1d1c_4cost_1cac_b', img: 'act2/1d_1c_0b_4cost_1cac_b.jpg', act: 2, dollars: 1, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act2_1d1c_4cost_1cac_c', img: 'act2/1d_1c_0b_4cost_1cac_c.jpg', act: 2, dollars: 1, cows: 1, bandits: 0, cost: 4, cacti: 1, special: null },
  { id: 'act2_3d_5cost_3cac_a', img: 'act2/3d_0c_0b_5cost_3cac_a.jpg', act: 2, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 3, special: null },
  { id: 'act2_3d_5cost_3cac_b', img: 'act2/3d_0c_0b_5cost_3cac_b.jpg', act: 2, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 3, special: null },
  { id: 'act2_3d1b_3cost_2cac', img: 'act2/3d_0c_1b_3cost_2cac_a.jpg', act: 2, dollars: 3, cows: 0, bandits: 1, cost: 3, cacti: 2, special: null },
  { id: 'act2_trash_to_use_a', img: 'act2/0d_0c_0b_4cost_2cac_trash_to_use_a.jpg', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 4, cacti: 2, special: 'trash_to_use' },
  { id: 'act2_trash_to_use_b', img: 'act2/0d_0c_0b_5cost_2cac_trash_to_use_b.jpg', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 5, cacti: 2, special: 'trash_to_use' },
  { id: 'act2_draw3', img: 'act2/0d_2c_0b_5cost_2cac_draw3.jpg', act: 2, dollars: 0, cows: 2, bandits: 0, cost: 5, cacti: 2, special: 'draw3' },
  { id: 'act2_put_on_top', img: 'act2/0d_0c_0b_5cost_2cac_put_on_top.jpg', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 5, cacti: 2, special: 'put_on_top' },
  { id: 'act2_trash_for_2', img: 'act2/1d_0c_0b_2cost_2cac_trash_for_2.jpg', act: 2, dollars: 1, cows: 0, bandits: 0, cost: 2, cacti: 2, special: 'trash_for_2' },
  { id: 'act2_look3_rearrange', img: 'act2/0d_0c_0b_4cost_2cac_look3_rearrange.jpg', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 4, cacti: 2, special: 'look3_rearrange' },
  { id: 'act2_copy_next', img: 'act2/2d_0c_0b_4cost_2cac_copy_next.jpg', act: 2, dollars: 2, cows: 0, bandits: 0, cost: 4, cacti: 2, special: 'copy_next' },
  { id: 'act2_trash_replay', img: 'act2/0d_0c_0b_5cost_2cac_trash_replay.jpg', act: 2, dollars: 0, cows: 0, bandits: 0, cost: 5, cacti: 2, special: 'replay_discard' },
  { id: 'act2_3d_dollar1_other', img: 'act2/3d_0c_0b_6cost_2cac_dollar1_other.jpg', act: 2, dollars: 3, cows: 0, bandits: 0, cost: 6, cacti: 2, special: 'dollar1_other' },

  // --- ACT 3 ---
  { id: 'act3_1c_trash_to_use_a', img: 'act3/0d_1c_0b_5cost_1cac_trash_to_use_a.jpg', act: 3, dollars: 0, cows: 1, bandits: 0, cost: 5, cacti: 1, special: 'trash_to_use' },
  { id: 'act3_1c_trash_to_use_b', img: 'act3/0d_1c_0b_5cost_1cac_trash_to_use_b.jpg', act: 3, dollars: 0, cows: 1, bandits: 0, cost: 5, cacti: 1, special: 'trash_to_use' },
  { id: 'act3_4d_8cost_1cac', img: 'act3/4d_0c_0b_8cost_1cac.jpg', act: 3, dollars: 4, cows: 0, bandits: 0, cost: 8, cacti: 1, special: null },
  { id: 'act3_2d3c_9cost_1cac', img: 'act3/2d_3c_0b_9cost_1cac.jpg', act: 3, dollars: 2, cows: 3, bandits: 0, cost: 9, cacti: 1, special: null },
  { id: 'act3_3c_7cost_1cac_a', img: 'act3/0d_3c_0b_7cost_1cac_a.jpg', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 7, cacti: 1, special: null },
  { id: 'act3_3c_7cost_1cac_b', img: 'act3/0d_3c_0b_7cost_1cac_b.jpg', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 7, cacti: 1, special: null },
  { id: 'act3_3d_6cost_1cac', img: 'act3/3d_0c_0b_6cost_1cac.jpg', act: 3, dollars: 3, cows: 0, bandits: 0, cost: 6, cacti: 1, special: null },
  { id: 'act3_3d_5cost_2cac_a', img: 'act3/3d_0c_0b_5cost_2cac_a.jpg', act: 3, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 2, special: null },
  { id: 'act3_3d_5cost_2cac_b', img: 'act3/3d_0c_0b_5cost_2cac_b.jpg', act: 3, dollars: 3, cows: 0, bandits: 0, cost: 5, cacti: 2, special: null },
  { id: 'act3_3c_6cost_2cac_a', img: 'act3/0d_3c_0b_6cost_2cac_a.jpg', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act3_3c_6cost_2cac_b', img: 'act3/0d_3c_0b_6cost_2cac_b.jpg', act: 3, dollars: 0, cows: 3, bandits: 0, cost: 6, cacti: 2, special: null },
  { id: 'act3_3c1b_7cost_2cac', img: 'act3/0d_3c_1b_7cost_2cac.jpg', act: 3, dollars: 0, cows: 3, bandits: 1, cost: 7, cacti: 2, special: null },
  { id: 'act3_look3_immediate', img: 'act3/0d_0c_0b_8cost_2cac_look3_immediate.jpg', act: 3, dollars: 0, cows: 0, bandits: 0, cost: 8, cacti: 2, special: 'look3_immediate' },
  { id: 'act3_4c_9cost_2cac', img: 'act3/0d_4c_0b_9cost_2cac.jpg', act: 3, dollars: 0, cows: 4, bandits: 0, cost: 9, cacti: 2, special: null },
  { id: 'act3_2c_trash_to_use', img: 'act3/0d_2c_0b_10cost_2cac_trash_to_use.jpg', act: 3, dollars: 0, cows: 2, bandits: 0, cost: 10, cacti: 2, special: 'trash_to_use' },
  { id: 'act3_3c2b_4cost_3cac', img: 'act3/0d_3c_2b_4cost_3cac.jpg', act: 3, dollars: 0, cows: 3, bandits: 2, cost: 4, cacti: 3, special: null },
  { id: 'act3_3d3c_10cost_3cac', img: 'act3/3d_3c_0b_10cost_3cac.jpg', act: 3, dollars: 3, cows: 3, bandits: 0, cost: 10, cacti: 3, special: null },
  { id: 'act3_4c_8cost_3cac_a', img: 'act3/0d_4c_0b_8cost_3cac_a.jpg', act: 3, dollars: 0, cows: 4, bandits: 0, cost: 8, cacti: 3, special: null },
  { id: 'act3_4c_8cost_3cac_b', img: 'act3/0d_4c_0b_8cost_3cac_b.jpg', act: 3, dollars: 0, cows: 4, bandits: 0, cost: 8, cacti: 3, special: null },
  { id: 'act3_3c1b_9cost_3cac', img: 'act3/0d_3c_1b_9cost_3cac.jpg', act: 3, dollars: 0, cows: 3, bandits: 1, cost: 9, cacti: 3, special: null },
  { id: 'act3_5c_11cost_3cac', img: 'act3/0d_5c_0b_11cost_3cac.jpg', act: 3, dollars: 0, cows: 5, bandits: 0, cost: 11, cacti: 3, special: null },
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
      const imgFile = tmpl.imgs ? tmpl.imgs[i % tmpl.imgs.length] : tmpl.img;
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

function initState() {
  uidCounter = 0;
  return {
    currentAct: 1,
    phase: 'start',
    roundNumber: 1,
    players: [createPlayer('You', true), createPlayer('Cowboy AI', false)],
    pyramid: [],
    log: [],
    buyOrder: [],
    currentBuyerIdx: 0,
    selectedPyramidCard: null,
    busy: false,
  };
}

// --- PYRAMID ---

function buildPyramid(act) {
  const pool = shuffle(getActPool(act));
  const numRows = 5; // 2 players
  const needed = (numRows * (numRows + 1)) / 2; // 15
  if (pool.length < needed) {
    console.warn(`Act ${act} only has ${pool.length} cards, need ${needed}. Using all available.`);
  }
  const selected = pool.slice(0, Math.min(needed, pool.length));
  console.log(`Built pyramid for Act ${act}: ${selected.length} cards from pool of ${pool.length}`, selected.map(c => c.id));

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

  // Special: lose_cow (the cow reduction happens at scoring, tracked via roundCows)

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
    return CARD_IMG_PATH + 'backs/back-' + card.cacti + 'cac.png';
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
  return div;
}

function render() {
  if (!G || G.phase === 'start') return;

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
  const statsEl = document.getElementById(prefix + '-round-stats');
  if (player.hand.length > 0 || G.phase === 'buy') {
    statsEl.classList.remove('hidden');
    document.getElementById(prefix + '-round-dollars').textContent = player.roundDollars;
    document.getElementById(prefix + '-round-cows').textContent = player.roundCows;
    document.getElementById(prefix + '-round-bandits').textContent = player.roundBandits;
  } else {
    statsEl.classList.add('hidden');
  }

  // Hand
  const handEl = document.getElementById(prefix + '-hand');
  handEl.innerHTML = '';

  const showFaceUp = true;

  for (const card of player.hand) {
    const el = renderCardEl(card, showFaceUp, player.busted ? 'busted' : '');
    handEl.appendChild(el);
  }

  // Deck preview (show back of next card) - human player only
  if (prefix === 'player') {
    renderDeckPreview(player);
  }
}

function renderDeckPreview(player) {
  const previewEl = document.getElementById('player-deck-preview');
  previewEl.innerHTML = '';

  if (player.deck.length > 0 && G.phase === 'draw' && !player.busted && !player.stoppedDrawing) {
    const nextCard = player.deck[0];
    const el = renderCardEl(nextCard, false); // face-down shows the back
    previewEl.appendChild(el);
    const label = document.createElement('div');
    label.className = 'deck-label';
    label.textContent = 'Next';
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
}

// --- GAME FLOW ---

function startGame() {
  G = initState();
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  setupAct(1);
}

function restartGame() {
  startGame();
}

function setupAct(act) {
  G.currentAct = act;
  G.roundNumber = 1;
  G.pyramid = buildPyramid(act);

  // Between acts, merge everything back and reshuffle
  for (const player of G.players) {
    const allCards = [...player.deck, ...player.discard, ...player.hand];
    player.deck = shuffle(allCards);
    player.discard = [];
    player.hand = [];
    resetPlayerRound(player);
  }

  addLog(`--- Act ${act} begins! ---`, 'log-score');
  render();
  startRound();
}

function startRound() {
  for (const player of G.players) {
    resetPlayerRound(player);
  }
  G.selectedPyramidCard = null;
  G.phase = 'draw';
  G.roundNumber = G.roundNumber;
  G.playerDrawDone = false;
  G.aiDrawDone = false;

  addLog(`Round ${G.roundNumber} - Draw Phase`);
  render();
  // Start both players drawing simultaneously
  startPlayerDraw();
  G.aiDrawPromise = aiDrawPhase();
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

  // Handle special: draw3
  if (card.special === 'draw3') {
    addLog('Draw 3 more cards!');
    G.busy = false;
    for (let i = 0; i < 3; i++) {
      await delay(400);
      if (player.busted) break;
      const extraCard = drawFromDeck(player);
      if (!extraCard) break;
      player.hand.push(extraCard);
      applyCardEffects(player, extraCard, false);
      render();
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
  checkDrawPhaseComplete();
}

function checkDrawPhaseComplete() {
  if (G.playerDrawDone && G.aiDrawDone) {
    onDrawPhaseComplete();
  } else if (G.playerDrawDone) {
    setMessage('Waiting for AI to finish drawing...');
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

    // Handle draw3
    if (card.special === 'draw3' && !ai.busted) {
      for (let i = 0; i < 3; i++) {
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
  await delay(1500);

  // Move all drawn cards to discard
  player.discard.push(...player.hand);
  player.hand = [];
  player.roundDollars = 0;
  player.roundCows = 0;
  render();

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

  const p0 = G.players[0];
  const p1 = G.players[1];

  // Check hasBuyBurnFirst (special card overrides)
  if (p0.hasBuyBurnFirst && !p0.busted) {
    G.buyOrder = [0, 1];
    addLog('--- Buy Phase --- (You have first buy priority!)');
    G.currentBuyerIdx = 0;
    render();
    processBuyTurn();
    return;
  } else if (p1.hasBuyBurnFirst && !p1.busted) {
    G.buyOrder = [1, 0];
    addLog('--- Buy Phase --- (AI has first buy priority!)');
    G.currentBuyerIdx = 0;
    render();
    processBuyTurn();
    return;
  }

  // Determine who CHOOSES the buy order (most $ chooses, with tiebreakers)
  let chooserIdx;
  if (p0.busted && !p1.busted) {
    chooserIdx = 1;
  } else if (p1.busted && !p0.busted) {
    chooserIdx = 0;
  } else if (p0.busted && p1.busted) {
    // Both busted, no buying
    G.buyOrder = [0, 1];
    G.currentBuyerIdx = 0;
    addLog('--- Buy Phase --- (Both busted!)');
    render();
    processBuyTurn();
    return;
  } else if (p0.roundDollars > p1.roundDollars) {
    chooserIdx = 0;
  } else if (p1.roundDollars > p0.roundDollars) {
    chooserIdx = 1;
  } else if (p0.roundCows > p1.roundCows) {
    chooserIdx = 0;
  } else if (p1.roundCows > p0.roundCows) {
    chooserIdx = 1;
  } else if (p0.hand.length > p1.hand.length) {
    chooserIdx = 0;
  } else if (p1.hand.length > p0.hand.length) {
    chooserIdx = 1;
  } else {
    chooserIdx = Math.random() < 0.5 ? 0 : 1; // random tiebreak
  }

  if (chooserIdx === 0) {
    // Human chooses who buys first
    addLog('--- Buy Phase --- You have the most $, choose who buys first.');
    setMessage(`Buy Phase - You have $${p0.roundDollars} vs AI's $${p1.roundDollars}. Who buys first?`);
    setActions([
      { text: 'I Buy First', onClick: () => {
        G.buyOrder = [0, 1];
        G.currentBuyerIdx = 0;
        addLog('You chose to buy first.');
        render();
        processBuyTurn();
      }},
      { text: 'AI Buys First', onClick: () => {
        G.buyOrder = [1, 0];
        G.currentBuyerIdx = 0;
        addLog('You chose AI to buy first.');
        render();
        processBuyTurn();
      }, className: 'btn-secondary' },
    ]);
    render();
  } else {
    // AI chooses - AI always buys first when it has the choice
    G.buyOrder = [1, 0];
    G.currentBuyerIdx = 0;
    addLog('--- Buy Phase --- AI has the most $ and chooses to buy first.');
    render();
    processBuyTurn();
  }
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
  } else {
    aiBuyTurn(player);
  }
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

  const buttons = [];
  if (canAfford) {
    buttons.push({ text: `Buy ($${slot.card.cost})`, onClick: () => executeBuy(player, row, col) });
  }
  buttons.push({ text: 'Burn (Remove)', onClick: () => executeBurn(player, row, col), className: 'btn-burn' });
  buttons.push({ text: 'Cancel', onClick: () => {
    G.selectedPyramidCard = null;
    humanBuyTurn(player);
  }, className: 'btn-secondary' });

  setActions(buttons);
}

function executeBuy(player, row, col) {
  const slot = G.pyramid[row][col];
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

function executeBurn(player, row, col) {
  const slot = G.pyramid[row][col];
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
  if (card.special === 'draw3') score += 2;
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
    startRound();
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

  setupAct(nextAct);
}

function gameOver() {
  G.phase = 'gameOver';
  const p = G.players[0];
  const ai = G.players[1];

  let title;
  if (p.herd > ai.herd) {
    title = 'You Win!';
  } else if (ai.herd > p.herd) {
    title = 'AI Wins!';
  } else {
    title = 'It\'s a Tie!';
  }

  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-scores').innerHTML =
    `<p style="font-size:1.3rem;margin:1rem 0">Your Herd: <strong>${p.herd}</strong> cows</p>` +
    `<p style="font-size:1.3rem;margin:1rem 0">AI Herd: <strong>${ai.herd}</strong> cows</p>`;

  document.getElementById('gameover-screen').classList.remove('hidden');
  addLog(`Game Over! You: ${p.herd} cows, AI: ${ai.herd} cows.`, 'log-score');
}

// --- RULES MODAL ---

function showRules() {
  document.getElementById('rules-modal').classList.remove('hidden');
}

function closeRules() {
  document.getElementById('rules-modal').classList.add('hidden');
}

// --- IMAGE PRELOADER ---

function preloadImages() {
  const imgs = new Set();
  for (const tmpl of STARTER_TEMPLATES) {
    for (const img of tmpl.imgs) {
      imgs.add(CARD_IMG_PATH + img);
    }
  }
  for (const card of STORE_CARDS) {
    imgs.add(CARD_IMG_PATH + card.img);
  }
  for (let i = 1; i <= 3; i++) {
    imgs.add(CARD_IMG_PATH + 'backs/back-' + i + 'cac.png');
  }
  for (const src of imgs) {
    const img = new Image();
    img.src = src;
  }
}

// --- INIT ---
preloadImages();
