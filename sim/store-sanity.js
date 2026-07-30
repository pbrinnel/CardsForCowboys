#!/usr/bin/env node
// sim/store-sanity.js — STRUCTURAL report on the single-Store engine (R2 gate of
// sim/CARD_REBALANCE_PLAN.md). Run it before trusting any card or tier number.
//
// Why it exists: the single-Store port's failure modes are SILENT. A subtly wrong brick offset,
// an off-by-one act tier, or a pool that quietly runs short does not throw — it just produces a
// slightly different game, and every downstream win% inherits the error with no visible symptom.
// This report makes the structure itself observable, and asserts the invariants that a geometry
// bug would violate.
//
// Usage:
//   node sim/store-sanity.js                 # 300 games per player count, 2-8P
//   node sim/store-sanity.js --games 1000
//   node sim/store-sanity.js --players 2,4   # only these counts
'use strict';

const engine = require('./personality-engine');
const core = require('./game-core');
const { GENOMES, byName } = require('./personalities');

const ALL = GENOMES.map(g => g.name);

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { games: 300, players: [2, 3, 4, 5, 6, 7, 8] };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--games') o.games = parseInt(a[++i], 10);
    else if (a[i] === '--players') o.players = a[++i].split(',').map(s => parseInt(s.trim(), 10));
  }
  return o;
}

// A mixed field so the report isn't an artefact of one bot's style.
function lineupFor(np, seed) {
  return Array.from({ length: np }, (_, k) => byName[ALL[(seed * 7 + k * 3) % ALL.length]]);
}

const pct = x => (x * 100).toFixed(1) + '%';
function quantiles(sorted) {
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { min: sorted[0], p10: q(0.10), med: q(0.50), p90: q(0.90), max: sorted[sorted.length - 1] };
}

const errors = [];
function assert(cond, msg) { if (!cond) errors.push(msg); }

function run(np, games) {
  const expectRows  = np <= 4 ? 6 : 9;
  const expectWidth = core.STORE_WIDTH[np];
  const expectTotal = expectRows * expectWidth;
  const depIds = new Set(core.STORE_CARDS.filter(c => c.deprecated).map(c => c.id));

  const rounds = [], herds = [], deckSizes = [];
  let buys = 0, burns = 0, extras = 0, removedTotal = 0;
  let reached2 = 0, reached3 = 0, emptied = 0, ties = 0;
  // first round in which any card of each row was taken — proxy for when a row opens up
  const rowFirstTaken = Array.from({ length: expectRows }, () => []);
  const rowTakeRound  = Array.from({ length: expectRows }, () => ({ sum: 0, n: 0 }));
  const bustBySeat = {}, drawBySeat = {};

  for (let s = 1; s <= games; s++) {
    const lineup = lineupFor(np, s);
    const seen = new Set();

    engine.setBuyObserver(ev => {
      if (ev.action === 'buy') buys++; else burns++;
      if (ev.extra) extras++;
      removedTotal++;
      rowTakeRound[ev.row].sum += ev.round; rowTakeRound[ev.row].n++;
      if (!seen.has(ev.row)) { seen.add(ev.row); rowFirstTaken[ev.row].push(ev.round); }
      assert(!depIds.has(ev.card.id), `${np}P seed ${s}: DEPRECATED card ${ev.card.id} reached the Store`);
    });

    const st = engine.createInitialState(lineup, np, s);
    // Structural assertions on the freshly built Store, before a single card moves.
    engine.continueGame(st, lineup, 'endOfRound');
    const pyr = st.pyramid;
    assert(pyr.length === expectRows, `${np}P: ${pyr.length} rows, expected ${expectRows}`);
    assert(pyr.every(r => r.length === expectWidth), `${np}P: ragged rows (expected all ${expectWidth} wide)`);
    assert(pyr.flat().length === expectTotal, `${np}P: ${pyr.flat().length} cards, expected ${expectTotal}`);
    for (let r = 0; r < pyr.length; r++) {
      const want = core.rowAct(pyr, r);
      assert(pyr[r].every(sl => sl.card.act === want), `${np}P: row ${r} holds a card from the wrong act tier (expected act ${want})`);
    }
    const perTier = [1, 2, 3].map(a => pyr.flat().filter(sl => sl.card.act === a).length);
    assert(perTier.every(n => n === expectTotal / 3),
      `${np}P: act tiers uneven — got ${perTier.join('/')}, expected ${expectTotal / 3} each`);

    while (st.phase !== 'done') engine.continueGame(st, lineup, 'endOfRound');
    engine.setBuyObserver(null);

    const res = engine.gameResult(st, { detail: true });
    rounds.push(res.rounds);
    if (res.tie) ties++;
    if (core.isPyramidEmpty(st.pyramid)) emptied++;
    st.players.forEach((p, i) => {
      herds.push(p.herd);
      deckSizes.push(p.deck.length + p.discard.length + p.hand.length);
      bustBySeat[i] = (bustBySeat[i] || 0) + res.busts[i];
      drawBySeat[i] = (drawBySeat[i] || 0) + res.drawRounds[i];
    });
    // Every game must consume the whole Store — that IS the end condition.
    assert(core.isPyramidEmpty(st.pyramid), `${np}P seed ${s}: game ended with cards left in the Store`);
    // Stage coverage
    reached2++; // stage 1 always reached; recomputed below from row data
  }

  rounds.sort((a, b) => a - b);
  const q = quantiles(rounds);
  const avgHerd = herds.reduce((a, b) => a + b, 0) / herds.length;
  const avgDeck = deckSizes.reduce((a, b) => a + b, 0) / deckSizes.length;
  const totalBust = Object.values(bustBySeat).reduce((a, b) => a + b, 0);
  const totalDraw = Object.values(drawBySeat).reduce((a, b) => a + b, 0);

  console.log(`\n${np}P — ${games} games, Store ${expectRows}×${expectWidth} = ${expectTotal} cards`);
  console.log(`  rounds/game     min ${q.min}  p10 ${q.p10}  median ${q.med}  p90 ${q.p90}  max ${q.max}`);
  console.log(`  Store removal   ${pct(buys / removedTotal)} bought / ${pct(burns / removedTotal)} burned` +
    `   (${(removedTotal / games).toFixed(1)} cards/game, ${(removedTotal / games / q.med).toFixed(2)} per round)`);
  console.log(`  extra buys      ${(extras / games).toFixed(2)} per game`);
  console.log(`  fully emptied   ${pct(emptied / games)}   (must be 100% — it is the end condition)`);
  console.log(`  per player      final collection ${avgDeck.toFixed(1)} cards  ·  herd ${avgHerd.toFixed(1)}`);
  console.log(`  bust rate       ${pct(totalBust / totalDraw)} of drawn rounds`);
  console.log(`  row first taken (round a row's first card leaves — front row is ${expectRows - 1}):`);
  const parts = [];
  for (let r = expectRows - 1; r >= 0; r--) {
    const arr = rowFirstTaken[r].slice().sort((a, b) => a - b);
    const med = arr.length ? quantiles(arr).med : '—';
    parts.push(`r${r}(act${core.rowAct({ length: expectRows }, r)})=${med}`);
  }
  console.log('    ' + parts.join('  '));
  return { np, ties, games };
}

function main() {
  const o = parseArgs();
  console.log('Cards For Cowboys — Store structural sanity (single-Store engine)');
  console.log(`Mixed field of all ${ALL.length} bots, rotating by seed.`);
  const tieRows = [];
  for (const np of o.players) {
    if (np < 2 || np > 8) { console.error(`skipping players=${np} (2-8 only)`); continue; }
    tieRows.push(run(np, o.games));
  }

  console.log('\nShowdown ties (after the full cows → $ → card-count ladder):');
  for (const t of tieRows) console.log(`  ${t.np}P  ${pct(t.ties / t.games)}`);

  if (errors.length) {
    const uniq = [...new Set(errors)];
    console.error(`\n✗ ${errors.length} STRUCTURAL FAILURE(S) (${uniq.length} distinct):`);
    uniq.slice(0, 20).forEach(e => console.error('  ' + e));
    process.exit(1);
  }
  console.log('\n✓ All structural invariants hold: row/width/total per count, act tiers exact and');
  console.log('  even, no deprecated card ever dealt, and every game consumes the whole Store.');
}

main();
