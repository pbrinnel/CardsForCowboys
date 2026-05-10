#!/usr/bin/env node
// simulate.js — headless game simulation for Cards For Cowboys
// Usage: node simulate.js [numGames]
// Reports how often the showdown changes who wins, across 2P / 3P / 4P.
'use strict';

// ─── CARD DATA (mirrored from play.js) ───────────────────────────────────────

const STARTER_TEMPLATES = [
  { id: 'starter_91', dollars: 1, cows: 0, bandits: 0, count: 1 },
  { id: 'starter_92', dollars: 1, cows: 0, bandits: 0, count: 1 },
  { id: 'starter_93', dollars: 1, cows: 0, bandits: 0, count: 1 },
  { id: 'starter_94', dollars: 1, cows: 0, bandits: 0, count: 1 },
  { id: 'starter_61', dollars: 2, cows: 0, bandits: 0, count: 1 },
  { id: 'starter_62', dollars: 0, cows: 1, bandits: 1, count: 1 },
  { id: 'starter_63', dollars: 0, cows: 1, bandits: 1, count: 1 },
  { id: 'starter_64', dollars: 0, cows: 2, bandits: 2, count: 1 },
  { id: 'starter_33', dollars: 1, cows: 1, bandits: 0, count: 1 },
  { id: 'starter_34', dollars: 0, cows: 0, bandits: 1, count: 1 },
];

const STORE_CARDS = [
  // ACT 1
  { id: 'card_74',  act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_75',  act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_76',  act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_77',  act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, special: 'burn_to_use' },
  { id: 'card_78',  act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3, special: 'burn_to_use' },
  { id: 'card_79',  act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_80',  act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_65',  act: 1, minPlayers: 3, dollars: 0, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_68',  act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_69',  act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_70',  act: 1, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 3, special: 'burn_to_use' },
  { id: 'card_46',  act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_47',  act: 1, minPlayers: 2, dollars: 2, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_48',  act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5 },
  { id: 'card_49',  act: 1, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 5 },
  { id: 'card_35',  act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_36',  act: 1, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_37',  act: 1, minPlayers: 3, dollars: 0, cows:  2, bandits:  0, cost: 5 },
  { id: 'card_40',  act: 1, minPlayers: 4, dollars: 0, cows:  2, bandits:  0, cost: 5 },
  { id: 'card_10',  act: 1, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2 },
  { id: 'card_11',  act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2 },
  { id: 'card_12',  act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2 },
  { id: 'card_13',  act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 2 },
  { id: 'card_14',  act: 1, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 2, special: 'burn_buy_first' },
  { id: 'card_15',  act: 1, minPlayers: 2, dollars: 0, cows:  1, bandits:  0, cost: 3, special: '2cow_if_first' },
  { id: 'card_1',   act: 1, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2 },
  { id: 'card_2',   act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 2 },
  { id: 'card_3',   act: 1, minPlayers: 4, dollars: 0, cows:  1, bandits:  0, cost: 3, special: '2cow_if_first' },
  // ACT 2
  { id: 'card_81',  act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_82',  act: 2, minPlayers: 2, dollars: 1, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_83',  act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 6 },
  { id: 'card_66',  act: 2, minPlayers: 3, dollars: 1, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_67',  act: 2, minPlayers: 3, dollars: 0, cows:  2, bandits:  0, cost: 6 },
  { id: 'card_50',  act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits: -1, cost: 4, special: 'burn_to_use' },
  { id: 'card_51',  act: 2, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost: 4 },
  { id: 'card_52',  act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5 },
  { id: 'card_53',  act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 5 },
  { id: 'card_54',  act: 2, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost: 5, special: 'draw4' },
  { id: 'card_38',  act: 2, minPlayers: 3, dollars: 2, cows:  0, bandits:  0, cost: 3 },
  { id: 'card_39',  act: 2, minPlayers: 3, dollars: 0, cows:  0, bandits: -1, cost: 4, special: 'burn_to_use' },
  { id: 'card_41',  act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_42',  act: 2, minPlayers: 4, dollars: 2, cows:  1, bandits:  0, cost: 4 },
  { id: 'card_43',  act: 2, minPlayers: 4, dollars: 0, cows:  5, bandits:  2, cost: 4 },
  { id: 'card_16',  act: 2, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 2, special: 'burn_for_2' },
  { id: 'card_17',  act: 2, minPlayers: 2, dollars: 4, cows:  0, bandits:  1, cost: 3 },
  { id: 'card_18',  act: 2, minPlayers: 2, dollars: 0, cows:  2, bandits:  0, cost: 4 },
  { id: 'card_19',  act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, special: 'look3_rearrange' },
  { id: 'card_20',  act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, special: 'copy_next' },
  { id: 'card_21',  act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 4, special: 'extra_buy' },
  { id: 'card_22',  act: 2, minPlayers: 2, dollars: 1, cows:  0, bandits:  0, cost: 3, cacti: 1, special: 'burn_for_2' },
  { id: 'card_23',  act: 2, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost: 5, special: 'replay_discard' },
  { id: 'card_24',  act: 2, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost: 6, special: 'dollar1_other' },
  { id: 'card_4',   act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits: -1, cost: 0, special: 'discard_to_player' },
  { id: 'card_5',   act: 2, minPlayers: 4, dollars: 1, cows:  0, bandits:  0, cost: 2, special: 'burn_for_2' },
  { id: 'card_6',   act: 2, minPlayers: 4, dollars: 2, cows:  0, bandits:  0, cost: 4 },
  { id: 'card_7',   act: 2, minPlayers: 4, dollars: 0, cows:  0, bandits:  0, cost: 4, special: 'copy_next' },
  // ACT 3
  { id: 'card_84',  act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5 },
  { id: 'card_85',  act: 3, minPlayers: 2, dollars: 0, cows: -1, bandits: -1, cost:  5 },
  { id: 'card_86',  act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  6 },
  { id: 'card_87',  act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7 },
  { id: 'card_88',  act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  7 },
  { id: 'card_89',  act: 3, minPlayers: 2, dollars: 4, cows:  0, bandits:  0, cost:  8 },
  { id: 'card_90',  act: 3, minPlayers: 2, dollars: 2, cows:  3, bandits:  0, cost:  9 },
  { id: 'card_71',  act: 3, minPlayers: 4, dollars: 0, cows: -1, bandits: -1, cost:  5 },
  { id: 'card_72',  act: 3, minPlayers: 4, dollars: 0, cows:  3, bandits:  0, cost:  7 },
  { id: 'card_73',  act: 3, minPlayers: 4, dollars: 4, cows:  0, bandits:  0, cost:  8 },
  { id: 'card_55',  act: 3, minPlayers: 2, dollars: 3, cows:  3, bandits:  0, cost: 10 },
  { id: 'card_56',  act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  0, cost: 11 },
  { id: 'card_57',  act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  2, cost:  4 },
  { id: 'card_58',  act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8 },
  { id: 'card_59',  act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  8 },
  { id: 'card_60',  act: 3, minPlayers: 2, dollars: 0, cows:  5, bandits:  1, cost:  9 },
  { id: 'card_44',  act: 3, minPlayers: 4, dollars: 0, cows:  5, bandits:  0, cost: 11 },
  { id: 'card_45',  act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  0, cost:  8 },
  { id: 'card_25',  act: 3, minPlayers: 2, dollars: 0, cows:  2, bandits: -1, cost: 10 },
  { id: 'card_26',  act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5 },
  { id: 'card_27',  act: 3, minPlayers: 2, dollars: 3, cows:  0, bandits:  0, cost:  5 },
  { id: 'card_28',  act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6 },
  { id: 'card_29',  act: 3, minPlayers: 2, dollars: 0, cows:  3, bandits:  0, cost:  6 },
  { id: 'card_30',  act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  1, cost:  7 },
  { id: 'card_31',  act: 3, minPlayers: 2, dollars: 0, cows:  0, bandits:  0, cost:  8, special: 'look3_immediate' },
  { id: 'card_32',  act: 3, minPlayers: 2, dollars: 0, cows:  4, bandits:  0, cost:  9 },
  { id: 'card_8',   act: 3, minPlayers: 4, dollars: 0, cows:  4, bandits:  1, cost:  7 },
  { id: 'card_9',   act: 3, minPlayers: 4, dollars: 3, cows:  2, bandits:  0, cost:  8 },
];

// ─── SEEDED RNG (LCG — same constants as play.js) ────────────────────────────

function makeLCG(seed) {
  let s = ((seed >>> 0) || 1);
  return function next() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ─── AI PERSONALITIES (mirrored from play.js) ────────────────────────────────

const AI_PERSONALITIES = {
  sheriff:  { bustThreshold2: 0.05, bustThreshold1: 0.15, dollarBuffer: 0,   cowWeight: 5,   dollarWeight: 2,   banditPenalty: 4,   positionWeight: 0,   denialBurn: false, deckMemory: 0.9, lethalBias: 1.5, affordMult: 1.2, act1DollarBonus: 1.5, act3CowBonus: 2.5, revealBonus: 2.5 },
  wild_bill:{ bustThreshold2: 0.35, bustThreshold1: 0.50, dollarBuffer: 999, cowWeight: 9,   dollarWeight: 0.5, banditPenalty: 0.5, positionWeight: 0,   denialBurn: false, deckMemory: 0.1, lethalBias: 0.5, affordMult: 2.0, act1DollarBonus: 0,   act3CowBonus: 4.0, revealBonus: 0   },
  rancher:  { bustThreshold2: 0.22, bustThreshold1: 0.42, dollarBuffer: 3,   cowWeight: 9,   dollarWeight: 0.5, banditPenalty: 1.5, positionWeight: 0.4, denialBurn: false, deckMemory: 0.6, lethalBias: 1.0, affordMult: 1.6, act1DollarBonus: 0,   act3CowBonus: 3.5, revealBonus: 1.0 },
  banker:   { bustThreshold2: 0.15, bustThreshold1: 0.30, dollarBuffer: 1,   cowWeight: 1.5, dollarWeight: 3,   banditPenalty: 2,   positionWeight: 0.3, denialBurn: false, deckMemory: 0.8, lethalBias: 1.2, affordMult: 1.2, act1DollarBonus: 2.5, act3CowBonus: 0.5, revealBonus: 1.0 },
  outlaw:   { bustThreshold2: 0.35, bustThreshold1: 0.55, dollarBuffer: 2,   cowWeight: 8,   dollarWeight: 1,   banditPenalty: 1.0, positionWeight: 1.5, denialBurn: true,  deckMemory: 0.4, lethalBias: 0.6, affordMult: 2.0, act1DollarBonus: 0,   act3CowBonus: 3.5, revealBonus: 0.5 },
  deputy:   { bustThreshold2: 0.10, bustThreshold1: 0.28, dollarBuffer: 1,   cowWeight: 6,   dollarWeight: 1.5, banditPenalty: 2.5, positionWeight: 0.3, denialBurn: true,  deckMemory: 0.7, lethalBias: 1.3, affordMult: 1.4, act1DollarBonus: 0.5, act3CowBonus: 2.5, revealBonus: 2.0 },
};
const PERSONALITY_NAMES = Object.keys(AI_PERSONALITIES);

// ─── CARD SCORING ─────────────────────────────────────────────────────────────

function scoreCard(card, personality, act) {
  const cfg = AI_PERSONALITIES[personality];
  let s = 0;
  s += (card.cows    || 0) * cfg.cowWeight;
  s += (card.dollars || 0) * cfg.dollarWeight;
  s -= (card.bandits || 0) * cfg.banditPenalty;
  if (card.special === 'burn_to_use')  s += 2;
  if (card.special === 'copy_next')     s += 3;
  if (card.special === 'draw4')         s += 2;
  if (card.special === 'look3_rearrange') s += 1.5;
  if (card.special === 'replay_discard')  s += 2;

  if (card.special === 'burn_buy_first') s += 1;
  if (card.special === 'dollar1_other')   s -= 0.5;
  if ((card.cows || 0) < 0) s -= 2;
  if (act === 1) s += (card.dollars || 0) * (cfg.act1DollarBonus ?? 1);
  if (act === 3) s += (card.cows    || 0) * (cfg.act3CowBonus   ?? 2);
  return s;
}

// ─── PYRAMID ──────────────────────────────────────────────────────────────────

function buildPyramid(act, numPlayers, rng) {
  const pool = STORE_CARDS.filter(c => c.act === act && c.minPlayers <= numPlayers);
  const shuffled = shuffle(pool, rng);
  const numRows = numPlayers + 3;
  const needed = (numRows * (numRows + 1)) / 2;
  const selected = shuffled.slice(0, Math.min(needed, shuffled.length));

  const pyramid = [];
  let idx = 0;
  for (let row = 0; row < numRows; row++) {
    const rowArr = [];
    for (let col = 0; col <= row; col++) {
      if (idx < selected.length) {
        rowArr.push({ card: selected[idx], faceUp: row === numRows - 1, removed: false });
        idx++;
      }
    }
    pyramid.push(rowArr);
  }
  return pyramid;
}

function isCardCovered(pyr, row, col) {
  if (row >= pyr.length - 1) return false;
  const nr = pyr[row + 1];
  return (nr[col] && !nr[col].removed) || (nr[col + 1] && !nr[col + 1].removed);
}

function revealUncovered(pyr) {
  for (let r = 0; r < pyr.length; r++)
    for (let c = 0; c < pyr[r].length; c++) {
      const s = pyr[r][c];
      if (!s.removed && !s.faceUp && !isCardCovered(pyr, r, c)) s.faceUp = true;
    }
}

function getAvailable(pyr) {
  const out = [];
  for (let r = 0; r < pyr.length; r++)
    for (let c = 0; c < pyr[r].length; c++) {
      const s = pyr[r][c];
      if (!s.removed && s.faceUp) out.push({ row: r, col: c, slot: s });
    }
  return out;
}

function isPyramidEmpty(pyr) {
  return pyr.every(row => row.every(s => s.removed));
}

function pyramidRevealBonus(pyr, row, col, revealBonus) {
  if (row === 0) return 0;
  const B = revealBonus ?? 1.5;
  let bonus = 0;
  if (col < row) {
    const pA = pyr[row-1][col];
    if (pA && !pA.removed && !pA.faceUp) {
      const sib = pyr[row][col+1];
      if (!sib || sib.removed) bonus += B;
    }
  }
  if (col > 0) {
    const pB = pyr[row-1][col-1];
    if (pB && !pB.removed && !pB.faceUp) {
      const sib = pyr[row][col-1];
      if (!sib || sib.removed) bonus += B;
    }
  }
  return bonus;
}

// ─── PLAYER ───────────────────────────────────────────────────────────────────

function createPlayer(name, personality, slotIdx, gameSeed) {
  const rng = makeLCG(((gameSeed ^ (slotIdx * 0x9e3779b9)) >>> 0) || 1);
  const starters = [];
  for (const t of STARTER_TEMPLATES)
    for (let i = 0; i < t.count; i++) starters.push(Object.assign({}, t));
  return {
    name, personality, rng,
    deck: shuffle(starters, rng),
    discard: [], hand: [], herd: 0,
    roundDollars: 0, roundCows: 0, roundBandits: 0, busted: false,
  };
}

// ─── DRAW PHASE ───────────────────────────────────────────────────────────────

function calcBustProb(p, currentBandits, cfg) {
  const deck = p.deck;
  if (deck.length === 0) return 0;
  const minLethal = currentBandits === 2 ? 1 : 2;
  const lethalCount = deck.filter(c => (c.bandits || 0) >= minLethal).length;
  const exactProb = lethalCount / deck.length;
  const FLAT_PRIOR = 0.20;
  const memory = cfg.deckMemory ?? 0.5;
  const bias   = cfg.lethalBias  ?? 1.0;
  return (exactProb * memory + FLAT_PRIOR * (1 - memory)) * bias;
}

function getBestCost(pyr, personality, act) {
  const avail = getAvailable(pyr);
  if (avail.length === 0) return 99;
  let best = -Infinity, bestCost = 0;
  for (const a of avail) {
    const sc = scoreCard(a.slot.card, personality, act);
    if (sc > best) { best = sc; bestCost = a.slot.card.cost || 0; }
  }
  return bestCost;
}

function aiShouldDraw(p, pyr, act, allPlayers) {
  const cfg = AI_PERSONALITIES[p.personality];
  if (p.hand.length >= 7) return false;
  if (p.hand.length < 2)  return true;

  let posMult = 1.0;
  if (cfg.positionWeight > 0) {
    const maxOpp = Math.max(0, ...allPlayers.filter(o => o !== p).map(o => o.herd));
    const deficit = maxOpp - p.herd;
    posMult = Math.max(0.5, Math.min(2.0, 1 + (deficit / 10) * cfg.positionWeight));
  }

  const avail = getAvailable(pyr);
  const canAfford = avail.some(a => (a.slot.card.cost || 0) <= p.roundDollars);
  const affordMult = canAfford ? 1.0 : (cfg.affordMult ?? 1.4);

  const cardsLeft = p.deck.length;

  if (p.roundBandits >= 2) {
    if (cardsLeft === 0) return false;
    return calcBustProb(p, 2, cfg) < cfg.bustThreshold2 * posMult * affordMult;
  }
  if (p.roundBandits === 1) {
    if (cardsLeft <= 1) return false;
    if (calcBustProb(p, 1, cfg) >= cfg.bustThreshold1 * posMult * affordMult) return false;
    if (cfg.dollarBuffer >= 999) return true;
    return p.roundDollars < getBestCost(pyr, p.personality, act);
  }
  // 0 bandits
  const bestCost = getBestCost(pyr, p.personality, act);
  const maxCost  = avail.length > 0 ? Math.max(...avail.map(a => a.slot.card.cost || 0)) : bestCost;
  const buf      = Math.min(cfg.dollarBuffer, Math.max(0, maxCost - bestCost));
  return p.roundDollars < bestCost + buf;
}

function runDraw(p, pyr, act, allPlayers) {
  p.roundDollars = 0; p.roundCows = 0; p.roundBandits = 0;
  p.hand = []; p.busted = false;

  if (p.deck.length === 0 && p.discard.length > 0) {
    p.deck = shuffle(p.discard, p.rng);
    p.discard = [];
    if (p.deck.length > 1) p.deck.push(p.deck.shift());
  }

  while (!p.busted) {
    if (p.deck.length === 0) break;
    const card = p.deck.shift();
    p.hand.push(card);
    p.roundDollars  += card.dollars || 0;
    p.roundCows     += card.cows    || 0;
    p.roundBandits  += card.bandits || 0;
    if (p.roundBandits < 0) p.roundBandits = 0;

    if (p.roundBandits >= 3) { p.busted = true; break; }
    if (!aiShouldDraw(p, pyr, act, allPlayers)) break;
  }
}

// ─── BUY PHASE ────────────────────────────────────────────────────────────────

function runBuy(p, pyr, act, allPlayers) {
  const avail = getAvailable(pyr);
  if (avail.length === 0) return;

  const dollars = p.busted ? 0 : p.roundDollars;
  const affordable = avail.filter(a => (a.slot.card.cost || 0) <= dollars);

  if (affordable.length > 0) {
    let best = null, bestScore = -Infinity;
    for (const a of affordable) {
      const sc = scoreCard(a.slot.card, p.personality, act) + pyramidRevealBonus(pyr, a.row, a.col, AI_PERSONALITIES[p.personality]?.revealBonus);
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
    best.slot.removed = true;
    p.discard.push(Object.assign({}, best.slot.card));
    revealUncovered(pyr);
  } else {
    // Burn
    const cfg = AI_PERSONALITIES[p.personality];
    let burnTarget = null;

    if (cfg.denialBurn) {
      const leader = allPlayers.filter(o => o !== p).sort((a, b) => b.herd - a.herd)[0];
      if (leader) {
        let best = -Infinity;
        for (const a of avail) {
          const sc = scoreCard(a.slot.card, leader.personality, act);
          if (sc > best) { best = sc; burnTarget = a; }
        }
      }
    }

    if (!burnTarget) {
      const actProg = act / 3;
      const density = Math.min(1, avail.length / Math.max(1, allPlayers.length * 2));
      if (actProg * (1 - density) > 0.4) {
        const leader = allPlayers.filter(o => o !== p).sort((a, b) => b.herd - a.herd)[0];
        if (leader) {
          let best = -Infinity;
          for (const a of avail) {
            const sc = scoreCard(a.slot.card, leader.personality, act);
            if (sc > best) { best = sc; burnTarget = a; }
          }
        }
      }
    }

    if (!burnTarget) {
      let worst = Infinity;
      for (const a of avail) {
        const sc = scoreCard(a.slot.card, p.personality, act);
        if (sc < worst) { worst = sc; burnTarget = a; }
      }
    }

    burnTarget.slot.removed = true;
    revealUncovered(pyr);
  }
}

// ─── SHOWDOWN ─────────────────────────────────────────────────────────────────

function showdownScore(p) {
  const all = [...p.deck, ...p.hand, ...p.discard];
  const totalCows    = all.reduce((s, c) => s + (c.cows    || 0), 0);
  const totalDollars = all.reduce((s, c) => s + (c.dollars || 0), 0);
  return totalCows + Math.floor(totalDollars / 2);
}

// ─── WINNER DETECTION ────────────────────────────────────────────────────────
// Returns index of player with highest herd; ties broken by player index (slot 0 advantage = none)

function getWinner(players) {
  let best = -Infinity, bestIdx = 0;
  for (let i = 0; i < players.length; i++) {
    if (players[i].herd > best) { best = players[i].herd; bestIdx = i; }
  }
  return bestIdx;
}

// Returns the sorted ranking array (indices by descending herd)
function getRanking(players) {
  return players
    .map((p, i) => ({ i, herd: p.herd }))
    .sort((a, b) => b.herd - a.herd);
}

// ─── SINGLE GAME ─────────────────────────────────────────────────────────────

function runGame(numPlayers, gameSeed) {
  const rng = makeLCG(gameSeed);

  // Rotate personalities so each slot gets a different one
  const basePersonalities = shuffle(PERSONALITY_NAMES.slice(), rng);
  const players = Array.from({ length: numPlayers }, (_, i) =>
    createPlayer(`P${i+1}`, basePersonalities[i % PERSONALITY_NAMES.length], i, gameSeed)
  );

  for (let act = 1; act <= 3; act++) {
    const pyr = buildPyramid(act, numPlayers, rng);

    while (!isPyramidEmpty(pyr)) {
      // Draw phase
      for (const p of players) runDraw(p, pyr, act, players);

      // Score round: non-busted add cows to herd; everyone discards hand
      for (const p of players) {
        if (!p.busted) p.herd = Math.max(0, p.herd + p.roundCows);
        p.discard.push(...p.hand);
        p.hand = [];
      }

      // Buy order: sort by dollars desc (busted get 0), break ties by slot index
      const buyOrder = players
        .map((p, i) => ({ p, i }))
        .sort((a, b) => {
          const da = a.p.busted ? 0 : a.p.roundDollars;
          const db = b.p.busted ? 0 : b.p.roundDollars;
          return db - da || a.i - b.i;
        });

      for (const { p } of buyOrder) {
        if (!isPyramidEmpty(pyr)) runBuy(p, pyr, act, players);
      }

      // Reset round state
      for (const p of players) {
        p.roundDollars = 0; p.roundCows = 0; p.roundBandits = 0; p.busted = false;
      }
    }
  }

  // Snapshot pre-showdown ranking
  const preRanking = getRanking(players);
  const preWinner  = preRanking[0].i;
  const preHerds   = players.map(p => p.herd);

  // Showdown: add bonus to each player's herd
  for (const p of players) {
    p.herd = Math.max(0, p.herd + showdownScore(p));
  }

  const postRanking = getRanking(players);
  const postWinner  = postRanking[0].i;
  const postHerds   = players.map(p => p.herd);

  // Did the winner change?
  const winnerChanged = preWinner !== postWinner;

  // Did ANY position change? (broader measure)
  const anyRankChanged = preRanking.some((pre, rank) => pre.i !== postRanking[rank].i);

  return { preWinner, postWinner, winnerChanged, anyRankChanged, preHerds, postHerds };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const NUM_GAMES = parseInt(process.argv[2] || '20000', 10);

console.log(`Running ${NUM_GAMES.toLocaleString()} games per player count…\n`);

for (const numPlayers of [2, 3, 4]) {
  let winnerChanges = 0;
  let anyRankChanges = 0;
  // Track how large the showdown swing is
  let totalSwing = 0;
  let comebackSizes = [];

  for (let i = 0; i < NUM_GAMES; i++) {
    // Vary seed across games and player counts to avoid correlation
    const seed = ((i * 2654435761) ^ (numPlayers * 0x9e3779b9)) >>> 0;
    const r = runGame(numPlayers, seed);

    if (r.winnerChanged)   winnerChanges++;
    if (r.anyRankChanged)  anyRankChanges++;

    // Size of swing: difference in showdown bonus between pre-leader and post-winner
    const preLeader = r.preHerds.indexOf(Math.max(...r.preHerds));
    const swing = r.postHerds[r.postWinner] - r.postHerds[preLeader];
    totalSwing += Math.abs(swing);
    if (r.winnerChanged) comebackSizes.push(swing);
  }

  const winnerPct    = (winnerChanges  / NUM_GAMES * 100).toFixed(1);
  const rankPct      = (anyRankChanges / NUM_GAMES * 100).toFixed(1);
  const avgSwing     = (totalSwing / NUM_GAMES).toFixed(1);
  const avgComeback  = comebackSizes.length > 0
    ? (comebackSizes.reduce((a, b) => a + b, 0) / comebackSizes.length).toFixed(1)
    : 'n/a';

  console.log(`── ${numPlayers}-Player ──────────────────────────────`);
  console.log(`  Winner changed:          ${winnerChanges.toLocaleString()} / ${NUM_GAMES.toLocaleString()} games  (${winnerPct}%)`);
  console.log(`  Any rank changed:        ${anyRankChanges.toLocaleString()} / ${NUM_GAMES.toLocaleString()} games  (${rankPct}%)`);
  console.log(`  Avg showdown swing:      ${avgSwing} cows`);
  console.log(`  Avg comeback margin:     ${avgComeback} cows\n`);
}
