# AI Distillation Plan — "search-strength, param-cost" (Route C)

**Status: PROPOSAL — not started (July 2026).** Successor to the search-AI bake-off. The verdict
there ([`AI_SEARCH_RESULTS.md`](AI_SEARCH_RESULTS.md)) was: flat-MC buy-phase search **beats the
pros fairly** (+7.9pp 2P / +11.6pp 4P at N=256 under human-equivalent info), but shipping it means
porting the rollout engine into `play.js` — declined as not worth it. This plan is the route that
doc itself flagged as most promising: **use the shelved search as an offline *teacher*, distill its
decisions into a fast, portable *student* policy** (an enriched scoring function; a tiny net only
if needed) that ships as a plain deterministic function in `play.js`. Prerequisite reading:
[`AI_SEARCH_RESULTS.md`](AI_SEARCH_RESULTS.md) → [`TUNING.md`](TUNING.md) →
[`AI_SEARCH_BAKEOFF_PLAN.md`](AI_SEARCH_BAKEOFF_PLAN.md) (build-log style this plan follows).

> ⚠️ **Nothing here can start until Phase D0 (sim re-sync to the brick Store) is done.** Every
> existing sim number — the tier rankings, the maxDraw results, the search deltas — was measured on
> the OLD triangle pyramid, which the live game no longer uses. See D0.

---

## 1. The goal (one sentence)

Distill the proven-but-shelved Monte-Carlo buy search into a **pure function of public information**
that retains enough of the search's edge to clear the same pre-registered bar (≥ +5pp vs the best
pro at both 2P and 4P), and is therefore cheap to ship as a new top difficulty tier — no rollout
machinery, no per-turn compute, no engine port.

Like the bake-off, this is **evidence + a verdict with a pre-registered bar**, not a "ship a
smarter AI" task. If the student can't hold the edge, we shelve it and say so — that negative
("the search's value is irreducibly lookahead") is also bankable.

## 2. Why this, why now

Two efforts hit their limits, in complementary ways:

- **Parameter search is dead.** Competitive coevolution (`evolve.js --coevolve`, strong-opponent
  fitness + Hall of Fame) converged 3/3 trials onto the exact `enforcer` genome. The 14-param space
  is tapped out; per `TUNING.md`, "the next real gain is logic/features, not more parameter search."
  The single-knob wins (`maxDraw` 7→10) have been harvested; the `AI_FUTURE_IMPROVEMENTS.md` backlog
  is empty.
- **Search works fairly but was shelved on cost.** Under the fair information model (hidden decks
  determinized per rollout — no peeking, per [[feedback-ai-human-info-only]]), N=256 `endOfGame`
  clears the bar at both counts. Fairness costs only ~3pp and 4× rollouts — affordable, not fatal.
  What killed shipping was (a) the `play.js` port of the clone/rollout engine and (b) no evidence
  humans feel a buy-phase skill gain.

**The structural insight from both:** the genome isn't weak because its numbers are wrong — it's
weak because its *decision structure* can't express what the search does. Clearest example: the
search will **burn a card the leader wants even when it could buy** — a denial play the current buy
logic literally cannot make. Coevolution driving `denialWeight → 0` wasn't evidence denial is
worthless; it was evidence the genome's crude denial knob is worthless. Distillation transfers the
search's richer decisions into a representation cheap enough to ship, and extends the action space
(burn-when-able-to-buy) — exactly the "logic/features" category TUNING.md points at.

## 3. Constraints that gate everything (unchanged from the bake-off)

1. **Fair info only** ([[feedback-ai-human-info-only]]): the student may consume only what a human
   sees — pyramid, all herds, opponents' face-up drawn hands, publicly-derivable card *sets*, public
   counters. Never any deck's hidden *order*. The feature list in D2 is the audit surface.
2. **MP determinism:** every client runs every AI locally with no broadcast, so the decision must be
   identical everywhere. A pure function of shared inputs satisfies this by construction (same
   argument as today's genome AI); still verify with a uid-relabeling invariance test in the mold of
   `test-search-mp-determinism.js`.
3. **Static hosting:** the student must run in the browser as plain JS. No server, no model files
   fetched at runtime beyond a JS array of weights.
4. **Sync discipline:** whatever ships must have a drift guard in the mold of
   `test-personality-sync.js` (weights + feature code identical between `play.js` and the sim).

---

## Phase D0 — re-sync the sim to the brick Store (MANDATORY precondition)

**Problem:** `sim/game-core.js` (`getNumRows`/`buildPyramid`) and `sim/personality-engine.js`
(`buildPyramidSeeded`) still model the retired **triangle** pyramid, and
`fixtures/golden-runGame.json` freezes that. The June 2026 brick rework changed the live board to
uniform **7×N rows (rows == player count), brick-staggered, geometry-based covering** (interior
cards have 2 coverers, one overhang end card per row has 1; only the bottom row starts face-up;
2P slices 14 of the 15-card act pool). Covering structure drives reveal dynamics drives buy
decisions — **all existing sim conclusions are for a board that no longer exists.**

**Work:**
1. Port the brick geometry into both sim engines (mirror `play.js` `pyramidRowWidth` /
   `pyramidColCenter` / `buildPyramid` / `isCardCovered`).
2. Regenerate the golden (`node sim/gen-golden.js` — this IS the "engine semantics legitimately
   changed" case its header reserves) and re-green `node sim/test-resume-reproduction.js`.
3. Re-validate: `node sim/simulate.js` (+ `--players 4`) and **re-tier** — the Easy/Medium/Hard
   bands may move; update `gamesetup.html` `DIFFICULTY_TIERS` + CLAUDE.md if they do.
4. **Re-baseline the teacher:** re-run `node sim/search-bakeoff.js --mode verdict --horizon
   endOfGame --N 256` on the new board. The +7.9/+11.6 figures predate the rework; D1's labels are
   only worth generating if the teacher's edge survives (expected, but verify — it's one command).

**D0b (optional, cheap during the same pass): extend the engine to 2–8P.** The brick rework made
every player count the same uniform 7×N layout, so the old "sim is 2–4P only" geometry ceiling
falls out naturally. `getActPool` doubling for 5P+ and the buy-first claim (already honored at the
`computeBuyOrder` layer, inert ≤4P) are the only extras. This gives tuning coverage for a shipped
mode that currently has zero AI validation. Optional — D1+ can proceed on 2P/4P alone.

**Gate:** golden regenerated + reproduction test green + fresh tier table + fresh teacher verdict
on the brick board. No D1 work before this.

## Phase D1 — teacher labeling (offline, compute is free)

Generate a decision corpus by running pro-field self-play games (`personality-engine.js`,
diverse seeds, 2P and 4P, mixed opponent lineups) and querying the **fair search** at every focal
buy decision:

- **Teacher config:** fair determinization ON, **default** opponent model, `endOfGame` horizon,
  **N=512–1024** (offline, so buy cleaner value estimates than the shipped-config 256).
- **Label = the full candidate evaluation**, not just the argmax: for each decision store the
  public-info state, the candidate set (every affordable buy + top-K denial burns, `branchCap=12`,
  same generator as `searchChooseBuy`), and each candidate's mean rollout value (herd margin).
  Value-labeled candidates support ranking losses and regression; argmax-only labels throw away
  most of the signal.
- **Volume/diversity:** tens of thousands of decisions across acts 1–3, all rounds, varied herd
  gaps (winning / losing / close). Dedupe near-identical states. Log the seed + state hash per
  label so the corpus is reproducible.
- Deliverable: `sim/distill-label.js` (harness script — no new algorithm work; `cloneState` +
  `search-ai.js` + seeded determinization all exist) + a git-ignored `results/labels_*.json`.

## Phase D2 — fit the student (simplest form first)

**Form (a) — enriched scoring function (start here).** A hand-designed feature vector per
candidate action, scored linearly (or shallow-interaction), weights fit by pairwise ranking loss
against the teacher's values. Draft feature list (all public-info — audit against constraint #1):

- Card stats: cows, dollars, bandits, special type, cost; act, round, **rounds remaining**.
- Position: focal herd, margin vs leader, per-opponent herd deltas, dollars remaining after the
  action (dollar carry matters — buy order is `roundDollars`-first).
- Reveal structure: which cards a removal uncovers and their value (structural, replacing the flat
  `revealBonus` the GA already zeroed out).
- **Denial value-to-the-leader** (leader's own score for the card) — enables burn-when-able-to-buy.
- Pool/board summaries: cards left in the act, own public deck composition (bandit density of the
  known set).

**Form (b) — tiny MLP (fallback only).** If the linear student can't clear the D3 bar: a small net
(e.g. 2 hidden layers ×16–32, a few hundred–few thousand weights), trained on the same labels,
exported as plain JS Float64 arrays + one matrix-multiply function. Still a deterministic pure
function — IEEE-754 doubles with a fixed op order are reproducible across JS engines. Costs
inspectability; only escalate if (a) demonstrably falls short.

**Action-space note:** the student's candidate generator must match the teacher's (buys + denial
burns even when a buy is affordable). That is a *logic* change to `aiBuyTurn`'s structure at ship
time, not just a new scorer.

**Draw phase is out of scope** for D1–D4. Buy-only search already cleared the bar; draw is
higher-volume, was never searched (B3 skipped), and the personalities' bust-threshold logic is
near-calibrated. It's the natural *second* distillation target (D6) if the buy student succeeds.

## Phase D3 — bake-off gate (pre-registered bar)

Drop the student into `search-bakeoff.js` as a participant (the harness was built for "ANY future
AI candidate vs the pros") on the **re-synced brick engine**:

- **Primary bar (frozen now):** Δ point-estimate **≥ +5pp vs the best pro at BOTH 2P and 4P**, 95%
  CI excluding 0 — the same bar the search itself cleared.
- **Diagnostics (reported, not gating):** teacher-agreement rate (top-action match %), retained
  fraction of the teacher's re-baselined edge, per-act/round agreement breakdown (shows *where*
  the student loses the teacher).
- Also re-run `test-resume-reproduction.js` (engine untouched by D1–D3 — must stay green) and a
  uid-relabeling determinism test for the student.

**If it fails** after the MLP escalation: shelve with the write-up "the search's edge is
irreducibly lookahead," and the fallback options are the ones already inventoried in
`AI_SEARCH_RESULTS.md` Path B (light MCTS, learned value function at short horizons).

## Phase D4 — ship path (only if D3 clears)

Deliberately small — that's the point of distillation:

1. Port the feature code + weights into `src/play.js` as a `decideBuy`-style dispatch inside
   `aiBuyTurn` (including the extended candidate generator). No rollout machinery, no
   `drawState`-timing gate needed — the student consumes the same already-synced public state the
   genome AI does.
2. New top tier above Hard in `gamesetup.html` `DIFFICULTY_TIERS` (working name: **Legend**), its
   own themed names in `AI_NAME_POOLS`. Existing personalities untouched.
3. Drift guard: extend `test-personality-sync.js` (or a sibling) to hash the weights + feature
   function across `play.js` ↔ sim.
4. Validate: fresh `simulate.js` re-tier including the student; a two-tab live MP smoke test
   (standard for any AI logic change — see the card_4 precedent).
5. Trajectory: `trajLogHeader` already records per-seat `personality` — give the student a distinct
   personality id so human-vs-Legend games are identifiable in the corpus. Check whether the `traj`
   rules' shape validation needs the new id (it validates fields, not values — verify).

## Phase D5 — close the "does it matter to humans?" loop

The strongest reason the search was shelved was that +12pp bot-vs-bot is unproven on humans. Two
answers, neither blocking D1–D4:

- **Ship Legend opt-in and just measure.** `traj` headers carry per-seat personality; `gameHistory`
  carries outcomes. A join gives human-vs-tier win rates with zero new instrumentation. If humans
  stomp Legend as easily as Hard, the shelving decision's open question is answered — cheaply.
- **Trajectory Phase 1** ([`docs/TRAJECTORY_PHASE1_PLAN.md`](../docs/TRAJECTORY_PHASE1_PLAN.md)):
  the validator (layer 0a) is cheap hygiene worth doing anytime; the value oracle (layer 3) would
  show *where* humans lose EV (draw vs buy), which should direct any third round of AI investment.
  **Corpus size is the binding constraint** (~a dozen games) — don't build the heavy layers yet.

---

## What NOT to do (already settled)

- **More GA/coevolution on the current genome** — proven dead three ways (`TUNING.md`).
- **Opponent modeling** (inferring archetypes from observed buys) — the perfect↔default gap was
  only ~5pp; the ceiling on the whole direction is small. Garnish later, not a main course.
- **MCTS/UCB** — only worth it if shipping the raw search, which this plan exists to avoid.
- **Porting the rollout engine into `play.js`** — the exact cost the owner declined (Path A).
- **Re-measuring the cheating model** — upper-bound ablation only, never shippable.

## Risks / open questions

- **Distillation loses the edge.** The main risk, and the experiment's purpose. Mitigation: the
  feature set targets what rollouts appear to reward (denial, horizon-aware value, reveal
  structure); failure is cheap and informative via the existing harness.
- **The brick board shifts the teacher's edge.** Resolved by D0's re-baseline before any labeling.
- **Tier bands move under D0's re-tier.** Possible independent of distillation — budget for a
  `DIFFICULTY_TIERS` update as D0 fallout.
- **Perceived vs measured difficulty.** Even a successful student is a buy-phase gain; if humans
  experience difficulty mostly through draw-phase drama (busts, jail saves), felt difficulty may
  lag measured strength. That's what D5 measures, and what would justify the D6 draw-phase student.

## Key commands / assets

```bash
node sim/test-resume-reproduction.js        # engine integrity gate (green before AND after D0)
node sim/gen-golden.js                      # regenerate golden after the D0 geometry port
node sim/simulate.js && node sim/simulate.js --players 4    # re-tier after D0
node sim/search-bakeoff.js --mode verdict --horizon endOfGame --N 256   # teacher re-baseline (D0) / student gate (D3)
node sim/test-personality-sync.js           # play.js ↔ sim drift guard (extend at D4)
```

Reusable assets (all committed, per `AI_SEARCH_RESULTS.md`): resumable engine core
(`personality-engine.js`), the fair search teacher (`search-ai.js`), the bake-off harness
(`search-bakeoff.js`), the MP-determinism test pattern (`test-search-mp-determinism.js`).
