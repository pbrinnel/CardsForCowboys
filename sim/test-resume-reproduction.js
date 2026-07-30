#!/usr/bin/env node
// sim/test-resume-reproduction.js — B0 acceptance gate for the resumable simulator
// (AI_SEARCH_BAKEOFF_PLAN.md §4a). Proves the refactored engine still plays the exact same
// games as the pre-refactor monolith, and that cloneState / continueGame are correct and
// side-effect-free. If any check here fails, every downstream search measurement is garbage.
//
//   1. GOLDEN REGRESSION  — new runGame ≡ frozen golden (fixtures/golden-runGame.json) bit-for-bit.
//   2. ROUND-GRANULAR      — stepping continueGame(endOfRound) to 'done' ≡ runGame.
//   3. STAGE-GRANULAR      — stepping continueGame(endOfStage) to 'done' ≡ runGame.
//   4. CLONE INDEPENDENCE  — clone mid-game → finish clone ≡ runGame; AND the ORIGINAL,
//                            finished after cloning, still ≡ runGame (no RNG bleed, no aliasing).
//   5. MID-BUY RESUMPTION  — clone with buyCursor > 0 (the search's real use) finishes ≡ runGame.
//   6. CLONE COPY-NEXT     — clonePlayer re-points copyNextCard/copyNextDonor at the CLONE's cards.
//
// Run: node sim/test-resume-reproduction.js   (exit 0 = pass, 1 = fail)
'use strict';

const engine = require('./personality-engine');
const { byName } = require('./personalities');
const core = require('./game-core');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  return cond;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Compare two runGame-style results. `winners`/`tie` cover the showdown tiebreak ladder and
// `rounds` covers game length — both are engine semantics under the single Store (length is
// emergent from Store exhaustion), so a resume that silently changed either must fail here.
// Compared only when the reference carries them, so an older golden still loads.
function resultsEqual(a, b) {
  if (!(eq(a.herds, b.herds) && a.winner === b.winner &&
        eq(a.busts, b.busts) && eq(a.drawRounds, b.drawRounds) &&
        eq(a.collections || null, b.collections || null))) return false;
  if (b.winners !== undefined && !eq(a.winners, b.winners)) return false;
  if (b.tie     !== undefined && a.tie !== b.tie) return false;
  if (b.rounds  !== undefined && a.rounds !== b.rounds) return false;
  return true;
}

// Lineups spanning the bot space, used by the resume/clone checks. The 6P case covers the 9-row
// Store + doubled act pool, which 2-4P never exercises.
const CASES = [
  { players: 2, names: ['enforcer', 'rancher'] },
  { players: 2, names: ['wild_bill', 'outlaw'] },
  { players: 3, names: ['enforcer', 'outlaw', 'banker'] },
  { players: 4, names: ['enforcer', 'rancher', 'outlaw', 'wild_bill'] },
  { players: 4, names: ['deputy', 'drifter', 'prospector', 'banker'] },
  { players: 6, names: ['enforcer', 'rancher', 'outlaw', 'wild_bill', 'deputy', 'drifter'] },
];
const RESUME_SEEDS = 120;

// ── 1. GOLDEN REGRESSION (the gate) ──────────────────────────────────────────
function testGolden() {
  const file = path.join(__dirname, 'fixtures', 'golden-runGame.json');
  if (!fs.existsSync(file)) {
    console.error(`  ✗ golden fixture missing: ${file} (run: node sim/gen-golden.js on the reference engine)`);
    failures++; return;
  }
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  let games = 0, mism = 0;
  for (const entry of golden.entries) {
    const genomes = entry.names.map(n => byName[n]);
    for (let s = 0; s < entry.seeds; s++) {
      const r = engine.runGame(genomes, entry.players, s + 1, { detail: true });
      const g = entry.games[s];
      games++;
      if (!resultsEqual(r, g)) {
        if (mism < 3) console.error(`    mismatch ${entry.names.join('/')} ${entry.players}P seed ${s + 1}: got ${JSON.stringify(r.herds)} want ${JSON.stringify(g.herds)}`);
        mism++;
      }
    }
  }
  check(mism === 0, `golden regression: ${mism} / ${games} games diverged from frozen runGame snapshot`);
  if (mism === 0) console.log(`  ✓ golden regression — ${games} games reproduced bit-for-bit`);
}

// ── 2 & 3. HORIZON-GRANULAR RESUME ≡ runGame ─────────────────────────────────
function testHorizonResume(horizon, label) {
  let bad = 0, n = 0;
  for (const c of CASES) {
    const genomes = c.names.map(n => byName[n]);
    for (let seed = 1; seed <= RESUME_SEEDS; seed++) {
      const ref = engine.runGame(genomes, c.players, seed, { detail: true });
      const st = engine.createInitialState(genomes, c.players, seed);
      let guard = 0;
      while (st.phase !== 'done') {
        engine.continueGame(st, genomes, horizon);
        if (++guard > 1000) throw new Error('continueGame did not terminate');
      }
      const got = engine.gameResult(st, { detail: true });
      n++;
      if (!resultsEqual(ref, got)) { if (bad < 3) console.error(`    ${label} diverged: ${c.names.join('/')} seed ${seed}`); bad++; }
    }
  }
  check(bad === 0, `${label} resume: ${bad} / ${n} games diverged from runGame`);
  if (bad === 0) console.log(`  ✓ ${label} resume — ${n} games match runGame`);
}

// ── 4. CLONE INDEPENDENCE (clone finishes == ref; original unperturbed) ──────
function testCloneIndependence() {
  let bad = 0, n = 0, cloneChecks = 0;
  for (const c of CASES) {
    const genomes = c.names.map(nm => byName[nm]);
    for (let seed = 1; seed <= RESUME_SEEDS; seed++) {
      const ref = engine.runGame(genomes, c.players, seed, { detail: true });
      const st = engine.createInitialState(genomes, c.players, seed);
      let step = 0;
      // Walk round-by-round; at each pause point, fork a clone and finish it independently,
      // then keep walking the original. Both must land on the reference result.
      while (st.phase !== 'done') {
        engine.continueGame(st, genomes, 'endOfRound');
        if (st.phase === 'done') break;
        // Fork here (a live mid-game state: partial decks, removed pyramid cells, herds).
        if (step % 3 === 0) {
          const fork = engine.cloneState(st);
          engine.continueGame(fork, genomes, 'endOfGame');
          const forkRes = engine.gameResult(fork, { detail: true });
          if (!resultsEqual(ref, forkRes)) { if (bad < 3) console.error(`    clone fork diverged: ${c.names.join('/')} seed ${seed} step ${step}`); bad++; }
          cloneChecks++;
        }
        step++;
      }
      // The original, walked to the end AFTER all those forks, must still match ref
      // (forks must not perturb its RNG or alias its cards).
      const origRes = engine.gameResult(st, { detail: true });
      n++;
      if (!resultsEqual(ref, origRes)) { if (bad < 3) console.error(`    original perturbed by clones: ${c.names.join('/')} seed ${seed}`); bad++; }
    }
  }
  check(bad === 0, `clone independence: ${bad} failures (${cloneChecks} forks, ${n} originals checked)`);
  if (bad === 0) console.log(`  ✓ clone independence — ${cloneChecks} forks finished correctly, ${n} originals unperturbed`);
}

// ── 5. MID-BUY RESUMPTION (the search's real clone point: phase 'buy', buyCursor > 0) ──
// Mirror continueGame's pre-buy transitions (setup → draw) to obtain a buy-PAUSED state,
// process some buyers, fork, and confirm both fork and original finish ≡ runGame.
//
// ⚠️ This hand-mirrors continueGame's 'setup' and 'draw' phases and MUST stay in step with them,
// including which RNG draws they consume — an extra or missing seededShuffle here desynchronises
// the stream and every seed diverges from runGame. That is exactly what happened when the
// single-Store port removed the between-act deck merge and this helper kept doing it.
function freshToFirstBuy(genomes, np, seed) {
  const st = engine.createInitialState(genomes, np, seed);
  // 'setup': build the ONE Store. NO deck reshuffle — there is no between-act merge any more,
  // and createPlayerSeeded already seeded-shuffled each starter deck.
  st.pyramid = engine.buildPyramidSeeded(np, st.rng);
  st.round = 1;
  // 'draw': stage is latched at the round start (nothing leaves the Store during draws).
  st.stage = core.storeStage(st.pyramid);
  st.roundStartStage = st.stage;
  engine.runDrawPhase(st.players, genomes, st.pyramid, st.stage, st.rng);
  for (let i = 0; i < st.players.length; i++) {
    if (st.players[i].hand.length > 0) st.drawRounds[i]++;
    if (st.players[i].busted) st.busts[i]++;
  }
  st.buyOrder = engine.computeBuyOrder(st.players);
  st.buyCursor = 0; st.phase = 'buy';
  return st;
}
function testMidBuyResume() {
  let bad = 0, n = 0;
  for (const c of CASES) {
    const genomes = c.names.map(nm => byName[nm]);
    for (let seed = 1; seed <= RESUME_SEEDS; seed++) {
      const ref = engine.runGame(genomes, c.players, seed, { detail: true });
      const st = freshToFirstBuy(genomes, c.players, seed);
      // Process the first buyer "by hand" via the real primitive, advancing the cursor —
      // exactly how the search applies a candidate before resuming the rollout.
      if (st.buyOrder.length > 0 && !core.isPyramidEmpty(st.pyramid)) {
        const pIdx = st.buyOrder[st.buyCursor];
        engine.processBuyer(st.players[pIdx], genomes[pIdx], st.pyramid, st.stage, st.players);
        st.buyCursor++;
      }
      // Fork from the mid-buy state (buyCursor possibly > 0), finish both.
      const fork = engine.cloneState(st);
      engine.continueGame(fork, genomes, 'endOfGame');
      engine.continueGame(st, genomes, 'endOfGame');
      const forkRes = engine.gameResult(fork, { detail: true });
      const origRes = engine.gameResult(st, { detail: true });
      n++;
      if (!resultsEqual(ref, forkRes)) { if (bad < 3) console.error(`    mid-buy fork diverged: ${c.names.join('/')} seed ${seed}`); bad++; }
      if (!resultsEqual(ref, origRes)) { if (bad < 3) console.error(`    mid-buy original diverged: ${c.names.join('/')} seed ${seed}`); bad++; }
    }
  }
  check(bad === 0, `mid-buy resumption: ${bad} failures over ${n} seeds`);
  if (bad === 0) console.log(`  ✓ mid-buy resumption — ${n} seeds: fork & original both finish ≡ runGame`);
}

// ── 6. CLONE COPY-NEXT IDENTITY REMAP (unit) ─────────────────────────────────
// The clone trap: copyNextCard/copyNextDonor alias cards in hand/discard. After clone they
// must point at the CLONE's instances, not the originals.
function testCloneCopyNext() {
  const mk = (uid, special) => ({ uid, id: `card_${uid}`, dollars: 0, cows: 0, bandits: 0, cacti: 1, cost: 0, special: special || null, act: 2 });
  const copyCard = mk(101, 'copy_next');
  const donorCard = mk(102, 'burn_to_use');
  const handCard = mk(103, null);
  const discardCard = mk(104, null);
  const p = {
    name: 'X', personality: null,
    deck: [], discard: [discardCard], hand: [copyCard, donorCard, handCard],
    herd: 5, roundDollars: 2, roundCows: 1, roundBandits: 1,
    busted: false, stoppedDrawing: false,
    copyNextActive: true, copyNextCard: copyCard, copyNextDonor: donorCard,
    hasBuyBurnFirst: false, hasExtraBuy: true, extraBuyUsed: false,
  };
  const cl = engine.clonePlayer(p);
  // structural copy
  check(cl !== p && cl.hand !== p.hand && cl.hand[0] !== p.hand[0], 'clonePlayer deep-copies hand cards');
  check(cl.hand[0].uid === 101 && cl.discard[0].uid === 104, 'clonePlayer preserves card data');
  // identity remap: copyNext refs point at the CLONE's hand instances
  check(cl.copyNextCard === cl.hand[0], 'copyNextCard re-pointed to cloned hand card (not original)');
  check(cl.copyNextDonor === cl.hand[1], 'copyNextDonor re-pointed to cloned hand card (not original)');
  check(cl.copyNextCard !== p.copyNextCard, 'copyNextCard is NOT the original instance');
  // scalar/flag fidelity
  check(cl.copyNextActive === true && cl.hasExtraBuy === true && cl.herd === 5 && cl.roundBandits === 1, 'clonePlayer copies flags/scalars');
  // mutating the clone must not touch the original
  cl.hand[0].cows = 999; cl.herd = 0;
  check(p.hand[0].cows === 0 && p.herd === 5, 'mutating clone does not affect original');
  console.log('  ✓ clone copy-next identity remap + isolation');
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log('B0 reproduction gate — resumable simulator (cloneState / continueGame)\n');
testGolden();
testHorizonResume('endOfRound', 'round-granular');
testHorizonResume('endOfAct', 'act-granular');
testCloneIndependence();
testMidBuyResume();
testCloneCopyNext();

console.log('');
if (failures === 0) {
  console.log('✓ B0 GATE PASSED — the resumable core reproduces runGame bit-for-bit and clones cleanly.');
  process.exit(0);
} else {
  console.error(`✗ B0 GATE FAILED — ${failures} check(s) failed. Do NOT proceed to B1.`);
  process.exit(1);
}
