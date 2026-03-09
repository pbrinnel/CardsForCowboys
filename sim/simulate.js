#!/usr/bin/env node
// ============================================================
// Cards For Cowboys - AI vs AI Simulation Runner
// ============================================================
//
// Usage:
//   node sim/simulate.js                              # 1000 games, default vs default
//   node sim/simulate.js --games 5000                 # 5000 games
//   node sim/simulate.js --p1 aggressive --p2 conservative
//   node sim/simulate.js --tournament                 # all strategy combos
//   node sim/simulate.js --list                       # show available strategies
//
// ============================================================

const core = require('./game-core');
const ai = require('./ai-player');
const { StatsCollector } = require('./stats');

// --- CLI ARGS ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    games: 1000,
    p1: 'default',
    p2: 'default',
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
      case '--p1':
        opts.p1 = args[++i] || 'default';
        break;
      case '--p2':
        opts.p2 = args[++i] || 'default';
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
  --p1 STRATEGY       P1 strategy name (default: default)
  --p2 STRATEGY       P2 strategy name (default: default)
  --tournament, -t    Run all strategy combos against each other
  --random, -r        Random strategy pair each game
  --list, -l          List available strategies
  --verbose, -v       Print per-game results
  --help, -h          Show this help

Strategies: ${Object.keys(ai.STRATEGIES).join(', ')}
`);
}

// --- SINGLE GAME SIMULATION ---

function simulateGame(strategy1, strategy2, verbose) {
  core.resetUidCounter();

  const p1 = core.createPlayer('P1');
  const p2 = core.createPlayer('P2');
  const players = [p1, p2];
  const strategies = [strategy1, strategy2];

  const result = {
    p1Herd: 0,
    p2Herd: 0,
    p1Busts: 0,
    p2Busts: 0,
    p1RoundsPlayed: 0,
    p2RoundsPlayed: 0,
    totalRounds: 0,
    p1Purchases: [],
    p2Purchases: [],
    p1ActCows: [0, 0, 0],
    p2ActCows: [0, 0, 0],
    pyramidCards: [],
    p1Strategy: strategy1.name,
    p2Strategy: strategy2.name,
  };

  for (let act = 1; act <= 3; act++) {
    // Between acts: merge and reshuffle
    for (const player of players) {
      const allCards = [...player.deck, ...player.discard, ...player.hand];
      player.deck = core.shuffle(allCards);
      player.discard = [];
      player.hand = [];
    }

    const pyramid = core.buildPyramid(act);

    // Track which cards are in this pyramid
    for (const row of pyramid) {
      for (const slot of row) {
        result.pyramidCards.push(slot.card.id);
      }
    }

    let roundNum = 0;
    const actStartHerd = [p1.herd, p2.herd];

    while (!core.isPyramidEmpty(pyramid)) {
      roundNum++;
      result.totalRounds++;

      // --- DRAW PHASE ---
      for (let i = 0; i < 2; i++) {
        const drawResult = ai.executeDrawPhase(players[i], strategies[i], pyramid);
        if (drawResult.busted) {
          if (i === 0) result.p1Busts++;
          else result.p2Busts++;
        }
        if (i === 0) result.p1RoundsPlayed++;
        else result.p2RoundsPlayed++;
      }

      // Handle dollar1_other special (opponent loses $1)
      for (let i = 0; i < 2; i++) {
        const hasIt = players[i].hand.some(c => c.special === 'dollar1_other');
        if (hasIt && !players[i].busted) {
          const opp = players[1 - i];
          opp.roundDollars = Math.max(0, opp.roundDollars - 1);
        }
      }

      // --- BUY PHASE ---
      // Determine buy order
      let buyOrder;
      if (p1.hasBuyBurnFirst && !p1.busted) {
        buyOrder = [0, 1];
      } else if (p2.hasBuyBurnFirst && !p2.busted) {
        buyOrder = [1, 0];
      } else if (p1.busted && !p2.busted) {
        buyOrder = [1, 0];
      } else if (p2.busted && !p1.busted) {
        buyOrder = [0, 1];
      } else if (p1.busted && p2.busted) {
        buyOrder = [0, 1];
      } else {
        // Compare dollars, cows, hand size
        if (p1.roundDollars > p2.roundDollars) {
          buyOrder = [0, 1]; // P1 has more $, chooses to go first
        } else if (p2.roundDollars > p1.roundDollars) {
          buyOrder = [1, 0]; // P2 goes first
        } else if (p1.roundCows > p2.roundCows) {
          buyOrder = [0, 1];
        } else if (p2.roundCows > p1.roundCows) {
          buyOrder = [1, 0];
        } else if (p1.hand.length > p2.hand.length) {
          buyOrder = [0, 1];
        } else if (p2.hand.length > p1.hand.length) {
          buyOrder = [1, 0];
        } else {
          buyOrder = Math.random() < 0.5 ? [0, 1] : [1, 0];
        }
      }

      for (const playerIdx of buyOrder) {
        if (core.isPyramidEmpty(pyramid)) break;
        const player = players[playerIdx];
        if (player.busted) continue;

        const decision = ai.chooseBuy(player, strategies[playerIdx], pyramid, act);
        if (decision.action === 'buy') {
          const slot = pyramid[decision.row][decision.col];
          const card = slot.card;
          player.discard.push(card);
          slot.removed = true;
          core.revealUncovered(pyramid);
          if (playerIdx === 0) result.p1Purchases.push(card.id);
          else result.p2Purchases.push(card.id);
        } else if (decision.action === 'burn') {
          pyramid[decision.row][decision.col].removed = true;
          core.revealUncovered(pyramid);
        }
      }

      // --- SCORE ---
      for (const player of players) {
        if (!player.busted && player.roundCows !== 0) {
          player.herd = Math.max(0, player.herd + player.roundCows);
        }
        player.discard.push(...player.hand);
        player.hand = [];
      }

      if (verbose) {
        console.log(`  Act ${act} R${roundNum}: P1=${p1.herd} P2=${p2.herd}`);
      }
    }

    result.p1ActCows[act - 1] = p1.herd - actStartHerd[0];
    result.p2ActCows[act - 1] = p2.herd - actStartHerd[1];
  }

  result.p1Herd = p1.herd;
  result.p2Herd = p2.herd;
  return result;
}

// --- MAIN ---

function runMatchup(p1Key, p2Key, numGames, verbose) {
  const s1 = ai.STRATEGIES[p1Key];
  const s2 = ai.STRATEGIES[p2Key];

  if (!s1) { console.error(`Unknown strategy: ${p1Key}`); process.exit(1); }
  if (!s2) { console.error(`Unknown strategy: ${p2Key}`); process.exit(1); }

  const stats = new StatsCollector(s1.name, s2.name);

  const startTime = Date.now();
  for (let i = 0; i < numGames; i++) {
    if (!verbose && i > 0 && i % 200 === 0) {
      process.stdout.write(`\r  Running... ${i}/${numGames}`);
    }
    const result = simulateGame(s1, s2, verbose);
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
    console.log(`\nTournament mode: ${opts.games} games per matchup\n`);
    const keys = Object.keys(ai.STRATEGIES);
    const allResults = [];

    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        console.log(`\n${ai.STRATEGIES[keys[i]].name} vs ${ai.STRATEGIES[keys[j]].name}:`);
        const stats = runMatchup(keys[i], keys[j], opts.games, opts.verbose);
        const summary = stats.getSummary();
        allResults.push(summary);
        stats.printSummary();
      }
    }

    // Print tournament leaderboard
    const wins = {};
    for (const key of keys) wins[key] = 0;

    for (const r of allResults) {
      // Find which key maps to which strategy name
      for (const key of keys) {
        if (ai.STRATEGIES[key].name === r.p1Strategy && r.p1WinRate > r.p2WinRate) wins[key]++;
        if (ai.STRATEGIES[key].name === r.p2Strategy && r.p2WinRate > r.p1WinRate) wins[key]++;
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
    console.log(`\nRandom mode: ${opts.games} games (random strategy pair each game)\n`);
    const keys = Object.keys(ai.STRATEGIES);
    const stats = new StatsCollector('Random', 'Random');

    const startTime = Date.now();
    for (let i = 0; i < opts.games; i++) {
      if (!opts.verbose && i > 0 && i % 200 === 0) {
        process.stdout.write(`\r  Running... ${i}/${opts.games}`);
      }
      const k1 = keys[Math.floor(Math.random() * keys.length)];
      const k2 = keys[Math.floor(Math.random() * keys.length)];
      const result = simulateGame(ai.STRATEGIES[k1], ai.STRATEGIES[k2], opts.verbose);
      stats.recordGame(result);
    }
    const elapsed = Date.now() - startTime;
    if (!opts.verbose) process.stdout.write(`\r`);
    console.log(`  Completed ${opts.games} games in ${(elapsed / 1000).toFixed(2)}s (${(opts.games / elapsed * 1000).toFixed(0)} games/sec)`);

    stats.printSummary();
    stats.writeCSV(`random_${timestamp}.csv`);
    stats.writeSummary(`random_${timestamp}.txt`);

  } else {
    console.log(`\nSimulating ${opts.games} games: ${opts.p1} vs ${opts.p2}\n`);
    const stats = runMatchup(opts.p1, opts.p2, opts.games, opts.verbose);
    stats.printSummary();
    stats.writeCSV(`${opts.p1}_vs_${opts.p2}_${timestamp}.csv`);
    stats.writeSummary(`${opts.p1}_vs_${opts.p2}_${timestamp}.txt`);
  }
}

main();
