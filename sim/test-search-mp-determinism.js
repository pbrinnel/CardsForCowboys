#!/usr/bin/env node
// sim/test-search-mp-determinism.js — offline evidence that the flat-MC search is safe for
// human-v-human-v-AI MP (AI_SEARCH_BAKEOFF_PLAN.md §4c).
//
// Why this matters: the live game runs every AI on every client with NO broadcast, so an AI
// seat's decision must be byte-identical on all clients or MP desyncs. Clients DO share, via
// drawState, every opponent's hand/deck/discard as ORDERED card-id arrays (src/play.js
// pushDrawState ~L194) — but each client assigns its own local `uid`s. Therefore the search is
// MP-safe iff its decision depends ONLY on shared/derivable info (ids, array order, card stats,
// and the shared-seeded rollout RNG) and NEVER on uid values/order.
//
// Test: build a mid-game buy state, take the search's decision, then relabel every uid (ids and
// array ORDER preserved — modelling a second client) and confirm the decision is identical.
// We scramble uids hard (reversed + offset) to catch any hidden uid dependence.
//
// NOTE: this proves uid/representation-invariance (the determinism PREREQUISITE). It does NOT
// prove the live timing guarantee (that the final pre-buy drawState has propagated identically
// to every client before each runs the AI turn) — that's a live two-tab check in the ship phase.
//
// Run: node sim/test-search-mp-determinism.js   (exit 0 = pass)
'use strict';

const engine = require('./personality-engine');
const { byName } = require('./personalities');
const { makeSearchPolicy, searchChooseBuy } = require('./search-ai');

let failures = 0;
const check = (c, m) => { if (!c) { console.error(`  ✗ ${m}`); failures++; } return c; };

// Advance a fresh game to the first buy phase (mirrors continueGame's pre-buy steps), with the
// focal seat 0 a search policy and the rest pros. Returns { state, policy, livePolicies, focalIdx }.
function freshToFirstBuy(genomes, numPlayers, seed) {
  const st = engine.createInitialState(genomes, numPlayers, seed);
  for (const p of st.players) {
    const all = [...p.deck, ...p.discard, ...p.hand];
    p.deck = engine.seededShuffle(all, st.rng); p.discard = []; p.hand = [];
  }
  st.stage = 1; st.round = 1;
  st.pyramid = engine.buildPyramidSeeded(numPlayers, st.rng);
  engine.runDrawPhase(st.players, genomes, st.pyramid, 1, st.rng);
  st.buyOrder = engine.computeBuyOrder(st.players);
  st.buyCursor = 0; st.phase = 'buy';
  return st;
}

// Relabel every uid in the state IN PLACE (ids + array order untouched) — model a 2nd client.
// References (copyNextCard/copyNextDonor point at hand cards) stay valid since we mutate uid on
// the existing objects, not replace them.
function scrambleUids(state) {
  const cards = [];
  for (const p of state.players) { cards.push(...p.deck, ...p.discard, ...p.hand); }
  for (const row of state.pyramid) for (const slot of row) if (slot.card) cards.push(slot.card);
  // Hard scramble: assign in reverse with a big offset, so uid VALUES and their relative order
  // both differ from the original while ids/array order are preserved.
  let u = 9_000_000 + cards.length;
  for (const c of cards) { c.uid = u--; }
}

function decisionKey(d) { return `${d.action}:${d.row},${d.col}`; }

function run() {
  console.log('Search MP-determinism — uid/representation-invariance of the buy decision\n');

  // Search seat 0 vs a mix of pros, across player counts & seeds & a couple of configs.
  const lineups = [
    { np: 2, opps: ['enforcer'] },
    { np: 2, opps: ['wild_bill'] },
    { np: 3, opps: ['rancher', 'outlaw'] },
    { np: 4, opps: ['enforcer', 'drifter', 'banker'] },
  ];
  const configs = [
    { N: 32, horizon: 'endOfAct',  oppModel: 'perfect' },
    { N: 32, horizon: 'endOfGame', oppModel: 'default' },
  ];

  let checks = 0;
  for (const cfg of configs) {
    for (const lu of lineups) {
      for (let seed = 1; seed <= 30; seed++) {
        const policy = makeSearchPolicy({ ...cfg, defaultGenome: byName['enforcer'], drawGenome: byName['enforcer'] });
        const genomes = [policy, ...lu.opps.map(n => byName[n])];
        const st = freshToFirstBuy(genomes, lu.np, seed);
        if (st.players[0].busted) continue;                 // search seat busted → no buy decision
        const livePolicies = genomes;

        // Client A decision
        const dA = searchChooseBuy(st, 0, policy, livePolicies);
        // Client B: identical logical state, scrambled uids
        const stB = engine.cloneState(st);
        scrambleUids(stB);
        const policyB = makeSearchPolicy({ ...cfg, defaultGenome: byName['enforcer'], drawGenome: byName['enforcer'] });
        const livePoliciesB = [policyB, ...lu.opps.map(n => byName[n])];
        const dB = searchChooseBuy(stB, 0, policyB, livePoliciesB);

        checks++;
        if (!check(decisionKey(dA) === decisionKey(dB),
          `decision differs under uid relabel: ${lu.np}P ${lu.opps.join('/')} seed ${seed} cfg ${cfg.horizon}/${cfg.oppModel}: A=${decisionKey(dA)} B=${decisionKey(dB)}`)) {
          if (failures > 5) { console.error('  …stopping early'); return checks; }
        }
      }
    }
  }
  console.log(`  ✓ ${checks} buy decisions identical under hard uid relabeling (ids/order/stats + shared seed only)`);
  return checks;
}

run();
console.log('');
if (failures === 0) {
  console.log('✓ PASS — the search buy decision is uid/representation-invariant: it uses ONLY the');
  console.log('  information drawState makes identical across clients. This is the MP-determinism');
  console.log('  PREREQUISITE for human-v-human-v-AI. (Live timing of drawState propagation is the');
  console.log('  remaining check, verifiable only in a two-tab live test during the ship phase.)');
  process.exit(0);
} else {
  console.error(`✗ FAIL — ${failures} decision(s) depended on uid representation → would desync in MP.`);
  process.exit(1);
}
