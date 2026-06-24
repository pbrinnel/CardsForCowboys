#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — Personality Simulation & Card-Balance Runner
// ============================================================
//
// Runs the REAL shipped personalities (sim/personalities.js) head-to-head through the
// shared deterministic engine (sim/personality-engine.js — the same decision logic as the
// live game's aiShouldDraw/scoreCardForAI/aiBuyTurn). Two jobs:
//
//   1. Win matrix — pairwise win-rates between personalities (are the difficulty tiers real?).
//   2. Card balance — per store-card buy-rate + win-rate-when-owned (which cards are over/under
//      powered?). evolve.js can't answer this; it only tunes AI params.
//
// Unlike evolve.js (which SEARCHES for better params), simulate.js VALIDATES the current bots
// and the card set. Deterministic: same seed → same game, so runs are reproducible.
// 2–4 players only (the engine doesn't model 5–8P flat-row pyramids).
//
// Usage:
//   node sim/simulate.js                         # default: 2P win matrix + card table, 3000 games/pair
//   node sim/simulate.js --games 5000            # more games per pairing
//   node sim/simulate.js --players 4             # 4P round-robin (focal vs 3 rotating)
//   node sim/simulate.js --matchup rancher,outlaw   # one matchup, detailed
//   node sim/simulate.js --cards-only            # skip the matrix, just the card table
//   node sim/simulate.js --csv                   # also write the card table to results/
//   node sim/simulate.js --list                  # list personality names
// ============================================================

const engine = require('./personality-engine');
const { GENOMES, byName } = require('./personalities');
const core = require('./game-core');
const fs = require('fs');
const path = require('path');

const NAMES = GENOMES.map(g => g.name);
const STORE_BY_ID = Object.fromEntries(core.STORE_CARDS.map(c => [c.id, c]));

// --- CLI ---
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { games: 3000, players: 2, matchup: null, cardsOnly: false, csv: false, list: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--games')   o.games = parseInt(a[++i], 10);
    else if (a[i] === '--players') o.players = parseInt(a[++i], 10);
    else if (a[i] === '--matchup') o.matchup = a[++i].split(',').map(s => s.trim());
    else if (a[i] === '--cards-only') o.cardsOnly = true;
    else if (a[i] === '--csv')  o.csv = true;
    else if (a[i] === '--list') o.list = true;
  }
  return o;
}

// Accumulate per store-card ownership/win stats from one game's collections.
function tallyCards(stat, collections, winnerIdx) {
  collections.forEach((ids, pIdx) => {
    const owned = new Set(ids.filter(id => id.startsWith('card_')));
    for (const id of ids) if (id.startsWith('card_')) {
      stat.copies[id] = (stat.copies[id] || 0) + 1;            // total copies bought
    }
    for (const id of owned) {
      stat.owners[id] = (stat.owners[id] || 0) + 1;            // (player,game) slots owning >=1
      if (pIdx === winnerIdx) stat.wins[id] = (stat.wins[id] || 0) + 1;
    }
  });
}

// Run `games` seeds of one lineup; return win counts + bust/herd + card stats.
function runSeries(lineup, players, games, cardStat) {
  const genomes = lineup.map(n => byName[n]);
  const wins = new Array(lineup.length).fill(0);
  const busts = new Array(lineup.length).fill(0);
  const drawRounds = new Array(lineup.length).fill(0);
  const herdSum = new Array(lineup.length).fill(0);
  for (let s = 0; s < games; s++) {
    const r = engine.runGame(genomes, players, s + 1, { detail: !!cardStat });
    wins[r.winner]++;
    for (let i = 0; i < lineup.length; i++) {
      busts[i] += r.busts[i]; drawRounds[i] += r.drawRounds[i]; herdSum[i] += r.herds[i];
    }
    if (cardStat) tallyCards(cardStat, r.collections, r.winner);
  }
  return { wins, busts, drawRounds, herdSum, games };
}

function pct(x) { return (x * 100).toFixed(1); }

// --- 2P pairwise win matrix (each pair played in both seat orders) ---
function winMatrix(games, cardStat) {
  console.log(`\n=== 2P win matrix — ${games} games/pair, both seat orders (row beats column %) ===`);
  const overall = Object.fromEntries(NAMES.map(n => [n, { w: 0, g: 0 }]));
  const cell = {};
  for (let i = 0; i < NAMES.length; i++) {
    for (let j = i + 1; j < NAMES.length; j++) {
      const A = NAMES[i], B = NAMES[j];
      let aWins = 0, tot = 0;
      const r1 = runSeries([A, B], 2, games, cardStat); aWins += r1.wins[0]; tot += games;
      const r2 = runSeries([B, A], 2, games, cardStat); aWins += r2.wins[1]; tot += games;
      cell[`${A}|${B}`] = aWins / tot;
      cell[`${B}|${A}`] = 1 - aWins / tot;
      overall[A].w += aWins;          overall[A].g += tot;
      overall[B].w += tot - aWins;    overall[B].g += tot;
    }
  }
  console.log('vs'.padEnd(11) + NAMES.map(n => n.slice(0, 6).padStart(7)).join(''));
  for (const A of NAMES) {
    const row = NAMES.map(B => A === B ? '     —' : pct(cell[`${A}|${B}`]).padStart(7)).join('');
    console.log(A.padEnd(11) + row);
  }
  console.log('\nOverall win% (vs the whole field):');
  NAMES.map(n => ({ n, wr: overall[n].w / overall[n].g }))
    .sort((a, b) => b.wr - a.wr)
    .forEach(x => console.log(`  ${x.n.padEnd(11)} ${pct(x.wr).padStart(5)}%`));
}

// --- 4P round-robin: each personality as focal + 3 rotating opponents ---
function field4P(games, cardStat) {
  console.log(`\n=== 4P win% — ${games} games each, focal + 3 rotating opponents (baseline 25%) ===`);
  const rows = [];
  for (const focal of NAMES) {
    let wins = 0, busts = 0, draws = 0;
    for (let s = 0; s < games; s++) {
      const opps = [0, 1, 2].map(k => NAMES[(s * 3 + k + 1) % NAMES.length]);
      const seat = s % 4;
      const lineup = opps.slice(); lineup.splice(seat, 0, focal);
      const r = engine.runGame(lineup.map(n => byName[n]), 4, s + 1, { detail: !!cardStat });
      if (r.winner === seat) wins++;
      busts += r.busts[seat]; draws += r.drawRounds[seat];
      if (cardStat) tallyCards(cardStat, r.collections, r.winner);
    }
    rows.push({ focal, wr: wins / games, bust: busts / draws });
  }
  rows.sort((a, b) => b.wr - a.wr)
    .forEach(x => console.log(`  ${x.focal.padEnd(11)} win ${pct(x.wr).padStart(5)}%   bust ${pct(x.bust).padStart(5)}%`));
}

// --- single detailed matchup ---
function matchup(lineup, players, games, cardStat) {
  for (const n of lineup) if (!byName[n]) { console.error(`unknown personality: ${n}`); process.exit(1); }
  console.log(`\n=== ${lineup.join(' vs ')} — ${players}P, ${games} games ===`);
  const r = runSeries(lineup, players, games, cardStat);
  lineup.forEach((n, i) => console.log(
    `  ${n.padEnd(11)} win ${pct(r.wins[i] / games).padStart(5)}%   ` +
    `bust ${pct(r.busts[i] / r.drawRounds[i]).padStart(5)}%   avgHerd ${(r.herdSum[i] / games).toFixed(1)}`));
}

// --- card-balance table ---
function cardTable(stat, csv) {
  const rows = Object.keys(stat.owners).map(id => {
    const c = STORE_BY_ID[id] || {};
    return {
      id, act: c.act ?? '?', cost: c.cost ?? '?',
      cows: c.cows ?? 0, dollars: c.dollars ?? 0, bandits: c.bandits ?? 0,
      special: c.special || '',
      copies: stat.copies[id] || 0,
      owners: stat.owners[id],
      winRate: (stat.wins[id] || 0) / stat.owners[id],
    };
  }).sort((a, b) => b.winRate - a.winRate);

  console.log(`\n=== Card balance — win% when owned (sorted; ${rows.length} store cards seen) ===`);
  console.log('card'.padEnd(9) + 'act'.padStart(4) + 'cost'.padStart(5) +
    'cow'.padStart(4) + '$'.padStart(3) + 'bndt'.padStart(5) + 'copies'.padStart(8) + ' win%   special');
  for (const r of rows) {
    console.log(
      r.id.padEnd(9) + String(r.act).padStart(4) + String(r.cost).padStart(5) +
      String(r.cows).padStart(4) + String(r.dollars).padStart(3) + String(r.bandits).padStart(5) +
      String(r.copies).padStart(8) + pct(r.winRate).padStart(6) + '   ' + r.special);
  }
  console.log('\nReads: win% = of all (player,game) slots that owned ≥1 copy, the share that won.');
  console.log('High win% + high copies = strong & popular. High win% + low copies = sleeper.');
  console.log('~baseline = 1/numPlayers; far below it on a popular card is a balance flag.');

  if (csv) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(__dirname, 'results', `cardbalance_${ts}.csv`);
    const lines = ['id,act,cost,cows,dollars,bandits,special,copies,owners,winRate'];
    for (const r of rows) lines.push(
      [r.id, r.act, r.cost, r.cows, r.dollars, r.bandits, r.special, r.copies, r.owners, r.winRate.toFixed(4)].join(','));
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`\nCSV: ${file}`);
  }
}

// --- main ---
function main() {
  const o = parseArgs();
  if (o.list) { console.log('Personalities:', NAMES.join(', ')); return; }
  if (o.players < 2 || o.players > 4) { console.error('players must be 2–4'); process.exit(1); }

  const cardStat = { copies: {}, owners: {}, wins: {} };
  console.log('Cards For Cowboys — personality simulation (engine: personality-engine.js, real shipped bots)');

  if (o.matchup) {
    matchup(o.matchup, o.players, o.games, cardStat);
  } else if (!o.cardsOnly) {
    if (o.players === 2) winMatrix(o.games, cardStat);
    else field4P(o.games, cardStat);
  } else {
    // cards-only: still need games to populate stats — run a quiet round-robin
    for (let i = 0; i < NAMES.length; i++)
      for (let j = i + 1; j < NAMES.length; j++)
        runSeries([NAMES[i], NAMES[j]], o.players, o.games, cardStat);
  }

  cardTable(cardStat, o.csv);
}

main();
