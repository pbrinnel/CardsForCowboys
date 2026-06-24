#!/usr/bin/env node
// sim/personality-engine.js — the Cards For Cowboys AI decision layer + deterministic
// one-game runner, shared by all sim tools (evolve.js, simulate.js, draw-cap-experiment.js).
//
// A 'genome' is a personality parameter object (see sim/personalities.js). The engine is
// pure and seed-deterministic: runGame(genomes, numPlayers, seed) replays a full 3-act game
// and returns { herds, winner, busts, drawRounds }. This is the SAME decision logic the live
// game runs (play.js aiShouldDraw / scoreCardForAI / aiBuyTurn) — keep them in sync.
//
// 2–4 players only (buildPyramidSeeded uses the triangle formula; 5–8P flat rows not modeled).
'use strict';

const core = require('./game-core');
const { determineBuyWinner } = require('./tiebreaker');

// ── LCG SEEDED RNG ───────────────────────────────────────────────────────────

function makeLCG(seed) {
  let s = ((seed >>> 0) || 1);
  const fn = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
  // State accessors for the resumable simulator (cloneState). Pure additions — the call
  // behaviour of fn() is byte-identical to the original closure.
  fn.getState = () => s;
  fn.setState = (v) => { s = (v >>> 0); };
  return fn;
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
  if (card.special === 'burn_to_use')         score += 2;
  if (card.special === 'draw4')                score += 2;
  if (card.special === 'replay_discard')       score += 2;
  if (card.special === 'look3_rearrange')      score += 1.5;
  if (card.special === 'burn_buy_first') score += 1;
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
  // Hard hand-size cap. Tunable per-genome (draw-cap experiment); absent = legacy 7.
  if (player.hand.length >= (genome.maxDraw ?? 7)) return false;
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

  // Always activate extra_buy if held (free extra action; no condition needed)
  if (!player.hasExtraBuy) {
    const extraCard = player.hand.find(c => c.special === 'extra_buy');
    if (extraCard) {
      player.hand.splice(player.hand.indexOf(extraCard), 1);
      player.hasExtraBuy = true;
    }
  }

  // Activate dollar-producing hand cards if doing so lets us buy a HIGHER-SCORED card —
  // not only one we couldn't otherwise afford at all (see AI_FUTURE_IMPROVEMENTS #1).
  // Mirrors aiBuyTurn's bestScoredAffordable in play.js (incl. reveal bonus).
  const bestScoredAffordable = (budget) => {
    let best = -Infinity;
    for (const a of avail) {
      if ((a.slot.card.cost || 0) > budget) continue;
      const s = scoreCard(a.slot.card, genome, act, allPlayers, player)
              + pyramidRevealBonus(pyramid, a.row, a.col, genome);
      if (s > best) best = s;
    }
    return best;
  };
  for (const tCard of player.hand.filter(c =>
    c.special === 'burn_to_use' && c.dollars > 0
  )) {
    const bonus = tCard.dollars;
    if (bestScoredAffordable(player.roundDollars + bonus) > bestScoredAffordable(player.roundDollars)) {
      player.hand.splice(player.hand.indexOf(tCard), 1);
      player.roundDollars += bonus;
    }
  }

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
  // core.createStarterDeck() shuffles with Math.random, so without this the seeded
  // reshuffle below starts from a random order and the game is NOT seed-reproducible.
  // Canonicalize by uid (= deterministic creation order) first so `seed` fully controls
  // the game — required for reproducible GA fitness + experiments.
  p.deck.sort((a, b) => a.uid - b.uid);
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
      const copyNextWasActive = player.copyNextActive;
      core.applyCardEffects(player, card, isFirst);

      // draw4: mandatory draws, with a between-draw jail-negate window (parity with live game).
      // Copy Next doubles forced draws (4 → 8).
      if (card.special === 'draw4' && !player.busted) {
        const draws = copyNextWasActive ? 8 : 4;
        for (let d = 0; d < draws; d++) {
          if (player.busted) break;
          // Proactively negate with a held jail (-1 bandit) card before each draw if at 2+ bandits.
          if (player.roundBandits >= 2) {
            const jail = player.hand.find(c =>
              (c.special === 'burn_to_use' && c.bandits < 0) ||
              (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor?.special === 'burn_to_use' && player.copyNextDonor.bandits < 0)
            );
            if (jail) {
              player.hand.splice(player.hand.indexOf(jail), 1);
              const jailEffect = (jail.special === 'copy_next') ? player.copyNextDonor : jail;
              if (jail.special === 'copy_next') { player.copyNextDonor = null; player.copyNextCard = null; }
              player.roundDollars += jailEffect.dollars;
              player.roundBandits = Math.max(0, player.roundBandits + jailEffect.bandits);
              player.roundCows += jailEffect.cows;
            }
          }
          const extra = drawFromDeckSeeded(player, rng);
          if (!extra) break;
          player.hand.push(extra);
          core.applyCardEffects(player, extra, false);
          if (player.roundBandits >= 3) { handleBust(player); break; }
        }
        if (player.busted) break;
      }

      // burn_to_use activation: jail cards only (-1 bandit) — dollar cards saved for
      // before-stopping window or buy phase (mid-draw dollar activation is wasteful).
      // Also activates Copy Next if linked to a jail donor.
      for (const tCard of player.hand.filter(c =>
        (c.special === 'burn_to_use' && c.bandits < 0) ||
        (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor?.special === 'burn_to_use' && player.copyNextDonor.bandits < 0)
      )) {
        if (player.roundBandits < 2) continue;
        const idx = player.hand.indexOf(tCard);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          const effectCard = (tCard.special === 'copy_next') ? player.copyNextDonor : tCard;
          if (tCard.special === 'copy_next') { player.copyNextDonor = null; player.copyNextCard = null; }
          player.roundBandits = Math.max(0, player.roundBandits + effectCard.bandits);
        }
      }


      // look3_rearrange: always burn, sort top 3 deck cards (least bandits first)
      if (card.special === 'look3_rearrange' && player.deck.length >= 2) {
        const idx = player.hand.indexOf(card);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          // Parity with game: reshuffle discard in if the draw pile can't fill a top-3.
          if (player.deck.length < 3 && player.discard.length > 0) {
            player.deck.push(...seededShuffle(player.discard, rng));
            player.discard = [];
          }
          const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
          top3.sort((a, b) => a.bandits - b.bandits);
          player.deck.unshift(...top3);
        }
      }

      // look3_immediate: keep card, sort top 3 deck cards (least bandits first)
      if (card.special === 'look3_immediate' && player.deck.length >= 2) {
        // Parity with game: reshuffle discard in if the draw pile can't fill a top-3.
        if (player.deck.length < 3 && player.discard.length > 0) {
          player.deck.push(...seededShuffle(player.discard, rng));
          player.discard = [];
        }
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

      // burn_buy_first: auto-activate
      if (card.special === 'burn_buy_first') {
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

      // Before stopping: activate dollar burn_to_use (including Copy Next copies) if it
      // unlocks a better card.
      if (!shouldDraw(player, genome, pyramid, act, players)) {
        for (const tCard of player.hand.filter(c =>
          (c.special === 'burn_to_use' && c.dollars > 0) ||
          (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor?.special === 'burn_to_use' && player.copyNextDonor.dollars > 0)
        )) {
          const effectCard = (tCard.special === 'copy_next') ? player.copyNextDonor : tCard;
          const avail = core.getAvailablePyramidCards(pyramid);
          const unlocksAfford = avail.some(a =>
            (a.slot.card.cost || 0) > player.roundDollars &&
            (a.slot.card.cost || 0) <= player.roundDollars + effectCard.dollars
          );
          if (unlocksAfford) {
            const idx = player.hand.indexOf(tCard);
            if (idx >= 0) {
              player.hand.splice(idx, 1);
              if (tCard.special === 'copy_next') { player.copyNextDonor = null; player.copyNextCard = null; }
              player.roundDollars += effectCard.dollars;
              player.roundCows += effectCard.cows;
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

// Buy order for a round: hasBuyBurnFirst holder(s) first, then a tiebreaker-sorted field.
// Pure (no rng, no mutation) — used by both runBuyPhase and the resumable continueGame.
function computeBuyOrder(players) {
  const playerOrder = players.map((_, i) => i);
  const nonBusted = playerOrder.filter(i => !players[i].busted);

  // hasBuyBurnFirst players go first. 5-8P doubled-deck rule: only ONE holder per round
  // is honored (lowest index = first to activate); extras demote to normal order. Inert
  // at ≤4P (a single card_14 → at most one holder).
  const buyFirst = nonBusted.filter(i => players[i].hasBuyBurnFirst).sort((a, b) => a - b);
  const priority = buyFirst.slice(0, 1);
  const demoted = new Set(buyFirst.slice(1));
  const normal = nonBusted.filter(i => !players[i].hasBuyBurnFirst || demoted.has(i));

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

  return [...priority, ...normalSorted];
}

// One buyer's full turn: primary buy/burn + the granted extra-buy turn (if held). No rng.
function processBuyer(player, genome, pyramid, act, players) {
  const decision = chooseBuy(player, genome, pyramid, act, players);
  applyBuyDecision(player, decision, pyramid);

  // Extra buy turn
  if (player.hasExtraBuy && !player.extraBuyUsed && !core.isPyramidEmpty(pyramid)) {
    player.extraBuyUsed = true;
    const extraDecision = chooseBuy(player, genome, pyramid, act, players);
    applyBuyDecision(player, extraDecision, pyramid);
  }
}

function runBuyPhase(players, genomes, pyramid, act) {
  const buyOrder = computeBuyOrder(players);
  let cursor = 0;
  while (cursor < buyOrder.length) {
    if (core.isPyramidEmpty(pyramid)) break;
    processBuyer(players[buyOrder[cursor]], genomes[buyOrder[cursor]], pyramid, act, players);
    cursor++;
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

// ── ROUND / SHOWDOWN SCORING (extracted for the resumable core) ────────────────

function scoreRound(players) {
  for (const player of players) {
    if (!player.busted && player.roundCows !== 0) {
      player.herd = Math.max(0, player.herd + player.roundCows);
    }
    player.discard.push(...player.hand);
    player.hand = [];
  }
}

// Showdown: count all cards in each player's collection + the floor(dollars/2) bonus cows.
function applyShowdown(players) {
  for (const player of players) {
    const allCards = [...player.deck, ...player.discard, ...player.hand];
    const totalCows    = allCards.reduce((s, c) => s + (c.cows    || 0), 0);
    const totalDollars = allCards.reduce((s, c) => s + (c.dollars || 0), 0);
    const bonusCows    = Math.floor(totalDollars / 2);
    player.herd = Math.max(0, player.herd + totalCows + bonusCows);
  }
}

// ── RESUMABLE SIMULATOR CORE ───────────────────────────────────────────────────
//
// The game is a phase state machine that can be paused, cloned, and resumed under
// arbitrary per-seat policies (see AI_SEARCH_BAKEOFF_PLAN.md §4a). runGame is now a thin
// wrapper: createInitialState → continueGame(…, 'endOfGame') → gameResult.
//
// State shape:
//   { numPlayers, genomes, players[], act, round, phase, pyramid, buyOrder, buyCursor,
//     busts[], drawRounds[], seed, rng }
// phase ∈ 'nextAct' | 'draw' | 'buy' | 'score' | 'showdown' | 'done'.
//
// The RNG lives IN the state (not a separate param) so cloneState captures it atomically.
// Rollouts MUST replace the clone's rng with their own deterministically-seeded LCG (RNG
// hygiene, §4b) — cloneState gives the clone an INDEPENDENT LCG so it can never perturb the
// live game's RNG.

function createInitialState(genomes, numPlayers, seed) {
  core.resetUidCounter();
  const rng = makeLCG(seed);
  const players = genomes.map((g, i) => createPlayerSeeded(`P${i}`, rng));
  return {
    numPlayers,
    genomes,                                       // default policies, one per seat
    players,
    act: 0,
    round: 0,
    phase: 'nextAct',
    pyramid: null,
    buyOrder: null,
    buyCursor: 0,
    busts:      new Array(players.length).fill(0), // rounds ending in a bust
    drawRounds: new Array(players.length).fill(0), // rounds the player actually drew
    seed,
    rng,
  };
}

// Advance `state` in place from its current phase to `horizon`.
//   horizon 'endOfRound' — stop after the current round's scoring completes.
//   horizon 'endOfAct'   — stop after the current act's 5th round completes.
//   horizon 'endOfGame'  — run all 3 acts + showdown (state.phase ends 'done').
// `policies` (one per seat) drive draw/buy decisions; defaults to the state's own genomes.
// Returns the (mutated) state.
function continueGame(state, policies = state.genomes, horizon = 'endOfGame') {
  const rng = state.rng;
  while (state.phase !== 'done') {
    switch (state.phase) {
      case 'nextAct': {
        if (state.act === 3) { state.phase = 'showdown'; break; }
        state.act++;
        // Between acts: merge and reshuffle all cards (seeded). Runs for act 1 too —
        // it reshuffles the starter deck once more (matches the original act loop).
        for (const player of state.players) {
          const allCards = [...player.deck, ...player.discard, ...player.hand];
          player.deck = seededShuffle(allCards, rng);
          player.discard = [];
          player.hand = [];
        }
        state.pyramid = buildPyramidSeeded(state.act, state.numPlayers, rng);
        state.round = 1;
        state.phase = 'draw';
        break;
      }
      case 'draw': {
        runDrawPhase(state.players, policies, state.pyramid, state.act, rng);
        // Diagnostics: tally before the buy phase. A player with cards in hand drew this round.
        for (let i = 0; i < state.players.length; i++) {
          if (state.players[i].hand.length > 0) state.drawRounds[i]++;
          if (state.players[i].busted) state.busts[i]++;
        }
        state.buyOrder = computeBuyOrder(state.players);
        state.buyCursor = 0;
        state.phase = 'buy';
        break;
      }
      case 'buy': {
        // Resumable: a cloned state may enter mid-phase with buyCursor > 0.
        while (state.buyCursor < state.buyOrder.length) {
          if (core.isPyramidEmpty(state.pyramid)) break;
          const pIdx = state.buyOrder[state.buyCursor];
          processBuyer(state.players[pIdx], policies[pIdx], state.pyramid, state.act, state.players);
          state.buyCursor++;
        }
        state.phase = 'score';
        break;
      }
      case 'score': {
        scoreRound(state.players);
        const finishedAct = (state.round === 5);
        if (finishedAct) { state.phase = 'nextAct'; }
        else { state.round++; state.phase = 'draw'; }
        if (horizon === 'endOfRound') return state;
        if (horizon === 'endOfAct' && finishedAct) return state;
        break;
      }
      case 'showdown': {
        applyShowdown(state.players);
        state.phase = 'done';
        break;
      }
    }
  }
  return state;
}

// ── CLONE ──────────────────────────────────────────────────────────────────────

function cloneCard(c) {
  return {
    uid: c.uid, id: c.id, dollars: c.dollars, cows: c.cows, bandits: c.bandits,
    cacti: c.cacti, cost: c.cost, special: c.special, act: c.act, minPlayers: c.minPlayers,
  };
}

function clonePlayer(p) {
  // Clone every card by value, keyed by uid, so the copyNext references can be re-pointed
  // at the CLONE's card instances (not the originals). This is the classic clone trap:
  // copyNextCard/copyNextDonor alias cards living in hand/discard.
  const byUid = new Map();
  const cloneArr = (arr) => arr.map(c => { const cc = cloneCard(c); byUid.set(c.uid, cc); return cc; });
  const deck    = cloneArr(p.deck);
  const discard = cloneArr(p.discard);
  const hand    = cloneArr(p.hand);
  const remap = (ref) => ref ? (byUid.get(ref.uid) || cloneCard(ref)) : null;
  return {
    name: p.name,
    personality: p.personality,
    deck, discard, hand,
    herd: p.herd,
    roundDollars: p.roundDollars,
    roundCows: p.roundCows,
    roundBandits: p.roundBandits,
    busted: p.busted,
    stoppedDrawing: p.stoppedDrawing,
    copyNextActive: p.copyNextActive,
    copyNextCard: remap(p.copyNextCard),
    copyNextDonor: remap(p.copyNextDonor),
    hasBuyBurnFirst: p.hasBuyBurnFirst,
    hasExtraBuy: p.hasExtraBuy,
    extraBuyUsed: p.extraBuyUsed,
  };
}

function clonePyramid(pyramid) {
  return pyramid.map(row => row.map(slot => ({
    card: cloneCard(slot.card), faceUp: slot.faceUp, removed: slot.removed,
  })));
}

// Deep copy of the resumable state. genomes are read-only data → shared by reference.
// The clone gets an INDEPENDENT LCG positioned at the same internal state (so resuming the
// clone reproduces the original's continuation exactly, and the original is never perturbed).
function cloneState(state) {
  const rng = makeLCG(0);
  rng.setState(state.rng.getState());
  return {
    numPlayers: state.numPlayers,
    genomes: state.genomes,
    players: state.players.map(clonePlayer),
    act: state.act,
    round: state.round,
    phase: state.phase,
    pyramid: state.pyramid ? clonePyramid(state.pyramid) : null,
    buyOrder: state.buyOrder ? [...state.buyOrder] : null,
    buyCursor: state.buyCursor,
    busts: [...state.busts],
    drawRounds: [...state.drawRounds],
    seed: state.seed,
    rng,
  };
}

// ── GAME RESULT + RUNNER ─────────────────────────────────────────────────────────

function gameResult(state, opts = {}) {
  const players = state.players;
  const herds = players.map(p => p.herd);
  const maxHerd = Math.max(...herds);
  // Winner = highest herd; ties go to lower player index.
  const winner = herds.indexOf(maxHerd);
  const result = { herds, winner, busts: state.busts, drawRounds: state.drawRounds };
  // opts.detail: per-player final card-id collections, for card-balance analysis
  // (simulate.js). Off by default so the GA hot path stays lean.
  if (opts.detail) {
    result.collections = players.map(p =>
      [...p.deck, ...p.discard, ...p.hand].map(c => c.id));
  }
  return result;
}

function runGame(genomes, numPlayers, seed, opts = {}) {
  const state = createInitialState(genomes, numPlayers, seed);
  continueGame(state, genomes, 'endOfGame');
  return gameResult(state, opts);
}

module.exports = {
  makeLCG, seededShuffle, calcBustProb, scoreCard, pyramidRevealBonus, getBestCost,
  shouldDraw, chooseBuy, drawFromDeckSeeded, buildPyramidSeeded, createPlayerSeeded,
  runDrawPhase, handleBust, computeBuyOrder, processBuyer, runBuyPhase, applyBuyDecision,
  scoreRound, applyShowdown, runGame,
  // Resumable simulator core (B0) — shared with the search AI + trajectory value oracle.
  createInitialState, continueGame, cloneState, clonePlayer, clonePyramid, gameResult,
};
