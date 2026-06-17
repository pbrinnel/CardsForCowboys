#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — Sim Card Tierlist Generator
// ============================================================
//
// Runs N sim games across strategy matchups and computes a
// per-card "winner lift": how much more likely the winner is
// to have bought a card vs a baseline random player.
//
// Usage:
//   node admin/gen-sim-tierlist.js                   # 5000 games, 2P
//   node admin/gen-sim-tierlist.js --games 10000     # more games
//   node admin/gen-sim-tierlist.js --players 3       # 3P games
//   node admin/gen-sim-tierlist.js --players 4       # 4P games
//   node admin/gen-sim-tierlist.js --all             # 2P+3P+4P combined
//   node admin/gen-sim-tierlist.js > sim/results/sim-tierlist.json
//
// Output: JSON array sorted by winner lift descending.
// Each entry: { id, act, cacti, cows, dollars, bandits, cost, special,
//   buyCount, winnerBuyCount, winnerLift, aiScores: {personality: score} }
//
// "Winner lift" = (winnerBuyCount / totalWins) / (buyCount / totalBuys)
// Values > 1 mean winners buy this card more than average.
// ============================================================

const path = require('path');
const core  = require(path.join(__dirname, '../sim/game-core'));
const ai    = require(path.join(__dirname, '../sim/ai-player'));
const { determineBuyWinner } = require(path.join(__dirname, '../sim/tiebreaker'));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { games: 5000, players: 2, all: false };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--games' || args[i] === '-n') && args[i + 1]) {
      opts.games = parseInt(args[++i]) || 5000;
    } else if (args[i] === '--players' && args[i + 1]) {
      opts.players = Math.min(4, Math.max(2, parseInt(args[++i]) || 2));
    } else if (args[i] === '--all') {
      opts.all = true;
    }
  }
  return opts;
}

// Mirror of simulate.js computeBuyOrder (needed to run games inline)
function computeBuyOrder(players) {
  const nonBusted = players.map((_, i) => i).filter(i => !players[i].busted);
  const priority  = nonBusted.filter(i =>  players[i].hasBuyBurnFirst).sort((a, b) => a - b);
  const normal    = nonBusted.filter(i => !players[i].hasBuyBurnFirst);
  let sorted;
  if (normal.length <= 1) {
    sorted = normal;
  } else {
    const sub = normal.map(i => players[i]);
    const ord = normal.map(i => i);
    const { winnerIdx } = determineBuyWinner(sub, ord);
    const globalWinner  = normal[winnerIdx];
    sorted = [globalWinner, ...normal.filter(i => i !== globalWinner).sort((a, b) => a - b)];
  }
  return [...priority, ...sorted];
}

function simulateGame(strategies, numPlayers) {
  core.resetUidCounter();
  const players = strategies.map((s, i) => core.createPlayer(`P${i + 1}`, s.name));
  const purchases = Array.from({ length: numPlayers }, () => []);

  for (let act = 1; act <= 3; act++) {
    for (const p of players) {
      const all = [...p.deck, ...p.discard, ...p.hand];
      p.deck = core.shuffle(all);
      p.discard = [];
      p.hand = [];
    }

    const pyramid = core.buildPyramid(act, numPlayers);

    while (!core.isPyramidEmpty(pyramid)) {
      // Draw phase
      for (let i = 0; i < numPlayers; i++) {
        ai.executeDrawPhase(players[i], strategies[i], pyramid, act);
      }

      // discard_to_player pass (weakest target, mirrors simulate.js)
      for (let pi = 0; pi < numPlayers; pi++) {
        const from = players[pi];
        const passCards = from.hand.filter(c => c.special === 'discard_to_player');
        for (const card of passCards) {
          const target = players
            .map((p, i) => ({ p, i }))
            .filter(x => x.i !== pi)
            .sort((a, b) => a.p.herd !== b.p.herd ? a.p.herd - b.p.herd : a.i - b.i)[0];
          const idx = from.hand.indexOf(card);
          if (idx >= 0) from.hand.splice(idx, 1);
          target.p.discard.push(card);
        }
      }

      // Buy phase
      const buyOrder = computeBuyOrder(players);
      for (const pi of buyOrder) {
        if (core.isPyramidEmpty(pyramid)) break;
        const decision = ai.chooseBuy(players[pi], strategies[pi], pyramid, act);
        if (decision.action === 'buy') {
          const slot = pyramid[decision.row][decision.col];
          players[pi].discard.push(slot.card);
          purchases[pi].push(slot.card.id);
          slot.removed = true;
          core.revealUncovered(pyramid);
        } else if (decision.action === 'burn') {
          pyramid[decision.row][decision.col].removed = true;
          core.revealUncovered(pyramid);
        }
        if (players[pi].hasExtraBuy && !players[pi].extraBuyUsed && !core.isPyramidEmpty(pyramid)) {
          players[pi].extraBuyUsed = true;
          const ex = ai.chooseBuy(players[pi], strategies[pi], pyramid, act);
          if (ex.action === 'buy') {
            const slot = pyramid[ex.row][ex.col];
            players[pi].discard.push(slot.card);
            purchases[pi].push(slot.card.id);
            slot.removed = true;
            core.revealUncovered(pyramid);
          } else if (ex.action === 'burn') {
            pyramid[ex.row][ex.col].removed = true;
            core.revealUncovered(pyramid);
          }
        }
      }

      // Score round
      for (const p of players) {
        if (!p.busted && p.roundCows !== 0) p.herd = Math.max(0, p.herd + p.roundCows);
        p.discard.push(...p.hand);
        p.hand = [];
      }
    }
  }

  // Showdown
  for (const p of players) {
    const all = [...p.deck, ...p.discard, ...p.hand];
    const totalCows    = all.reduce((s, c) => s + (c.cows    || 0), 0);
    const totalDollars = all.reduce((s, c) => s + (c.dollars || 0), 0);
    p.herd = Math.max(0, p.herd + totalCows + Math.floor(totalDollars / 2));
  }

  const maxHerd = Math.max(...players.map(p => p.herd));
  const winners = players.map((p, i) => p.herd === maxHerd ? i : -1).filter(i => i >= 0);
  return { purchases, winners, herds: players.map(p => p.herd) };
}

function runBatch(numPlayers, numGames) {
  const stratKeys = Object.keys(ai.STRATEGIES);

  // Per-card accumulators
  const cardStats = {}; // id -> { buyCount, winnerBuyCount }
  for (const card of core.STORE_CARDS) {
    cardStats[card.id] = { buyCount: 0, winnerBuyCount: 0 };
  }

  let totalBuys = 0;
  let totalWins = 0; // sum of winner counts (1 per game for sole winners, shared for ties)

  for (let g = 0; g < numGames; g++) {
    if (g > 0 && g % 500 === 0) process.stderr.write(`\r  ${g}/${numGames}`);

    // Pick random strategies for variety
    const strategies = Array.from({ length: numPlayers }, () =>
      ai.STRATEGIES[stratKeys[Math.floor(Math.random() * stratKeys.length)]]
    );

    const { purchases, winners } = simulateGame(strategies, numPlayers);
    const winnerSet = new Set(winners);

    for (let pi = 0; pi < numPlayers; pi++) {
      const isWinner = winnerSet.has(pi);
      for (const cardId of purchases[pi]) {
        if (cardStats[cardId]) {
          cardStats[cardId].buyCount++;
          if (isWinner) cardStats[cardId].winnerBuyCount++;
        }
      }
      totalBuys += purchases[pi].length;
      if (isWinner) totalWins++;
    }
  }
  process.stderr.write('\r');

  return { cardStats, totalBuys, totalWins, numGames };
}

// Compute average AI score for each card across all personalities, by act
function computeAiScores(card) {
  const scores = {};
  for (const [key, strat] of Object.entries(ai.STRATEGIES)) {
    // Score in the card's own act context
    let score = 0;
    score += card.cows    * strat.cowWeight;
    score += card.dollars * strat.dollarWeight;
    score += card.bandits * strat.banditWeight;
    if (card.special && strat.specialBonuses && strat.specialBonuses[card.special]) {
      score += strat.specialBonuses[card.special];
    }
    if (card.cows < 0 && strat.negativeCowPenalty) score += strat.negativeCowPenalty;
    if (card.act === 1 && strat.act1DollarBonus) score += card.dollars * strat.act1DollarBonus;
    if (card.act === 3 && strat.act3CowBonus)    score += card.cows    * strat.act3CowBonus;
    scores[key] = +score.toFixed(2);
  }
  return scores;
}

function main() {
  const opts = parseArgs();
  const runs = opts.all ? [2, 3, 4] : [opts.players];

  // Accumulate across all requested player counts
  const combined = {};
  for (const card of core.STORE_CARDS) {
    combined[card.id] = { buyCount: 0, winnerBuyCount: 0 };
  }
  let totalBuys = 0, totalWins = 0, totalGames = 0;

  for (const np of runs) {
    const label = `${np}P, ${opts.games} games`;
    process.stderr.write(`  Running ${label}...\n`);
    const batch = runBatch(np, opts.games);
    for (const [id, s] of Object.entries(batch.cardStats)) {
      if (combined[id]) {
        combined[id].buyCount      += s.buyCount;
        combined[id].winnerBuyCount += s.winnerBuyCount;
      }
    }
    totalBuys  += batch.totalBuys;
    totalWins  += batch.totalWins;
    totalGames += batch.numGames;
    process.stderr.write(`  Done.\n`);
  }

  // Derive baseline from card stats (winner purchases / all purchases).
  // For a 2-player game this is ~0.5; lower for more players.
  const totalWinnerBuys = Object.values(combined).reduce((s, c) => s + c.winnerBuyCount, 0);
  const totalAllBuys    = Object.values(combined).reduce((s, c) => s + c.buyCount, 0);
  const baseline = totalWinnerBuys / Math.max(1, totalAllBuys);

  const output = core.STORE_CARDS.map(card => {
    const s = combined[card.id];
    const winnerRate = s.buyCount > 0 ? s.winnerBuyCount / s.buyCount : null;
    const lift = (winnerRate !== null && baseline > 0) ? +(winnerRate / baseline).toFixed(3) : null;
    const aiScores = computeAiScores(card);
    const scoreVals = Object.values(aiScores);
    const avgScore  = scoreVals.length
      ? +(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length).toFixed(2)
      : 0;

    return {
      id:       card.id,
      act:      card.act,
      cacti:    card.cacti,
      cows:     card.cows,
      dollars:  card.dollars,
      bandits:  card.bandits,
      cost:     card.cost,
      special:  card.special,
      minPlayers: card.minPlayers,
      buyCount:      s.buyCount,
      winnerBuyCount: s.winnerBuyCount,
      winnerRate:    winnerRate !== null ? +winnerRate.toFixed(4) : null,
      winnerLift:    lift,
      avgAiScore:    avgScore,
      aiScores,
    };
  });

  // Sort by winnerLift desc, nulls last
  output.sort((a, b) => {
    if (a.winnerLift === null && b.winnerLift === null) return 0;
    if (a.winnerLift === null) return 1;
    if (b.winnerLift === null) return -1;
    return b.winnerLift - a.winnerLift;
  });

  const meta = {
    generated: new Date().toISOString(),
    totalGames,
    totalBuys: totalAllBuys,
    totalWinnerBuys,
    baseline: +baseline.toFixed(4),
    playerCounts: runs,
  };

  console.log(JSON.stringify({ meta, cards: output }, null, 2));
}

main();
