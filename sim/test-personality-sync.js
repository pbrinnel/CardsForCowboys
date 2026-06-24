#!/usr/bin/env node
// sim/test-personality-sync.js — guards the ONE drift that silently rots AI tuning:
// sim/personalities.js (what the sim tunes) vs src/play.js AI_PERSONALITIES (what ships).
//
// Run: node sim/test-personality-sync.js   (exit 0 = in sync, 1 = drift). Wire into CI/pre-push.
'use strict';

const fs = require('fs');
const path = require('path');
const { byName } = require('./personalities');

const PLAY = path.join(__dirname, '..', 'src', 'play.js');
const CANON = ['sheriff', 'wild_bill', 'rancher', 'banker', 'outlaw', 'deputy',
  'greenhorn', 'prospector', 'drifter', 'enforcer'];
// Numeric params that must match exactly (shared names between play.js + personalities.js).
const NUMERIC = ['bustThreshold2', 'bustThreshold1', 'dollarBuffer', 'cowWeight', 'dollarWeight',
  'banditPenalty', 'positionWeight', 'deckMemory', 'lethalBias', 'affordMult',
  'act1DollarBonus', 'act3CowBonus', 'revealBonus'];

// Extract the AI_PERSONALITIES object literal from play.js by brace-matching (comments stripped).
function extractShipped() {
  const src = fs.readFileSync(PLAY, 'utf8');
  const m = src.indexOf('const AI_PERSONALITIES = {');
  if (m < 0) { console.error('FAIL: could not find AI_PERSONALITIES in play.js'); process.exit(1); }
  const from = src.indexOf('{', m);
  const noComments = src.slice(from).replace(/\/\/[^\n]*/g, ''); // strip line comments
  let depth = 0, end = -1;
  for (let i = 0; i < noComments.length; i++) {
    if (noComments[i] === '{') depth++;
    else if (noComments[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const objText = noComments.slice(0, end);
  // eslint-disable-next-line no-new-func — trusted local source, pure object literal
  return new Function('return (' + objText + ')')();
}

function main() {
  const shipped = extractShipped();
  const errors = [];

  for (const name of CANON) {
    const live = shipped[name];
    const sim = byName[name];
    if (!live) { errors.push(`${name}: missing from play.js AI_PERSONALITIES`); continue; }
    if (!sim)  { errors.push(`${name}: missing from sim/personalities.js`); continue; }

    for (const k of NUMERIC) {
      if (live[k] !== sim[k]) errors.push(`${name}.${k}: play.js=${live[k]} vs personalities.js=${sim[k]}`);
    }
    // maxDraw: play.js absent => 7
    const liveMax = live.maxDraw ?? 7;
    if (liveMax !== sim.maxDraw) errors.push(`${name}.maxDraw: play.js=${liveMax} vs personalities.js=${sim.maxDraw}`);
    // denialBurn (bool) <-> denialWeight (>=0.5)
    const liveDenial = !!live.denialBurn;
    const simDenial = sim.denialWeight >= 0.5;
    if (liveDenial !== simDenial) errors.push(`${name}.denial: play.js denialBurn=${liveDenial} vs personalities.js denialWeight=${sim.denialWeight}`);
  }

  if (errors.length) {
    console.error(`✗ personality sync FAILED (${errors.length}):`);
    errors.forEach(e => console.error('  ' + e));
    console.error('\nFix: update sim/personalities.js (and evolve seeds flow from it) to match play.js, or vice-versa.');
    process.exit(1);
  }
  console.log(`✓ personality sync OK — all ${CANON.length} canonical bots match play.js (${NUMERIC.length + 2} params each).`);
}

main();
