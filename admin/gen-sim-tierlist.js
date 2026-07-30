#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — Sim Card Tierlist Generator
// ============================================================
//
// Runs N sim games with random personality lineups and computes a per-card "winner lift":
// how much more often the winner owns a card than an average player. Pairs with
// admin/compare-tierlists.py (sim-vs-human card comparison).
//
// Runs on the shared engine (sim/personality-engine.js) + the REAL personalities
// (sim/personalities.js) — same AI the live game uses. Deterministic per game (seeded).
//
// Usage:
//   node admin/gen-sim-tierlist.js                   # 5000 games, 2P
//   node admin/gen-sim-tierlist.js --games 10000     # more games
//   node admin/gen-sim-tierlist.js --players 3       # 3P games
//   node admin/gen-sim-tierlist.js --all             # 2P+3P+4P combined
//   node admin/gen-sim-tierlist.js --all --games 10000 > sim/results/sim-tierlist.json
//
// Output JSON: { meta, cards[] } sorted by winnerLift desc. Each card:
//   { id, act, cacti, cows, dollars, bandits, cost, special,
//     buyCount, winnerBuyCount, winnerRate, winnerLift, avgAiScore, aiScores }
// winnerLift = winnerRate / baseline; > 1 means winners buy it more than average.
// ============================================================

const path = require('path');
const core    = require(path.join(__dirname, '../sim/game-core'));
const engine  = require(path.join(__dirname, '../sim/personality-engine'));
const { GENOMES, byName } = require(path.join(__dirname, '../sim/personalities'));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { games: 5000, players: 2, all: false };
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--games' || args[i] === '-n') && args[i + 1]) opts.games = parseInt(args[++i]) || 5000;
    else if (args[i] === '--players' && args[i + 1]) opts.players = Math.min(4, Math.max(2, parseInt(args[++i]) || 2));
    else if (args[i] === '--all') opts.all = true;
  }
  return opts;
}

function runBatch(numPlayers, numGames) {
  const cardStats = {};
  for (const card of core.STORE_CARDS) cardStats[card.id] = { buyCount: 0, winnerBuyCount: 0 };
  let totalBuys = 0, totalWins = 0;

  for (let g = 0; g < numGames; g++) {
    if (g > 0 && g % 500 === 0) process.stderr.write(`\r  ${g}/${numGames}`);
    // Random personality lineup for variety (seat order varies with the game seed).
    const lineup = Array.from({ length: numPlayers }, () =>
      GENOMES[Math.floor(Math.random() * GENOMES.length)]);
    const { collections, winner } = engine.runGame(lineup, numPlayers, g + 1, { detail: true });

    collections.forEach((ids, pi) => {
      const isWinner = pi === winner;
      for (const id of ids) if (id.startsWith('card_') && cardStats[id]) {  // bought store cards only
        cardStats[id].buyCount++;
        if (isWinner) cardStats[id].winnerBuyCount++;
        totalBuys++;
      }
    });
    totalWins++; // sole winner per game (engine breaks ties to lowest index)
  }
  process.stderr.write('\r');
  return { cardStats, totalBuys, totalWins, numGames };
}

// Per-personality AI buy-score for a card (real engine.scoreCard, in the card's own act).
function computeAiScores(card) {
  const scores = {};
  for (const g of GENOMES) scores[g.name] = +engine.scoreCard(card, g, card.act, [], null).toFixed(2);
  return scores;
}

function main() {
  const opts = parseArgs();
  const runs = opts.all ? [2, 3, 4] : [opts.players];

  const combined = {};
  for (const card of core.STORE_CARDS) combined[card.id] = { buyCount: 0, winnerBuyCount: 0 };
  let totalGames = 0;

  for (const np of runs) {
    process.stderr.write(`  Running ${np}P, ${opts.games} games...\n`);
    const batch = runBatch(np, opts.games);
    for (const [id, s] of Object.entries(batch.cardStats)) {
      if (combined[id]) { combined[id].buyCount += s.buyCount; combined[id].winnerBuyCount += s.winnerBuyCount; }
    }
    totalGames += batch.numGames;
    process.stderr.write('  Done.\n');
  }

  const totalWinnerBuys = Object.values(combined).reduce((s, c) => s + c.winnerBuyCount, 0);
  const totalAllBuys    = Object.values(combined).reduce((s, c) => s + c.buyCount, 0);
  const baseline = totalWinnerBuys / Math.max(1, totalAllBuys);

  const output = core.STORE_CARDS.map(card => {
    const s = combined[card.id];
    const winnerRate = s.buyCount > 0 ? s.winnerBuyCount / s.buyCount : null;
    const lift = (winnerRate !== null && baseline > 0) ? +(winnerRate / baseline).toFixed(3) : null;
    const aiScores = computeAiScores(card);
    const vals = Object.values(aiScores);
    const avgScore = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 0;
    return {
      id: card.id, act: card.act, cacti: card.cacti, cows: card.cows, dollars: card.dollars,
      bandits: card.bandits, cost: card.cost, special: card.special,
      buyCount: s.buyCount, winnerBuyCount: s.winnerBuyCount,
      winnerRate: winnerRate !== null ? +winnerRate.toFixed(4) : null,
      winnerLift: lift, avgAiScore: avgScore, aiScores,
    };
  });

  output.sort((a, b) => {
    if (a.winnerLift === null && b.winnerLift === null) return 0;
    if (a.winnerLift === null) return 1;
    if (b.winnerLift === null) return -1;
    return b.winnerLift - a.winnerLift;
  });

  const meta = {
    generated: new Date().toISOString(),
    totalGames, totalBuys: totalAllBuys, totalWinnerBuys,
    baseline: +baseline.toFixed(4), playerCounts: runs,
  };
  console.log(JSON.stringify({ meta, cards: output }, null, 2));
}

main();
