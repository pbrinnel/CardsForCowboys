#!/usr/bin/env node
// sim/gen-golden.js — capture a frozen snapshot of runGame's output for the B0 reproduction
// gate. RUN THIS AGAINST THE PRE-REFACTOR ENGINE; the refactored engine must reproduce it
// bit-for-bit (see test-resume-reproduction.js).
//
// Writes sim/fixtures/golden-runGame.json: for a fixed matrix of lineups × player counts ×
// seeds, the full result of runGame (herds, winner, busts, drawRounds, collections). The
// lineups are chosen to exercise the full card/special space (aggressive bots draw deep and
// trigger copy_next/draw4/burn_to_use/look3/replay/extra_buy/swap across acts 2–3; the 4P
// lineup pulls in the 4+P-only cards).
//
// Usage: node sim/gen-golden.js   (regenerate only if card stats / engine semantics legitimately change)
'use strict';

const engine = require('./personality-engine');
const { byName } = require('./personalities');
const fs = require('fs');
const path = require('path');

// (numPlayers, [names], seedCount). Seeds are 1..seedCount.
const MATRIX = [
  { players: 2, names: ['enforcer', 'rancher'] },
  { players: 2, names: ['wild_bill', 'outlaw'] },     // aggressive: deep draws, many specials
  { players: 2, names: ['deputy', 'banker'] },        // denial + dollar-first
  { players: 2, names: ['greenhorn', 'drifter'] },
  { players: 2, names: ['prospector', 'sheriff'] },
  { players: 3, names: ['enforcer', 'outlaw', 'banker'] },
  { players: 3, names: ['rancher', 'wild_bill', 'deputy'] },
  { players: 4, names: ['enforcer', 'rancher', 'outlaw', 'wild_bill'] },  // 4+P cards: swap/copy
  { players: 4, names: ['deputy', 'drifter', 'prospector', 'banker'] },
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
      busts: r.busts,
      drawRounds: r.drawRounds,
      collections: r.collections,
    });
  }
  entries.push({ players: cell.players, names: cell.names, seeds: SEEDS, games });
}

const out = { schema: 1, seeds: SEEDS, matrix: MATRIX, entries };
const dir = path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'golden-runGame.json');
fs.writeFileSync(file, JSON.stringify(out));
const bytes = fs.statSync(file).size;
console.log(`Wrote ${file} — ${MATRIX.length} lineups × ${SEEDS} seeds = ${MATRIX.length * SEEDS} games, ${(bytes / 1024).toFixed(0)} KB`);
