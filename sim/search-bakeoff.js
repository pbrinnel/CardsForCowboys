#!/usr/bin/env node
// sim/search-bakeoff.js — reusable head-to-head / vs-field measurement for the search-AI
// bake-off (AI_SEARCH_BAKEOFF_PLAN.md). Mirrors simulate.js's structure (2P both seat orders;
// 4P focal vs 3 rotating opponents) but lets the focal seat be EITHER a parameter pro (genome)
// or the flat-MC search policy — so search and pro baselines are measured apples-to-apples on
// the same seeds. Reports win% + CI + the cost side (rollouts/decision, ms/game).
//
// Two B2 experiments built in:
//   --mode sweep   N×horizon vs enforcer (2P). vs enforcer the perfect/default opponent models
//                  are IDENTICAL (the opponent truly is enforcer), so this isolates the
//                  strength↔cost shape of the knobs without the model confound.
//   --mode ablate  vs the FIELD (2P, and 4P with --players4), PERFECT vs DEFAULT opponent model.
//                  The perfect↔default gap = how much the search leans on knowing opponents (§6).
//
// Generic usage (also the B4 head-to-head core):
//   node sim/search-bakeoff.js --vs enforcer --seeds 400
//   node sim/search-bakeoff.js --field --players 2 --opp-model default --seeds 100
'use strict';

const engine = require('./personality-engine');
const { GENOMES, byName } = require('./personalities');
const { makeSearchPolicy } = require('./search-ai');

const FIELD = GENOMES.map(g => g.name);   // the 10 parameter pros
const pct = x => (x * 100).toFixed(1);
const ci95 = (p, n) => 1.96 * Math.sqrt(p * (1 - p) / n);

// ── participants ──────────────────────────────────────────────────────────────
// A focal spec is { kind:'search', opts } or { kind:'genome', name }. instantiate() returns a
// FRESH instance each game (search policies carry per-game _stats that must reset).
function instantiate(spec) {
  if (spec.kind === 'search') return makeSearchPolicy(spec.opts);
  return byName[spec.name];
}
function specName(spec) {
  if (spec.kind === 'search') return `search(N=${spec.opts.N},${spec.opts.horizon},${spec.opts.oppModel})`;
  return spec.name;
}
function statsOf(inst) { return inst && inst._stats ? inst._stats : { decisions: 0, rollouts: 0 }; }

// ── 2P head-to-head: focal vs one opponent, both seat orders ────────────────────
function duel2P(focalSpec, oppName, seeds) {
  let wins = 0, games = 0, decisions = 0, rollouts = 0;
  const t0 = Date.now();
  for (let s = 1; s <= seeds; s++) {
    let f = instantiate(focalSpec);
    if (engine.runGame([f, byName[oppName]], 2, s).winner === 0) wins++;
    { const st = statsOf(f); decisions += st.decisions; rollouts += st.rollouts; } games++;

    f = instantiate(focalSpec);
    if (engine.runGame([byName[oppName], f], 2, s).winner === 1) wins++;
    { const st = statsOf(f); decisions += st.decisions; rollouts += st.rollouts; } games++;
  }
  return { wins, games, wr: wins / games, decisions, rollouts, ms: Date.now() - t0 };
}

// ── 2P vs the field: focal vs each genome (skip self if focal is that genome) ───
function vsField2P(focalSpec, seeds) {
  const skip = focalSpec.kind === 'genome' ? focalSpec.name : null;
  let wins = 0, games = 0, decisions = 0, rollouts = 0;
  const t0 = Date.now();
  for (const opp of FIELD) {
    if (opp === skip) continue;
    const r = duel2P(focalSpec, opp, seeds);
    wins += r.wins; games += r.games; decisions += r.decisions; rollouts += r.rollouts;
  }
  return { wins, games, wr: wins / games, decisions, rollouts, ms: Date.now() - t0 };
}

// ── 4P field: focal + 3 rotating opponents (mirrors simulate.js field4P) ────────
function field4P(focalSpec, seeds) {
  const skip = focalSpec.kind === 'genome' ? focalSpec.name : null;
  const opps = FIELD.filter(n => n !== skip);
  let wins = 0, games = 0, decisions = 0, rollouts = 0;
  const t0 = Date.now();
  for (let s = 0; s < seeds; s++) {
    const three = [0, 1, 2].map(k => opps[(s * 3 + k) % opps.length]);
    const seat = s % 4;
    const focal = instantiate(focalSpec);
    const lineup = three.map(n => byName[n]);
    lineup.splice(seat, 0, focal);
    if (engine.runGame(lineup, 4, s + 1).winner === seat) wins++;
    const st = statsOf(focal); decisions += st.decisions; rollouts += st.rollouts; games++;
  }
  return { wins, games, wr: wins / games, decisions, rollouts, ms: Date.now() - t0 };
}

function report(label, r) {
  const rpd = r.rollouts / Math.max(1, r.decisions);
  console.log(
    `  ${label.padEnd(34)} ${pct(r.wr).padStart(5)}%  ±${pct(ci95(r.wr, r.games)).padStart(4)}pp   ` +
    `[${rpd.toFixed(0).padStart(4)} roll/dec, ${(r.ms / r.games).toFixed(1).padStart(6)} ms/game, n=${r.games}]`);
  return r;
}

// ── experiments ────────────────────────────────────────────────────────────────
function searchSpec(N, horizon, oppModel, branchCap, def) {
  return { kind: 'search', opts: { N, horizon, oppModel, branchCap, defaultGenome: byName[def], drawGenome: byName[def] } };
}

function runSweep(o) {
  console.log(`\n=== B2 SWEEP — N × horizon vs enforcer (2P, both orders, ${o.seeds} seeds) ===`);
  console.log(`(vs enforcer, perfect ≡ default model — isolates the knob strength↔cost shape)\n`);
  const Ns = [16, 64, 256];
  const horizons = ['endOfRound', 'endOfAct', 'endOfGame'];
  for (const horizon of horizons) {
    for (const N of Ns) {
      const spec = searchSpec(N, horizon, 'perfect', o.branchCap, o.def);
      report(`N=${N} ${horizon}`, duel2P(spec, 'enforcer', o.seeds));
    }
    console.log('');
  }
  console.log('Baseline: enforcer vs enforcer ≈ 50% (mirror). >50% = lookahead adds value.');
}

function runAblate(o) {
  console.log(`\n=== B2 ABLATION — search vs FIELD, perfect vs default opponent model ===`);
  console.log(`config: N=${o.N}, horizon=${o.horizon}, branchCap=${o.branchCap}, default=${o.def}\n`);

  console.log(`2P vs field (${o.seeds} seeds × ${FIELD.length} opponents × 2 orders):`);
  const perfect2 = report('search [perfect model]', vsField2P(searchSpec(o.N, o.horizon, 'perfect', o.branchCap, o.def), o.seeds));
  const default2 = report('search [default model] ', vsField2P(searchSpec(o.N, o.horizon, 'default', o.branchCap, o.def), o.seeds));
  // Pro baselines on the SAME field/seeds (each pro skips itself; minor field-size asymmetry noted).
  console.log('  ── pro baselines (same field & seeds) ──');
  const enf2 = report('enforcer (best pro)', vsField2P({ kind: 'genome', name: 'enforcer' }, o.seeds));
  const dri2 = report('drifter', vsField2P({ kind: 'genome', name: 'drifter' }, o.seeds));
  const bestPro2 = Math.max(enf2.wr, dri2.wr);
  console.log('');
  console.log(`  Δ2P (search default − best pro) = ${pct(default2.wr - bestPro2)}pp   |   perfect↔default gap = ${pct(perfect2.wr - default2.wr)}pp`);

  if (o.players4) {
    console.log(`\n4P focal vs 3 rotating opponents (${o.seeds4} seeds; baseline 25%):`);
    const perfect4 = report('search [perfect model]', field4P(searchSpec(o.N, o.horizon, 'perfect', o.branchCap, o.def), o.seeds4));
    const default4 = report('search [default model] ', field4P(searchSpec(o.N, o.horizon, 'default', o.branchCap, o.def), o.seeds4));
    console.log('  ── pro baselines (same field & seeds) ──');
    const enf4 = report('enforcer (best pro)', field4P({ kind: 'genome', name: 'enforcer' }, o.seeds4));
    const dri4 = report('drifter', field4P({ kind: 'genome', name: 'drifter' }, o.seeds4));
    const bestPro4 = Math.max(enf4.wr, dri4.wr);
    console.log('');
    console.log(`  Δ4P (search default − best pro) = ${pct(default4.wr - bestPro4)}pp   |   perfect↔default gap = ${pct(perfect4.wr - default4.wr)}pp`);
  }
  console.log(`\nThe REALISTIC (default) model is the shippable one. The §9 worth-it bar is on Δ under`);
  console.log(`the default model at scale (B4) — this is a B2 directional read on a moderate seed set.`);
}

// ── generic head-to-head / field (also the B4 core) ─────────────────────────────
function runGeneric(o) {
  const spec = searchSpec(o.N, o.horizon, o.oppModel, o.branchCap, o.def);
  console.log(`\n=== ${specName(spec)} — default=${o.def} ===`);
  if (o.field) {
    if (o.players === 4) report(`vs field 4P`, field4P(spec, o.seeds));
    else report(`vs field 2P`, vsField2P(spec, o.seeds));
  } else {
    report(`vs ${o.vs} (2P)`, duel2P(spec, o.vs, o.seeds));
  }
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    mode: null, vs: 'enforcer', field: false, players: 2, players4: false,
    N: 64, horizon: 'endOfAct', branchCap: 12, oppModel: 'perfect', def: 'enforcer',
    seeds: 100, seeds4: 80,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--mode') o.mode = a[++i];
    else if (k === '--vs') { o.vs = a[++i]; o.field = false; }
    else if (k === '--field') o.field = true;
    else if (k === '--players') o.players = parseInt(a[++i], 10);
    else if (k === '--players4') o.players4 = true;
    else if (k === '--N') o.N = parseInt(a[++i], 10);
    else if (k === '--horizon') o.horizon = a[++i];
    else if (k === '--branch') o.branchCap = parseInt(a[++i], 10);
    else if (k === '--opp-model') o.oppModel = a[++i];
    else if (k === '--default') o.def = a[++i];
    else if (k === '--seeds') o.seeds = parseInt(a[++i], 10);
    else if (k === '--seeds4') o.seeds4 = parseInt(a[++i], 10);
  }
  return o;
}

function main() {
  const o = parseArgs();
  console.log('Cards For Cowboys — search-AI bake-off (engine: personality-engine.js resumable core)');
  if (o.mode === 'sweep') runSweep(o);
  else if (o.mode === 'ablate') runAblate(o);
  else runGeneric(o);
}

main();
