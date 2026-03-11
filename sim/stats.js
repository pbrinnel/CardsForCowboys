// ============================================================
// Stats - Data collection, aggregation, CSV + summary output
// N-player generalised
// ============================================================

const fs = require('fs');
const path = require('path');

class StatsCollector {
  // strategies: array of strategy name strings (one per player slot)
  constructor(strategies) {
    this.strategyNames = Array.isArray(strategies) ? strategies : [strategies];
    this.games = [];
  }

  recordGame(result) {
    this.games.push(result);
  }

  // --- AGGREGATION ---

  getSummary() {
    const n = this.games.length;
    if (n === 0) return null;

    const numPlayers = this.games[0].numPlayers || this.strategyNames.length || 2;

    // Per-player accumulators
    const playerWins = new Array(numPlayers).fill(0);
    let ties = 0;
    const totalHerd = new Array(numPlayers).fill(0);
    const totalBusts = new Array(numPlayers).fill(0);
    const totalRoundsPlayed = new Array(numPlayers).fill(0);
    let totalRounds = 0;
    const margins = [];

    // Card tracking: cardId -> { total, inWins, totalHerdDelta }
    const cardPurchases = {};
    const cardAvailable = {};

    // Strategy tracking: stratName -> { played, wins, losses, ties, totalHerd, busts, rounds }
    const strategyStats = {};

    for (const g of this.games) {
      const np = g.numPlayers || numPlayers;
      totalRounds += g.totalRounds;

      for (let i = 0; i < np; i++) {
        totalHerd[i] += g.herds[i];
        totalBusts[i] += g.busts[i];
        totalRoundsPlayed[i] += g.roundsPlayed[i];
      }

      // Find winner(s)
      const maxHerd = Math.max(...g.herds);
      const winners = g.herds.map((h, i) => h === maxHerd ? i : -1).filter(i => i >= 0);

      if (winners.length === 1) {
        playerWins[winners[0]]++;
        // Record margin vs runner-up
        const sorted = [...g.herds].sort((a, b) => b - a);
        margins.push(sorted[0] - sorted[1]);
      } else {
        ties++;
      }

      // Track pyramid cards available
      for (const cardId of g.pyramidCards) {
        cardAvailable[cardId] = (cardAvailable[cardId] || 0) + 1;
      }

      // Track card purchases per player
      for (let i = 0; i < np; i++) {
        const won = winners.length === 1 && winners[0] === i;
        for (const cardId of (g.purchases[i] || [])) {
          if (!cardPurchases[cardId]) cardPurchases[cardId] = { total: 0, inWins: 0, totalHerdRank: 0 };
          cardPurchases[cardId].total++;
          if (won) cardPurchases[cardId].inWins++;
          // herd rank: 0 = best, numPlayers-1 = worst
          const sortedHerds = [...g.herds].sort((a, b) => b - a);
          cardPurchases[cardId].totalHerdRank += sortedHerds.indexOf(g.herds[i]);
        }
      }

      // Track strategy performance
      for (let i = 0; i < np; i++) {
        const s = g.strategies && g.strategies[i];
        if (!s) continue;
        if (!strategyStats[s]) strategyStats[s] = { played: 0, wins: 0, losses: 0, ties: 0, totalHerd: 0, busts: 0, rounds: 0 };
        strategyStats[s].played++;
        strategyStats[s].totalHerd += g.herds[i];
        strategyStats[s].busts += g.busts[i];
        strategyStats[s].rounds += g.roundsPlayed[i];
        if (winners.length === 1 && winners[0] === i) strategyStats[s].wins++;
        else if (winners.length > 1 && winners.includes(i)) strategyStats[s].ties++;
        else strategyStats[s].losses++;
      }
    }

    const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;

    // Card power rankings
    const cardRankings = [];
    for (const [cardId, stats] of Object.entries(cardPurchases)) {
      if (stats.total < 3) continue;
      const winRate = stats.total > 0 ? stats.inWins / stats.total : 0;
      const avgRank = stats.total > 0 ? stats.totalHerdRank / stats.total : 0;
      const purchaseRate = cardAvailable[cardId] ? stats.total / cardAvailable[cardId] : 0;
      cardRankings.push({ cardId, purchased: stats.total, available: cardAvailable[cardId] || 0, purchaseRate, winRate, avgRank });
    }
    cardRankings.sort((a, b) => b.winRate - a.winRate);

    // Strategy rankings
    const strategyRankings = [];
    for (const [name, stats] of Object.entries(strategyStats)) {
      if (stats.played < 5) continue;
      strategyRankings.push({
        name,
        played: stats.played,
        wins: stats.wins,
        losses: stats.losses,
        ties: stats.ties,
        winRate: stats.played > 0 ? stats.wins / stats.played : 0,
        avgHerd: stats.played > 0 ? stats.totalHerd / stats.played : 0,
        bustRate: stats.rounds > 0 ? stats.busts / stats.rounds : 0,
      });
    }
    strategyRankings.sort((a, b) => b.winRate - a.winRate);

    return {
      totalGames: n,
      numPlayers,
      strategyNames: this.strategyNames,
      playerWins,
      playerWinRates: playerWins.map(w => n > 0 ? w / n : 0),
      ties,
      tieRate: n > 0 ? ties / n : 0,
      avgHerds: totalHerd.map(h => n > 0 ? h / n : 0),
      avgMargin,
      avgRoundsPerGame: n > 0 ? totalRounds / n : 0,
      bustRates: totalRoundsPlayed.map((r, i) => r > 0 ? totalBusts[i] / r : 0),
      cardRankings,
      strategyRankings,
    };
  }

  // --- OUTPUT ---

  _buildSummaryText() {
    const s = this.getSummary();
    if (!s) return '(no games recorded)';
    const lines = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push(`SIMULATION RESULTS (${s.totalGames} games, ${s.numPlayers}P)`);
    lines.push(`Strategies: ${s.strategyNames.join('  vs  ')}`);
    lines.push('='.repeat(60));
    lines.push('');

    for (let i = 0; i < s.numPlayers; i++) {
      lines.push(`P${i + 1} (${s.strategyNames[i] || '?'}) wins: ${s.playerWins[i]} (${(s.playerWinRates[i] * 100).toFixed(1)}%)  avg herd: ${s.avgHerds[i].toFixed(1)}  bust rate: ${(s.bustRates[i] * 100).toFixed(1)}%`);
    }
    lines.push(`Ties: ${s.ties} (${(s.tieRate * 100).toFixed(1)}%)`);
    lines.push('');
    lines.push(`Avg margin of victory: ${s.avgMargin.toFixed(1)} cows`);
    lines.push(`Avg rounds per game: ${s.avgRoundsPerGame.toFixed(1)}`);

    // Strategy rankings
    if (s.strategyRankings.length > 0) {
      lines.push('');
      lines.push('='.repeat(80));
      lines.push('STRATEGY RANKINGS (by win rate)');
      lines.push('='.repeat(80));
      lines.push(stratPadRow('Strategy', 'Played', 'WinRate', 'AvgHerd', 'BustRate'));
      lines.push('-'.repeat(80));

      for (const r of s.strategyRankings) {
        lines.push(stratPadRow(
          r.name,
          String(r.played),
          (r.winRate * 100).toFixed(1) + '%',
          r.avgHerd.toFixed(1),
          (r.bustRate * 100).toFixed(1) + '%'
        ));
      }

      // Aggregate by risk/buy dimension
      const riskAgg = {};
      const buyAgg = {};
      for (const r of s.strategyRankings) {
        const parts = r.name.split('-');
        if (parts.length === 2) {
          const [risk, buy] = parts;
          if (!riskAgg[risk]) riskAgg[risk] = { played: 0, wins: 0, totalHerd: 0 };
          riskAgg[risk].played += r.played;
          riskAgg[risk].wins += r.wins;
          riskAgg[risk].totalHerd += r.avgHerd * r.played;

          if (!buyAgg[buy]) buyAgg[buy] = { played: 0, wins: 0, totalHerd: 0 };
          buyAgg[buy].played += r.played;
          buyAgg[buy].wins += r.wins;
          buyAgg[buy].totalHerd += r.avgHerd * r.played;
        }
      }

      lines.push('');
      lines.push('-'.repeat(80));
      lines.push('BY RISK PROFILE:');
      lines.push(stratPadRow('Risk', 'Played', 'WinRate', 'AvgHerd', ''));
      lines.push('-'.repeat(80));
      const riskSorted = Object.entries(riskAgg).sort((a, b) => (b[1].wins / b[1].played) - (a[1].wins / a[1].played));
      for (const [name, agg] of riskSorted) {
        lines.push(stratPadRow(name, String(agg.played), (agg.wins / agg.played * 100).toFixed(1) + '%', (agg.totalHerd / agg.played).toFixed(1), ''));
      }

      lines.push('');
      lines.push('-'.repeat(80));
      lines.push('BY BUY PREFERENCE:');
      lines.push(stratPadRow('Preference', 'Played', 'WinRate', 'AvgHerd', ''));
      lines.push('-'.repeat(80));
      const buySorted = Object.entries(buyAgg).sort((a, b) => (b[1].wins / b[1].played) - (a[1].wins / a[1].played));
      for (const [name, agg] of buySorted) {
        lines.push(stratPadRow(name, String(agg.played), (agg.wins / agg.played * 100).toFixed(1) + '%', (agg.totalHerd / agg.played).toFixed(1), ''));
      }
    }

    // Card rankings
    lines.push('');
    lines.push('='.repeat(80));
    lines.push('CARD POWER RANKINGS (by win rate when purchased)');
    lines.push('='.repeat(80));
    lines.push(padRow('Card', 'Bought', 'Buy%', 'WinRate', 'AvgRank'));
    lines.push('-'.repeat(80));

    for (const c of s.cardRankings) {
      lines.push(padRow(
        c.cardId.substring(0, 30),
        String(c.purchased),
        (c.purchaseRate * 100).toFixed(0) + '%',
        (c.winRate * 100).toFixed(1) + '%',
        c.avgRank.toFixed(2)
      ));
    }

    lines.push('');
    return lines.join('\n');
  }

  printSummary() {
    const output = this._buildSummaryText();
    console.log(output);
    return output;
  }

  writeCSV(filename) {
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    const filepath = path.join(resultsDir, filename);
    const numPlayers = this.games[0] ? this.games[0].numPlayers : this.strategyNames.length;

    // Dynamic headers for N players
    const playerHeaders = [];
    for (let i = 0; i < numPlayers; i++) {
      playerHeaders.push(`p${i + 1}_herd`, `p${i + 1}_busts`);
      playerHeaders.push(`p${i + 1}_act1_cows`, `p${i + 1}_act2_cows`, `p${i + 1}_act3_cows`);
      playerHeaders.push(`p${i + 1}_strategy`, `p${i + 1}_purchases`);
    }

    const headers = ['game', 'winner', 'margin', 'total_rounds', ...playerHeaders];
    const rows = [headers.join(',')];

    for (let gi = 0; gi < this.games.length; gi++) {
      const g = this.games[gi];
      const np = g.numPlayers || numPlayers;
      const maxHerd = Math.max(...g.herds);
      const winners = g.herds.map((h, i) => h === maxHerd ? `P${i + 1}` : null).filter(Boolean);
      const winner = winners.length === 1 ? winners[0] : 'TIE';
      const sorted = [...g.herds].sort((a, b) => b - a);
      const margin = sorted[0] - (sorted[1] || 0);

      const row = [gi + 1, winner, margin, g.totalRounds];
      for (let i = 0; i < np; i++) {
        row.push(g.herds[i], g.busts[i]);
        row.push(
          (g.actCows[i] && g.actCows[i][0]) || 0,
          (g.actCows[i] && g.actCows[i][1]) || 0,
          (g.actCows[i] && g.actCows[i][2]) || 0
        );
        row.push(g.strategies ? g.strategies[i] || '' : '');
        row.push('"' + ((g.purchases[i] || []).join(';')) + '"');
      }
      rows.push(row.join(','));
    }

    fs.writeFileSync(filepath, rows.join('\n') + '\n');
    console.log(`CSV written to: ${filepath}`);
    return filepath;
  }

  writeSummary(filename) {
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

    const filepath = path.join(resultsDir, filename);
    const output = this._buildSummaryText();
    fs.writeFileSync(filepath, output + '\n');
    console.log(`Summary written to: ${filepath}`);
    return filepath;
  }
}

function padRow(col1, col2, col3, col4, col5) {
  return `  ${col1.padEnd(32)} ${col2.padStart(6)} ${col3.padStart(6)} ${col4.padStart(8)} ${col5.padStart(8)}`;
}

function stratPadRow(col1, col2, col3, col4, col5) {
  return `  ${col1.padEnd(30)} ${col2.padStart(8)} ${col3.padStart(8)} ${col4.padStart(8)} ${col5.padStart(8)}`;
}

module.exports = { StatsCollector };
