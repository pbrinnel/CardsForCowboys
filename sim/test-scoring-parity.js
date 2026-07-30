#!/usr/bin/env node
// sim/test-scoring-parity.js — guards the THIRD drift class: the SCORING RULES themselves.
//
// test-card-sync.js guards card stats and test-personality-sync.js guards AI parameters, but
// nothing guarded how points are actually awarded — and that is where the worst kind of drift
// hides, because a wrong scoring rule produces perfectly plausible-looking numbers.
//
// The bug this exists to prevent (found July 2026): sim/personality-engine.js's applyShowdown
// added `floor(totalDollars / 2)` bonus cows at the showdown. **The live game has never had any
// $-to-herd conversion.** Dollars are purchasing power during play and are worth zero at the end.
// The phantom bonus inflated the measured value of all 21 dollar-bearing cards, and the error was
// invisible: every downstream table still looked reasonable.
//
// Two levels of checking:
//   1. SOURCE PARITY — read play.js's actual showdown/round-scoring expressions and assert they
//      award what the sim awards (in particular: showdown must not reference dollars).
//   2. BEHAVIOURAL — run applyShowdown/scoreRound on crafted fixtures with known answers.
//
// Run: node sim/test-scoring-parity.js   (exit 0 = pass, 1 = drift)
'use strict';

const fs = require('fs');
const path = require('path');
const engine = require('./personality-engine');

const PLAY = path.join(__dirname, '..', 'src', 'play.js');
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); } else { console.error(`  ✗ ${msg}`); failures++; }
  return cond;
}

// ── 1. SOURCE PARITY ─────────────────────────────────────────────────────────
function sourceParity() {
  const src = fs.readFileSync(PLAY, 'utf8');

  // Isolate play.js's showdown scoring loop.
  const at = src.indexOf('G.showdownTallies = [];');
  if (at < 0) { console.error('  ✗ could not locate the showdown scoring block in play.js'); failures++; return; }
  const block = src.slice(at, at + 1200).replace(/\/\/[^\n]*/g, '');   // strip comments

  const awardsCows = /totalCows\s*=\s*allCards\.reduce/.test(block);
  check(awardsCows, 'play.js showdown sums printed Cows across the collection');

  // The load-bearing assertion: no dollar term anywhere in the awarding of herd.
  const herdLine = /player\.herd\s*=\s*player\.herd\s*\+\s*totalCows\s*;/.test(block);
  check(herdLine, 'play.js showdown awards herd = herd + totalCows, with NO other term');

  const mentionsDollars = /dollars/.test(block);
  check(!mentionsDollars, 'play.js showdown scoring does NOT reference dollars (no $-to-herd conversion)');

  // And the sim must match: its applyShowdown must not mention dollars either.
  const simSrc = fs.readFileSync(path.join(__dirname, 'personality-engine.js'), 'utf8');
  const simAt = simSrc.indexOf('function applyShowdown');
  const simBlock = simSrc.slice(simAt, simSrc.indexOf('\n}', simAt)).replace(/\/\/[^\n]*/g, '');
  check(!/dollars/.test(simBlock), 'sim applyShowdown does NOT reference dollars');
  check(/Math\.max\(0,\s*c\.cows/.test(simBlock), 'sim applyShowdown clamps negative Cows PER CARD, as play.js does');

  // Round scoring: herd += roundCows, floored at 0, only when not busted.
  const rsAt = src.indexOf('async function scoreRound()');
  const rsBlock = src.slice(rsAt, rsAt + 700).replace(/\/\/[^\n]*/g, '');
  check(/!player\.busted\s*&&\s*player\.roundCows\s*!==\s*0/.test(rsBlock),
    'play.js scoreRound banks cows only for non-busted players');
  check(/Math\.max\(0,\s*player\.herd\s*\+\s*player\.roundCows\)/.test(rsBlock),
    'play.js scoreRound floors the herd at 0');
  check(!/roundDollars/.test(rsBlock), 'play.js scoreRound does NOT bank dollars');
}

// ── 2. BEHAVIOURAL ───────────────────────────────────────────────────────────
const mkCard = (o) => ({ uid: Math.random(), id: 'card_x', dollars: 0, cows: 0, bandits: 0, cacti: 1, cost: 0, special: null, act: 1, ...o });
const mkPlayer = (o) => ({
  name: 'P', deck: [], discard: [], hand: [], herd: 0,
  roundDollars: 0, roundCows: 0, roundBandits: 0, busted: false, stoppedDrawing: false,
  copyNextActive: false, copyNextCard: null, copyNextDonor: null,
  hasBuyBurnFirst: false, hasExtraBuy: false, extraBuyUsed: false, ...o,
});

function behavioural() {
  // A pile of pure cash must be worth exactly NOTHING at the showdown.
  {
    const p = mkPlayer({ herd: 10, deck: [mkCard({ dollars: 4 }), mkCard({ dollars: 3 }), mkCard({ dollars: 9 })] });
    engine.applyShowdown([p]);
    check(p.herd === 10, `$16 across the collection adds 0 herd at showdown (got ${p.herd}, want 10)`);
  }
  // Cows are counted from all three piles.
  {
    const p = mkPlayer({ herd: 5, deck: [mkCard({ cows: 2 })], discard: [mkCard({ cows: 3 })], hand: [mkCard({ cows: 1 })] });
    engine.applyShowdown([p]);
    check(p.herd === 11, `cows counted across deck+discard+hand (got ${p.herd}, want 11)`);
  }
  // Mixed card: only the cow half scores.
  {
    const p = mkPlayer({ herd: 0, deck: [mkCard({ cows: 2, dollars: 8 })] });
    engine.applyShowdown([p]);
    check(p.herd === 2, `a 2-cow/$8 card scores 2 (got ${p.herd}, want 2)`);
  }
  // Negative cows clamp per card rather than dragging the total down.
  {
    const p = mkPlayer({ herd: 0, deck: [mkCard({ cows: -5 }), mkCard({ cows: 3 })] });
    engine.applyShowdown([p]);
    check(p.herd === 3, `a -5-cow card is clamped to 0, not subtracted (got ${p.herd}, want 3)`);
  }
  // Round scoring: busted banks nothing; dollars never bank.
  {
    const a = mkPlayer({ herd: 4, roundCows: 3, roundDollars: 7 });
    const b = mkPlayer({ herd: 4, roundCows: 3, busted: true });
    engine.scoreRound([a, b]);
    check(a.herd === 7, `non-busted banks roundCows only, not dollars (got ${a.herd}, want 7)`);
    check(b.herd === 4, `busted player banks nothing (got ${b.herd}, want 4)`);
  }
  // Tiebreak DOES use dollars — that is a tiebreak, not scoring, and must stay.
  {
    const rich = mkPlayer({ herd: 20, deck: [mkCard({ dollars: 9 })] });
    const poor = mkPlayer({ herd: 20, deck: [mkCard({ dollars: 0 })] });
    const { winners, reason } = engine.resolveShowdownWinners([rich, poor]);
    check(winners.length === 1 && winners[0] === 0 && reason === 'most $',
      `a tied herd still breaks on most $ (got winners=[${winners}] reason="${reason}")`);
  }
}

console.log('Scoring parity — sim vs play.js award rules\n');
console.log('Source parity:');
sourceParity();
console.log('\nBehavioural:');
behavioural();

if (failures) {
  console.error(`\n✗ SCORING PARITY FAILED (${failures}). The sim is not awarding points the way the`);
  console.error('  game does, so every win-rate and card-balance number it produces is invalid.');
  process.exit(1);
}
console.log('\n✓ Scoring parity OK — dollars do not score at the showdown, in either engine.');
