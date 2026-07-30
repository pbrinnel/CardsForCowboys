#!/usr/bin/env node
// sim/card-counterfactual.js — CAUSAL card value (R5 of sim/CARD_REBALANCE_PLAN.md).
//
// R4's win%-when-bought is correlational. Two confounds it cannot remove:
//   SELECTION — an expensive card is only bought by a player who already had a good draw round,
//     so its win% is partly "this player was winning anyway".
//   AI JUDGEMENT — R4 showed the AI systematically over-buys Explosives and under-buys act-3
//     cows, so "cards the AI bought" is a biased sample of situations.
//
// This removes both by FORCING the purchase. At a sampled buy decision we hold the state, the
// buyer, and the alternatives fixed, and vary only WHICH card is taken:
//
//   for each affordable candidate c (plus a burn baseline):
//     clone the state → force the focal to take c → determinize hidden decks (fair info)
//     → roll the rest of the game out N times → value = mean herd margin for the focal
//
//   advantage(c) = value(c) − mean value over that decision's candidate set
//
// Because every candidate is evaluated from the SAME state by the SAME player, the difference
// is attributable to the card. Averaged over many decisions, that is a causal estimate of what
// the card is worth at its price.
//
// CONTINUATION POLICY MATTERS, and is the point of --continuation:
//   default — everyone plays the shipped genome afterwards. Answers "what is this card worth in
//             the game as it is actually played?"
//   search  — the focal seat plays the (shelved) Monte-Carlo search afterwards. Answers "what is
//             this card worth to a STRONGER player?" Decisive for dollar cards, whose entire
//             value is instrumental: if dollars look bad under `default` but fine under `search`,
//             the fault is the AI's spending, not the card's price.
//
// Fair info throughout ([[feedback-ai-human-info-only]]): hidden decks are re-shuffled per
// rollout, so no rollout sees a deck order a human could not know.
//
// Usage:
//   node sim/card-counterfactual.js --games 300 --N 32
//   node sim/card-counterfactual.js --games 150 --N 24 --continuation search
//   node sim/card-counterfactual.js --cards card_43,card_73 --games 400
'use strict';

const engine = require('./personality-engine');
const core = require('./game-core');
const search = require('./search-ai');
const { byName, GENOMES } = require('./personalities');
const fs = require('fs');
const path = require('path');

const STORE_BY_ID = Object.fromEntries(core.STORE_CARDS.map(c => [c.id, c]));

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    games: 300, N: 32, players: 4, def: 'enforcer',
    continuation: 'default', searchN: 24, cards: null, csv: false, sampleRate: 1.0,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--games') o.games = parseInt(a[++i], 10);
    else if (a[i] === '--N') o.N = parseInt(a[++i], 10);
    else if (a[i] === '--players') o.players = parseInt(a[++i], 10);
    else if (a[i] === '--def') o.def = a[++i];
    else if (a[i] === '--continuation') o.continuation = a[++i];
    else if (a[i] === '--search-n') o.searchN = parseInt(a[++i], 10);
    else if (a[i] === '--cards') o.cards = a[++i].split(',').map(s => s.trim());
    else if (a[i] === '--sample') o.sampleRate = parseFloat(a[++i]);
    else if (a[i] === '--csv') o.csv = true;
  }
  return o;
}

// Deterministic per-rollout seed, same mixing idea as search-ai's rolloutSeed.
function mixSeed(base, round, seat, cand, roll) {
  let h = ((base >>> 0) || 1);
  for (const v of [round + 0x9e3779b1, seat + 0xc2b2ae3d, cand + 0x27d4eb2f, roll + 0x165667b1]) {
    h = Math.imul(h ^ v, 2654435761) >>> 0;
  }
  return h || 1;
}

// Evaluate one candidate action from `state` by rolling the rest of the game out N times.
function evaluate(state, focalIdx, decision, policies, def, N, candIdx, opts) {
  let total = 0;
  for (let r = 0; r < N; r++) {
    const clone = engine.cloneState(state);
    clone.rng = engine.makeLCG(mixSeed(state.seed, state.round, focalIdx, candIdx, r));
    search.determinizeHiddenDecks(clone);          // fair info: hidden deck ORDER is unknown
    search.applyFocalTurn(clone, focalIdx, decision, def);
    engine.continueGame(clone, policies, 'endOfGame');
    total += search.herdMarginValue(clone, focalIdx);
  }
  return total / N;
}

function main() {
  const o = parseArgs();
  const def = byName[o.def];
  if (!def) { console.error('unknown --def personality: ' + o.def); process.exit(1); }
  const focusSet = o.cards ? new Set(o.cards) : null;

  // Pro field: the five Hard bots, rotating. Measuring card value against weak opposition would
  // reward cards that only work when opponents misplay.
  const HARD = ['enforcer', 'drifter', 'deputy', 'rancher', 'prospector'];

  // Continuation policies for the rollouts.
  let searchPolicy = null;
  if (o.continuation === 'search') {
    searchPolicy = search.makeSearchPolicy({
      N: o.searchN, horizon: 'endOfGame', oppModel: 'default',
      fairInfo: true, def: o.def, branchCap: 8,
    });
  } else if (o.continuation !== 'default') {
    console.error("--continuation must be 'default' or 'search'"); process.exit(1);
  }

  // Per-card accumulators.
  const stat = {};   // id -> { n, advSum, advSq, vsBurnSum, roundSum, valSum }
  const bump = (id, adv, vsBurn, round, val) => {
    const s = stat[id] || (stat[id] = { n: 0, advSum: 0, advSq: 0, vsBurnSum: 0, roundSum: 0, valSum: 0 });
    s.n++; s.advSum += adv; s.advSq += adv * adv; s.vsBurnSum += vsBurn; s.roundSum += round; s.valSum += val;
  };

  let decisions = 0, rollouts = 0;
  const t0 = Date.now();

  for (let g = 1; g <= o.games; g++) {
    if (g % 25 === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stderr.write(`\r  game ${g}/${o.games}  decisions ${decisions}  rollouts ${rollouts}  ${el.toFixed(0)}s`);
    }
    const lineup = Array.from({ length: o.players }, (_, k) => byName[HARD[(g * 3 + k) % HARD.length]]);
    const state = engine.createInitialState(lineup, o.players, g);

    while (state.phase !== 'done') {
      // 'beforeBuy' pauses with the draw resolved and the buy order fixed, but nothing bought —
      // the only point at which substituting a decision is meaningful.
      engine.continueGame(state, lineup, 'beforeBuy');
      if (state.phase === 'buy') {
        while (state.buyCursor < state.buyOrder.length) {
          if (core.isPyramidEmpty(state.pyramid)) break;
          const pIdx = state.buyOrder[state.buyCursor];
          const focal = state.players[pIdx];
          state.stage = core.storeStage(state.pyramid);

          const avail = core.getAvailablePyramidCards(state.pyramid);
          const affordable = avail.filter(a => (a.slot.card.cost || 0) <= focal.roundDollars);

          const relevant = !focusSet || affordable.some(a => focusSet.has(a.slot.card.id));
          // Need >= 2 real options for a within-decision comparison to mean anything.
          if (affordable.length >= 2 && relevant && Math.random() <= o.sampleRate) {
            // Candidate set: every affordable buy, plus ONE burn as an absolute reference
            // ("is taking this card even better than taking nothing?").
            const cands = affordable.map(a => ({ action: 'buy', row: a.row, col: a.col, id: a.slot.card.id }));
            let worst = null, worstScore = Infinity;
            for (const a of avail) {
              const s = engine.scoreCard(a.slot.card, def, state.stage, state.players, focal);
              if (s < worstScore) { worstScore = s; worst = a; }
            }
            if (worst) cands.push({ action: 'burn', row: worst.row, col: worst.col, id: null });

            const policies = state.players.map((_, i) =>
              (searchPolicy && i === pIdx) ? searchPolicy : lineup[i]);

            const values = cands.map((c, ci) =>
              evaluate(state, pIdx, c, policies, def, o.N, ci, o));
            rollouts += cands.length * o.N;
            decisions++;

            const buyVals = values.slice(0, cands.length - (worst ? 1 : 0));
            const burnVal = worst ? values[values.length - 1] : null;
            const meanVal = buyVals.reduce((a, b) => a + b, 0) / buyVals.length;

            cands.forEach((c, ci) => {
              if (c.action !== 'buy') return;
              bump(c.id, values[ci] - meanVal, burnVal === null ? NaN : values[ci] - burnVal,
                state.round, values[ci]);
            });
          }

          engine.processBuyer(focal, lineup[pIdx], state.pyramid, state.stage, state.players, null);
          state.buyCursor++;
        }
        state.phase = 'score';
      }
      // Resolve scoring (and the showdown, on the last round) before the next 'beforeBuy'.
      engine.continueGame(state, lineup, 'endOfRound');
    }
  }
  process.stderr.write('\r' + ' '.repeat(78) + '\r');

  // --- report ---
  const rows = Object.entries(stat).filter(([, s]) => s.n >= 20).map(([id, s]) => {
    const c = STORE_BY_ID[id] || {};
    const adv = s.advSum / s.n;
    const varr = Math.max(0, s.advSq / s.n - adv * adv);
    return {
      id, act: c.act, cost: c.cost, cows: c.cows, dollars: c.dollars,
      bandits: c.bandits, special: c.special || '',
      n: s.n, adv, se: Math.sqrt(varr / s.n),
      vsBurn: s.vsBurnSum / s.n, meanRound: s.roundSum / s.n,
    };
  }).sort((a, b) => b.adv - a.adv);

  const el = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('Cards For Cowboys — CAUSAL card value (forced-buy counterfactual)');
  console.log(`${o.players}P · ${o.games} games · N=${o.N} rollouts/candidate · continuation=${o.continuation}` +
    (o.continuation === 'search' ? ` (searchN=${o.searchN})` : '') + ` · fair info`);
  console.log(`${decisions} decisions evaluated · ${rollouts.toLocaleString()} rollouts · ${el}s\n`);
  console.log('advantage = herd margin vs the AVERAGE of the other affordable cards at the same');
  console.log('decision. +1.0 means taking this card is worth one extra herd over the alternatives.');
  console.log('vsBurn    = margin vs burning instead. NEGATIVE means the card is not worth taking.\n');

  console.log('card      act cost  print                   n     adv    ±se   vsBurn   rnd');
  for (const r of rows) {
    const tag = [r.cows ? `${r.cows}cow` : '', r.dollars ? `$${r.dollars}` : '',
      r.bandits ? `${r.bandits}bnd` : '', r.special].filter(Boolean).join(' ');
    const sig = Math.abs(r.adv) > 2 * r.se ? '' : ' ns';
    console.log(r.id.padEnd(9) + String(r.act).padStart(3) + String(r.cost).padStart(5) + '  ' +
      tag.padEnd(20) + String(r.n).padStart(5) +
      (r.adv >= 0 ? '+' : '') + r.adv.toFixed(2).padStart(6) +
      ('±' + r.se.toFixed(2)).padStart(7) +
      (r.vsBurn >= 0 ? '+' : '') + r.vsBurn.toFixed(2).padStart(8) +
      r.meanRound.toFixed(1).padStart(6) + sig);
  }
  console.log('\nns = advantage is within 2 standard errors of zero (no detectable effect).');

  // Grouped read: the question R4 raised.
  const grp = (pred) => {
    const g = rows.filter(pred);
    if (!g.length) return null;
    const w = g.reduce((a, r) => a + r.n, 0);
    return {
      n: g.length,
      adv: g.reduce((a, r) => a + r.adv * r.n, 0) / w,
      vsBurn: g.reduce((a, r) => a + r.vsBurn * r.n, 0) / w,
    };
  };
  const cow = grp(r => r.cows > 0), dol = grp(r => !r.cows && r.dollars > 0);
  const exp = grp(r => r.special === 'burn_to_use');
  console.log('\n' + '─'.repeat(70));
  console.log('GROUPED — the R4 question, now causally');
  console.log('─'.repeat(70));
  if (cow) console.log(`  cow-bearing  (${cow.n} cards):  advantage ${cow.adv >= 0 ? '+' : ''}${cow.adv.toFixed(2)}   vs burning ${cow.vsBurn >= 0 ? '+' : ''}${cow.vsBurn.toFixed(2)}`);
  if (dol) console.log(`  dollar-only  (${dol.n} cards):  advantage ${dol.adv >= 0 ? '+' : ''}${dol.adv.toFixed(2)}   vs burning ${dol.vsBurn >= 0 ? '+' : ''}${dol.vsBurn.toFixed(2)}`);
  if (exp) console.log(`  Explosives   (${exp.n} cards):  advantage ${exp.adv >= 0 ? '+' : ''}${exp.adv.toFixed(2)}   vs burning ${exp.vsBurn >= 0 ? '+' : ''}${exp.vsBurn.toFixed(2)}`);

  if (o.csv) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(__dirname, 'results', `counterfactual_${o.players}P_${o.continuation}_${ts}.csv`);
    const lines = ['id,act,cost,cows,dollars,bandits,special,n,advantage,se,vsBurn,meanRound'];
    for (const r of rows) lines.push([r.id, r.act, r.cost, r.cows, r.dollars, r.bandits, r.special,
      r.n, r.adv.toFixed(4), r.se.toFixed(4), r.vsBurn.toFixed(4), r.meanRound.toFixed(2)].join(','));
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`\nCSV: ${file}`);
  }
}

main();
