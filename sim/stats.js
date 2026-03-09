// ============================================================
// Stats - Data collection, aggregation, CSV + summary output
// ============================================================

const fs = require('fs');
const path = require('path');

class StatsCollector {
  constructor(p1Strategy, p2Strategy) {
    this.p1Strategy = p1Strategy;
    this.p2Strategy = p2Strategy;
    this.games = [];
  }

  recordGame(result) {
    this.games.push(result);
  }

  // --- AGGREGATION ---

  getSummary() {
    const n = this.games.length;
    let p1Wins = 0, p2Wins = 0, ties = 0;
    let totalP1Herd = 0, totalP2Herd = 0;
    let totalP1Busts = 0, totalP2Busts = 0;
    let totalP1Rounds = 0, totalP2Rounds = 0;
    let totalRounds = 0;
    let margins = [];

    // Card tracking
    const cardPurchases = {};  // cardId -> { total, inWins, inLosses, totalHerdDelta }
    const cardAvailable = {};  // cardId -> times it was in pyramid

    // Strategy tracking
    const strategyStats = {};  // stratName -> { played, wins, totalHerd, busts, rounds }

    for (const g of this.games) {
      totalP1Herd += g.p1Herd;
      totalP2Herd += g.p2Herd;
      totalP1Busts += g.p1Busts;
      totalP2Busts += g.p2Busts;
      totalP1Rounds += g.p1RoundsPlayed;
      totalP2Rounds += g.p2RoundsPlayed;
      totalRounds += g.totalRounds;

      if (g.p1Herd > g.p2Herd) {
        p1Wins++;
        margins.push(g.p1Herd - g.p2Herd);
      } else if (g.p2Herd > g.p1Herd) {
        p2Wins++;
        margins.push(g.p2Herd - g.p1Herd);
      } else {
        ties++;
      }

      // Track cards available in pyramid
      for (const cardId of g.pyramidCards) {
        cardAvailable[cardId] = (cardAvailable[cardId] || 0) + 1;
      }

      // Track cards purchased
      const herdDelta = g.p1Herd - g.p2Herd;
      for (const cardId of g.p1Purchases) {
        if (!cardPurchases[cardId]) cardPurchases[cardId] = { total: 0, inWins: 0, inLosses: 0, totalHerdDelta: 0, totalCost: 0 };
        cardPurchases[cardId].total++;
        cardPurchases[cardId].totalHerdDelta += herdDelta;
        if (g.p1Herd > g.p2Herd) cardPurchases[cardId].inWins++;
        else if (g.p1Herd < g.p2Herd) cardPurchases[cardId].inLosses++;
      }
      for (const cardId of g.p2Purchases) {
        if (!cardPurchases[cardId]) cardPurchases[cardId] = { total: 0, inWins: 0, inLosses: 0, totalHerdDelta: 0, totalCost: 0 };
        cardPurchases[cardId].total++;
        cardPurchases[cardId].totalHerdDelta -= herdDelta; // flip perspective
        if (g.p2Herd > g.p1Herd) cardPurchases[cardId].inWins++;
        else if (g.p2Herd < g.p1Herd) cardPurchases[cardId].inLosses++;
      }

      // Track strategy performance
      if (g.p1Strategy) {
        const s = g.p1Strategy;
        if (!strategyStats[s]) strategyStats[s] = { played: 0, wins: 0, losses: 0, ties: 0, totalHerd: 0, busts: 0, rounds: 0 };
        strategyStats[s].played++;
        strategyStats[s].totalHerd += g.p1Herd;
        strategyStats[s].busts += g.p1Busts;
        strategyStats[s].rounds += g.p1RoundsPlayed;
        if (g.p1Herd > g.p2Herd) strategyStats[s].wins++;
        else if (g.p1Herd < g.p2Herd) strategyStats[s].losses++;
        else strategyStats[s].ties++;
      }
      if (g.p2Strategy) {
        const s = g.p2Strategy;
        if (!strategyStats[s]) strategyStats[s] = { played: 0, wins: 0, losses: 0, ties: 0, totalHerd: 0, busts: 0, rounds: 0 };
        strategyStats[s].played++;
        strategyStats[s].totalHerd += g.p2Herd;
        strategyStats[s].busts += g.p2Busts;
        strategyStats[s].rounds += g.p2RoundsPlayed;
        if (g.p2Herd > g.p1Herd) strategyStats[s].wins++;
        else if (g.p2Herd < g.p1Herd) strategyStats[s].losses++;
        else strategyStats[s].ties++;
      }
    }

    const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;

    // Card power rankings
    const cardRankings = [];
    for (const [cardId, stats] of Object.entries(cardPurchases)) {
      if (stats.total < 3) continue; // not enough data
      const winRate = stats.total > 0 ? stats.inWins / stats.total : 0;
      const avgDelta = stats.total > 0 ? stats.totalHerdDelta / stats.total : 0;
      const purchaseRate = cardAvailable[cardId] ? stats.total / cardAvailable[cardId] : 0;
      cardRankings.push({
        cardId,
        purchased: stats.total,
        available: cardAvailable[cardId] || 0,
        purchaseRate,
        winRate,
        avgHerdDelta: avgDelta,
      });
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
      p1Strategy: this.p1Strategy,
      p2Strategy: this.p2Strategy,
      p1Wins, p2Wins, ties,
      p1WinRate: n > 0 ? p1Wins / n : 0,
      p2WinRate: n > 0 ? p2Wins / n : 0,
      avgP1Herd: n > 0 ? totalP1Herd / n : 0,
      avgP2Herd: n > 0 ? totalP2Herd / n : 0,
      avgMargin,
      avgRoundsPerGame: n > 0 ? totalRounds / n : 0,
      p1BustRate: totalP1Rounds > 0 ? totalP1Busts / totalP1Rounds : 0,
      p2BustRate: totalP2Rounds > 0 ? totalP2Busts / totalP2Rounds : 0,
      cardRankings,
      strategyRankings,
    };
  }

  // --- OUTPUT ---

  _buildSummaryText() {
    const s = this.getSummary();
    const lines = [];
    lines.push('');
    lines.push('='.repeat(60));
    lines.push(`SIMULATION RESULTS (${s.totalGames} games)`);
    lines.push(`P1: ${s.p1Strategy}  vs  P2: ${s.p2Strategy}`);
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`P1 wins: ${s.p1Wins} (${(s.p1WinRate * 100).toFixed(1)}%)`);
    lines.push(`P2 wins: ${s.p2Wins} (${(s.p2WinRate * 100).toFixed(1)}%)`);
    lines.push(`Ties:    ${s.ties} (${(s.ties / s.totalGames * 100).toFixed(1)}%)`);
    lines.push('');
    lines.push(`Avg P1 herd: ${s.avgP1Herd.toFixed(1)} cows`);
    lines.push(`Avg P2 herd: ${s.avgP2Herd.toFixed(1)} cows`);
    lines.push(`Avg margin of victory: ${s.avgMargin.toFixed(1)} cows`);
    lines.push(`Avg rounds per game: ${s.avgRoundsPerGame.toFixed(1)}`);
    lines.push('');
    lines.push(`P1 bust rate: ${(s.p1BustRate * 100).toFixed(1)}% of rounds`);
    lines.push(`P2 bust rate: ${(s.p2BustRate * 100).toFixed(1)}% of rounds`);

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

      // Risk profile aggregate
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
        lines.push(stratPadRow(
          name,
          String(agg.played),
          (agg.wins / agg.played * 100).toFixed(1) + '%',
          (agg.totalHerd / agg.played).toFixed(1),
          ''
        ));
      }

      lines.push('');
      lines.push('-'.repeat(80));
      lines.push('BY BUY PREFERENCE:');
      lines.push(stratPadRow('Preference', 'Played', 'WinRate', 'AvgHerd', ''));
      lines.push('-'.repeat(80));
      const buySorted = Object.entries(buyAgg).sort((a, b) => (b[1].wins / b[1].played) - (a[1].wins / a[1].played));
      for (const [name, agg] of buySorted) {
        lines.push(stratPadRow(
          name,
          String(agg.played),
          (agg.wins / agg.played * 100).toFixed(1) + '%',
          (agg.totalHerd / agg.played).toFixed(1),
          ''
        ));
      }
    }

    // Card rankings
    lines.push('');
    lines.push('='.repeat(80));
    lines.push('CARD POWER RANKINGS (by win rate when purchased)');
    lines.push('='.repeat(80));
    lines.push(padRow('Card', 'Bought', 'Buy%', 'WinRate', 'AvgDelta'));
    lines.push('-'.repeat(80));

    for (const c of s.cardRankings) {
      lines.push(padRow(
        c.cardId.substring(0, 30),
        String(c.purchased),
        (c.purchaseRate * 100).toFixed(0) + '%',
        (c.winRate * 100).toFixed(1) + '%',
        (c.avgHerdDelta >= 0 ? '+' : '') + c.avgHerdDelta.toFixed(1)
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

    const headers = [
      'game', 'winner', 'p1_herd', 'p2_herd', 'margin',
      'p1_busts', 'p2_busts', 'total_rounds',
      'p1_act1_cows', 'p1_act2_cows', 'p1_act3_cows',
      'p2_act1_cows', 'p2_act2_cows', 'p2_act3_cows',
      'p1_strategy', 'p2_strategy',
      'p1_purchases', 'p2_purchases',
    ];

    const rows = [headers.join(',')];
    for (let i = 0; i < this.games.length; i++) {
      const g = this.games[i];
      const winner = g.p1Herd > g.p2Herd ? 'P1' : g.p2Herd > g.p1Herd ? 'P2' : 'TIE';
      rows.push([
        i + 1,
        winner,
        g.p1Herd,
        g.p2Herd,
        Math.abs(g.p1Herd - g.p2Herd),
        g.p1Busts,
        g.p2Busts,
        g.totalRounds,
        g.p1ActCows[0] || 0,
        g.p1ActCows[1] || 0,
        g.p1ActCows[2] || 0,
        g.p2ActCows[0] || 0,
        g.p2ActCows[1] || 0,
        g.p2ActCows[2] || 0,
        g.p1Strategy || '',
        g.p2Strategy || '',
        '"' + g.p1Purchases.join(';') + '"',
        '"' + g.p2Purchases.join(';') + '"',
      ].join(','));
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
