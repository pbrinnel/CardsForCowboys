#!/usr/bin/env node
// sim/evolve.js — Evolutionary AI tournament for Cards For Cowboys
// Usage: node sim/evolve.js [options]  (see --help)
'use strict';

const core = require('./game-core');
const { determineBuyWinner } = require('./tiebreaker');
const fs = require('fs');
const path = require('path');

// ── PARAM RANGES & KEYS ──────────────────────────────────────────────────────

const PARAM_RANGES = {
  bustThreshold2:  { min: 0.01, max: 0.60 },
  bustThreshold1:  { min: 0.05, max: 0.90 },
  dollarBuffer:    { min: 0,    max: 5    },
  cowWeight:       { min: 0,    max: 10   },
  dollarWeight:    { min: 0,    max: 6    },
  banditPenalty:   { min: 0,    max: 8    },
  positionWeight:  { min: 0,    max: 2.5  },
  denialWeight:    { min: 0,    max: 1    },
  deckMemory:      { min: 0,    max: 1    },
  lethalBias:      { min: 0.2,  max: 2.5  },
  act1DollarBonus: { min: 0,    max: 3    },
  act3CowBonus:    { min: 0,    max: 4    },
  revealBonus:     { min: 0,    max: 4    },
  affordMult:      { min: 1.0,  max: 2.5  },
};
const PARAM_KEYS = Object.keys(PARAM_RANGES);

// ── SEED GENOMES (generation 0) ──────────────────────────────────────────────

const SEED_GENOMES = [
  { name: 'sheriff',   bustThreshold2: 0.05, bustThreshold1: 0.15, dollarBuffer: 0,   cowWeight: 3,   dollarWeight: 1.5, banditPenalty: 4,   positionWeight: 0,   denialWeight: 0,   deckMemory: 0.9, lethalBias: 1.5, act1DollarBonus: 1, act3CowBonus: 2, revealBonus: 1.5, affordMult: 1.4 },
  { name: 'wild_bill', bustThreshold2: 0.35, bustThreshold1: 0.50, dollarBuffer: 4.5, cowWeight: 5,   dollarWeight: 0.5, banditPenalty: 0.5, positionWeight: 0,   denialWeight: 0,   deckMemory: 0.1, lethalBias: 0.5, act1DollarBonus: 1, act3CowBonus: 2, revealBonus: 1.5, affordMult: 1.4 },
  { name: 'rancher',   bustThreshold2: 0.15, bustThreshold1: 0.30, dollarBuffer: 2,   cowWeight: 6,   dollarWeight: 0.5, banditPenalty: 2,   positionWeight: 0.4, denialWeight: 0,   deckMemory: 0.6, lethalBias: 1.0, act1DollarBonus: 1, act3CowBonus: 2, revealBonus: 1.5, affordMult: 1.4 },
  { name: 'banker',    bustThreshold2: 0.15, bustThreshold1: 0.30, dollarBuffer: 1,   cowWeight: 1.5, dollarWeight: 3,   banditPenalty: 2,   positionWeight: 0.3, denialWeight: 0,   deckMemory: 0.8, lethalBias: 1.2, act1DollarBonus: 1, act3CowBonus: 2, revealBonus: 1.5, affordMult: 1.4 },
  { name: 'outlaw',    bustThreshold2: 0.20, bustThreshold1: 0.35, dollarBuffer: 1,   cowWeight: 4,   dollarWeight: 1,   banditPenalty: 2,   positionWeight: 1.5, denialWeight: 0,   deckMemory: 0.4, lethalBias: 0.8, act1DollarBonus: 1, act3CowBonus: 2, revealBonus: 1.5, affordMult: 1.4 },
  { name: 'deputy',    bustThreshold2: 0.10, bustThreshold1: 0.20, dollarBuffer: 0,   cowWeight: 2,   dollarWeight: 2,   banditPenalty: 3,   positionWeight: 0.3, denialWeight: 1.0, deckMemory: 0.7, lethalBias: 1.3, act1DollarBonus: 1, act3CowBonus: 2, revealBonus: 1.5, affordMult: 1.4 },
];

// ── LCG SEEDED RNG ───────────────────────────────────────────────────────────

function makeLCG(seed) {
  let s = ((seed >>> 0) || 1);
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}

function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── INLINE AI DECISION LAYER ─────────────────────────────────────────────────

function calcBustProb(player, currentBandits, genome) {
  const deck = player.deck;
  if (deck.length === 0) return 0;
  const minLethal = currentBandits === 2 ? 1 : 2;
  const lethalCount = deck.filter(c => (c.bandits || 0) >= minLethal).length;
  const exactProb = lethalCount / deck.length;
  const FLAT_PRIOR = 0.20;
  return (exactProb * genome.deckMemory + FLAT_PRIOR * (1 - genome.deckMemory)) * genome.lethalBias;
}

function scoreCard(card, genome, act, allPlayers, thisPlayer) {
  let score = 0;
  score += (card.cows    || 0) * genome.cowWeight;
  score += (card.dollars || 0) * genome.dollarWeight;
  score -= (card.bandits || 0) * genome.banditPenalty;
  if (act === 1) score += (card.dollars || 0) * genome.act1DollarBonus;
  if (act === 3) score += (card.cows    || 0) * genome.act3CowBonus;
  if (card.special === 'trash_to_use')         score += 2;
  if (card.special === 'draw4')                score += 2;
  if (card.special === 'replay_discard')       score += 2;
  if (card.special === 'look3_rearrange')      score += 1.5;
  if (card.special === 'trash_buy_burn_first') score += 1;
  if (card.special === 'dollar1_other')        score -= 0.5;
  if (card.special === 'copy_next' && thisPlayer && thisPlayer.deck.length > 0) {
    const avg = thisPlayer.deck.reduce((s, c) =>
      s + (c.cows || 0) * genome.cowWeight + (c.dollars || 0) * genome.dollarWeight, 0)
      / thisPlayer.deck.length;
    score += Math.max(1.5, Math.min(6, avg));
  }
  if ((card.cows || 0) < 0) score -= 2;
  return score;
}

function pyramidRevealBonus(pyramid, row, col, genome) {
  if (row === 0) return 0;
  let bonus = 0;
  if (col < row) {
    const parentA = pyramid[row - 1][col];
    if (parentA && !parentA.removed && !parentA.faceUp) {
      const sibA = pyramid[row][col + 1];
      if (!sibA || sibA.removed) bonus += genome.revealBonus;
    }
  }
  if (col > 0) {
    const parentB = pyramid[row - 1][col - 1];
    if (parentB && !parentB.removed && !parentB.faceUp) {
      const sibB = pyramid[row][col - 1];
      if (!sibB || sibB.removed) bonus += genome.revealBonus;
    }
  }
  return bonus;
}

function getBestCost(player, genome, pyramid, act, allPlayers) {
  const avail = core.getAvailablePyramidCards(pyramid);
  if (avail.length === 0) return 99;
  let best = -Infinity, bestCost = 0;
  for (const a of avail) {
    const s = scoreCard(a.slot.card, genome, act, allPlayers, player)
            + pyramidRevealBonus(pyramid, a.row, a.col, genome);
    if (s > best) { best = s; bestCost = a.slot.card.cost || 0; }
  }
  return bestCost;
}

function shouldDraw(player, genome, pyramid, act, allPlayers) {
  if (player.hand.length >= 7) return false;
  if (player.hand.length < 2)  return true;

  let posMult = 1.0;
  if (genome.positionWeight > 0 && allPlayers.length > 1) {
    const maxOpp = Math.max(0, ...allPlayers.filter(p => p !== player).map(p => p.herd || 0));
    const deficit = maxOpp - (player.herd || 0);
    posMult = Math.max(0.5, Math.min(2.0, 1 + (deficit / 10) * genome.positionWeight));
  }

  const avail = core.getAvailablePyramidCards(pyramid);
  const canAfford = avail.some(a => (a.slot.card.cost || 0) <= player.roundDollars);
  const affordMult = canAfford ? 1.0 : genome.affordMult;

  if (player.roundBandits >= 2) {
    if (player.deck.length === 0) return false;
    return calcBustProb(player, 2, genome) < genome.bustThreshold2 * posMult * affordMult;
  }

  if (player.roundBandits === 1) {
    if (player.deck.length <= 1) return false;
    if (calcBustProb(player, 1, genome) >= genome.bustThreshold1 * posMult * affordMult) return false;
    const bestCost = getBestCost(player, genome, pyramid, act, allPlayers);
    return player.roundDollars < bestCost;
  }

  // 0 bandits: draw until we can afford best card + buffer
  const bestCost = getBestCost(player, genome, pyramid, act, allPlayers);
  const maxCost = avail.length > 0 ? Math.max(...avail.map(a => a.slot.card.cost || 0)) : bestCost;
  const buf = Math.min(genome.dollarBuffer, Math.max(0, maxCost - bestCost));
  return player.roundDollars < bestCost + buf;
}

function chooseBuy(player, genome, pyramid, act, allPlayers) {
  const avail = core.getAvailablePyramidCards(pyramid);
  if (avail.length === 0) return { action: 'pass' };

  const affordable = avail.filter(a => (a.slot.card.cost || 0) <= player.roundDollars);
  if (affordable.length > 0) {
    let best = null, bestScore = -Infinity;
    for (const a of affordable) {
      const s = scoreCard(a.slot.card, genome, act, allPlayers, player)
              + pyramidRevealBonus(pyramid, a.row, a.col, genome);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    return { action: 'buy', row: best.row, col: best.col };
  }

  const leader = allPlayers
    .filter(p => p !== player)
    .sort((a, b) => (b.herd || 0) - (a.herd || 0))[0];

  let worstSelfScore = Infinity, bestLeaderScore = -Infinity;
  let selfWorst = null, leaderBest = null;

  for (const a of avail) {
    const selfScore = scoreCard(a.slot.card, genome, act, allPlayers, player);
    if (selfScore < worstSelfScore) { worstSelfScore = selfScore; selfWorst = a; }
    if (leader) {
      const ls = scoreCard(a.slot.card, genome, act, allPlayers, leader);
      if (ls > bestLeaderScore) { bestLeaderScore = ls; leaderBest = a; }
    }
  }

  const burnTarget = genome.denialWeight >= 0.5 && leaderBest ? leaderBest : selfWorst;
  return { action: 'burn', row: burnTarget.row, col: burnTarget.col };
}

// ── GAME RUNNER HELPERS ──────────────────────────────────────────────────────

function drawFromDeckSeeded(player, rng) {
  if (player.deck.length === 0) {
    if (player.discard.length === 0) return null;
    player.deck = seededShuffle(player.discard, rng);
    player.discard = [];
    // Put the top card at the bottom (mirrors game-core behavior)
    if (player.deck.length > 1) {
      player.deck.push(player.deck.shift());
    }
  }
  return player.deck.shift();
}

function buildPyramidSeeded(act, numPlayers, rng) {
  const pool = seededShuffle(core.getActPool(act, numPlayers), rng);
  const numRows = core.getNumRows(numPlayers);
  const needed = (numRows * (numRows + 1)) / 2;
  const selected = pool.slice(0, Math.min(needed, pool.length));

  const pyramid = [];
  let idx = 0;
  for (let row = 0; row < numRows; row++) {
    const rowArr = [];
    for (let col = 0; col <= row; col++) {
      if (idx < selected.length) {
        const card = core.createCardInstance(selected[idx]);
        const faceUp = (row === numRows - 1);
        rowArr.push({ card, faceUp, removed: false });
        idx++;
      }
    }
    pyramid.push(rowArr);
  }
  return pyramid;
}

function createPlayerSeeded(name, rng) {
  const p = core.createPlayer(name, null);
  // Re-shuffle starter deck with seeded RNG
  p.deck = seededShuffle(p.deck, rng);
  return p;
}

// ── DRAW PHASE ───────────────────────────────────────────────────────────────

function runDrawPhase(players, genomes, pyramid, act, rng) {
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const genome = genomes[i];
    core.resetPlayerRound(player);

    if (player.deck.length === 0 && player.discard.length === 0) {
      player.stoppedDrawing = true;
      continue;
    }

    while (!player.busted && !player.stoppedDrawing) {
      const card = drawFromDeckSeeded(player, rng);
      if (!card) { player.stoppedDrawing = true; break; }

      const isFirst = player.hand.length === 0;
      player.hand.push(card);
      core.applyCardEffects(player, card, isFirst);

      // draw4: draw 4 extra immediately
      if (card.special === 'draw4' && !player.busted) {
        for (let d = 0; d < 4; d++) {
          if (player.busted) break;
          const extra = drawFromDeckSeeded(player, rng);
          if (!extra) break;
          player.hand.push(extra);
          core.applyCardEffects(player, extra, false);
          if (player.roundBandits >= 3) { handleBust(player); break; }
        }
        if (player.busted) break;
      }

      // trash_to_use activation
      for (const tCard of player.hand.filter(c => c.special === 'trash_to_use')) {
        let activate = false;
        if (tCard.bandits < 0 && player.roundBandits >= 2) activate = true;
        if (tCard.dollars > 0 && player.roundBandits >= 2) {
          const bestCost = getBestCost(player, genome, pyramid, act, players);
          if (player.roundDollars < bestCost) activate = true;
        }
        if (!activate) continue;
        const idx = player.hand.indexOf(tCard);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          player.roundDollars += tCard.dollars;
          player.roundBandits = Math.max(0, player.roundBandits + tCard.bandits);
          player.roundCows += tCard.cows;
        }
      }

      // trash_for_2: burn for +$1 if it bridges to best card
      if (card.special === 'trash_for_2') {
        const bestCost = getBestCost(player, genome, pyramid, act, players);
        if (player.roundDollars < bestCost && player.roundDollars + 1 >= bestCost) {
          player.roundDollars += 1;
          const idx = player.hand.indexOf(card);
          if (idx >= 0) player.hand.splice(idx, 1);
        }
      }

      // look3_rearrange: always burn, sort top 3 deck cards (least bandits first)
      if (card.special === 'look3_rearrange' && player.deck.length >= 2) {
        const idx = player.hand.indexOf(card);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
          top3.sort((a, b) => a.bandits - b.bandits);
          player.deck.unshift(...top3);
        }
      }

      // look3_immediate: keep card, sort top 3 deck cards (least bandits first)
      if (card.special === 'look3_immediate' && player.deck.length >= 2) {
        const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
        top3.sort((a, b) => a.bandits - b.bandits);
        player.deck.unshift(...top3);
      }

      // replay_discard: burn, replay best discard card
      if (card.special === 'replay_discard' && player.discard.length > 0) {
        const idx = player.hand.indexOf(card);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          let bestIdx = 0, bestScore = -Infinity;
          for (let k = 0; k < player.discard.length; k++) {
            const s = scoreCard(player.discard[k], genome, act, players, player);
            if (s > bestScore) { bestScore = s; bestIdx = k; }
          }
          const replayed = player.discard.splice(bestIdx, 1)[0];
          player.hand.push(replayed);
          core.applyCardEffects(player, replayed, false);
        }
      }

      // trash_buy_burn_first: auto-activate
      if (card.special === 'trash_buy_burn_first') {
        player.hasBuyBurnFirst = true;
        const idx = player.hand.indexOf(card);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          player.roundCows -= (card.cows || 0);
        }
      }

      // extra_buy: auto-activate
      if (card.special === 'extra_buy') {
        player.hasExtraBuy = true;
        const idx = player.hand.indexOf(card);
        if (idx >= 0) player.hand.splice(idx, 1);
      }

      // Check bust
      if (player.roundBandits >= 3) { handleBust(player); break; }

      // Before stopping: activate dollar trash_to_use if it unlocks a better card
      if (!shouldDraw(player, genome, pyramid, act, players)) {
        for (const tCard of player.hand.filter(c => c.special === 'trash_to_use' && c.dollars > 0)) {
          const avail = core.getAvailablePyramidCards(pyramid);
          const unlocksAfford = avail.some(a =>
            (a.slot.card.cost || 0) > player.roundDollars &&
            (a.slot.card.cost || 0) <= player.roundDollars + tCard.dollars
          );
          if (unlocksAfford) {
            const idx = player.hand.indexOf(tCard);
            if (idx >= 0) {
              player.hand.splice(idx, 1);
              player.roundDollars += tCard.dollars;
              player.roundCows += tCard.cows;
            }
          }
        }
        player.stoppedDrawing = true;
      }
    }
  }
}

function handleBust(player) {
  player.busted = true;
  player.roundDollars = 0;
  player.roundCows = 0;
  player.roundBandits = 3;
}

// ── BUY PHASE ────────────────────────────────────────────────────────────────

function runBuyPhase(players, genomes, pyramid, act) {
  const playerOrder = players.map((_, i) => i);
  const nonBusted = playerOrder.filter(i => !players[i].busted);

  // hasBuyBurnFirst players go first
  const priority = nonBusted.filter(i => players[i].hasBuyBurnFirst).sort((a, b) => a - b);
  const normal = nonBusted.filter(i => !players[i].hasBuyBurnFirst);

  let normalSorted;
  if (normal.length <= 1) {
    normalSorted = normal;
  } else {
    const subPlayers = normal.map(i => players[i]);
    const subOrder = normal.map(i => playerOrder[i]);
    const { winnerIdx } = determineBuyWinner(subPlayers, subOrder);
    const winnerGlobalIdx = normal[winnerIdx];
    const rest = normal.filter(i => i !== winnerGlobalIdx).sort((a, b) => a - b);
    normalSorted = [winnerGlobalIdx, ...rest];
  }

  const buyOrder = [...priority, ...normalSorted];

  for (const playerIdx of buyOrder) {
    if (core.isPyramidEmpty(pyramid)) break;
    const player = players[playerIdx];
    const genome = genomes[playerIdx];

    const decision = chooseBuy(player, genome, pyramid, act, players);
    applyBuyDecision(player, decision, pyramid);

    // Extra buy turn
    if (player.hasExtraBuy && !player.extraBuyUsed && !core.isPyramidEmpty(pyramid)) {
      player.extraBuyUsed = true;
      const extraDecision = chooseBuy(player, genome, pyramid, act, players);
      applyBuyDecision(player, extraDecision, pyramid);
    }
  }
}

function applyBuyDecision(player, decision, pyramid) {
  if (decision.action === 'buy') {
    const slot = pyramid[decision.row][decision.col];
    player.discard.push(slot.card);
    slot.removed = true;
    core.revealUncovered(pyramid);
  } else if (decision.action === 'burn') {
    pyramid[decision.row][decision.col].removed = true;
    core.revealUncovered(pyramid);
  }
}

// ── GAME RUNNER ──────────────────────────────────────────────────────────────

function runGame(genomes, numPlayers, seed) {
  core.resetUidCounter();
  const rng = makeLCG(seed);

  const players = genomes.map((g, i) => createPlayerSeeded(`P${i}`, rng));

  for (let act = 1; act <= 3; act++) {
    // Between acts: merge and reshuffle all cards (seeded)
    for (const player of players) {
      const allCards = [...player.deck, ...player.discard, ...player.hand];
      player.deck = seededShuffle(allCards, rng);
      player.discard = [];
      player.hand = [];
    }

    const pyramid = buildPyramidSeeded(act, numPlayers, rng);

    for (let round = 1; round <= 5; round++) {
      runDrawPhase(players, genomes, pyramid, act, rng);
      runBuyPhase(players, genomes, pyramid, act);

      // Score round
      for (const player of players) {
        if (!player.busted && player.roundCows !== 0) {
          player.herd = Math.max(0, player.herd + player.roundCows);
        }
        player.discard.push(...player.hand);
        player.hand = [];
      }
    }
  }

  // Showdown: count all cards in each player's collection
  for (const player of players) {
    const allCards = [...player.deck, ...player.discard, ...player.hand];
    const totalCows    = allCards.reduce((s, c) => s + (c.cows    || 0), 0);
    const totalDollars = allCards.reduce((s, c) => s + (c.dollars || 0), 0);
    const bonusCows    = Math.floor(totalDollars / 2);
    player.herd = Math.max(0, player.herd + totalCows + bonusCows);
  }

  const herds = players.map(p => p.herd);
  const maxHerd = Math.max(...herds);
  // Winner = highest herd; ties go to lower player index
  const winner = herds.indexOf(maxHerd);

  return { herds, winner };
}

// ── FITNESS EVALUATION ───────────────────────────────────────────────────────

function evaluateFitness(population, kSeeds) {
  const n = population.length;
  const winCounts = new Array(n).fill(0);
  const gamesPlayed = new Array(n).fill(0);

  // 2P: full round-robin (all pairs × kSeeds)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let s = 0; s < kSeeds; s++) {
        const seed = (s + 1) * 997 + i * 31 + j + 20003;
        const result = runGame([population[i], population[j]], 2, seed);
        gamesPlayed[i]++; gamesPlayed[j]++;
        if (result.winner === 0) winCounts[i]++;
        else winCounts[j]++;
      }
    }
  }

  // 4P: sampled groups — each genome plays kSeeds games with 3 random opponents.
  // Generate n groups of 4 per "round" (rotate through the shuffled population).
  // Run kSeeds rounds so each genome gets kSeeds 4P games.
  const rng4p = makeLCG(n * 7919 + kSeeds);
  for (let s = 0; s < kSeeds; s++) {
    // Shuffle indices and chunk into groups of 4
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng4p() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let g = 0; g + 3 < n; g += 4) {
      const group = [indices[g], indices[g + 1], indices[g + 2], indices[g + 3]];
      const seed = (s + 1) * 1009 + group.reduce((a, b) => a * 31 + b, 0);
      const result = runGame(group.map(i => population[i]), 4, seed);
      group.forEach((popIdx, seatIdx) => {
        gamesPlayed[popIdx]++;
        if (seatIdx === result.winner) winCounts[popIdx]++;
      });
    }
  }

  return population.map((genome, i) => ({
    genome,
    fitness: gamesPlayed[i] > 0 ? winCounts[i] / gamesPlayed[i] : 0,
    wins: winCounts[i],
    games: gamesPlayed[i],
  }));
}

// ── EVOLUTIONARY ALGORITHM ───────────────────────────────────────────────────

function gaussianRandom() {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function randomGenome() {
  const g = {};
  for (const key of PARAM_KEYS) {
    const { min, max } = PARAM_RANGES[key];
    g[key] = min + Math.random() * (max - min);
  }
  return g;
}

function crossover(parentA, parentB) {
  const child = {};
  for (const key of PARAM_KEYS) {
    child[key] = Math.random() < 0.5 ? parentA[key] : parentB[key];
  }
  return child;
}

function mutate(genome, mutationRate, mutationStrength) {
  const child = { ...genome };
  for (const key of PARAM_KEYS) {
    if (Math.random() < mutationRate) {
      const range = PARAM_RANGES[key].max - PARAM_RANGES[key].min;
      child[key] += gaussianRandom() * range * mutationStrength;
      child[key] = Math.max(PARAM_RANGES[key].min, Math.min(PARAM_RANGES[key].max, child[key]));
    }
  }
  return child;
}

function buildNextGeneration(rankedPop, eliteFrac, mutationRate, mutationStrength) {
  const popSize = rankedPop.length;
  const numElites = Math.floor(popSize * eliteFrac);
  const elites = rankedPop.slice(0, numElites).map(r => ({ ...r.genome }));

  const parentPool = rankedPop.slice(0, Math.floor(popSize / 2)).map(r => r.genome);
  const numRandom = 2;
  const numChildren = popSize - numElites - numRandom;

  const children = [];
  for (let i = 0; i < numChildren; i++) {
    const a = parentPool[Math.floor(Math.random() * parentPool.length)];
    const b = parentPool[Math.floor(Math.random() * parentPool.length)];
    children.push(mutate(crossover(a, b), mutationRate, mutationStrength));
  }

  const randoms = Array.from({ length: numRandom }, () => randomGenome());
  return [...elites, ...randoms, ...children];
}

// ── CONVERGENCE DETECTION ─────────────────────────────────────────────────────

function checkConverged(fitnessHistory) {
  if (fitnessHistory.length < 5) return false;
  const last5 = fitnessHistory.slice(-5);
  for (const entry of last5) {
    const top3 = entry.slice(0, 3).map(r => r.fitness);
    const spread = Math.max(...top3) - Math.min(...top3);
    if (spread >= 0.01) return false;
  }
  return true;
}

// ── HOLDOUT VALIDATION ────────────────────────────────────────────────────────

function runHoldout(bestGenome, holdoutSeeds) {
  const holdoutGenomes = [...SEED_GENOMES.map(g => ({ ...g }))];

  let wins2P = 0, total2P = 0;
  let wins4P = 0, total4P = 0;

  // Run against seed personalities at 2P (best vs each personality)
  for (const opp of holdoutGenomes) {
    for (let s = 0; s < holdoutSeeds; s++) {
      const seed = 9999991 + s * 13 + holdoutGenomes.indexOf(opp) * 100003;
      const result = runGame([bestGenome, opp], 2, seed);
      total2P++;
      if (result.winner === 0) wins2P++;
    }
  }

  // Run at 4P: best + 3 seed personalities chosen round-robin
  for (let s = 0; s < holdoutSeeds; s++) {
    const opps = [holdoutGenomes[s % holdoutGenomes.length],
                  holdoutGenomes[(s + 1) % holdoutGenomes.length],
                  holdoutGenomes[(s + 2) % holdoutGenomes.length]];
    const seed = 7777771 + s * 17;
    const result = runGame([bestGenome, ...opps], 4, seed);
    total4P++;
    if (result.winner === 0) wins4P++;
  }

  return {
    winRate2P: total2P > 0 ? wins2P / total2P : 0,
    winRate4P: total4P > 0 ? wins4P / total4P : 0,
    seeds: holdoutSeeds,
  };
}

// ── OUTPUT FORMATTING ─────────────────────────────────────────────────────────

const SHORT = {
  bustThreshold2:  'bustT2',
  bustThreshold1:  'bustT1',
  dollarBuffer:    'dolBuf',
  cowWeight:       'cowW',
  dollarWeight:    'dolW',
  banditPenalty:   'bandPen',
  positionWeight:  'posW',
  denialWeight:    'denW',
  deckMemory:      'mem',
  lethalBias:      'bias',
  act1DollarBonus: 'a1dol',
  act3CowBonus:    'a3cow',
  revealBonus:     'rev',
  affordMult:      'aff',
};

function formatGenomeLine(rank, entry) {
  const parts = PARAM_KEYS.map(k => `${SHORT[k]}=${entry.genome[k].toFixed(2)}`).join(' ');
  return `  #${rank}  ${parts}  fit=${entry.fitness.toFixed(3)}`;
}

function printGenSummary(gen, rankedPop, quiet) {
  const best  = rankedPop[0].fitness;
  const mean  = rankedPop.reduce((s, r) => s + r.fitness, 0) / rankedPop.length;
  const worst = rankedPop[rankedPop.length - 1].fitness;
  const spread = best - worst;
  console.log(`Gen ${String(gen).padStart(3)} | best: ${best.toFixed(3)} | mean: ${mean.toFixed(3)} | worst: ${worst.toFixed(3)} | spread: ${spread.toFixed(3)}`);
  if (!quiet) {
    for (let i = 0; i < Math.min(5, rankedPop.length); i++) {
      console.log(formatGenomeLine(i + 1, rankedPop[i]));
    }
  }
}

function printFinalSummary(bestGenome, holdout, numGens) {
  console.log('\n' + '═'.repeat(43));
  console.log(`  Evolution complete — ${numGens} generations`);
  console.log(`  Best genome (holdout 2P: ${(holdout.winRate2P * 100).toFixed(1)}%, 4P: ${(holdout.winRate4P * 100).toFixed(1)}%):`);
  for (const key of PARAM_KEYS) {
    console.log(`    ${key.padEnd(16)} ${bestGenome[key].toFixed(2)}`);
  }
  console.log('═'.repeat(43));
}

// ── CLI PARSING ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const cfg = {
    popSize:          24,
    maxGenerations:   50,
    kSeeds:           30,
    eliteFrac:        0.25,
    mutationRate:     0.30,
    mutationStrength: 0.15,
    trials:           1,
    holdoutSeeds:     200,
    outDir:           path.join(__dirname, 'results'),
    resume:           null,
    quiet:            false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--pop':      cfg.popSize          = parseInt(args[++i]); break;
      case '--gens':     cfg.maxGenerations   = parseInt(args[++i]); break;
      case '--seeds':    cfg.kSeeds           = parseInt(args[++i]); break;
      case '--elite':    cfg.eliteFrac        = parseFloat(args[++i]); break;
      case '--mut-rate': cfg.mutationRate     = parseFloat(args[++i]); break;
      case '--mut-str':  cfg.mutationStrength = parseFloat(args[++i]); break;
      case '--trials':   cfg.trials           = parseInt(args[++i]); break;
      case '--holdout':  cfg.holdoutSeeds     = parseInt(args[++i]); break;
      case '--out':      cfg.outDir           = args[++i]; break;
      case '--resume':   cfg.resume           = args[++i]; break;
      case '--quiet':    cfg.quiet            = true; break;
      case '--help':
        console.log(`
node sim/evolve.js [options]

  --pop       <n>    Population size per generation     (default: 24)
  --gens      <n>    Max generations                    (default: 50)
  --seeds     <n>    Games per matchup per player count (default: 30)
  --elite     <f>    Elite fraction kept unchanged      (default: 0.25)
  --mut-rate  <f>    Probability each param mutates     (default: 0.30)
  --mut-str   <f>    Mutation std dev as fraction of range (default: 0.15)
  --trials    <n>    Independent runs to compare        (default: 1)
  --holdout   <n>    Seeds for final holdout validation (default: 200)
  --out       <dir>  Output directory                   (default: sim/results/)
  --resume    <file> Resume from a previous JSON checkpoint
  --quiet            Suppress per-generation genome detail
`);
        process.exit(0);
    }
  }
  return cfg;
}

// ── SINGLE TRIAL ─────────────────────────────────────────────────────────────

function runTrial(cfg, trialIdx) {
  let population;
  let startGen = 1;
  const generationsLog = [];
  const fitnessHistory = [];

  if (cfg.resume && trialIdx === 0) {
    try {
      const checkpoint = JSON.parse(fs.readFileSync(cfg.resume, 'utf8'));
      population = checkpoint.generations[checkpoint.generations.length - 1].population
        || checkpoint.generations.map(g => g.bestGenome);
      startGen = checkpoint.generations.length + 1;
      generationsLog.push(...checkpoint.generations);
      console.log(`Resumed from ${cfg.resume} at generation ${startGen}`);
    } catch (e) {
      console.error('Failed to load checkpoint:', e.message);
      process.exit(1);
    }
  } else {
    // Generation 0: 6 seed genomes + random fill
    const seeds = SEED_GENOMES.map(g => {
      const clone = {};
      for (const k of PARAM_KEYS) clone[k] = g[k];
      return clone;
    });
    const randoms = Array.from({ length: cfg.popSize - seeds.length }, () => randomGenome());
    population = [...seeds, ...randoms].slice(0, cfg.popSize);
  }

  let bestGenome = null;

  for (let gen = startGen; gen <= cfg.maxGenerations; gen++) {
    process.stdout.write(`Trial ${trialIdx + 1} | `);
    const results = evaluateFitness(population, cfg.kSeeds, cfg.quiet);
    const rankedPop = results.sort((a, b) => b.fitness - a.fitness);

    printGenSummary(gen, rankedPop, cfg.quiet);
    fitnessHistory.push(rankedPop.map(r => ({ fitness: r.fitness })));

    bestGenome = rankedPop[0].genome;

    generationsLog.push({
      gen,
      bestFitness:  rankedPop[0].fitness,
      meanFitness:  rankedPop.reduce((s, r) => s + r.fitness, 0) / rankedPop.length,
      bestGenome:   { ...bestGenome },
      population:   rankedPop.map(r => ({ ...r.genome })),
    });

    if (checkConverged(fitnessHistory)) {
      console.log(`Converged at generation ${gen}.`);
      break;
    }

    if (gen < cfg.maxGenerations) {
      population = buildNextGeneration(rankedPop, cfg.eliteFrac, cfg.mutationRate, cfg.mutationStrength);
    }
  }

  console.log('Running holdout validation...');
  const holdout = runHoldout(bestGenome, cfg.holdoutSeeds);
  console.log(`Holdout: 2P=${(holdout.winRate2P * 100).toFixed(1)}%  4P=${(holdout.winRate4P * 100).toFixed(1)}%`);

  return { generationsLog, bestGenome, holdout };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  const cfg = parseArgs(process.argv);

  if (!fs.existsSync(cfg.outDir)) fs.mkdirSync(cfg.outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const trialResults = [];

  for (let t = 0; t < cfg.trials; t++) {
    if (cfg.trials > 1) console.log(`\n${'─'.repeat(43)}\nTrial ${t + 1} / ${cfg.trials}\n`);
    const result = runTrial(cfg, t);
    trialResults.push(result);
  }

  // Pick best trial by holdout win rate (average of 2P and 4P)
  trialResults.sort((a, b) => {
    const scoreA = (a.holdout.winRate2P + a.holdout.winRate4P) / 2;
    const scoreB = (b.holdout.winRate2P + b.holdout.winRate4P) / 2;
    return scoreB - scoreA;
  });

  const best = trialResults[0];
  const numGens = best.generationsLog.length;

  printFinalSummary(best.bestGenome, best.holdout, numGens);

  if (cfg.trials > 1) {
    console.log('\nAll trial holdouts:');
    trialResults.forEach((r, i) =>
      console.log(`  Trial ${i + 1}: 2P=${(r.holdout.winRate2P * 100).toFixed(1)}%  4P=${(r.holdout.winRate4P * 100).toFixed(1)}%`)
    );
    console.log('\nGenome convergence check (top params across trials):');
    for (const key of PARAM_KEYS) {
      const vals = trialResults.map(r => r.bestGenome[key]);
      const range = Math.max(...vals) - Math.min(...vals);
      const paramRange = PARAM_RANGES[key].max - PARAM_RANGES[key].min;
      const pct = (range / paramRange * 100).toFixed(1);
      console.log(`  ${key.padEnd(16)} spread=${range.toFixed(3)} (${pct}% of range)`);
    }
  }

  const outFile = path.join(cfg.outDir, `evolve_${timestamp}.json`);
  const outData = {
    config: {
      popSize:          cfg.popSize,
      maxGenerations:   cfg.maxGenerations,
      kSeeds:           cfg.kSeeds,
      eliteFrac:        cfg.eliteFrac,
      mutationRate:     cfg.mutationRate,
      mutationStrength: cfg.mutationStrength,
    },
    generations: best.generationsLog.map(g => ({
      gen:         g.gen,
      bestFitness: g.bestFitness,
      meanFitness: g.meanFitness,
      bestGenome:  g.bestGenome,
    })),
    finalBest: best.bestGenome,
    holdout:   best.holdout,
    trials:    cfg.trials > 1 ? trialResults.map(r => ({ holdout: r.holdout, finalBest: r.bestGenome })) : undefined,
  };

  fs.writeFileSync(outFile, JSON.stringify(outData, null, 2));
  console.log(`\nResults written to ${outFile}`);
}

main();
