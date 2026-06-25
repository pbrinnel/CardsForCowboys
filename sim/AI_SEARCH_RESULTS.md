# AI Search Bake-Off — Results & Verdict (Route B: lookahead / Monte-Carlo)

**Status: COMPLETE → SHELVED (not shipping). June 2026.** The bake-off ran to a clean, *positive*
verdict under a fair, human-equivalent information model — the search beats the pros — but the project
owner has decided the improvement **is not worth the engineering cost** of shipping it as an online AI
personality (see "Decision & status" below). All work is sim-side and committed; the live game was
never touched. This doc is the conclusive record + the resume guide. Source plan:
[`AI_SEARCH_BAKEOFF_PLAN.md`](AI_SEARCH_BAKEOFF_PLAN.md); the param-AI world it competed against:
[`TUNING.md`](TUNING.md).

> **Picking this back up?** Jump to ["If you pick this back up later"](#if-you-pick-this-back-up-later)
> at the bottom — it has the reusable-assets inventory, the two forward paths (ship online / simulate
> something smarter), and the exact commands.

---

## TL;DR verdict

**A flat Monte-Carlo buy-phase search BEATS the parameter "pro" bots by a clear margin — using only
the information a human player has, and at a rollout budget that clears the pre-registered bar.**

The decisive constraint (set by the project owner): *an AI may not use information a human wouldn't
have* — no peeking at any face-down deck's order, its own or opponents'. The search must therefore
**determinize hidden state** (sample each deck's order per rollout from its known public *set*), which
is also the correct imperfect-information Monte-Carlo formulation. Under that **fair** model, with the
**default** opponent model (you can't know a human's strategy), `endOfGame` horizon, **N=256** rollouts:

| | search (fair, N=256) | best pro | **Δ vs best pro** | frozen bar (≥+5pp, CI>0) |
|---|---|---|---|---|
| **2P** | 78.0% (±1.7, n=2400) | 70.1% (enforcer) | **+7.9pp** | ✅ PASS |
| **4P** | 55.0% (±4.0, n=600) | 43.4% (drifter) | **+11.6pp** | ✅ PASS |

This closes the question the prior session opened: the 14-parameter genome was exhausted
(coevolution converged to `enforcer` and couldn't out-design the Hard bots), so the only way left to
play *better* was a capability the genome can't express — actual lookahead. **It works, fairly.**

**The fairness constraint costs ~3pp and ~4× the rollouts.** The hidden-information ("cheating")
version — which used opponents' true deck order — scored +7.2 / +8.0pp at only N=64 (see the
perfect-information ablation below); that was an upper bound, not a shippable result. Removing the
unfair info drops N=64 to +4.3pp (2P, **misses** the bar) / +5.7pp (4P, clears). More rollouts buy it
back: at N=256 the fair search clears comfortably at both counts (under imperfect info, more samples
⇒ better expected-value estimates ⇒ better play).

**The search is ship-*capable* but, by decision, not ship-*bound*.** The passing config (**N=256,
`endOfGame`, default opponent model, fair-info determinization**) uses only human-equivalent info and
is MP-deterministic by construction. Shipping it would require porting the resumable engine into
`play.js` + a live `drawState`-timing gate + two-tab MP testing — see the decision below.

---

## Decision & status (June 2026) — SHELVED, not shipping

**Decision (project owner): do NOT ship the search as an online AI personality.** "The juice isn't
worth the squeeze." The reasoning, plainly:

- **The win is real but moderate.** ~+8pp (2P) / ~+12pp (4P) over the best existing Hard bot. That
  makes it the clear strongest AI — by more than the entire current Hard-tier spread (~6pp) — but it's
  **about a third of one tier gap** (Hard→Medium is ~25pp). Evolutionary, not a difficulty leap.
- **It's bot-vs-bot skill, not a proven human-difficulty gain.** All numbers are AI-vs-AI on the
  deterministic engine. We have no human-vs-search data, so "+10pp vs the best bot" does **not** mean
  players will find it ~10% harder. Whether a smarter *buy* policy is even perceptible to a human
  (whose games are also swung by draw-phase luck) is unknown.
- **The cost is a non-trivial engineering project.** Porting the resumable clone/rollout engine into
  the browser (ideally unifying `play.js` + the sim, today hand-synced parallel implementations) + a
  live MP-determinism gate + per-turn compute (~24 ms/dec 2P, ~64 ms 4P). Real risk, real effort, for
  a moderate, unproven-on-humans gain.

**Status:** SHELVED, not abandoned. Everything is committed and reusable; the genome hot path is
byte-identical; the live game is untouched. A clean negative *ship* decision on a clean positive
*technical* result. If the calculus changes (e.g. human data shows buy-skill matters, or a cheaper
path appears), see ["If you pick this back up later"](#if-you-pick-this-back-up-later).

---

## What the search is (method)

At the focal seat's **buy turn**, for each candidate primary action:

1. **Candidates** = every affordable buy + the top-K denial burns (ranked by value-to-the-leader),
   capped at `branchCap=12`. Crucially the search may *burn even when it could buy* — a denial play
   the genome never makes.
2. **Rollouts**: clone the live game state ([`cloneState`](personality-engine.js)), give the clone its
   **own** deterministically seeded LCG, **determinize hidden state** (reshuffle every deck — own and
   opponents' — keeping the public set, randomizing the unseen order), apply the focal's whole turn
   (candidate + a default-genome bonus buy), and play forward under default policies to a **horizon**
   (`endOfGame`). N=256 rollouts per candidate (the fair model needs ~4× the N of the cheating model).
3. **Value** each rollout by **herd margin** (focal herd − best opponent herd); at `endOfGame` this is
   the true showdown result (card cows + `floor($/2)` bonus folded in). Average over N.
4. **argmax** candidate; deterministic `scoreCard` tiebreak → fully reproducible.

It is plain **flat Monte-Carlo / 1-ply expectimax**, not MCTS — enough to answer "is search worth
it?". The focal seat plays the default genome *inside* rollouts (no recursive search — too expensive).

**Two scientific controls, both reported:**
- **Opponent model (§6):** *perfect* = rollouts use opponents' true genomes (upper bound); *default*
  = rollouts assume every opponent plays `enforcer` (the shippable model — you don't know real
  opponents' "genome"). The **gap** measures how much the search leans on knowing opponents.
- **RNG hygiene (§4b):** rollout seeds are mixed from `(gameSeed, act, round, slot, candidate,
  rollout)` — all *shared* state. The live game's RNG is never advanced by the search, so every
  search decision is reproducible (verified: same game twice ≡ identical).

---

## Evidence, phase by phase

### B0 — resumable simulator (the enabling refactor)
`personality-engine.js` became a resumable phase state machine (`createInitialState` →
`continueGame(state, policies, horizon)` → `gameResult`; `runGame` is a thin wrapper). `cloneState`
deep-copies players/pyramid (re-pointing the `copyNextCard`/`copyNextDonor` aliases at the clone's
own cards) and gives the clone an independent LCG. **Gate green:** golden bit-for-bit over 1350
games + round/act-granular resume ≡ `runGame` + clone independence (3000 forks, originals
unperturbed) + mid-buy resumption. All consumer tools (`simulate.js` 2P/4P, `draw-cap-experiment.js`)
**byte-identical** to pre-refactor — the genome hot path did not move.

### B1 — first signal (perfect model, N=64, endOfAct)
Search beats `enforcer` head-to-head **62.9%** (95% CI ±3.3pp, n=800 — excludes 50%); beats the whole
Hard field 68–73%. I.e. buy-phase lookahead adds ~13pp over plain `enforcer` when the opponent model
is exact. (`sim/search-b1-signal.js`.)

### B2 — opponent-model ablation + N×horizon sweep + cost (`sim/search-bakeoff.js`)
**Sweep (vs enforcer 2P, where perfect≡default — isolates the knobs):**

| horizon | N=16 | N=64 | N=256 | cost @N64 |
|---|---|---|---|---|
| `endOfRound` | 52.1% | 52.1% | 52.1% | **worthless** — heuristic can't see a buy's payoff |
| `endOfAct` | 54.2% | 66.7% | 63.7% | 18 ms/game (plateaus ~N64) |
| `endOfGame` | 55.0% | 67.9% | **72.9%** | 72 ms/game (no value-bias; scales with N) |

**Ablation (search vs FIELD, perfect vs default model, default=enforcer):**

| config | Δ2P (default) | Δ4P (default) | perfect↔default gap (2P / 4P) |
|---|---|---|---|
| N64 `endOfAct` | +6.2pp | +3.7pp (misses) | 3.8 / 10.3pp |
| **N64 `endOfGame`** | +5.9pp | **+10.4pp** | 4.6 / 6.0pp |

The headline B2 finding: the `endOfAct` value heuristic badly *undervalued* 4P play; moving to the
true `endOfGame` horizon lifted Δ4P from +3.7 → **+10.4pp** while holding 2P. The perfect↔default
gaps are modest — the search does **not** lean heavily on knowing opponents.

### B3 — draw-phase search: SKIPPED (by decision)
Buy-only search already clears the proposed bar under the realistic model, so draw-phase search (the
highest-volume, highest-cost decision class) was skipped for the headline verdict. It remains an
available enhancement — see "What it would take to revisit."

### Fair-information constraint (the decisive turn)
A human can't see any face-down deck's ORDER — their own or opponents'. The first scale verdict used
the true deck order in rollouts (perfect information). To respect the constraint, each rollout now
**determinizes hidden state**: every player's deck is reshuffled with the shared rollout LCG, keeping
the public *set* (starters + observed buys, minus the visible hand/discard) and randomizing only the
hidden *order* (`search-ai.js` `determinizeHiddenDecks`, default on). This is both fair and the
textbook imperfect-information Monte-Carlo treatment, and it removes any dependence on synced hidden
state (so it's MP-deterministic too). What the AI still uses is exactly what a human can: the pyramid,
all herds, opponents' face-up drawn hands, and the publicly-derivable card sets.

### B4 — scale verdict, FAIR information (default model, `endOfGame`)
`node sim/search-bakeoff.js --mode verdict --horizon endOfGame --opp-model default` (fair = default).

| N | 2P Δ vs best pro | 4P Δ vs best pro | bar (≥+5pp, CI>0) |
|---|---|---|---|
| **64** | +4.3pp (74.4% vs 70.1, n=8000) | +5.7pp (49.1% vs 43.4, n=2000) | 2P ❌ · 4P ✅ → misses |
| **256** | **+7.9pp** (78.0% vs 70.1, n=2400) | **+11.6pp** (55.0% vs 43.4, n=600) | 2P ✅ · 4P ✅ → **CLEARS** |

At N=64 the fair search is reliably *better* than the best pro at both counts (both Δ CIs exclude 0)
but the 2P margin (+4.3pp) is under the +5pp bar. Raising rollouts to **N=256 clears both** — the 2P
shortfall was under-resourced sampling, not a ceiling. **Verdict: the search clears the pre-registered
bar under fair, human-equivalent information, at N=256.**

### Perfect-information ablation (UPPER BOUND — not shippable)
`--cheat` reproduces the original full-information rollout (uses opponents' true deck order). N=64:
Δ2P **+7.2pp** (77.3% vs 70.1, n=6000) / Δ4P **+8.0pp** (51.4% vs 43.4, n=2000). The gap to the fair
N=64 numbers (≈ +3pp at each count) is the value of the hidden information — which the fairness
constraint forbids. Kept only to quantify the cost of playing fair.

**Robustness** (B2 sweep): positive across N (16/64/256) and across `endOfAct`/`endOfGame` — not a
single lucky config; `endOfRound` is the only dead horizon.

---

## Cost / latency

| config | rollouts/decision | ms/game | ≈ ms/decision |
|---|---|---|---|
| N64 `endOfGame` (2P) | ~311 | 72 | ~6 |
| N64 `endOfGame` (4P) | ~410 | 213 | ~14 |
| **N256 `endOfGame` (2P)** | ~1246 | 288 | **~24** |
| **N256 `endOfGame` (4P)** | ~1641 | 961 | **~64** |

The bar-clearing fair config is **N256 `endOfGame`**: ~24 ms/decision (2P), ~64 ms/decision (4P). The
4P figure nudges past the ~50 ms budget I proposed for a *latency-sensitive* client, but this is a
**turn-based** game — even ~1 s for a whole AI buy phase is imperceptible, so N=256 is fine in
practice (and latency is a non-issue for solo play). If a strict budget is ever needed, N=64 still
clears 4P (~14 ms/dec) and only 2P needs the larger N.

---

## Shippability (§4c) — important caveats

Every client runs every AI locally with no broadcast, so an AI seat's decision must be identical on all
clients (or MP desyncs — the same reason the `card_4` swap AI is pyramid-only). The **fair-info**
search satisfies this *by construction*:

- **It uses only shared/derivable info:** the pyramid (`actSetup`), public herds, opponents' face-up
  hands, and publicly-derivable card *sets*. The fair determinization reshuffles every deck per rollout
  with a **shared seed**, so the AI never depends on any seat's hidden deck *order* — not even the
  synced one. (This also resolved the clairvoyance question: the AI does not exploit anyone's near-future
  draws.) Opponent strategy is assumed = `enforcer` (the **default** model — you can't know a human's
  "genome"), which is the model that produced the +7.9/+11.6pp result.
- **Representation-invariance proven:** the buy decision is identical under hard `uid` relabeling
  (`sim/test-search-mp-determinism.js`, 168 decisions) — it depends only on ids/sets/stats + the shared
  seed. The MP-determinism prerequisite holds.
- **The two remaining ship gates are engineering, not algorithm:**
  1. **Porting** — the search runs on the sim's resumable engine (`personality-engine.js`); the live
     game has its own parallel AI in `play.js`. Shipping means getting the clone/rollout machinery into
     the browser — ideally by unifying `play.js` + the sim onto one engine (today hand-synced). This is
     the bulk of the cost.
  2. **Live timing** — guarantee each human's *final* pre-buy `drawState` (their card sets) has
     propagated identically to all clients before each runs the AI buy turn (gate it like the existing
     `drawDone` barrier). Confirmable only in a two-tab live test.

**Net:** the algorithm is **MP-safe and fair for human-v-human-v-AI**. Shipping it is a follow-on
engineering project (port + timing gate + two-tab test) — **the live game was not touched here.**

---

## Verdict

**Technical verdict: PASS.** Under fair, human-equivalent information the search clears the
pre-registered bar at N=256 — +7.9pp (2P) / +11.6pp (4P) vs the best pro, default opponent model. The
exhausted 14-param genome can't express lookahead; the search can, and the edge survives the fairness
constraint. **Product verdict: SHELVED** — the gain is moderate, unproven on humans, and the ship cost
(a real `play.js` port) is too high to justify now (see "Decision & status" above).

A clean result either way: we now *know* search beats the pros fairly, and we now *know* it isn't worth
shipping for a moderate bot-vs-bot gain. Both are bankable conclusions, not loose ends.

---

## If you pick this back up later

Everything below is committed on `main` and runs offline in Node (no Firebase/browser). The genome hot
path is byte-identical to pre-project; the live game is untouched.

### Reusable assets (what you get for free)
| Asset | File | What it is |
|---|---|---|
| Resumable engine core | `sim/personality-engine.js` | `createInitialState` → `continueGame(state,policies,horizon)` → `gameResult`; `cloneState`. Clone/resume any mid-game state. Also feeds the trajectory value oracle. |
| Reproduction gate | `sim/test-resume-reproduction.js` + `sim/fixtures/golden-runGame.json` | Proves the core reproduces `runGame` bit-for-bit. Re-run after any engine change. |
| The search AI | `sim/search-ai.js` | `makeSearchPolicy` / `searchChooseBuy`, fair-info determinization, seeded rollouts. A drop-in `__search` participant. |
| Bake-off harness | `sim/search-bakeoff.js` | `--mode sweep`/`ablate`/`verdict`/generic; 2P+4P; perfect/default model; `--cheat`/`--fair`; win% + cost. **Reusable for ANY future AI candidate vs the pros.** |
| MP-safety test | `sim/test-search-mp-determinism.js` | The buy decision is uid/representation-invariant (the MP-determinism prerequisite). |

Key commands:
```bash
node sim/test-resume-reproduction.js                  # engine integrity gate (must stay green)
node sim/search-b1-signal.js                          # quick head-to-head signal vs each pro
node sim/search-bakeoff.js --mode verdict --horizon endOfGame   # the fair scale verdict (N flag: --N 256)
node sim/search-bakeoff.js --mode sweep               # N × horizon strength/cost shape
```

### Path A — if you DO decide to ship it online (the deferred engineering)
The algorithm is fair + MP-deterministic; what remains is integration:
1. **Unify the engines.** Today `src/play.js` has its own AI and `sim/personality-engine.js` is a
   hand-synced parallel copy. Port (or share) the resumable core + `search-ai.js` into the browser so
   the live AI *is* the simulated AI. This is the bulk of the work and also kills the chronic
   play.js↔sim drift risk.
2. **Add the live `drawState`-timing gate.** Don't run a search AI's buy turn until every human's final
   pre-buy `drawState` (card sets) has landed identically on all clients — mirror the existing
   `drawDone` barrier. This is the one thing only a two-tab live test can confirm.
3. **Wire it into the difficulty picker** (`gamesetup.html` `DIFFICULTY_TIERS` / `pickAiForSlot`) as a
   new top tier; config = **N=256, `endOfGame`, default model, fairInfo on**.
4. **Test:** two-tab live MP (the §4c determinism gate) + a fresh `simulate.js` re-tier.

### Path B — if you want to SIMULATE something smarter first (cheaper, sim-only)
The harness makes new AI candidates cheap to bake off. In rough order of expected value:
1. **Learned policy (Route C) — the most promising.** Use this search as a *teacher*: generate
   (state → best buy) examples offline, distill into a fast policy (small net or a richer scoring
   function). A learned policy evaluates in microseconds → **removes the latency + per-turn-compute
   objection entirely**, and could ship as a `play.js` function without the rollout machinery. This is
   the natural way to make "search-strength, param-cost" AI.
2. **Draw-phase search (B3, never built).** Add `searchShouldDraw` (when to stop drawing). Higher-volume
   decisions → watch cost; measure whether it adds anything beyond buy-only. Buy-only left this on the
   table.
3. **Light MCTS (UCB over candidates)** instead of flat MC — spends the rollout budget where it matters;
   could reach N=256 strength at lower N.
4. **Better value function** at shorter horizons (a learned or hand-tuned end-of-act evaluator) so you
   don't need full `endOfGame` rollouts — big latency win if it holds.
5. **Smarter fair opponent modeling** — still public-info only (see
   [[feedback-ai-human-info-only]]): e.g. infer an opponent's *archetype* from their observed buys
   instead of always assuming `enforcer`.

### Don't bother re-doing
- Re-litigating the 14-param genome (coevolution proved it's tapped out — `TUNING.md`).
- The perfect-information ("cheating") numbers — they're an upper bound, not shippable.
- `endOfRound` horizons (dead) and N<64 for the fair model (under-resourced).

### Adjacent payoff even if the AI never ships
The resumable core (B0) is shared infrastructure with the trajectory Monte-Carlo **value oracle**
([`docs/TRAJECTORY_PHASE1_PLAN.md`](../docs/TRAJECTORY_PHASE1_PLAN.md)) — EV-labeling human decisions to
measure *quality*. The search itself is a ready-made stronger-than-pro reference for that, and for
re-checking card balance.
