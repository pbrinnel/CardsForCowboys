#!/usr/bin/env node
// sim/gen-golden.js — capture a frozen snapshot of runGame's output for the reproduction gate
// in test-resume-reproduction.js. The golden is the ANCHOR: once written, any unintended change
// to engine semantics or card stats shows up as a divergence.
//
// Writes sim/fixtures/golden-runGame.json: for a fixed matrix of lineups × player counts ×
// seeds, the full result of runGame (herds, winner/winners/tie, rounds, busts, drawRounds,
// collections).
//
// REGENERATE ONLY when card stats or engine semantics legitimately change — and understand that
// doing so DISCARDS the old anchor. Regenerating to "fix" a failing gate you did not intend to
// break is how a real regression gets laundered into the baseline.
//
// Regenerated July 2026 for the single-Store rework (`gameV` 3): one Store with act tiers, brick
// geometry, monotonic rounds ending on Store-empty, no between-act reshuffle, the 54-live card
// pool, and the resolveShowdownWinners tiebreak. The prior golden froze the retired triangle
// board and is not comparable. Lineups span the bot space; only two specials survive the cull
// (`burn_to_use`, `draw4`), so "exercise every special" is no longer a selection criterion —
// player-count coverage is, because the Store's width/rows/pool-doubling all key off it.
//
// Usage: node sim/gen-golden.js
'use strict';

const engine = require('./personality-engine');
const { byName } = require('./personalities');
const fs = require('fs');
const path = require('path');

// (numPlayers, [names]). Seeds are 1..SEEDS.
const MATRIX = [
  { players: 2, names: ['enforcer', 'rancher'] },
  { players: 2, names: ['wild_bill', 'outlaw'] },     // aggressive: deep draws, high bust
  { players: 2, names: ['deputy', 'banker'] },        // denial + dollar-first
  { players: 2, names: ['greenhorn', 'drifter'] },
  { players: 2, names: ['prospector', 'sheriff'] },
  { players: 3, names: ['enforcer', 'outlaw', 'banker'] },
  { players: 3, names: ['rancher', 'wild_bill', 'deputy'] },
  { players: 4, names: ['enforcer', 'rancher', 'outlaw', 'wild_bill'] },
  { players: 4, names: ['deputy', 'drifter', 'prospector', 'banker'] },
  // 5-8P: 9 rows and a DOUBLED act pool (ids repeat, uids don't) — a code path the sim could
  // not reach before the single-Store port, so freeze it.
  { players: 5, names: ['enforcer', 'rancher', 'outlaw', 'banker', 'deputy'] },
  { players: 6, names: ['enforcer', 'rancher', 'outlaw', 'wild_bill', 'deputy', 'drifter'] },
  { players: 8, names: ['enforcer', 'rancher', 'outlaw', 'wild_bill', 'deputy', 'drifter', 'sheriff', 'greenhorn'] },
];
const SEEDS = 150;

const entries = [];
for (const cell of MATRIX) {
  const genomes = cell.names.map(n => byName[n]);
  const games = [];
  for (let s = 1; s <= SEEDS; s++) {
    const r = engine.runGame(genomes, cell.players, s, { detail: true });
    games.push({
      herds: r.herds,
      winner: r.winner,
      winners: r.winners,
      tie: r.tie,
      rounds: r.rounds,
      busts: r.busts,
      drawRounds: r.drawRounds,
      collections: r.collections,
    });
  }
  entries.push({ players: cell.players, names: cell.names, seeds: SEEDS, games });
}

const out = { schema: 2, gameV: 3, generated: new Date().toISOString(), seeds: SEEDS, matrix: MATRIX, entries };
const dir = path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'golden-runGame.json');
fs.writeFileSync(file, JSON.stringify(out));
const bytes = fs.statSync(file).size;
console.log(`Wrote ${file} — ${MATRIX.length} lineups × ${SEEDS} seeds = ${MATRIX.length * SEEDS} games, ${(bytes / 1024).toFixed(0)} KB`);
