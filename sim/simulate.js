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
// and the card set. Deterministic: same seed → same game, so runs are reproducible. 2–8 players.
//
// CARD BALANCE IS MEASURED AT 4P (product decision, July 2026). 4P is also the cleanest count to
// measure: it deals ALL 18 live cards of every act in EVERY game, so availability is universal,
// non-purchase is a genuine choice, and every card gets the maximum number of observations.
// Other counts are a later check — at 2P only 10 of 18 per act appear, so buy rates there mix
// desirability with which cards happened to be dealt.
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

// Accumulate per store-card stats from one game.
//
// Two independent signals, deliberately kept separate:
//   REVEALED PREFERENCE — was the card bought or burned? Every card dealt into the Store is
//     eventually removed (that is the end condition), so buys + burns = times dealt, exactly.
//     Burn share is therefore an unconfounded "the AI did not want this at this price" measure.
//     It is the strongest signal at 4P, where all 18 act cards are dealt EVERY game, so
//     availability is universal and non-purchase is a choice rather than an accident.
//   OUTCOME VALUE — win% among (player,game) slots that owned >= 1 copy. Confounded (strong bots
//     buy cows; expensive cards are only affordable to a player already having a good round), so
//     it is read against a cost/act/round trend rather than raw — see sim/card-flags.js.
//
// Ownership is keyed on WHO BOUGHT the card, not who held it at the end.
// This matters and is not a stylistic choice: activating an Explosive (`burn_to_use`) SPLICES it
// out of hand and never pushes it to discard, so a used Explosive is absent from the final
// collection. Collection-based ownership therefore silently conditioned those six cards'
// win% on "bought it and never used it" — the opposite of how they are meant to be played.
// Buy-event ownership is immune to that, and is the cleaner question anyway: given a player
// bought this card, did they win?
//
// Ties are credited fractionally (1/winners.length), never handed to the lowest seat index.
function tallyCards(stat, collections, winners, events) {
  const share = 1 / winners.length;
  const winnerSet = new Set(winners);

  const buyersByCard = {};
  for (const ev of (events || [])) {
    const id = ev.id;
    if (ev.action === 'buy') {
      (buyersByCard[id] = buyersByCard[id] || new Set()).add(ev.seat);
      stat.buys[id] = (stat.buys[id] || 0) + 1;
      stat.rowSum[id]   = (stat.rowSum[id]   || 0) + ev.row;
      stat.roundSum[id] = (stat.roundSum[id] || 0) + ev.round;
    } else {
      stat.burns[id] = (stat.burns[id] || 0) + 1;
    }
  }
  for (const id in buyersByCard) {
    for (const seat of buyersByCard[id]) {
      stat.owners[id] = (stat.owners[id] || 0) + 1;   // (buyer, game) slots
      if (winnerSet.has(seat)) stat.wins[id] = (stat.wins[id] || 0) + share;
    }
  }

  // Copies still counted from final collections, for reference only.
  collections.forEach(ids => {
    for (const id of ids) if (id.startsWith('card_')) stat.copies[id] = (stat.copies[id] || 0) + 1;
  });
}

function newCardStat() {
  return { copies: {}, owners: {}, wins: {}, buys: {}, burns: {}, rowSum: {}, roundSum: {} };
}

// Run `games` seeds of one lineup; return win counts + bust/herd + card stats.
function runSeries(lineup, players, games, cardStat) {
  const genomes = lineup.map(n => byName[n]);
  const wins = new Array(lineup.length).fill(0);
  const busts = new Array(lineup.length).fill(0);
  const drawRounds = new Array(lineup.length).fill(0);
  const herdSum = new Array(lineup.length).fill(0);
  for (let s = 0; s < games; s++) {
    let events = null;
    if (cardStat) {
      events = [];
      engine.setBuyObserver(ev => events.push({ action: ev.action, row: ev.row, round: ev.round, id: ev.card.id, seat: ev.seat }));
    }
    const r = engine.runGame(genomes, players, s + 1, { detail: !!cardStat });
    if (cardStat) engine.setBuyObserver(null);
    const share = 1 / r.winners.length;
    for (const w of r.winners) wins[w] += share;
    for (let i = 0; i < lineup.length; i++) {
      busts[i] += r.busts[i]; drawRounds[i] += r.drawRounds[i]; herdSum[i] += r.herds[i];
    }
    if (cardStat) tallyCards(cardStat, r.collections, r.winners, events);
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
      let events = null;
      if (cardStat) {
        events = [];
        engine.setBuyObserver(ev => events.push({ action: ev.action, row: ev.row, round: ev.round, id: ev.card.id, seat: ev.seat }));
      }
      const r = engine.runGame(lineup.map(n => byName[n]), 4, s + 1, { detail: !!cardStat });
      if (cardStat) engine.setBuyObserver(null);
      if (r.winners.includes(seat)) wins += 1 / r.winners.length;
      busts += r.busts[seat]; draws += r.drawRounds[seat];
      if (cardStat) tallyCards(cardStat, r.collections, r.winners, events);
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
function cardTable(stat, csv, players) {
  const baseline = 1 / players;
  const ids = new Set([...Object.keys(stat.buys), ...Object.keys(stat.burns)]);
  const rows = [...ids].map(id => {
    const c = STORE_BY_ID[id] || {};
    const buys = stat.buys[id] || 0, burns = stat.burns[id] || 0;
    const dealt = buys + burns;   // every dealt card is removed — the Store always empties
    const owners = stat.owners[id] || 0;
    return {
      id, act: c.act ?? '?', cost: c.cost ?? '?',
      cows: c.cows ?? 0, dollars: c.dollars ?? 0, bandits: c.bandits ?? 0,
      special: c.special || '',
      dealt, buys, burns,
      buyRate: dealt ? buys / dealt : 0,
      meanRow:   buys ? stat.rowSum[id] / buys : NaN,
      meanRound: buys ? stat.roundSum[id] / buys : NaN,
      copies: stat.copies[id] || 0,
      owners,
      winRate: owners ? (stat.wins[id] || 0) / owners : NaN,
    };
  }).sort((a, b) => b.buyRate - a.buyRate);

  console.log(`\n=== Card balance — ${players}P, ${rows.length} live store cards ===`);
  console.log(`Sorted by BUY RATE (revealed preference). Win% baseline = ${pct(baseline)}.`);
  console.log('card'.padEnd(9) + 'act'.padStart(4) + 'cost'.padStart(5) +
    'cow'.padStart(4) + '$'.padStart(3) + 'bnd'.padStart(4) +
    'dealt'.padStart(7) + 'buy%'.padStart(7) + 'row'.padStart(6) + 'rnd'.padStart(6) +
    'win%'.padStart(7) + '  special');
  for (const r of rows) {
    console.log(
      r.id.padEnd(9) + String(r.act).padStart(4) + String(r.cost).padStart(5) +
      String(r.cows).padStart(4) + String(r.dollars).padStart(3) + String(r.bandits).padStart(4) +
      String(r.dealt).padStart(7) + pct(r.buyRate).padStart(7) +
      (isNaN(r.meanRow) ? '    —' : r.meanRow.toFixed(1)).padStart(6) +
      (isNaN(r.meanRound) ? '    —' : r.meanRound.toFixed(1)).padStart(6) +
      (isNaN(r.winRate) ? '    —' : pct(r.winRate)).padStart(7) + '  ' + r.special);
  }
  console.log('\nReads:');
  console.log('  buy%  = of the times this card was DEALT, the share BOUGHT rather than burned.');
  console.log('          Unconfounded desirability-at-its-price: every dealt card is removed, so');
  console.log('          buys + burns = dealt exactly. Low buy% = the AI does not want it.');
  console.log('  row   = mean Store row it was bought from (higher = nearer the front//earlier).');
  console.log('  rnd   = mean round it was bought. Late rounds mean fewer draws to use it.');
  console.log('  win%  = of the players who BOUGHT it, the share that won (ties split');
  console.log('          fractionally). Buyer-keyed, not collection-keyed, so a USED Explosive');
  console.log('          still counts — it is spliced out of the collection when activated.');
  console.log('          CONFOUNDED by cost and by who can afford it — read residuals, not raw:');
  console.log('          pipe the CSV through sim/card-flags.js.');

  if (csv) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(__dirname, 'results', `cardbalance_${players}P_${ts}.csv`);
    const lines = ['id,act,cost,cows,dollars,bandits,special,dealt,buys,burns,buyRate,meanRow,meanRound,copies,owners,winRate'];
    for (const r of rows) lines.push(
      [r.id, r.act, r.cost, r.cows, r.dollars, r.bandits, r.special, r.dealt, r.buys, r.burns,
       r.buyRate.toFixed(4), isNaN(r.meanRow) ? '' : r.meanRow.toFixed(3),
       isNaN(r.meanRound) ? '' : r.meanRound.toFixed(3),
       r.copies, r.owners, isNaN(r.winRate) ? '' : r.winRate.toFixed(4)].join(','));
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`\nCSV: ${file}`);
  }
}

// --- main ---
function main() {
  const o = parseArgs();
  if (o.list) { console.log('Personalities:', NAMES.join(', ')); return; }
  if (o.players < 2 || o.players > 8) { console.error('players must be 2–8'); process.exit(1); }

  const cardStat = newCardStat();
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

  cardTable(cardStat, o.csv, o.players);
}

main();
