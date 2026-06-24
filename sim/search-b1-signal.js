#!/usr/bin/env node
// sim/search-b1-signal.js — B1 "first signal": does the flat-MC buy-phase search beat the pros
// head-to-head AT ALL? (AI_SEARCH_BAKEOFF_PLAN.md B1). Perfect opponent model, N=64,
// horizon=endOfAct, defaultGenome=enforcer. 2P, both seat orders, fixed seed set.
//
// This is a SIGNAL, not the verdict — the pre-registered bar + ablation + scale come later
// (B2–B4). Reports win% vs each opponent, plus the cost side (rollouts/decision, ms/game).
//
// Usage:
//   node sim/search-b1-signal.js                 # default: vs enforcer @ 400 seeds + Hard field @ 150
//   node sim/search-b1-signal.js --seeds 800     # more seeds on the headline matchup
//   node sim/search-b1-signal.js --N 128 --horizon endOfGame
'use strict';

const engine = require('./personality-engine');
const { byName } = require('./personalities');
const { makeSearchPolicy } = require('./search-ai');

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { seeds: 400, fieldSeeds: 150, N: 64, horizon: 'endOfAct', branchCap: 12, oppModel: 'perfect', def: 'enforcer' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--seeds') o.seeds = parseInt(a[++i], 10);
    else if (a[i] === '--field-seeds') o.fieldSeeds = parseInt(a[++i], 10);
    else if (a[i] === '--N') o.N = parseInt(a[++i], 10);
    else if (a[i] === '--horizon') o.horizon = a[++i];
    else if (a[i] === '--branch') o.branchCap = parseInt(a[++i], 10);
    else if (a[i] === '--opp-model') o.oppModel = a[++i];
    else if (a[i] === '--default') o.def = a[++i];
  }
  return o;
}

const pct = x => (x * 100).toFixed(1);
function ci95(p, n) { // 95% half-width (pp) for a win-rate p over n games (normal approx)
  return 1.96 * Math.sqrt(p * (1 - p) / n);
}

// Search (focal) vs one opponent genome, 2P, both seat orders. Returns search win-rate + cost.
function duel(opts, oppName, seeds) {
  const def = byName[opts.def];
  const opp = byName[oppName];
  const mk = () => makeSearchPolicy({ N: opts.N, horizon: opts.horizon, branchCap: opts.branchCap, oppModel: opts.oppModel, defaultGenome: def, drawGenome: def });

  let wins = 0, games = 0, decisions = 0, rollouts = 0;
  const t0 = Date.now();
  for (let s = 1; s <= seeds; s++) {
    // order A: search seat 0
    let p = mk();
    if (engine.runGame([p, opp], 2, s).winner === 0) wins++;
    decisions += p._stats.decisions; rollouts += p._stats.rollouts; games++;
    // order B: search seat 1
    p = mk();
    if (engine.runGame([opp, p], 2, s).winner === 1) wins++;
    decisions += p._stats.decisions; rollouts += p._stats.rollouts; games++;
  }
  const dt = Date.now() - t0;
  return {
    oppName, wr: wins / games, games,
    rpd: rollouts / Math.max(1, decisions),
    msPerGame: dt / games,
  };
}

function main() {
  const o = parseArgs();
  console.log('Cards For Cowboys — B1 first signal: flat-MC buy-phase search vs the pros (2P, both seat orders)');
  console.log(`config: search default=${o.def}, N=${o.N}, horizon=${o.horizon}, branchCap=${o.branchCap}, oppModel=${o.oppModel}`);
  console.log(`        baseline to beat: a coin flip (50%). The pros' own 2P-vs-field is ~64–70% (see AI_PERSONALITIES.md).\n`);

  // Headline: vs enforcer (the coevolution convergence target / strongest pro).
  console.log(`HEADLINE — search vs enforcer @ ${o.seeds} seeds × 2 orders:`);
  const head = duel(o, 'enforcer', o.seeds);
  const hw = ci95(head.wr, head.games);
  console.log(`  search win% = ${pct(head.wr)}%  (95% CI ±${pct(hw)}pp, n=${head.games})   ${head.wr - hw > 0.5 ? '▲ beats enforcer (CI excludes 50%)' : head.wr > 0.5 ? '▲ above 50% (CI includes it)' : '▼ loses to enforcer'}`);
  console.log(`  cost: ${head.rpd.toFixed(0)} rollouts/decision, ${head.msPerGame.toFixed(1)} ms/game\n`);

  // Breadth: vs the rest of the Hard field (fewer seeds — context, not the headline).
  const field = ['drifter', 'deputy', 'prospector', 'rancher'];
  console.log(`BREADTH — search vs the rest of the Hard field @ ${o.fieldSeeds} seeds × 2 orders:`);
  let agg = 0, aggN = 0;
  for (const name of field) {
    const r = duel(o, name, o.fieldSeeds);
    const hw2 = ci95(r.wr, r.games);
    console.log(`  vs ${name.padEnd(11)} ${pct(r.wr).padStart(5)}%  (±${pct(hw2)}pp)`);
    agg += r.wr * r.games; aggN += r.games;
  }
  console.log(`  vs Hard field (incl. enforcer headline) aggregate ≈ ${pct((agg + head.wr * head.games) / (aggN + head.games))}%\n`);

  console.log('Read: >50% vs a single pro means the search out-plays it head-to-head. This is the B1');
  console.log('gate ("does it beat enforcer at all?") — NOT the §9 worth-it bar (that needs the realistic');
  console.log('model + scale, B2–B4). Cost shown is the tradeoff side of the verdict.');
}

main();
