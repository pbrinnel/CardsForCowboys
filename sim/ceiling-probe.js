#!/usr/bin/env node
// sim/ceiling-probe.js — Phase-0 diagnostic for the "more competitive AI" effort.
//
// QUESTION: with the CURRENT 14-param genome + decision logic, can a fresh GA candidate,
// optimizing ONLY against the 5 Hard bots (not the diluted whole field), actually beat them?
// If the best evolved genome plateaus near ~50%, the current param space is exhausted and the
// next gain must come from new genes / logic (Phase 1), not more search.
//
// This is a throwaway probe, not a shipping tool. Fitness = win-rate vs the FIXED Hard set
// (2P vs each + 4P with 3 random Hard opponents). No Hall of Fame, no new genes — that is the
// whole point: measure the ceiling of what exists today.
'use strict';

const { runGame, makeLCG } = require('./personality-engine');
const { byName } = require('./personalities');
const { PARAM_KEYS, PARAM_RANGES } = require('./evolve');

const HARD = ['deputy', 'enforcer', 'drifter', 'rancher', 'prospector'].map(n => byName[n]);

function gaussian() {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}
function randomGenome() {
  const g = {};
  for (const k of PARAM_KEYS) { const { min, max } = PARAM_RANGES[k]; g[k] = min + Math.random() * (max - min); }
  g.maxDraw = 7 + Math.floor(Math.random() * 4); // 7..10
  return g;
}
function mutate(g, rate, str) {
  const c = { ...g };
  for (const k of PARAM_KEYS) {
    if (Math.random() < rate) {
      const r = PARAM_RANGES[k].max - PARAM_RANGES[k].min;
      c[k] = Math.max(PARAM_RANGES[k].min, Math.min(PARAM_RANGES[k].max, c[k] + gaussian() * r * str));
    }
  }
  return c;
}
function crossover(a, b) { const c = {}; for (const k of PARAM_KEYS) c[k] = Math.random() < 0.5 ? a[k] : b[k]; c.maxDraw = a.maxDraw; return c; }

// Fitness: win-rate of `cand` vs the FIXED Hard set only.
function fitnessVsHard(cand, kSeeds) {
  let wins = 0, games = 0;
  // 2P: cand vs each Hard bot, both seat orders folded into seed variety
  for (let h = 0; h < HARD.length; h++) {
    for (let s = 0; s < kSeeds; s++) {
      const seed = 50000 + s * 131 + h * 9001;
      if (runGame([cand, HARD[h]], 2, seed).winner === 0) wins++;
      games++;
      // reverse seat
      if (runGame([HARD[h], cand], 2, seed + 7).winner === 1) wins++;
      games++;
    }
  }
  // 4P: cand + 3 random Hard opponents
  const rng = makeLCG(777);
  for (let s = 0; s < kSeeds; s++) {
    const opps = [0, 1, 2].map(() => HARD[Math.floor(rng() * HARD.length)]);
    const seed = 80000 + s * 211;
    if (runGame([cand, ...opps], 4, seed).winner === 0) wins++;
    games++;
  }
  return wins / games;
}

function main() {
  const POP = 40, GENS = 40, KSEEDS = 25;
  // seed gen0 with the Hard bots themselves + random fill (so the GA starts from known-strong)
  let pop = [...HARD.map(g => ({ ...g })), ...Array.from({ length: POP - HARD.length }, randomGenome)];

  console.log(`Ceiling probe — candidate vs FIXED Hard set [${['deputy','enforcer','drifter','rancher','prospector'].join(', ')}]`);
  console.log(`pop=${POP} gens=${GENS} seeds=${KSEEDS}  (50% = ties the Hard cluster; >55% = real headroom in current params)\n`);

  let best = null, bestFit = 0;
  for (let gen = 1; gen <= GENS; gen++) {
    const scored = pop.map(g => ({ g, f: fitnessVsHard(g, KSEEDS) })).sort((a, b) => b.f - a.f);
    if (scored[0].f > bestFit) { bestFit = scored[0].f; best = scored[0].g; }
    if (gen % 5 === 0 || gen === 1) console.log(`gen ${String(gen).padStart(2)} | best vs Hard: ${(scored[0].f * 100).toFixed(1)}%  | mean: ${(scored.reduce((s, x) => s + x.f, 0) / scored.length * 100).toFixed(1)}%`);
    const elites = scored.slice(0, Math.floor(POP * 0.25)).map(x => ({ ...x.g }));
    const pool = scored.slice(0, POP / 2).map(x => x.g);
    const kids = [];
    while (elites.length + kids.length + 2 < POP) {
      const a = pool[Math.floor(Math.random() * pool.length)], b = pool[Math.floor(Math.random() * pool.length)];
      kids.push(mutate(crossover(a, b), 0.3, 0.15));
    }
    pop = [...elites, randomGenome(), randomGenome(), ...kids];
  }

  // High-seed re-validation of the single best genome
  const finalFit = fitnessVsHard(best, 300);
  console.log(`\nBest candidate, re-validated @300 seeds vs Hard set: ${(finalFit * 100).toFixed(1)}%`);
  console.log('Genome:');
  for (const k of PARAM_KEYS) console.log(`  ${k.padEnd(16)} ${best[k].toFixed(2)}`);
  console.log(`  ${'maxDraw'.padEnd(16)} ${best.maxDraw}`);
  console.log(`\nVERDICT: ${finalFit < 0.53 ? 'CEILING REACHED — current params exhausted; Phase 1 (new genes/logic) needed before re-evolution.' : 'HEADROOM EXISTS — re-evolution alone may yield gains.'}`);
}

main();
