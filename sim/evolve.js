#!/usr/bin/env node
// sim/evolve.js — Evolutionary AI tournament for Cards For Cowboys
// Usage: node sim/evolve.js [options]  (see --help)
'use strict';

const fs = require('fs');
const path = require('path');

// ── PARAM RANGES & KEYS ──────────────────────────────────────────────────────

const PARAM_RANGES = {
  bustThreshold2:  { min: 0.01, max: 0.60 },
  bustThreshold1:  { min: 0.05, max: 0.90 },
  dollarBuffer:    { min: 0,    max: 5    },
  cowWeight:       { min: 0,    max: 10   },
  dollarWeight:    { min: 0,    max: 6    },
  banditPenalty:   { min: 0,    max: 8    },
  positionWeight:  { min: 0,    max: 2.5  },
  denialWeight:    { min: 0,    max: 1    },
  deckMemory:      { min: 0,    max: 1    },
  lethalBias:      { min: 0.2,  max: 2.5  },
  act1DollarBonus: { min: 0,    max: 3    },
  act3CowBonus:    { min: 0,    max: 4    },
  revealBonus:     { min: 0,    max: 4    },
  affordMult:      { min: 1.0,  max: 2.5  },
};
const PARAM_KEYS = Object.keys(PARAM_RANGES);

// ── SEED GENOMES (generation 0) ──────────────────────────────────────────────
// The canonical personalities (synced to play.js) seed generation 0. The GA mutates
// clones (PARAM_KEYS only — maxDraw is a fixed governor, not evolved).
const { GENOMES: SEED_GENOMES, byName } = require('./personalities');

// maxDraw is a fixed governor (not evolved — see TUNING.md). Coevolution candidates use a
// constant cap; the probe (ceiling-probe.js) found 10 optimal for the disciplined strong cluster
// this mode targets. To sweep maxDraw, use draw-cap-experiment.js (the dedicated tool).
const COEVOLVE_MAXDRAW = 10;

// ── SHARED ENGINE ────────────────────────────────────────────────────────────
// AI decision layer + one-game runner now live in personality-engine.js (shared with
// simulate.js + draw-cap-experiment.js). The GA below only needs runGame + makeLCG.
const { runGame, makeLCG } = require('./personality-engine');

// ── FITNESS EVALUATION ───────────────────────────────────────────────────────

function evaluateFitness(population, kSeeds) {
  const n = population.length;
  const winCounts = new Array(n).fill(0);
  const gamesPlayed = new Array(n).fill(0);

  // 2P: full round-robin (all pairs × kSeeds)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let s = 0; s < kSeeds; s++) {
        const seed = (s + 1) * 997 + i * 31 + j + 20003;
        const result = runGame([population[i], population[j]], 2, seed);
        gamesPlayed[i]++; gamesPlayed[j]++;
        if (result.winner === 0) winCounts[i]++;
        else winCounts[j]++;
      }
    }
  }

  // 4P: sampled groups — each genome plays kSeeds games with 3 random opponents.
  // Generate n groups of 4 per "round" (rotate through the shuffled population).
  // Run kSeeds rounds so each genome gets kSeeds 4P games.
  const rng4p = makeLCG(n * 7919 + kSeeds);
  for (let s = 0; s < kSeeds; s++) {
    // Shuffle indices and chunk into groups of 4
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng4p() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let g = 0; g + 3 < n; g += 4) {
      const group = [indices[g], indices[g + 1], indices[g + 2], indices[g + 3]];
      const seed = (s + 1) * 1009 + group.reduce((a, b) => a * 31 + b, 0);
      const result = runGame(group.map(i => population[i]), 4, seed);
      group.forEach((popIdx, seatIdx) => {
        gamesPlayed[popIdx]++;
        if (seatIdx === result.winner) winCounts[popIdx]++;
      });
    }
  }

  return population.map((genome, i) => ({
    genome,
    fitness: gamesPlayed[i] > 0 ? winCounts[i] / gamesPlayed[i] : 0,
    wins: winCounts[i],
    games: gamesPlayed[i],
  }));
}

// ── COMPETITIVE COEVOLUTION (Phase 2 ceiling-raise) ──────────────────────────
// Fitness = win-rate vs a FIXED opponent pool (Hard anchors + a Hall of Fame of past champions),
// NOT vs the diluted evolving population. The field-GA above drives denial/positionWeight to ~0
// because they don't help against weak random fill; against strong opponents they earn their keep
// (proven by sim/ceiling-probe.js). The Hall of Fame stops the GA forgetting how to beat strong
// play (intransitive cycling). All candidates share a fixed maxDraw (COEVOLVE_MAXDRAW).

function evaluateVsOpponents(population, opponents, kSeeds) {
  const rng4p = makeLCG(population.length * 6151 + opponents.length * 97 + kSeeds);
  return population.map((cand, ci) => {
    let wins = 0, games = 0;
    // 2P vs each opponent, both seat orders
    for (let oi = 0; oi < opponents.length; oi++) {
      for (let s = 0; s < kSeeds; s++) {
        const seed = 60000 + s * 137 + oi * 7919 + ci * 31;
        if (runGame([cand, opponents[oi]], 2, seed).winner === 0) wins++;
        games++;
        if (runGame([opponents[oi], cand], 2, seed + 5).winner === 1) wins++;
        games++;
      }
    }
    // 4P: candidate + 3 sampled opponents
    for (let s = 0; s < kSeeds; s++) {
      const opps = [0, 1, 2].map(() => opponents[Math.floor(rng4p() * opponents.length)]);
      const seed = 90000 + s * 211 + ci * 53;
      if (runGame([cand, ...opps], 4, seed).winner === 0) wins++;
      games++;
    }
    return { genome: cand, fitness: games > 0 ? wins / games : 0, wins, games };
  });
}

// High-seed holdout of ONE genome vs a fixed opponent set (the overfitting guard — the probe's
// in-GA 63%→55% collapse showed low-seed fitness is optimistic).
function runHoldoutVs(genome, opponents, seeds) {
  let w2 = 0, t2 = 0, w4 = 0, t4 = 0;
  for (let oi = 0; oi < opponents.length; oi++) {
    for (let s = 0; s < seeds; s++) {
      const seed = 1234567 + s * 13 + oi * 100003;
      if (runGame([genome, opponents[oi]], 2, seed).winner === 0) w2++;
      t2++;
      if (runGame([opponents[oi], genome], 2, seed + 5).winner === 1) w2++;
      t2++;
    }
  }
  const rng = makeLCG(424242);
  for (let s = 0; s < seeds; s++) {
    const opps = [0, 1, 2].map(() => opponents[Math.floor(rng() * opponents.length)]);
    if (runGame([genome, ...opps], 4, 7654321 + s * 17).winner === 0) w4++;
    t4++;
  }
  return { winRate2P: t2 ? w2 / t2 : 0, winRate4P: t4 ? w4 / t4 : 0, seeds };
}

function resolveAnchors(spec) {
  return spec.split(',').map(n => n.trim()).filter(Boolean).map(n => {
    if (!byName[n]) { console.error(`Unknown anchor personality: ${n}`); process.exit(1); }
    const g = {};
    for (const k of PARAM_KEYS) g[k] = byName[n][k];
    g.maxDraw = byName[n].maxDraw ?? 7;
    g.name = n;
    return g;
  });
}

function runCoevolveTrial(cfg, trialIdx) {
  const anchors = resolveAnchors(cfg.anchors);

  // Gen0: seed from the anchors (start strong) + random fill. All candidates share a fixed maxDraw.
  let population = [
    ...anchors.map(a => ({ ...a })),
    ...Array.from({ length: Math.max(0, cfg.popSize - anchors.length) }, randomGenome),
  ].slice(0, cfg.popSize);
  population.forEach(g => { g.maxDraw = COEVOLVE_MAXDRAW; });

  const hof = [];               // Hall of Fame champions (opponent pool grows over time)
  const generationsLog = [];
  const fitnessHistory = [];
  let bestGenome = null, bestFit = -1;

  for (let gen = 1; gen <= cfg.maxGenerations; gen++) {
    const opponents = [...anchors, ...hof];
    const ranked = evaluateVsOpponents(population, opponents, cfg.kSeeds)
      .sort((a, b) => b.fitness - a.fitness);

    process.stdout.write(`Trial ${trialIdx + 1} | `);
    printGenSummary(gen, ranked, cfg.quiet);
    fitnessHistory.push(ranked.map(r => ({ fitness: r.fitness })));

    if (ranked[0].fitness > bestFit) { bestFit = ranked[0].fitness; bestGenome = { ...ranked[0].genome }; }
    generationsLog.push({
      gen, bestFitness: ranked[0].fitness,
      meanFitness: ranked.reduce((s, r) => s + r.fitness, 0) / ranked.length,
      bestGenome: { ...ranked[0].genome },
    });

    // Hall of Fame: enroll this gen's champion, cap to hofSize (drop oldest).
    hof.push({ ...ranked[0].genome });
    if (hof.length > cfg.hofSize) hof.shift();

    if (checkConverged(fitnessHistory)) { console.log(`Converged at generation ${gen}.`); break; }

    if (gen < cfg.maxGenerations) {
      population = buildNextGeneration(ranked, cfg.eliteFrac, cfg.mutationRate, cfg.mutationStrength);
      population.forEach(g => { g.maxDraw = COEVOLVE_MAXDRAW; }); // re-stamp (crossover/mutate drop it)
    }
  }

  console.log('Running holdout validation (high seed)...');
  const holdout = runHoldoutVs(bestGenome, anchors, cfg.holdoutSeeds);
  const vsField = runHoldoutVs(bestGenome, SEED_GENOMES, cfg.holdoutSeeds);
  console.log(`Holdout vs anchors: 2P=${(holdout.winRate2P * 100).toFixed(1)}%  4P=${(holdout.winRate4P * 100).toFixed(1)}%` +
              `  |  vs full field: 2P=${(vsField.winRate2P * 100).toFixed(1)}%  4P=${(vsField.winRate4P * 100).toFixed(1)}%`);

  return { generationsLog, bestGenome, holdout, vsField, anchors };
}

// ── EVOLUTIONARY ALGORITHM ───────────────────────────────────────────────────

function gaussianRandom() {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function randomGenome() {
  const g = {};
  for (const key of PARAM_KEYS) {
    const { min, max } = PARAM_RANGES[key];
    g[key] = min + Math.random() * (max - min);
  }
  return g;
}

function crossover(parentA, parentB) {
  const child = {};
  for (const key of PARAM_KEYS) {
    child[key] = Math.random() < 0.5 ? parentA[key] : parentB[key];
  }
  return child;
}

function mutate(genome, mutationRate, mutationStrength) {
  const child = { ...genome };
  for (const key of PARAM_KEYS) {
    if (Math.random() < mutationRate) {
      const range = PARAM_RANGES[key].max - PARAM_RANGES[key].min;
      child[key] += gaussianRandom() * range * mutationStrength;
      child[key] = Math.max(PARAM_RANGES[key].min, Math.min(PARAM_RANGES[key].max, child[key]));
    }
  }
  return child;
}

function buildNextGeneration(rankedPop, eliteFrac, mutationRate, mutationStrength) {
  const popSize = rankedPop.length;
  const numElites = Math.floor(popSize * eliteFrac);
  const elites = rankedPop.slice(0, numElites).map(r => ({ ...r.genome }));

  const parentPool = rankedPop.slice(0, Math.floor(popSize / 2)).map(r => r.genome);
  const numRandom = 2;
  const numChildren = popSize - numElites - numRandom;

  const children = [];
  for (let i = 0; i < numChildren; i++) {
    const a = parentPool[Math.floor(Math.random() * parentPool.length)];
    const b = parentPool[Math.floor(Math.random() * parentPool.length)];
    children.push(mutate(crossover(a, b), mutationRate, mutationStrength));
  }

  const randoms = Array.from({ length: numRandom }, () => randomGenome());
  return [...elites, ...randoms, ...children];
}

// ── CONVERGENCE DETECTION ─────────────────────────────────────────────────────

function checkConverged(fitnessHistory) {
  if (fitnessHistory.length < 5) return false;
  const last5 = fitnessHistory.slice(-5);
  for (const entry of last5) {
    const top3 = entry.slice(0, 3).map(r => r.fitness);
    const spread = Math.max(...top3) - Math.min(...top3);
    if (spread >= 0.01) return false;
  }
  return true;
}

// ── HOLDOUT VALIDATION ────────────────────────────────────────────────────────

function runHoldout(bestGenome, holdoutSeeds) {
  const holdoutGenomes = [...SEED_GENOMES.map(g => ({ ...g }))];

  let wins2P = 0, total2P = 0;
  let wins4P = 0, total4P = 0;

  // Run against seed personalities at 2P (best vs each personality)
  for (const opp of holdoutGenomes) {
    for (let s = 0; s < holdoutSeeds; s++) {
      const seed = 9999991 + s * 13 + holdoutGenomes.indexOf(opp) * 100003;
      const result = runGame([bestGenome, opp], 2, seed);
      total2P++;
      if (result.winner === 0) wins2P++;
    }
  }

  // Run at 4P: best + 3 seed personalities chosen round-robin
  for (let s = 0; s < holdoutSeeds; s++) {
    const opps = [holdoutGenomes[s % holdoutGenomes.length],
                  holdoutGenomes[(s + 1) % holdoutGenomes.length],
                  holdoutGenomes[(s + 2) % holdoutGenomes.length]];
    const seed = 7777771 + s * 17;
    const result = runGame([bestGenome, ...opps], 4, seed);
    total4P++;
    if (result.winner === 0) wins4P++;
  }

  return {
    winRate2P: total2P > 0 ? wins2P / total2P : 0,
    winRate4P: total4P > 0 ? wins4P / total4P : 0,
    seeds: holdoutSeeds,
  };
}

// ── OUTPUT FORMATTING ─────────────────────────────────────────────────────────

const SHORT = {
  bustThreshold2:  'bustT2',
  bustThreshold1:  'bustT1',
  dollarBuffer:    'dolBuf',
  cowWeight:       'cowW',
  dollarWeight:    'dolW',
  banditPenalty:   'bandPen',
  positionWeight:  'posW',
  denialWeight:    'denW',
  deckMemory:      'mem',
  lethalBias:      'bias',
  act1DollarBonus: 'a1dol',
  act3CowBonus:    'a3cow',
  revealBonus:     'rev',
  affordMult:      'aff',
};

function formatGenomeLine(rank, entry) {
  const parts = PARAM_KEYS.map(k => `${SHORT[k]}=${entry.genome[k].toFixed(2)}`).join(' ');
  return `  #${rank}  ${parts}  fit=${entry.fitness.toFixed(3)}`;
}

function printGenSummary(gen, rankedPop, quiet) {
  const best  = rankedPop[0].fitness;
  const mean  = rankedPop.reduce((s, r) => s + r.fitness, 0) / rankedPop.length;
  const worst = rankedPop[rankedPop.length - 1].fitness;
  const spread = best - worst;
  console.log(`Gen ${String(gen).padStart(3)} | best: ${best.toFixed(3)} | mean: ${mean.toFixed(3)} | worst: ${worst.toFixed(3)} | spread: ${spread.toFixed(3)}`);
  if (!quiet) {
    for (let i = 0; i < Math.min(5, rankedPop.length); i++) {
      console.log(formatGenomeLine(i + 1, rankedPop[i]));
    }
  }
}

function printFinalSummary(bestGenome, holdout, numGens) {
  console.log('\n' + '═'.repeat(43));
  console.log(`  Evolution complete — ${numGens} generations`);
  console.log(`  Best genome (holdout 2P: ${(holdout.winRate2P * 100).toFixed(1)}%, 4P: ${(holdout.winRate4P * 100).toFixed(1)}%):`);
  for (const key of PARAM_KEYS) {
    console.log(`    ${key.padEnd(16)} ${bestGenome[key].toFixed(2)}`);
  }
  console.log('═'.repeat(43));
}

// ── CLI PARSING ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const cfg = {
    popSize:          24,
    maxGenerations:   50,
    kSeeds:           30,
    eliteFrac:        0.25,
    mutationRate:     0.30,
    mutationStrength: 0.15,
    trials:           1,
    holdoutSeeds:     200,
    outDir:           path.join(__dirname, 'results'),
    resume:           null,
    quiet:            false,
    coevolve:         false,
    anchors:          'deputy,enforcer,drifter,rancher,prospector',
    hofSize:          8,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--pop':      cfg.popSize          = parseInt(args[++i]); break;
      case '--gens':     cfg.maxGenerations   = parseInt(args[++i]); break;
      case '--seeds':    cfg.kSeeds           = parseInt(args[++i]); break;
      case '--elite':    cfg.eliteFrac        = parseFloat(args[++i]); break;
      case '--mut-rate': cfg.mutationRate     = parseFloat(args[++i]); break;
      case '--mut-str':  cfg.mutationStrength = parseFloat(args[++i]); break;
      case '--trials':   cfg.trials           = parseInt(args[++i]); break;
      case '--holdout':  cfg.holdoutSeeds     = parseInt(args[++i]); break;
      case '--out':      cfg.outDir           = args[++i]; break;
      case '--resume':   cfg.resume           = args[++i]; break;
      case '--quiet':    cfg.quiet            = true; break;
      case '--coevolve': cfg.coevolve         = true; break;
      case '--anchors':  cfg.anchors          = args[++i]; break;
      case '--hof':      cfg.hofSize          = parseInt(args[++i]); break;
      case '--help':
        console.log(`
node sim/evolve.js [options]

  --pop       <n>    Population size per generation     (default: 24)
  --gens      <n>    Max generations                    (default: 50)
  --seeds     <n>    Games per matchup per player count (default: 30)
  --elite     <f>    Elite fraction kept unchanged      (default: 0.25)
  --mut-rate  <f>    Probability each param mutates     (default: 0.30)
  --mut-str   <f>    Mutation std dev as fraction of range (default: 0.15)
  --trials    <n>    Independent runs to compare        (default: 1)
  --holdout   <n>    Seeds for final holdout validation (default: 200)
  --out       <dir>  Output directory                   (default: sim/results/)
  --resume    <file> Resume from a previous JSON checkpoint
  --quiet            Suppress per-generation genome detail

 Competitive coevolution (Phase 2 — breed bots that beat STRONG play, not the whole field):
  --coevolve         Fitness = win-rate vs fixed anchors + Hall of Fame (not the evolving pop)
  --anchors   <list> Comma-separated anchor personalities  (default: the 5 Hard bots)
  --hof       <n>    Hall-of-Fame size (past champions kept as opponents)  (default: 8)
`);
        process.exit(0);
    }
  }
  return cfg;
}

// ── SINGLE TRIAL ─────────────────────────────────────────────────────────────

function runTrial(cfg, trialIdx) {
  let population;
  let startGen = 1;
  const generationsLog = [];
  const fitnessHistory = [];

  if (cfg.resume && trialIdx === 0) {
    try {
      const checkpoint = JSON.parse(fs.readFileSync(cfg.resume, 'utf8'));
      population = checkpoint.generations[checkpoint.generations.length - 1].population
        || checkpoint.generations.map(g => g.bestGenome);
      startGen = checkpoint.generations.length + 1;
      generationsLog.push(...checkpoint.generations);
      console.log(`Resumed from ${cfg.resume} at generation ${startGen}`);
    } catch (e) {
      console.error('Failed to load checkpoint:', e.message);
      process.exit(1);
    }
  } else {
    // Generation 0: 6 seed genomes + random fill
    const seeds = SEED_GENOMES.map(g => {
      const clone = {};
      for (const k of PARAM_KEYS) clone[k] = g[k];
      return clone;
    });
    const randoms = Array.from({ length: cfg.popSize - seeds.length }, () => randomGenome());
    population = [...seeds, ...randoms].slice(0, cfg.popSize);
  }

  let bestGenome = null;

  for (let gen = startGen; gen <= cfg.maxGenerations; gen++) {
    process.stdout.write(`Trial ${trialIdx + 1} | `);
    const results = evaluateFitness(population, cfg.kSeeds, cfg.quiet);
    const rankedPop = results.sort((a, b) => b.fitness - a.fitness);

    printGenSummary(gen, rankedPop, cfg.quiet);
    fitnessHistory.push(rankedPop.map(r => ({ fitness: r.fitness })));

    bestGenome = rankedPop[0].genome;

    generationsLog.push({
      gen,
      bestFitness:  rankedPop[0].fitness,
      meanFitness:  rankedPop.reduce((s, r) => s + r.fitness, 0) / rankedPop.length,
      bestGenome:   { ...bestGenome },
      population:   rankedPop.map(r => ({ ...r.genome })),
    });

    if (checkConverged(fitnessHistory)) {
      console.log(`Converged at generation ${gen}.`);
      break;
    }

    if (gen < cfg.maxGenerations) {
      population = buildNextGeneration(rankedPop, cfg.eliteFrac, cfg.mutationRate, cfg.mutationStrength);
    }
  }

  console.log('Running holdout validation...');
  const holdout = runHoldout(bestGenome, cfg.holdoutSeeds);
  console.log(`Holdout: 2P=${(holdout.winRate2P * 100).toFixed(1)}%  4P=${(holdout.winRate4P * 100).toFixed(1)}%`);

  return { generationsLog, bestGenome, holdout };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  const cfg = parseArgs(process.argv);

  if (!fs.existsSync(cfg.outDir)) fs.mkdirSync(cfg.outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const trialResults = [];

  if (cfg.coevolve) {
    console.log(`Competitive coevolution — anchors: [${cfg.anchors}]  hof=${cfg.hofSize}  maxDraw(fixed)=${COEVOLVE_MAXDRAW}\n`);
  }

  for (let t = 0; t < cfg.trials; t++) {
    if (cfg.trials > 1) console.log(`\n${'─'.repeat(43)}\nTrial ${t + 1} / ${cfg.trials}\n`);
    const result = cfg.coevolve ? runCoevolveTrial(cfg, t) : runTrial(cfg, t);
    trialResults.push(result);
  }

  // Pick best trial by holdout win rate (average of 2P and 4P)
  trialResults.sort((a, b) => {
    const scoreA = (a.holdout.winRate2P + a.holdout.winRate4P) / 2;
    const scoreB = (b.holdout.winRate2P + b.holdout.winRate4P) / 2;
    return scoreB - scoreA;
  });

  const best = trialResults[0];
  const numGens = best.generationsLog.length;

  printFinalSummary(best.bestGenome, best.holdout, numGens);
  if (cfg.coevolve) {
    console.log(`    ${'maxDraw'.padEnd(16)} ${best.bestGenome.maxDraw ?? COEVOLVE_MAXDRAW}  (fixed)`);
    console.log(`  vs full field (tier context): 2P=${(best.vsField.winRate2P * 100).toFixed(1)}%  4P=${(best.vsField.winRate4P * 100).toFixed(1)}%`);
  }

  if (cfg.trials > 1) {
    console.log('\nAll trial holdouts:');
    trialResults.forEach((r, i) =>
      console.log(`  Trial ${i + 1}: anchors 2P=${(r.holdout.winRate2P * 100).toFixed(1)}% 4P=${(r.holdout.winRate4P * 100).toFixed(1)}%` +
        (cfg.coevolve ? `  | field 2P=${(r.vsField.winRate2P * 100).toFixed(1)}% 4P=${(r.vsField.winRate4P * 100).toFixed(1)}%` : ''))
    );
    console.log('\nGenome convergence check (top params across trials):');
    for (const key of PARAM_KEYS) {
      const vals = trialResults.map(r => r.bestGenome[key]);
      const range = Math.max(...vals) - Math.min(...vals);
      const paramRange = PARAM_RANGES[key].max - PARAM_RANGES[key].min;
      const pct = (range / paramRange * 100).toFixed(1);
      console.log(`  ${key.padEnd(16)} spread=${range.toFixed(3)} (${pct}% of range)`);
    }
  }

  const outFile = path.join(cfg.outDir, `evolve_${timestamp}.json`);
  const outData = {
    config: {
      popSize:          cfg.popSize,
      maxGenerations:   cfg.maxGenerations,
      kSeeds:           cfg.kSeeds,
      eliteFrac:        cfg.eliteFrac,
      mutationRate:     cfg.mutationRate,
      mutationStrength: cfg.mutationStrength,
    },
    generations: best.generationsLog.map(g => ({
      gen:         g.gen,
      bestFitness: g.bestFitness,
      meanFitness: g.meanFitness,
      bestGenome:  g.bestGenome,
    })),
    finalBest: best.bestGenome,
    holdout:   best.holdout,
    trials:    cfg.trials > 1 ? trialResults.map(r => ({ holdout: r.holdout, finalBest: r.bestGenome })) : undefined,
  };

  fs.writeFileSync(outFile, JSON.stringify(outData, null, 2));
  console.log(`\nResults written to ${outFile}`);
}

// Export the game engine + personality genomes for experiment harnesses (e.g.
// draw-cap-experiment.js). Only run the GA when invoked directly as a CLI.
module.exports = { runGame, SEED_GENOMES, PARAM_KEYS, PARAM_RANGES };

if (require.main === module) {
  main();
}
