# AI Search Bake-Off — Results & Verdict (Route B: lookahead / Monte-Carlo)

**Status:** B0–B2 + B4 complete; B3 (draw-phase search) deliberately skipped (buy-only already
clears the bar). This is the deliverable from [`AI_SEARCH_BAKEOFF_PLAN.md`](AI_SEARCH_BAKEOFF_PLAN.md):
*evidence + a verdict*. Read that plan for the design rationale; read [`TUNING.md`](TUNING.md) for the
parameter-AI world the search competes against.

---

## TL;DR verdict

**A flat Monte-Carlo buy-phase search BEATS the parameter "pro" bots by a clear margin — and the
edge survives the realistic opponent model.** Under the shippable (default) model, with N=64 rollouts
to an `endOfGame` horizon, the search **clears the pre-registered bar** (Δ ≥ +5pp vs the best pro at
**both** 2P and 4P, default model, 95% CI excluding 0):

| | search (default model) | best pro | **Δ vs best pro** | frozen bar (≥+5pp, CI>0) |
|---|---|---|---|---|
| **2P** | 77.3% (±1.1, n=6000) | 70.1% (enforcer) | **+7.2pp ±1.6** → CI [5.6, 8.8] | ✅ PASS |
| **4P** | 51.4% (±2.2, n=2000) | 43.4% (drifter) | **+8.0pp ±3.1** → CI [4.9, 11.1] | ✅ PASS |

This closes the question the prior session opened: the 14-parameter genome was exhausted
(coevolution converged to `enforcer` and couldn't out-design the Hard bots), so the only way left to
play *better* was a capability the genome can't express — actual lookahead. **It works.**

**Recommendation: ship-worthy, and viable for human-v-human-v-AI.** The verdict is positive — Route B
is real, not a perfect-info artifact. The config that passed (N64 `endOfGame`, **default** opponent
model) is exactly the one usable against humans, and the information its rollouts need is **already
shared** across clients by `drawState` (ordered hand/deck/discard). The decision is uid/representation
-invariant (proven), so all clients compute the same move — the MP-determinism prerequisite holds.
What's left is **engineering, not algorithm**: port the resumable engine into `play.js`, add a live
`drawState`-timing gate, and verify with two-tab MP testing (§4c below). This doc is **not**
authorization to modify the live game — shipping is its own phase with its own MP-determinism gate.

---

## What the search is (method)

At the focal seat's **buy turn**, for each candidate primary action:

1. **Candidates** = every affordable buy + the top-K denial burns (ranked by value-to-the-leader),
   capped at `branchCap=12`. Crucially the search may *burn even when it could buy* — a denial play
   the genome never makes.
2. **Rollouts**: clone the live game state ([`cloneState`](personality-engine.js)), apply the focal's
   whole turn (candidate + a default-genome bonus buy), give the clone its **own** deterministically
   seeded LCG, and play forward under default policies to a **horizon** (`endOfGame`). N=64 rollouts
   per candidate.
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

### B4 — scale verdict (default model, N=64 endOfGame)
`node sim/search-bakeoff.js --mode verdict --N 64 --horizon endOfGame --seeds 300 --seeds4 2000`

| | search [default] | enforcer | drifter | **Δ vs best pro** | bar |
|---|---|---|---|---|---|
| **2P** (n=6000) | **77.3%** ±1.1 | 70.1% ±1.2 | 69.1% ±1.2 | **+7.2pp ±1.6** (vs enforcer) | ✅ PASS |
| **4P** (n=2000) | **51.4%** ±2.2 | 41.9% ±2.2 | 43.4% ±2.2 | **+8.0pp ±3.1** (vs drifter) | ✅ PASS |

Both Δ point estimates exceed +5pp **and** their 95% CIs exclude 0 (the 2P CI lower bound, +5.6,
even exceeds +5). **Robustness** is established by B2: the edge is positive across N (16/64/256) and
across the `endOfAct`/`endOfGame` horizons — not a single lucky config. Note the 4P scale number
(+8.0pp, n=2000) is tighter than the B2 moderate-seed read (+10.4pp, n=250) but comfortably clears.

---

## Cost / latency

| config | rollouts/decision | ms/game | ≈ ms/decision |
|---|---|---|---|
| N64 `endOfAct` (2P) | ~310 | 18 | ~1.5 |
| N64 `endOfGame` (2P) | ~311 | 72 | ~6 |
| N64 `endOfGame` (4P) | ~410 | 213 | ~14 |
| N256 `endOfGame` (4P) | ~1640 | ~850 | ~56 |

At the recommended **N64 `endOfGame`**, a decision costs ~6 ms (2P) / ~14 ms (4P) — comfortably
inside a ~50 ms live-play budget. N=256 buys a few more pp but pushes 4P past the budget.

---

## Shippability (§4c) — important caveats

The offline bake-off answers "is search worth it?" cleanly. **Shipping into the live game has a
determinism constraint** the bake-off doesn't exercise: every client runs every AI locally with no
broadcast, so an AI seat's decision must be identical on all clients (or MP desyncs — the same reason
the `card_4` swap AI is pyramid-only). The good news (after checking the live sync) is that the
**information the rollout needs is already shared**, so the strength result carries to human MP:

- **What's shared across clients at an AI's buy turn:** the pyramid (via `actSetup`), public herds,
  every AI seat's state (seed-reconstructable), and — critically — **every human's full
  `hand`/`deck`/`discard` as ordered card-id arrays** (`src/play.js` `pushDrawState`). So every client
  builds an *identical* clone. Future draws *inside* a rollout use the **shared-seeded** rollout LCG
  (not a human's real `Math.random`), so they're identical across clients too. The search never
  consumes a human's true future draws — only a shared fiction.
- **Representation-invariance proven:** the buy decision is identical under hard `uid` relabeling
  (`sim/test-search-mp-determinism.js`, 168 decisions) — it depends only on ids/order/stats + shared
  seeds, exactly what `drawState` makes identical. This is the MP-determinism prerequisite, and it holds.
- **Use the DEFAULT opponent model** vs humans (you can't know a human's "genome") — which is exactly
  the model that passed B4 (+7.2 / +8.0pp). So the human-MP-relevant number is *already measured*.
- **Remaining gates (engineering, not algorithmic):**
  1. **Live timing** — guarantee each human's *final* pre-buy `drawState` has propagated identically
     to all clients before each runs the AI buy turn (gate it like the existing `drawDone` barrier).
     Verifiable only in a two-tab live test (the ship-phase MP-determinism gate).
  2. **Porting** — the search runs on the sim's resumable engine (`personality-engine.js`); the live
     game has its own parallel AI in `play.js`. Shipping means getting the resumable clone/rollout
     machinery into the browser — ideally by unifying `play.js` + sim onto one engine (today they're
     hand-synced). Non-trivial.
  3. **Clairvoyance (optional)** — rollouts use opponents' synced *deck order*, so the AI "knows"
     their near-future draws (shared info, not cheating, and washed out by reshuffles — but it could
     feel strong). A shared-seed reshuffle of opponents' decks removes it; measure the strength cost
     if desired.

**Net:** the algorithm is **MP-safe for human-v-human-v-AI** (default model, shared info,
uid-invariant). Actually shipping it is a follow-on engineering project — port the resumable engine
into `play.js` + add the live drawState-timing gate + two-tab determinism testing — **not done here**
(this effort is sim-side per the plan; the live game is untouched).

---

## Verdict & recommendation

**The search clears the pre-registered bar: PASS at 2P (+7.2pp) and PASS at 4P (+8.0pp), under the
realistic (default) opponent model, CIs excluding 0.** Route B is validated — lookahead expresses
real skill the exhausted 14-parameter genome cannot, and the edge is not a perfect-information
artifact (the perfect↔default gap is only ~5pp, and the *default* model is what passed).

**Recommendation — ship-worthy, including for human-v-human-v-AI:**
1. **Config:** adopt **N64 `endOfGame`, default opponent model**. Clears the bar at affordable
   latency (~6 ms/decision 2P, ~14 ms 4P), and is the MP-correct model (no peeking at human "genomes").
2. **MP-safety is established at the algorithm level:** the rollout uses only info `drawState` already
   shares (ordered hand/deck/discard) + shared-seeded RNG, and the decision is uid/representation
   -invariant (proven). All clients compute the same move. Solo / all-AI games are the simplest case;
   human-v-human-v-AI is viable under the same model.
3. **The actual ship is a follow-on engineering project** (touches `src/play.js`, NOT done here):
   - Port the resumable engine + search into the browser (ideally unify `play.js` + the sim onto one
     engine, instead of the current hand-synced parallel implementations).
   - Add a live `drawState`-timing gate: don't run the AI buy turn until each human's final pre-buy
     `drawState` has propagated identically to all clients (mirror the existing `drawDone` barrier).
   - Verify with two-tab live MP testing (the §4c MP-determinism gate).
   - Optional: decide on the clairvoyance question (use synced deck order vs shared-seed reshuffle).

This bake-off is sim-side and complete; shipping is a separate phase with its own MP-determinism gate.

**If instead the goal is to leave the live AI alone:** the search still pays off as an **offline
oracle** — a stronger-than-pro reference for scoring human trajectories
([`docs/TRAJECTORY_PHASE1_PLAN.md`](../docs/TRAJECTORY_PHASE1_PLAN.md)) and for re-checking card
balance, reusing the exact B0 resumable core.

---

## What it would take to revisit / go further
- **Draw-phase search (B3):** add `searchShouldDraw`. Higher volume (many draws/round) → watch cost;
  measure whether it adds anything beyond buy-only.
- **Light MCTS (UCB over candidates)** instead of flat MC if a tighter rollout budget is needed.
- **Higher N / N=256 `endOfGame`** for a few more pp where latency allows (offline tuning/oracle use).
- **Shared-info rollout** for live human-MP (the ship blocker above).
- **Learned policy (Route C):** distill the search's decisions into a fast policy — the natural next
  step if search proves valuable but too slow for some targets.
- The resumable core (B0) is **shared infrastructure** with the trajectory Monte-Carlo value oracle
  ([`docs/TRAJECTORY_PHASE1_PLAN.md`](../docs/TRAJECTORY_PHASE1_PLAN.md)) — both efforts reuse it.
