#!/usr/bin/env node
// sim/test-card-sync.js — guards the OTHER drift that silently rots card-balance work:
// sim/game-core.js's card DB (what the sim deals) vs src/card-db.js's (what ships).
//
// Why this exists: through the July 2026 single-Store rework, card_84 / card_85 were reworked
// live (`-1 cow` → `0 cow` + `draw4`) and the sim was never updated. Nothing failed; every
// card number the sim produced was just quietly wrong. Same failure mode as personality drift,
// same fix — a guard that fails loudly.
//
// Run: node sim/test-card-sync.js   (exit 0 = in sync, 1 = drift). Wire into CI/pre-push.
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./game-core');

// The shipped card DB. Lived in src/play.js until August 2026, when it moved to src/card-db.js
// so cardslist.html could share it — this guard follows the data, not the file it used to be in.
const PLAY = path.join(__dirname, '..', 'src', 'card-db.js');

// Stat fields that must match exactly. `img` is play.js-only (the sim is headless) and is
// deliberately NOT compared. `minPlayers` is retired and must appear in neither DB.
const STORE_FIELDS   = ['act', 'dollars', 'cows', 'bandits', 'cost', 'cacti', 'special', 'deprecated'];
const STARTER_FIELDS = ['dollars', 'cows', 'bandits', 'cacti', 'count'];

// Extract an array literal from card-db.js by bracket-matching (line comments stripped first —
// both card arrays carry `// --- ACT n ---` section headers).
function extractArray(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) { console.error(`FAIL: could not find ${decl} in src/card-db.js`); process.exit(1); }
  const from = src.indexOf('[', at);
  const noComments = src.slice(from).replace(/\/\/[^\n]*/g, '');
  let depth = 0, end = -1;
  for (let i = 0; i < noComments.length; i++) {
    if (noComments[i] === '[') depth++;
    else if (noComments[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  // eslint-disable-next-line no-new-func — trusted local source, pure array literal
  return new Function('return (' + noComments.slice(0, end) + ')')();
}

// Normalize so an absent flag and an explicit false compare equal.
function norm(v, field) {
  if (field === 'deprecated') return !!v;
  if (field === 'special') return v || null;
  return v;
}

function diffSet(label, liveArr, simArr, fields) {
  const errors = [];
  const liveById = new Map(liveArr.map(c => [c.id, c]));
  const simById  = new Map(simArr.map(c => [c.id, c]));

  for (const id of liveById.keys()) {
    if (!simById.has(id)) errors.push(`${label} ${id}: in card-db.js, MISSING from game-core.js`);
  }
  for (const id of simById.keys()) {
    if (!liveById.has(id)) errors.push(`${label} ${id}: in game-core.js, MISSING from card-db.js`);
  }
  for (const [id, live] of liveById) {
    const sim = simById.get(id);
    if (!sim) continue;
    for (const f of fields) {
      const a = norm(live[f], f), b = norm(sim[f], f);
      if (a !== b) errors.push(`${label} ${id}.${f}: card-db.js=${a} vs game-core.js=${b}`);
    }
    if ('minPlayers' in live || 'minPlayers' in sim) {
      errors.push(`${label} ${id}: retired field \`minPlayers\` is still present`);
    }
  }
  return errors;
}

function main() {
  const src = fs.readFileSync(PLAY, 'utf8');
  const liveStore    = extractArray(src, 'const STORE_CARDS = [');
  const liveStarters = extractArray(src, 'const STARTER_TEMPLATES = [');

  const errors = [
    ...diffSet('store',   liveStore,    core.STORE_CARDS,       STORE_FIELDS),
    ...diffSet('starter', liveStarters, core.STARTER_TEMPLATES, STARTER_FIELDS),
  ];

  // Structural invariant the Store build depends on: exactly 18 live cards per act. buildPyramid
  // slices rowsPerTier() * width from each act pool (18 at 4P — the whole pool), so a short act
  // pool silently deals a Store with holes instead of failing.
  const live = core.STORE_CARDS.filter(c => !c.deprecated);
  for (const act of [1, 2, 3]) {
    const n = live.filter(c => c.act === act).length;
    if (n !== 18) errors.push(`act ${act}: ${n} live cards, expected exactly 18`);
  }

  if (errors.length) {
    console.error(`✗ card sync FAILED (${errors.length}):`);
    errors.forEach(e => console.error('  ' + e));
    console.error('\nFix: regenerate sim/game-core.js\'s STORE_CARDS from src/card-db.js (mechanically —');
    console.error('do not hand-edit), or correct card-db.js if the sim is the one that is right.');
    process.exit(1);
  }
  console.log(`✓ card sync OK — ${core.STORE_CARDS.length} store cards (${live.length} live, 18/act) ` +
    `+ ${core.STARTER_TEMPLATES.length} starters match card-db.js.`);
}

main();
