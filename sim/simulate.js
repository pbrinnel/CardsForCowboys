#!/usr/bin/env node
// ============================================================
// Cards For Cowboys - AI vs AI Simulation Runner
// ============================================================
//
// Usage:
//   node sim/simulate.js                              # 1000 games, 2P default vs default
//   node sim/simulate.js --games 5000                 # 5000 games
//   node sim/simulate.js --players 3                  # 3-player game
//   node sim/simulate.js --p1 reckless_cowFocused --p2 timid_balanced
//   node sim/simulate.js --p1 bold_dollarFocused --p2 moderate_balanced --p3 timid_banditAverse
//   node sim/simulate.js --tournament                 # all strategy combos (2P only)
//   node sim/simulate.js --random                     # random strategies
//   node sim/simulate.js --list                       # show available strategies
//
// ============================================================

const core = require('./game-core');
const ai = require('./ai-player');
const { StatsCollector } = require('./stats');
const { determineBuyWinner } = require('./tiebreaker');

// --- CLI ARGS ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    games: 1000,
    players: 2,
    p1: 'default',
    p2: 'default',
    p3: 'default',
    p4: 'default',
    tournament: false,
    random: false,
    list: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--games': case '-n':
        opts.games = parseInt(args[++i]) || 1000;
        break;
      case '--players':
        opts.players = Math.min(4, Math.max(2, parseInt(args[++i]) || 2));
        break;
      case '--p1':
        opts.p1 = args[++i] || 'default';
        break;
      case '--p2':
        opts.p2 = args[++i] || 'default';
        break;
      case '--p3':
        opts.p3 = args[++i] || 'default';
        break;
      case '--p4':
        opts.p4 = args[++i] || 'default';
        break;
      case '--tournament': case '-t':
        opts.tournament = true;
        break;
      case '--random': case '-r':
        opts.random = true;
        break;
      case '--list': case '-l':
        opts.list = true;
        break;
      case '--verbose': case '-v':
        opts.verbose = true;
        break;
      case '--help': case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
Cards For Cowboys - AI Simulation

Usage:
  node sim/simulate.js [options]

Options:
  --games N, -n N     Number of games to simulate (default: 1000)
  --players N         Number of players (2-4, default: 2)
  --p1 STRATEGY       P1 strategy name (default: default)
  --p2 STRATEGY       P2 strategy name (default: default)
  --p3 STRATEGY       P3 strategy name for 3P/4P (default: default)
  --p4 STRATEGY       P4 strategy name for 4P (default: default)
  --tournament, -t    Run all strategy combos against each other (2P only)
  --random, -r        Random strategy pair/set each game
  --list, -l          List available strategies
  --verbose, -v       Print per-game results
  --help, -h          Show this help

Strategies: ${Object.keys(ai.STRATEGIES).join(', ')}
`);
}

function resolveStrategy(key) {
  if (key === 'default') key = 'moderate_balanced';
  const s = ai.STRATEGIES[key];
  if (!s) { console.error(`Unknown strategy: ${key}`); process.exit(1); }
  return s;
}

// --- BUY ORDER ---

// Returns player indices in buy order (non-busted only).
// hasBuyBurnFirst players go first (sorted by player index = slot index in SP).
// Remaining non-busted players ordered by determineBuyWinner tiebreaker.
function computeBuyOrder(players) {
  const nonBustedIdxs = players.map((_, i) => i).filter(i => !players[i].busted);

  // In SP mode, playerOrder[i] = i (identity)
  const playerOrder = players.map((_, i) => i);

  const priorityIdxs = nonBustedIdxs
    .filter(i => players[i].hasBuyBurnFirst)
    .sort((a, b) => a - b);

  const normalIdxs = nonBustedIdxs.filter(i => !players[i].hasBuyBurnFirst);

  let normalSorted;
  if (normalIdxs.length <= 1) {
    normalSorted = normalIdxs;
  } else {
    const subPlayers = normalIdxs.map(i => players[i]);
    const subOrder = normalIdxs.map(i => playerOrder[i]);
    const { winnerIdx } = determineBuyWinner(subPlayers, subOrder);
    const winnerGlobalIdx = normalIdxs[winnerIdx];
    const rest = normalIdxs
      .filter(i => i !== winnerGlobalIdx)
      .sort((a, b) => a - b);
    normalSorted = [winnerGlobalIdx, ...rest];
  }

  return [...priorityIdxs, ...normalSorted];
}

// --- SINGLE GAME SIMULATION ---

function simulateGame(strategies, numPlayers, verbose) {
  core.resetUidCounter();

  const players = [];
  for (let i = 0; i < numPlayers; i++) {
    players.push(core.createPlayer(`P${i + 1}`, strategies[i].name));
  }

  const result = {
    herds: new Array(numPlayers).fill(0),
    busts: new Array(numPlayers).fill(0),
    roundsPlayed: new Array(numPlayers).fill(0),
    purchases: Array.from({ length: numPlayers }, () => []),
    actCows: Array.from({ length: numPlayers }, () => [0, 0, 0]),
    strategies: strategies.map(s => s.name),
    pyramidCards: [],
    totalRounds: 0,
    numPlayers,
  };

  for (let act = 1; act <= 3; act++) {
    // Between acts: merge and reshuffle all cards
    for (const player of players) {
      const allCards = [...player.deck, ...player.discard, ...player.hand];
      player.deck = core.shuffle(allCards);
      player.discard = [];
      player.hand = [];
    }

    const pyramid = core.buildPyramid(act, numPlayers);

    for (const row of pyramid) {
      for (const slot of row) {
        result.pyramidCards.push(slot.card.id);
      }
    }

    let roundNum = 0;
    const actStartHerd = players.map(p => p.herd);

    while (!core.isPyramidEmpty(pyramid)) {
      roundNum++;
      result.totalRounds++;

      // --- DRAW PHASE ---
      for (let i = 0; i < numPlayers; i++) {
        const drawResult = ai.executeDrawPhase(players[i], strategies[i], pyramid, act);
        if (drawResult.busted) result.busts[i]++;
        result.roundsPlayed[i]++;
      }

      // --- dollar1_other: all opponents of holder lose $1 ---
      for (let i = 0; i < numPlayers; i++) {
        const hasIt = players[i].hand.some(c => c.special === 'dollar1_other');
        if (hasIt && !players[i].busted) {
          for (let j = 0; j < numPlayers; j++) {
            if (j !== i) {
              players[j].roundDollars = Math.max(0, players[j].roundDollars - 1);
            }
          }
        }
      }

      // --- BUY PHASE ---
      const buyOrder = computeBuyOrder(players);

      for (const playerIdx of buyOrder) {
        if (core.isPyramidEmpty(pyramid)) break;
        const player = players[playerIdx];

        const decision = ai.chooseBuy(player, strategies[playerIdx], pyramid, act);
        if (decision.action === 'buy') {
          const slot = pyramid[decision.row][decision.col];
          const card = slot.card;
          player.discard.push(card);
          slot.removed = true;
          core.revealUncovered(pyramid);
          result.purchases[playerIdx].push(card.id);
        } else if (decision.action === 'burn') {
          pyramid[decision.row][decision.col].removed = true;
          core.revealUncovered(pyramid);
        }

        // Extra buy turn (from extra_buy card activation)
        if (player.hasExtraBuy && !player.extraBuyUsed && !core.isPyramidEmpty(pyramid)) {
          player.extraBuyUsed = true;
          const extraDecision = ai.chooseBuy(player, strategies[playerIdx], pyramid, act);
          if (extraDecision.action === 'buy') {
            const slot = pyramid[extraDecision.row][extraDecision.col];
            player.discard.push(slot.card);
            slot.removed = true;
            core.revealUncovered(pyramid);
            result.purchases[playerIdx].push(slot.card.id);
          } else if (extraDecision.action === 'burn') {
            pyramid[extraDecision.row][extraDecision.col].removed = true;
            core.revealUncovered(pyramid);
          }
        }
      }

      // --- SCORE: add roundCows to herd ---
      for (const player of players) {
        if (!player.busted && player.roundCows !== 0) {
          player.herd = Math.max(0, player.herd + player.roundCows);
        }
        player.discard.push(...player.hand);
        player.hand = [];
      }

      if (verbose) {
        const herds = players.map((p, i) => `P${i + 1}=${p.herd}`).join(' ');
        console.log(`  Act ${act} R${roundNum}: ${herds}`);
      }
    }

    for (let i = 0; i < numPlayers; i++) {
      result.actCows[i][act - 1] = players[i].herd - actStartHerd[i];
    }
  }

  // --- SHOWDOWN: score all cards remaining in each player's collection ---
  // Mirrors play.js startShowdown(): totalCows + floor(totalDollars / 2) added to herd.
  for (let i = 0; i < numPlayers; i++) {
    const player = players[i];
    const allCards = [...player.deck, ...player.discard, ...player.hand];
    const totalCows    = allCards.reduce((s, c) => s + (c.cows    || 0), 0);
    const totalDollars = allCards.reduce((s, c) => s + (c.dollars || 0), 0);
    const bonusCows    = Math.floor(totalDollars / 2);
    player.herd = Math.max(0, player.herd + totalCows + bonusCows);
  }

  for (let i = 0; i < numPlayers; i++) {
    result.herds[i] = players[i].herd;
  }
  return result;
}

// --- MAIN ---

function runMatchup(stratKeys, numPlayers, numGames, verbose) {
  const strategies = stratKeys.map(resolveStrategy);
  const stats = new StatsCollector(strategies.map(s => s.name));

  const startTime = Date.now();
  for (let i = 0; i < numGames; i++) {
    if (!verbose && i > 0 && i % 200 === 0) {
      process.stdout.write(`\r  Running... ${i}/${numGames}`);
    }
    const result = simulateGame(strategies, numPlayers, verbose);
    stats.recordGame(result);
  }
  const elapsed = Date.now() - startTime;

  if (!verbose) process.stdout.write(`\r`);
  console.log(`  Completed ${numGames} games in ${(elapsed / 1000).toFixed(2)}s (${(numGames / elapsed * 1000).toFixed(0)} games/sec)`);

  return stats;
}

function main() {
  const opts = parseArgs();

  if (opts.list) {
    console.log(`\nAvailable strategies (${Object.keys(ai.STRATEGIES).length} total):\n`);
    console.log('Risk profiles:', Object.keys(ai.RISK_PROFILES).join(', '));
    console.log('Buy preferences:', Object.keys(ai.BUY_PREFERENCES).join(', '));
    console.log('\nAll combos (risk_buyPref):');
    const keys = Object.keys(ai.STRATEGIES);
    for (let i = 0; i < keys.length; i += 5) {
      console.log('  ' + keys.slice(i, i + 5).join(', '));
    }
    console.log('');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (opts.tournament) {
    console.log(`\nTournament mode (2P): ${opts.games} games per matchup\n`);
    const keys = Object.keys(ai.STRATEGIES);
    const allResults = [];

    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        const s1 = ai.STRATEGIES[keys[i]];
        const s2 = ai.STRATEGIES[keys[j]];
        console.log(`\n${s1.name} vs ${s2.name}:`);
        const stats = runMatchup([keys[i], keys[j]], 2, opts.games, opts.verbose);
        const summary = stats.getSummary();
        allResults.push(summary);
        stats.printSummary();
      }
    }

    // Tournament leaderboard (2P)
    const wins = {};
    for (const key of keys) wins[key] = 0;

    for (const r of allResults) {
      for (const key of keys) {
        const name = ai.STRATEGIES[key].name;
        const p0wr = r.playerWinRates[0];
        const p1wr = r.playerWinRates[1];
        if (r.strategyNames[0] === name && p0wr > p1wr) wins[key]++;
        if (r.strategyNames[1] === name && p1wr > p0wr) wins[key]++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('TOURNAMENT LEADERBOARD');
    console.log('='.repeat(60));
    const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1]);
    for (const [key, w] of sorted) {
      console.log(`  ${ai.STRATEGIES[key].name.padEnd(20)} ${w} matchup wins`);
    }
    console.log('');

  } else if (opts.random) {
    const numPlayers = opts.players;
    console.log(`\nRandom mode: ${opts.games} games (${numPlayers}P, random strategies each game)\n`);
    const keys = Object.keys(ai.STRATEGIES);
    const stats = new StatsCollector(Array(numPlayers).fill('Random'));

    const startTime = Date.now();
    for (let i = 0; i < opts.games; i++) {
      if (!opts.verbose && i > 0 && i % 200 === 0) {
        process.stdout.write(`\r  Running... ${i}/${opts.games}`);
      }
      const stratKeys = Array.from({ length: numPlayers }, () => keys[Math.floor(Math.random() * keys.length)]);
      const strategies = stratKeys.map(k => ai.STRATEGIES[k]);
      const result = simulateGame(strategies, numPlayers, opts.verbose);
      stats.recordGame(result);
    }
    const elapsed = Date.now() - startTime;
    if (!opts.verbose) process.stdout.write(`\r`);
    console.log(`  Completed ${opts.games} games in ${(elapsed / 1000).toFixed(2)}s (${(opts.games / elapsed * 1000).toFixed(0)} games/sec)`);

    stats.printSummary();
    stats.writeCSV(`random_${numPlayers}p_${timestamp}.csv`);
    stats.writeSummary(`random_${numPlayers}p_${timestamp}.txt`);

  } else {
    const numPlayers = opts.players;
    const stratKeys = [opts.p1, opts.p2, opts.p3, opts.p4].slice(0, numPlayers);
    const stratNames = stratKeys.map(k => k === 'default' ? 'moderate_balanced' : k).join('_vs_');
    console.log(`\nSimulating ${opts.games} games (${numPlayers}P): ${stratNames}\n`);
    const stats = runMatchup(stratKeys, numPlayers, opts.games, opts.verbose);
    stats.printSummary();
    stats.writeCSV(`${stratNames}_${numPlayers}p_${timestamp}.csv`);
    stats.writeSummary(`${stratNames}_${numPlayers}p_${timestamp}.txt`);
  }
}

main();
