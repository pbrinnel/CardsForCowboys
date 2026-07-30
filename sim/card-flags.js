#!/usr/bin/env node
// sim/card-flags.js — turn a cardbalance CSV into a RANKED REBALANCE SHORTLIST (R4 of
// sim/CARD_REBALANCE_PLAN.md). Measurement lives in simulate.js; judgement lives here.
//
// Raw win%-when-bought must not be read directly. Three confounds:
//   COST/AFFORDABILITY SELECTION — an expensive card can only be bought by a player who already
//     had a good draw round, so its win% is inflated by the situation, not the card.
//   TIMING — the Store is eaten front-to-back, so act-3 cards are always bought late, when there
//     are fewer rounds left to draw them and less left to spend on.
//   DUPLICATE PRINTS — 17 stat-lines appear 2-5× among the 54 live cards, so one balance fault
//     shows up as several "findings" unless duplicates are collapsed.
//
// Three views, weakest-assumption first:
//   1. SAME-COST COHORTS — the robust one. Within a cost band, affordability selection is held
//      roughly fixed, so a win% spread between cards of EQUAL cost is a pricing fault with no
//      modelling required.
//   2. HERD-EQUIVALENT PRICING — cards priced against a printed-value model. DOLLARS SCORE ZERO
//      (the showdown counts Cows only), so a card's direct herd value is its printed Cows and
//      nothing else. Dollars are worth only the cows they buy, which no printed model can capture.
//   3. RESIDUAL FLAG RULE — pre-registered: fit win% on (cost, act, mean buy round) and flag any
//      card off the fit by >= FLAG_PP with >= MIN_OBS observations.
//
// Also reports BUY-vs-WIN DIVERGENCE, which separates two different bugs that look alike:
//   high buy% + low win%  → the AI wants it and is wrong  (mispriced card OR over-scoring AI)
//   low buy% + high win%  → the AI ignores a strong card  (under-scoring AI)
// Deciding which requires the causal pass (R5) — this only localises it.
//
// Usage:
//   node sim/card-flags.js sim/results/cardbalance_4P_<ts>.csv
//   node sim/card-flags.js <csv> --flag-pp 8 --min-obs 300
'use strict';

const fs = require('fs');

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? parseFloat(args[i + 1]) : dflt;
}
const FLAG_PP = opt('flag-pp', 8);      // pre-registered threshold, percentage points
const MIN_OBS = opt('min-obs', 300);    // pre-registered minimum buyer-observations

if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('usage: node sim/card-flags.js <cardbalance CSV from simulate.js --csv>');
  process.exit(1);
}

// --- load ---
const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const head = lines[0].split(',');
const cards = lines.slice(1).map(l => {
  const v = l.split(',');
  const o = {};
  head.forEach((h, i) => { o[h] = v[i]; });
  return {
    id: o.id, act: +o.act, cost: +o.cost,
    cows: +o.cows, dollars: +o.dollars, bandits: +o.bandits,
    special: o.special || '',
    dealt: +o.dealt, buys: +o.buys, burns: +o.burns,
    buyRate: +o.buyRate, meanRow: +o.meanRow, meanRound: +o.meanRound,
    owners: +o.owners, winRate: +o.winRate,
  };
}).filter(c => c.owners >= MIN_OBS && isFinite(c.winRate));

const players = /_(\d)P_/.exec(csvPath);
const BASE = players ? 1 / +players[1] : 0.25;
const pp = x => (x * 100).toFixed(1);
const sgn = x => (x >= 0 ? '+' : '') + x.toFixed(1);

console.log(`Cards For Cowboys — card rebalance shortlist`);
console.log(`source: ${csvPath}`);
console.log(`${cards.length} cards with >= ${MIN_OBS} buyer-observations · win% baseline ${pp(BASE)}% · flag threshold ${FLAG_PP}pp\n`);

// Collapse identical printed stat-lines: one fault, one finding.
const keyOf = c => [c.cost, c.cows, c.dollars, c.bandits, c.special].join('/');
const groups = {};
for (const c of cards) (groups[keyOf(c)] = groups[keyOf(c)] || []).push(c);

// ── 1. SAME-COST COHORTS ─────────────────────────────────────────────────────
console.log('─'.repeat(78));
console.log('1. SAME-COST COHORTS — spread at equal cost needs no model to interpret');
console.log('─'.repeat(78));
const byCost = {};
for (const c of cards) (byCost[c.cost] = byCost[c.cost] || []).push(c);
const cohortSpreads = [];
for (const cost of Object.keys(byCost).map(Number).sort((a, b) => a - b)) {
  const g = byCost[cost].slice().sort((a, b) => b.winRate - a.winRate);
  if (g.length < 2) continue;
  const spread = (g[0].winRate - g[g.length - 1].winRate) * 100;
  cohortSpreads.push({ cost, spread, best: g[0], worst: g[g.length - 1] });
  console.log(`\n  cost ${cost}  —  win% spread ${spread.toFixed(1)}pp`);
  for (const c of g) {
    const tag = [c.cows ? `${c.cows}cow` : '', c.dollars ? `$${c.dollars}` : '',
      c.bandits ? `${c.bandits}bnd` : '', c.special].filter(Boolean).join(' ');
    console.log('    ' + c.id.padEnd(9) + `a${c.act}  ` + tag.padEnd(22) +
      `buy ${pp(c.buyRate).padStart(5)}%   win ${pp(c.winRate).padStart(5)}%   rnd ${c.meanRound.toFixed(1)}`);
  }
}

// ── 2. HERD-EQUIVALENT PRICING ───────────────────────────────────────────────
// The showdown counts printed COWS only — dollars score NOTHING. So a card's direct contribution
// to the final herd is exactly its cows, and every dollar-only card has a direct value of ZERO.
// Their entire worth is instrumental (the cows they let you buy), which is why a printed model
// cannot price them and why the same-cost cohorts above are the sounder read.
console.log('\n' + '─'.repeat(78));
console.log('2. COWS-PER-COST — dollars score ZERO at the showdown, so cows are the only');
console.log('   direct herd value. Dollar-only cards have herd/cost = 0 by construction.');
console.log('─'.repeat(78));
console.log('\n  card      act cost  cows   $  cow/cost   buy%    win%');
const priced = cards.map(c => ({ ...c, eff: c.cows / c.cost }))
  .sort((a, b) => b.eff - a.eff || b.winRate - a.winRate);
for (const c of priced) {
  console.log('  ' + c.id.padEnd(9) + String(c.act).padStart(3) + String(c.cost).padStart(5) +
    String(c.cows).padStart(6) + String(c.dollars).padStart(4) +
    c.eff.toFixed(3).padStart(10) + pp(c.buyRate).padStart(7) + pp(c.winRate).padStart(8));
}

// correlation of efficiency with realised win%
function corr(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
console.log(`\n  corr(cow-per-cost, win%) = ${corr(priced.map(c => c.eff), priced.map(c => c.winRate)).toFixed(3)}`);
const cowCards = cards.filter(c => c.cows > 0), dolCards = cards.filter(c => c.cows === 0 && c.dollars > 0);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`  cow-bearing cards  (n=${cowCards.length}):  mean win ${pp(mean(cowCards.map(c => c.winRate)))}%   mean buy ${pp(mean(cowCards.map(c => c.buyRate)))}%`);
console.log(`  dollar-only cards  (n=${dolCards.length}):  mean win ${pp(mean(dolCards.map(c => c.winRate)))}%   mean buy ${pp(mean(dolCards.map(c => c.buyRate)))}%`);

// ── 3. RESIDUAL FLAG RULE (pre-registered) ───────────────────────────────────
// OLS: win% ~ 1 + cost + meanRound + act2 + act3
function ols(X, y) {
  const k = X[0].length, n = X.length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < n; i++)
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b];
      A[a][k] += X[i][a] * y[i];
    }
  for (let c = 0; c < k; c++) {                                  // Gauss-Jordan
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let b = c; b <= k; b++) A[c][b] /= d;
    for (let r = 0; r < k; r++) if (r !== c) {
      const f = A[r][c];
      for (let b = c; b <= k; b++) A[r][b] -= f * A[c][b];
    }
  }
  return A.map(r => r[k]);
}
const X = cards.map(c => [1, c.cost, c.meanRound, c.act === 2 ? 1 : 0, c.act === 3 ? 1 : 0]);
const y = cards.map(c => c.winRate);
const beta = ols(X, y);
const resid = cards.map((c, i) => ({
  c, fit: X[i].reduce((s, v, j) => s + v * beta[j], 0),
})).map(r => ({ ...r, resid: (r.c.winRate - r.fit) * 100 }));

console.log('\n' + '─'.repeat(78));
console.log('3. RESIDUAL FLAG RULE — win% ~ cost + buy-round + act; flag |residual| >= ' + FLAG_PP + 'pp');
console.log('─'.repeat(78));
console.log(`\n  fit: win% = ${beta[0].toFixed(3)} ${sgn(beta[1])}*cost ${sgn(beta[2])}*round ${sgn(beta[3])}*act2 ${sgn(beta[4])}*act3`);

const flagged = resid.filter(r => Math.abs(r.resid) >= FLAG_PP)
  .sort((a, b) => Math.abs(b.resid) - Math.abs(a.resid));

// collapse duplicate prints
const seenKey = new Set();
const shortlist = [];
for (const r of flagged) {
  const k = keyOf(r.c);
  if (seenKey.has(k)) continue;
  seenKey.add(k);
  shortlist.push({ ...r, siblings: groups[k].map(x => x.id).filter(id => id !== r.c.id) });
}

if (!shortlist.length) {
  console.log('\n  ✓ NOTHING FLAGGED — no card deviates from the cost/timing trend by ' + FLAG_PP + 'pp or more.');
  console.log('    Record this null result; it is as informative as a change.');
} else {
  console.log(`\n  ${shortlist.length} distinct stat-line(s) flagged (${flagged.length} cards before collapsing duplicates):\n`);
  console.log('  card      act cost  print                    buy%    win%     fit   resid   verdict');
  for (const r of shortlist) {
    const c = r.c;
    const tag = [c.cows ? `${c.cows}cow` : '', c.dollars ? `$${c.dollars}` : '',
      c.bandits ? `${c.bandits}bnd` : '', c.special].filter(Boolean).join(' ');
    const verdict = r.resid > 0 ? 'UNDERPRICED (too strong)' : 'OVERPRICED (too weak)';
    console.log('  ' + c.id.padEnd(9) + String(c.act).padStart(3) + String(c.cost).padStart(5) + '  ' +
      tag.padEnd(22) + pp(c.buyRate).padStart(6) + pp(c.winRate).padStart(8) +
      pp(r.fit).padStart(8) + sgn(r.resid).padStart(8) + '   ' + verdict);
    if (r.siblings.length) console.log('            └ same print: ' + r.siblings.join(', '));
  }
}

// ── BUY-vs-WIN DIVERGENCE ────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('BUY-vs-WIN DIVERGENCE — is the CARD mispriced, or is the AI misjudging it?');
console.log('─'.repeat(78));
const rank = (arr, key) => {
  const s = arr.slice().sort((a, b) => b[key] - a[key]);
  const m = new Map(); s.forEach((c, i) => m.set(c.id, i + 1)); return m;
};
const buyRank = rank(cards, 'buyRate'), winRank = rank(cards, 'winRate');
const div = cards.map(c => ({ c, d: buyRank.get(c.id) - winRank.get(c.id) }));
console.log('\n  AI OVERVALUES (buys eagerly, wins less) — top 6:');
for (const x of div.sort((a, b) => a.d - b.d).slice(0, 6))
  console.log('    ' + x.c.id.padEnd(9) + `buy rank ${String(buyRank.get(x.c.id)).padStart(2)} vs win rank ${String(winRank.get(x.c.id)).padStart(2)}` +
    `   buy ${pp(x.c.buyRate).padStart(5)}%  win ${pp(x.c.winRate).padStart(5)}%`);
console.log('\n  AI UNDERVALUES (ignores it, but it wins) — top 6:');
for (const x of div.sort((a, b) => b.d - a.d).slice(0, 6))
  console.log('    ' + x.c.id.padEnd(9) + `buy rank ${String(buyRank.get(x.c.id)).padStart(2)} vs win rank ${String(winRank.get(x.c.id)).padStart(2)}` +
    `   buy ${pp(x.c.buyRate).padStart(5)}%  win ${pp(x.c.winRate).padStart(5)}%`);

console.log('\n' + '─'.repeat(78));
console.log('NOTE: every number here is correlational. A high-cost card is only bought by a player');
console.log('already having a good round, which inflates its win%. The same-cost cohorts (view 1)');
console.log('hold that confound roughly fixed and are the safest basis for a decision; anything');
console.log('resting on views 2-3 alone should go through the R5 forced-buy counterfactual first.');
