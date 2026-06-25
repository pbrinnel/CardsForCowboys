# AI Search Bake-Off — Next-Phase Plan (Route B: lookahead / Monte-Carlo)

**Status:** ✅ **COMPLETE → SHELVED (not shipping).** Technical verdict POSITIVE: under a **fair,
human-equivalent** information model the flat-MC buy-phase search clears the bar at N=256 (Δ2P +7.9pp /
Δ4P +11.6pp vs the best pro, default model). Product verdict: **the owner decided it's not worth the
`play.js` port** for a moderate, human-unproven, bot-vs-bot gain. **→ The conclusive record + resume
guide is [`AI_SEARCH_RESULTS.md`](AI_SEARCH_RESULTS.md) (read its "If you pick this back up later"
section first).** This file is the phase-by-phase build log. The earlier "+7.2/+8.0pp" figures used
hidden info and are an upper-bound ablation only. Read [`TUNING.md`](TUNING.md) /
[`AI_PERSONALITIES.md`](AI_PERSONALITIES.md) for the parameter-AI world it competed against.

### Progress log
- **B0 ✅ (done):** `personality-engine.js` refactored to a resumable phase state machine —
  `createInitialState` → `continueGame(state, policies, horizon)` → `gameResult`, with `runGame`
  now a thin wrapper. `cloneState` deep-copies players/pyramid (re-pointing the `copyNextCard`/
  `copyNextDonor` aliases at the clone's own card instances) and gives the clone an **independent
  LCG** positioned at the same internal state (so a fork can never perturb the live RNG — §4b).
  The RNG lives *in* the state (cloneState captures it atomically) rather than being a separate
  param; horizon ∈ `endOfRound | endOfAct | endOfGame`; the buy phase is resumable via
  `buyCursor` (the search's clone point). **Gate:** `node sim/test-resume-reproduction.js` — golden
  bit-for-bit (1350 games) + round/act-granular resume ≡ runGame + clone independence (3000 forks,
  originals unperturbed) + mid-buy resumption + copy-next remap unit. Regression: `simulate.js`
  (2P+4P), `draw-cap-experiment.js` outputs **byte-identical** to pre-refactor; sync/evolve/ceiling
  smoke green. New files: `sim/gen-golden.js`, `sim/fixtures/golden-runGame.json`,
  `sim/test-resume-reproduction.js`.
- **B1 ✅ (first signal — POSITIVE, perfect model):** `sim/search-ai.js` flat-MC `searchChooseBuy`
  (candidates = affordable buys + top-K denial burns, `branchCap=12`; per candidate N=64 rollouts,
  each a `cloneState` + fresh seeded LCG + `continueGame` to `horizon=endOfAct`; value = herd-margin
  with the §7 horizon heuristic; argmax + deterministic scoreCard tiebreak). Draw phase stays
  heuristic (`drawGenome=enforcer`). Wired in via the §8 seam (`policy.decideBuy` hook — no
  engine→search import). **Signal (`sim/search-b1-signal.js`, 2P, both seat orders, perfect model,
  default=enforcer):** beats enforcer **62.9%** (95% CI ±3.3pp, n=800 — excludes 50%); beats the
  rest of the Hard field 68–73% (drifter 68.0, deputy 69.0, prospector 69.3, rancher 73.3). I.e.
  buy-phase lookahead adds ~13pp over plain enforcer when the opponent model is exact. **Cost:** ~313
  rollouts/decision, ~18 ms/game. Determinism verified (same game twice ≡). Genome path still
  byte-identical (B0 gate + simulate diffs green). New files: `sim/search-ai.js`,
  `sim/search-b1-signal.js`.
  **Caveat:** this is the PERFECT-model upper bound (§6) — the search knows the opponent is enforcer.
  The shippable question is the REALISTIC (default) model, measured at scale in B2–B4.
- **B2 ✅ (ablation + sweeps + cost):** harness `sim/search-bakeoff.js` (reusable head-to-head /
  vs-field, 2P+4P, both models, cost metrics — also the B4 core).
  - **Sweep (vs enforcer 2P, model-moot, 120 seeds, win% / cost):** `endOfRound` is **worthless**
    (~52% at every N — the horizon heuristic can't see a buy's payoff that early). `endOfAct`:
    N16 54.2 / N64 66.7 / N256 63.7 (plateaus ~N64). `endOfGame`: N16 55.0 / N64 67.9 / **N256 72.9**
    — the only horizon with no value-bias, keeps scaling with N. Cost: N64 endOfAct 18ms/game,
    N64 endOfGame 72ms, N256 endOfGame 294ms. **Takeaway: use `endOfGame`.**
  - **Ablation — search vs FIELD, perfect vs default opponent model (§6), default=enforcer:**
    | config | Δ2P (default) | 2P gap | Δ4P (default) | 4P gap |
    |---|---|---|---|---|
    | N64 endOfAct | +6.2pp (77.8 vs 70.6, n=3000) | 3.8pp | **+3.7pp** (46.7 vs 43.0, n=300) | 10.3pp |
    | **N64 endOfGame** | **+5.9pp** (77.0 vs 71.1, n=2000) | 4.6pp | **+10.4pp** (53.2 vs 42.8, n=250) | 6.0pp |
  - **Headline finding:** the `endOfAct` horizon-value heuristic (§7) was badly *undervaluing* 4P
    play; switching to `endOfGame` lifts Δ4P from +3.7pp → **+10.4pp** while holding 2P. Under the
    **realistic (default) model**, N64 `endOfGame` clears the proposed +5pp bar at **both** 2P (+5.9)
    and 4P (+10.4) — point estimates; CIs at this seed count are ±~3pp (2P) / ±~9pp (4P), so B4
    scale is needed to firm up "≥5pp". The perfect↔default gaps are modest (4.6 / 6.0pp) → the
    search does **not** lean heavily on knowing opponents (good for generalization / shippability).
  - **Cost / latency:** N64 endOfGame ≈ 6ms/decision (2P) / 14ms/decision (4P) — within the ~50ms
    MP budget. N256 endOfGame ≈ 24/56ms (4P over budget). **Recommended bake-off config: N=64,
    horizon=endOfGame.**
- **B3 — SKIPPED (by decision):** buy-only search already clears the bar, so draw-phase search (the
  highest-cost decision class) was skipped for the headline verdict. Available as a future enhancement.
- **B4 ✅ (scale verdict — CLEARS THE BAR):** bar frozen with the user = Δ point-est ≥+5pp at BOTH 2P
  and 4P under the **default** model, 95% CI excluding 0. Run: `search-bakeoff.js --mode verdict --N
  64 --horizon endOfGame --seeds 300 --seeds4 2000`.
  - **2P (n=6000):** search 77.3% vs best pro enforcer 70.1% → **Δ2P = +7.2pp ±1.6** (CI [5.6, 8.8]) → PASS.
  - **4P (n=2000):** search 51.4% vs best pro drifter 43.4% → **Δ4P = +8.0pp ±3.1** (CI [4.9, 11.1]) → PASS.
  - Robustness from the B2 sweep (positive across N and endOfAct/endOfGame). **VERDICT: ✅ clears the
    bar under the realistic model at both player counts.**
- **FAIR-INFO RE-MEASUREMENT (binding result):** the project owner required that an AI use only
  information a human has — no peeking at hidden deck order (own or opponents'). The search's rollouts
  were determinized (reshuffle every deck per rollout, keep the public set, randomize hidden order —
  `search-ai.js` `determinizeHiddenDecks`, default on; the imperfect-information MC formulation, also
  MP-deterministic). Fairness costs ~3pp and ~4× the rollouts:
  | model | N | Δ2P | Δ4P | bar |
  |---|---|---|---|---|
  | cheating (true deck order — UPPER BOUND, not shippable) | 64 | +7.2pp | +8.0pp | (invalid: hidden info) |
  | **fair** | 64 | +4.3pp ❌ | +5.7pp ✅ | misses (2P short) |
  | **fair** | 256 | **+7.9pp ✅** | **+11.6pp ✅** | **CLEARS** |
  Proof it's MP-safe: `test-search-mp-determinism.js` — the buy decision is uid/representation
  -invariant (168 decisions), so it uses only shared/derivable info.
- **B5 ✅ (verdict doc):** [`AI_SEARCH_RESULTS.md`](AI_SEARCH_RESULTS.md) — full evidence + ship
  recommendation. **Route B validated under fair info at N=256.** Recommend N256 `endOfGame` default
  model, fair determinization; MP-deterministic by construction. Shipping = port the resumable engine
  into `play.js` + live drawState-timing gate + two-tab MP test (separate phase, NOT done here). The
  margin (~+8/+12pp over the best Hard bot) is real but moderate vs. the port cost — a product call.

---

## 1. The goal (one sentence)

Build a **lookahead / Monte-Carlo search AI**, drop it into the **same simulation/coevolution
harness** as a competitor against the existing parameter ("pro") bots, and **measure whether it
beats the pros by a margin large enough to justify the extra complexity.** If it can't beat the
old pros at their own game by a clear margin, we shelve it and say so.

This is a **bake-off with a pre-registered success bar**, not a "ship a smarter AI" task. The
deliverable is *evidence + a verdict*, then (only if it clears the bar) a ship recommendation.

## 2. Why this, why now

This session proved the 14-parameter heuristic genome is **exhausted**: competitive coevolution
(`evolve.js --coevolve`, strong-opponent fitness + Hall of Fame) could not out-design the existing
Hard bots — 3/3 trials converged onto the `enforcer` genome; `denialWeight → 0` robustly. See the
June 2026 note in `TUNING.md`. The only remaining way to make the AI *play better* (not just be
tuned better) is to give it **decision capabilities the genome cannot express** — i.e. actually
looking ahead instead of scoring the current position with fixed weights.

The chosen route (B) is the genuine step-change: the engine is already deterministic and headless,
so the AI can **roll out** possible futures and pick the highest-expected-value action.

---

## 3. The engine you're plugging into (current reality — read carefully)

All sim AI lives in [`personality-engine.js`](personality-engine.js). Key facts:

- `runGame(genomes, numPlayers, seed, opts)` → `{herds, winner, busts, drawRounds}`. It is a
  single linear function: **3 acts × 5 rounds**. Each round: `runDrawPhase` → tally → `runBuyPhase`
  → score. Showdown adds final card cows + `floor(totalDollars / 2)` bonus cows.
- The two decision hooks, **called identically for every player** (dispatch is by array index, all
  share the same functions):
  - `shouldDraw(player, genome, pyramid, act, allPlayers)` → bool (called per draw inside
    `runDrawPhase`).
  - `chooseBuy(player, genome, pyramid, act, allPlayers)` → `{action:'buy'|'burn'|'pass', row, col}`.
- **State is mutated in place.** `players[]` (deck/hand/discard/herd/roundCows/…), `pyramid[][]`
  (`{card, faceUp, removed}` cells). There is **no snapshot, no clone, no resume**. `runGame`
  builds fresh and runs to the end.
- RNG is a single seeded LCG (`makeLCG(seed)`), threaded through draws/shuffles. Same seed ⇒ same
  game (reproducibility is load-bearing for GA fitness).
- A "genome" is just a data object. The engine never branches on AI *type*.

**Consequence:** a search AI needs to (a) clone the whole game state, (b) play the clone forward
to a horizon under default policies, (c) read the outcome, (d) throw the clone away — many times
per decision. None of that infrastructure exists yet. **Building it is the bulk of the work.**

---

## 4. Two hard constraints (design around these from line 1)

### 4a. Resumable + cloneable simulation — THE central build item
You must be able to **continue a game from an arbitrary mid-game state** under arbitrary
per-seat policies. Refactor `runGame` into a resumable core:

- `cloneState(state)` — deep copy of `{players, pyramid, act, round, buyCursor, rngState}`. Cards
  are plain objects; clone by value. Must be cheap (it runs thousands of times).
- `continueGame(state, policies, rng, horizon)` — plays from `state` to `horizon`
  (`'endOfRound' | 'endOfAct' | 'endOfGame'`) and returns the resulting state / herds. The real
  `runGame` should become a thin wrapper: build initial state → `continueGame(…, 'endOfGame')`.
- **Acceptance gate B0:** `continueGame` from a fresh round-1 start must reproduce `runGame`
  **bit-for-bit** over a few hundred seeds (herds identical). If it doesn't, every downstream
  measurement is garbage. Write this regression test first.

This resumable simulator is **shared infrastructure** with the trajectory Monte-Carlo value oracle
(`docs/TRAJECTORY_PHASE1_PLAN.md`) — build it cleanly; both efforts use it.

### 4b. Rollout RNG hygiene
Rollouts must **not** consume the live game's RNG (or they alter actual play / break
reproducibility). Each rollout gets its **own** LCG, seeded **deterministically** from the
decision context (e.g. `gameSeed ⊕ act ⊕ round ⊕ slot ⊕ candidateIdx ⊕ rolloutIdx`) so fitness
stays reproducible. Never use `Math.random` in the search.

### 4c. MP determinism (a downstream SHIP gate, not a bake-off concern)
The live game runs every AI on every client with **no broadcast**; they must stay identical or MP
desyncs (this is why the card_4 swap AI is pyramid-only). For the **offline bake-off this does not
matter**. But if the search AI is ever to ship in MP, every rollout must be seeded from **shared**
state and use only **shared** information (the pyramid, public herds) — never per-client
opponent-hand views. Flag this in the verdict: a search AI that needs hidden info is offline-only.

---

## 5. The algorithm (start simple: flat Monte-Carlo / 1-ply expectimax)

At a decision point, for the acting seat:
1. **Enumerate candidate actions.** Buy phase: each affordable buy, each burn (or top-K by the
   existing `scoreCard` to bound the branching), plus special activations (extra-buy target,
   `$`-burn activation, swap target). Draw phase: `{continue, stop}`.
2. For each candidate: clone state, apply the candidate, then run **N rollouts** to `horizon`
   under a **default policy** for all seats (including self after this action), each rollout with
   its own seeded RNG.
3. **Value** each rollout outcome (see §7) and average.
4. Pick the **argmax** candidate. (Tie-break deterministically, e.g. by `scoreCard`, for
   reproducibility.)

Knobs (all measured later): `N` (rollouts/candidate), `horizon`, `defaultPolicy`, candidate
branching cap. Start with: buy-phase only, `N=64`, `horizon='endOfAct'`, `defaultPolicy=enforcer`.

Later, if flat MC clears the bar but is shaky: consider light **MCTS** (UCB over candidates) — but
do NOT start there. Flat MC first; it's enough to answer "is search worth it?".

---

## 6. The scientific control: opponent-model ablation

This is the most important experimental knob — it tells you whether the search is *real* or just
exploiting privileged information.

- **Perfect model (upper bound):** rollouts use the opponents' **true genomes**. Best case for
  search. **If it can't beat the pros even here, the approach is dead — stop.**
- **Default model (realistic):** rollouts assume every opponent plays a fixed strong default
  (e.g. `enforcer`), regardless of who they actually are. This is what a shippable AI could
  actually do (you don't know opponents' genomes in the live game).
- The **gap** between the two = how much the search leans on knowing opponents. A big gap means it
  won't generalize to real opponents (and definitely not to humans).

Report both. The "worth it" verdict must hold under the **default** model, not just perfect.

---

## 7. Value target (decide in B1, default given)

The win is determined at showdown by total herd. Options for the rollout value:
- **Win/loss label** (`1` if focal seat has top herd at `endOfGame`, else `0`) — cleanest, needs
  full-game rollouts (expensive).
- **Herd margin** (`focalHerd − bestOpponentHerd`) at the horizon — works at shorter horizons,
  smoother signal. **Default: use this at `endOfAct`, plus a horizon-value heuristic** = current
  herd + a cheap deck-EV term + the showdown `floor(dollars/2)` bonus approximation, so end-of-act
  rollouts don't ignore late-game card value.

Whatever you choose, **state it and keep it fixed across the ablation** so comparisons are clean.

---

## 8. Harness integration (compete in the SAME arena as the pros)

The user's explicit ask: the search AI must compete **inside the existing coevolution/simulation
experiment**, head-to-head with the parameter pros.

Recommended minimal seam (keeps the genome path the untouched hot path):
- A **participant** is either a genome (today's behavior) or a search policy. Represent the latter
  as a tagged object, e.g. `{ __search: true, N, horizon, defaultPolicy, branchCap }`.
- In `runDrawPhase` / `runBuyPhase`, dispatch: if the seat's participant is `__search`, call
  `searchShouldDraw(...)` / `searchChooseBuy(...)` (new, in `sim/search-ai.js`); else the existing
  `shouldDraw` / `chooseBuy`. **Regression gate:** with no search seats, every `simulate.js`
  number must be byte-identical to today (the genome path must not move).
- `simulate.js` and `evolve.js --coevolve` then accept a search participant as one of the
  competitors. New `sim/search-bakeoff.js` orchestrates the head-to-head (mirror `simulate.js`'s
  2P matrix + 4P focal-vs-field, both seat orders, fixed seed set), and additionally reports
  **avg rollouts/decision** and **wall-time/game** (the cost side of the tradeoff).

---

## 9. The pre-registered "worth it" bar (set BEFORE running; adjust only before B4)

Define `Δ2P = winRate(search vs field) − winRate(best pro vs same field)` and likewise `Δ4P`.
Current best pros vs field (June 2026, `simulate.js`): ~70% 2P / ~41% 4P (enforcer/drifter).

Proposed bar (confirm/tune before the B4 run, then freeze):
- **Strength:** `Δ2P ≥ +5pp` AND `Δ4P ≥ +5pp`, **under the default (realistic) opponent model**,
  on ≥ several-thousand seeds per cell (so the CI excludes 0).
- **Robustness:** still positive across horizon/N sweeps (not a single lucky config).
- **Cost:** acceptable for the intended use. Offline (tuning/oracle) — generous. MP-ship — strict:
  must also satisfy §4c (shared-info, seeded) AND a per-decision latency budget (propose ≤ ~50ms
  on a typical client; measure). If it only wins under the perfect model, or only above a latency
  the live game can't afford, the verdict is **"interesting, not shippable."**

A negative result is a **success** for this task: it definitively closes Route B and points the
budget at Route C (learned policy) or content/feature work.

---

## 10. Phased plan for the next session

- **B0 — Resumable simulator + clone (enabling refactor).** ✅ **DONE & green.** `cloneState`,
  `continueGame`, `runGame` wraps it. Reproduction gate (`test-resume-reproduction.js`) passes
  bit-for-bit; all consumer tools byte-identical. *No AI yet.* See Progress log above.
- **B1 — Buy-phase-only search, perfect model.** ✅ **DONE — positive signal.** `sim/search-ai.js`
  `searchChooseBuy`; draw stays heuristic. `N=64`, `horizon=endOfAct`, value=herd-margin, opponents =
  true genomes. **Beats enforcer 62.9% (CI excludes 50%); beats whole Hard field 68–73%.** See
  Progress log. Caveat: perfect-model upper bound — realistic model is B2.
- **B2 — Ablation + sweeps + cost.** ✅ **DONE.** Default-model rollouts + N×horizon sweep + cost.
  **Result:** use `endOfGame`; N64 `endOfGame` clears the proposed +5pp bar at both 2P (+5.9) and
  4P (+10.4) under the realistic model (point est.); perfect↔default gaps small. See Progress log.
- **B3 — Add draw-phase search** (`searchShouldDraw`). Re-measure; draw decisions are higher-volume
  so watch the cost explode here.
- **B4 — Bake-off at scale in the real arena.** ✅ **DONE — CLEARS THE BAR.** N64 `endOfGame` vs the
  full field, default model: Δ2P +7.2pp / Δ4P +8.0pp (both CIs exclude 0). See Progress log.
- **B5 — Verdict.** ✅ **DONE.** [`AI_SEARCH_RESULTS.md`](AI_SEARCH_RESULTS.md): numbers, ablation,
  cost, shippability, **ship-worthy** recommendation. Route B validated.

---

## 11. File map (what to create / touch)

| File | Action |
|---|---|
| `sim/personality-engine.js` | ✅ B0 done: refactored to resumable core (`createInitialState`/`continueGame`/`cloneState`/`gameResult`). **TODO B1:** add `__search` dispatch in draw/buy phases. Genome path stayed byte-identical. |
| `sim/gen-golden.js` | ✅ NEW (B0). Regenerates the frozen golden snapshot (run on the reference engine). |
| `sim/fixtures/golden-runGame.json` | ✅ NEW (B0). Frozen runGame output (1350 games) — the regression baseline. |
| `sim/test-resume-reproduction.js` | ✅ NEW (B0). Gate: golden bit-for-bit + resume/clone/mid-buy equivalence. |
| `sim/search-ai.js` | ✅ B1 done: flat-MC `searchChooseBuy` + `makeSearchPolicy` (perfect/default oppModel, value fn, seeded rollout RNG). **TODO B3:** add `searchShouldDraw`. |
| `sim/search-b1-signal.js` | ✅ NEW (B1). First-signal harness: search vs each pro head-to-head (2P), win% + cost. |
| `sim/search-bakeoff.js` | ✅ NEW (B2). Reusable head-to-head / vs-field harness (2P+4P, perfect/default model, `--mode sweep`/`ablate`) + cost metrics. Also the B4 core. |
| `sim/evolve.js` | TODO B4. Allow a `__search` participant in `--coevolve` (compete in the same GA arena). |
| `sim/AI_SEARCH_RESULTS.md` | ✅ NEW (B5). The verdict: evidence + cost + shippability + ship-worthy recommendation. |

Leave the live game (`src/play.js`) **untouched** until/unless B5 says ship — and then only after
solving §4c. This whole effort is sim-side until the verdict is in.

---

## 12. Risks & gotchas

- **Compute blowup.** Cost ≈ decisions/game × candidates × `N` × rollout-length × seats. Draw-phase
  decisions are numerous; full-game horizons are long. Bound branching (top-K candidates), start
  with short horizons, profile early.
- **Clone correctness.** In-place mutation bugs are the classic failure. Specials carry hidden
  state (`copyNextDonor/copyNextCard`, `hasExtraBuy/extraBuyUsed`, `hasBuyBurnFirst`, `forcedDraws`
  equivalent) — the clone must capture ALL of it. The B0 reproduction test is your safety net.
- **RNG bleed** (§4b) — the subtle one. If rollouts perturb the live RNG, fitness becomes
  irreproducible and the bake-off is meaningless.
- **Horizon value bias.** Short horizons ignore the showdown `floor(dollars/2)` bonus and final
  card cows — bake an approximation into the horizon value (§7) or you'll undervalue economy.
- **Perfect-model self-deception** (§6) — easy to get a great number that evaporates under the
  realistic model. The ablation is non-negotiable.
- **Determinism for ship** (§4c) — don't accidentally design a winner that can't ship in MP.

## 13. Open questions for the next session to decide

- Value target: win-prob vs herd-margin vs rank? (default §7 given.)
- Flat MC vs MCTS? (start flat.)
- Should the search policy's few knobs (`N`, `horizon`) themselves be evolved, or hand-set?
- Self-play rollout policy: fixed `enforcer`, or the search AI recursively (almost certainly too
  expensive — note and avoid)?

## 14. Pointers
- `TUNING.md` — the param-AI world + the "params exhausted" finding you're challenging.
- `AI_PERSONALITIES.md` — the pros' genomes and measured win%.
- `evolve.js --coevolve` / `simulate.js` / `draw-cap-experiment.js` — the harness to mirror/extend.
- `ceiling-probe.js` — example of a focused vs-the-pros probe.
- `docs/TRAJECTORY_PHASE1_PLAN.md` — the value-oracle roadmap that shares the §4a resumable simulator.
