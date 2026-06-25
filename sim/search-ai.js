#!/usr/bin/env node
// sim/search-ai.js — flat Monte-Carlo / 1-ply expectimax buy-phase AI (Route B, phase B1).
// Drops into the resumable engine (personality-engine.js) as a `__search` participant via the
// §8 dispatch seam — competes head-to-head with the parameter "pro" bots in the SAME arena.
//
// Algorithm (AI_SEARCH_BAKEOFF_PLAN.md §5) at the focal seat's buy turn:
//   1. Enumerate candidate primary actions: each affordable buy + top-K denial burns (branchCap).
//   2. For each candidate, run N rollouts: clone the live state, apply the focal's full turn
//      (the candidate primary + a defaultGenome bonus buy), give the clone its OWN seeded LCG,
//      then continueGame under default policies to `horizon`.
//   3. Value each rollout (herd-margin, §7) and average.
//   4. argmax candidate; deterministic tiebreak (defaultGenome scoreCard) for reproducibility.
//
// Opponent-model ablation (§6): oppModel 'perfect' → rollouts use opponents' TRUE genomes
// (upper bound); 'default' → opponents assumed to play the defaultGenome (the shippable,
// realistic model). The focal seat itself always plays the defaultGenome inside rollouts
// (no recursive search — §13).
//
// RNG hygiene (§4b): each rollout gets a fresh LCG seeded deterministically from the decision
// context; the live game's RNG is never advanced by the search (cloneState gives the clone an
// independent LCG, which we then overwrite). So search decisions are fully reproducible.
'use strict';

const engine = require('./personality-engine');
const core = require('./game-core');
const { byName } = require('./personalities');

// ── rollout seed: deterministic mix of the decision context ──────────────────
function rolloutSeed(base, act, round, slot, cand, roll) {
  let h = ((base >>> 0) || 1);
  h = Math.imul(h ^ (act   + 0x9e3779b1), 2654435761) >>> 0;
  h = Math.imul(h ^ (round + 0x85ebca77), 2654435761) >>> 0;
  h = Math.imul(h ^ (slot  + 0xc2b2ae3d), 2654435761) >>> 0;
  h = Math.imul(h ^ (cand  + 0x27d4eb2f), 2654435761) >>> 0;
  h = Math.imul(h ^ (roll  + 0x165667b1), 2654435761) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) || 1;
}

// ── value: herd margin at the horizon (§7) ───────────────────────────────────
// At endOfGame the showdown has folded card cows + floor($/2) into herd → use real herds.
// At a shorter horizon, estimate each player's final herd = banked herd + owned-card cows +
// floor(owned $/2) (the showdown formula on current holdings; ignores future rounds — the
// accepted horizon-value bias, §12).
function estFinalHerds(state) {
  if (state.phase === 'done') return state.players.map(p => p.herd);
  return state.players.map(p => {
    let cows = 0, dollars = 0;
    for (const c of p.deck)    { cows += (c.cows || 0); dollars += (c.dollars || 0); }
    for (const c of p.discard) { cows += (c.cows || 0); dollars += (c.dollars || 0); }
    for (const c of p.hand)    { cows += (c.cows || 0); dollars += (c.dollars || 0); }
    return p.herd + cows + Math.floor(dollars / 2);
  });
}
function herdMarginValue(state, focalIdx) {
  const h = estFinalHerds(state);
  let bestOpp = -Infinity;
  for (let i = 0; i < h.length; i++) if (i !== focalIdx && h[i] > bestOpp) bestOpp = h[i];
  if (bestOpp === -Infinity) bestOpp = 0;
  return h[focalIdx] - bestOpp;
}

// ── candidate enumeration ────────────────────────────────────────────────────
// Affordable buys (at current roundDollars) + top-K burns ranked by value-to-the-leader
// (denial), capped at branchCap. Burning even when a buy is affordable is allowed — that's a
// capability the genome lacks (it always buys if it can).
function enumerateBuyCandidates(focal, pyramid, avail, state, def, branchCap) {
  const buys = avail
    .filter(a => (a.slot.card.cost || 0) <= focal.roundDollars)
    .map(a => ({ action: 'buy', row: a.row, col: a.col, card: a.slot.card }));

  const leader = state.players
    .filter(p => p !== focal)
    .sort((a, b) => (b.herd || 0) - (a.herd || 0))[0];
  const burnRanked = avail
    .map(a => ({
      a,
      leaderScore: leader ? engine.scoreCard(a.slot.card, def, state.act, state.players, leader) : 0,
    }))
    .sort((x, y) => y.leaderScore - x.leaderScore);
  const burnBudget = Math.max(2, branchCap - buys.length);
  const burns = burnRanked.slice(0, burnBudget)
    .map(x => ({ action: 'burn', row: x.a.row, col: x.a.col, card: x.a.slot.card }));

  const seen = new Set();
  let cands = [...buys, ...burns].filter(d => {
    const k = `${d.action}:${d.row},${d.col}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  if (cands.length > branchCap) cands = cands.slice(0, branchCap);
  return cands;
}

// Deterministic tiebreak across equal-EV candidates: defaultGenome card score + reveal bonus,
// nudging buy over burn. Keeps the search reproducible.
function candidateTieScore(d, pyramid, def, state) {
  const s = engine.scoreCard(d.card, def, state.act, state.players, null)
          + engine.pyramidRevealBonus(pyramid, d.row, d.col, def);
  return s + (d.action === 'buy' ? 1e-4 : 0);
}

// FAIR-INFO determinization (imperfect-information Monte-Carlo). A human can't see any face-down
// deck's ORDER — their own or opponents'. So before rolling a future, reshuffle every player's
// deck with the shared rollout LCG: the card SET is preserved (public/derivable — starters +
// observed buys, minus the visible hand/discard), only the hidden ORDER is randomized. Hands and
// discards (face-up/public per the live game) are left intact. This is the ONLY thing that made the
// search use info a human lacks; with it on, the search is both fair AND MP-deterministic (it no
// longer depends on any synced hidden deck order — only on shared sets + the shared seed).
function determinizeHiddenDecks(clone) {
  for (const p of clone.players) {
    if (p.deck.length > 1) p.deck = engine.seededShuffle(p.deck, clone.rng);
  }
}

// Apply the focal's WHOLE buy turn to a clone: candidate primary + defaultGenome bonus buy,
// then advance past the focal so continueGame resumes with the next buyer. Mirrors the live
// processBuyer for a __search seat (extra-buy via defaultGenome), incl. chooseBuy's
// unconditional extra_buy auto-activation.
function applyFocalTurn(clone, focalIdx, decision, def) {
  const player = clone.players[focalIdx];
  if (!player.hasExtraBuy) {
    const extraCard = player.hand.find(c => c.special === 'extra_buy');
    if (extraCard) { player.hand.splice(player.hand.indexOf(extraCard), 1); player.hasExtraBuy = true; }
  }
  engine.applyBuyDecision(player, decision, clone.pyramid);
  if (player.hasExtraBuy && !player.extraBuyUsed && !core.isPyramidEmpty(clone.pyramid)) {
    player.extraBuyUsed = true;
    const extra = engine.chooseBuy(player, def, clone.pyramid, clone.act, clone.players);
    engine.applyBuyDecision(player, extra, clone.pyramid);
  }
  clone.buyCursor++;
}

// Rollout policy array: focal plays the defaultGenome; opponents play their TRUE genome
// (perfect) or the defaultGenome (realistic). All entries are plain genomes → no nested search.
function buildRolloutPolicies(state, focalIdx, policy, livePolicies) {
  const n = state.players.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === focalIdx) { out[i] = policy.defaultGenome; continue; }
    if (policy.oppModel === 'perfect') {
      const lp = livePolicies[i];
      out[i] = (lp && lp.__search) ? policy.defaultGenome : lp;  // never recurse into search
    } else {
      out[i] = policy.defaultGenome;                              // 'default' (realistic) model
    }
  }
  return out;
}

// ── the search ────────────────────────────────────────────────────────────────
function searchChooseBuy(state, focalIdx, policy, livePolicies) {
  const focal = state.players[focalIdx];
  const pyramid = state.pyramid;
  const avail = core.getAvailablePyramidCards(pyramid);
  if (avail.length === 0) return { action: 'pass' };

  const def = policy.defaultGenome;
  const candidates = enumerateBuyCandidates(focal, pyramid, avail, state, def, policy.branchCap);
  policy._stats.decisions++;
  if (candidates.length === 1) {
    policy._stats.rollouts += 0;
    const d = candidates[0];
    return { action: d.action, row: d.row, col: d.col };
  }

  const rolloutPolicies = buildRolloutPolicies(state, focalIdx, policy, livePolicies);
  const N = policy.N, horizon = policy.horizon;

  let best = null, bestV = -Infinity, bestTie = -Infinity;
  for (let ci = 0; ci < candidates.length; ci++) {
    const d = candidates[ci];
    let sum = 0;
    for (let r = 0; r < N; r++) {
      const clone = engine.cloneState(state);
      clone.rng = engine.makeLCG(rolloutSeed(state.seed, state.act, state.round, focalIdx, ci, r));
      if (policy.fairInfo) determinizeHiddenDecks(clone);  // sample hidden draw order (fair + MP-safe)
      applyFocalTurn(clone, focalIdx, d, def);
      engine.continueGame(clone, rolloutPolicies, horizon);
      sum += herdMarginValue(clone, focalIdx);
    }
    policy._stats.rollouts += N;
    const meanV = sum / N;
    const tie = candidateTieScore(d, pyramid, def, state);
    if (meanV > bestV + 1e-9 || (Math.abs(meanV - bestV) <= 1e-9 && tie > bestTie)) {
      bestV = meanV; bestTie = tie; best = d;
    }
  }
  return { action: best.action, row: best.row, col: best.col };
}

// ── policy factory ──────────────────────────────────────────────────────────
function makeSearchPolicy(opts = {}) {
  const def = opts.defaultGenome || byName['enforcer'];
  const policy = {
    __search: true,
    name: opts.name || 'search',
    N: opts.N ?? 64,
    horizon: opts.horizon ?? 'endOfAct',     // 'endOfRound' | 'endOfAct' | 'endOfGame'
    branchCap: opts.branchCap ?? 12,
    oppModel: opts.oppModel ?? 'perfect',    // 'perfect' | 'default'
    // fairInfo (default ON): determinize hidden deck order each rollout (imperfect-info MC). The
    // AI uses only info a human has (public sets/herds/visible hands), never face-down deck order.
    // Set false ONLY for the ablation that reproduces the perfect-information (cheating) baseline.
    fairInfo: opts.fairInfo ?? true,
    defaultGenome: def,
    drawGenome: opts.drawGenome || def,      // draw phase stays heuristic in B1
    _stats: { decisions: 0, rollouts: 0 },
  };
  // Hook called by the engine's decideBuy (§8). No engine→search import; the policy carries
  // its own behaviour, so there's no require cycle.
  policy.decideBuy = (st, pIdx, livePolicies) => searchChooseBuy(st, pIdx, policy, livePolicies);
  return policy;
}

module.exports = {
  makeSearchPolicy, searchChooseBuy, rolloutSeed,
  estFinalHerds, herdMarginValue, enumerateBuyCandidates,
};
