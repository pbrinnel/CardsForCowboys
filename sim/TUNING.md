# AI Tuning & Simulation Guide

**The one place to start when you want to change, tune, or validate the AI or the card set.**
Everything here runs offline in Node (no Firebase, no browser).

---

## Goal

Two questions, two kinds of tool:

| You want to know… | Use | What it does |
|---|---|---|
| Are the 6 bots at their intended difficulty? Is any card over/under-powered? | `simulate.js` | **Validates** the current AI + cards |
| Can the AI parameters be *better*? | `evolve.js` (broad GA search) + focused A/Bs like `draw-cap-experiment.js` | **Searches** for better params |
| Do sim card values match how humans actually play? | `admin/gen-sim-tierlist.js` + `admin/compare-tierlists.py` | sim-vs-human card tierlist |

The AI's decision logic is **identical** to the live game (`src/play.js`); the sim just runs it
thousands of times headlessly and reports aggregates.

---

## The pieces (read this map before touching anything)

```
personalities.js        ← THE 6 BOTS (data). Single source of truth, synced to play.js.
personality-engine.js   ← AI decisions + one-game runner. Same logic as the live game.
                          Also the RESUMABLE CORE: createInitialState/continueGame/cloneState/
                          gameResult (runGame is now a thin wrapper). Used by the search-AI
                          bake-off (AI_SEARCH_BAKEOFF_PLAN.md) + the trajectory value oracle.
game-core.js            ← card DB, pyramid build, card effects (lower level).
tiebreaker.js           ← buy-order tiebreak (shared with the live game).
test-resume-reproduction.js ← B0 gate: continueGame/cloneState reproduce runGame bit-for-bit.

evolve.js               ← genetic algorithm: SEARCHES param space for better genomes.
simulate.js             ← VALIDATES current bots: win matrix + per-card balance table.
draw-cap-experiment.js  ← EXAMPLE of a focused single-parameter A/B (copy as a template).
test-personality-sync.js← GUARD: fails if personalities.js drifts from play.js.
```

A **genome** = one personality's parameter object (see `personalities.js`). `runGame(genomes,
numPlayers, seed)` replays a full deterministic 3-act game and returns `{herds, winner, busts,
drawRounds}`. Same `seed` ⇒ same game.

**Scope:** 2–4 players only (the engine doesn't model 5–8P flat-row pyramids). Personality params
live in `AI_PERSONALITIES` — the full reference is [`AI_PERSONALITIES.md`](AI_PERSONALITIES.md).

---

## ⚠️ The golden rule: one source of truth

`src/play.js` `AI_PERSONALITIES` (**what ships**) and `sim/personalities.js` (**what the sim runs**)
must stay identical. Drift here silently rots every tuning result.

```bash
node sim/test-personality-sync.js     # exit 0 = in sync, 1 = drift (prints the diffs)
```

Run it after **any** personality change. Wire it into pre-push / CI.

---

## Workflow A — validate the current AI (`simulate.js`)

```bash
node sim/simulate.js                       # 2P win matrix + card-balance table (default)
node sim/simulate.js --players 4           # 4P field (each bot focal + 3 rotating opponents)
node sim/simulate.js --matchup rancher,outlaw   # one detailed matchup
node sim/simulate.js --cards-only --csv    # just the card table, also write CSV to results/
node sim/simulate.js --list                # personality names
```

**Outputs & how to read them:**
- **Win matrix** — `row beats column %`. "Overall win%" ranks each bot vs the whole field. Sanity
  check: Hard bots (outlaw, wild_bill) should beat Easy ones (sheriff, banker); the designed-to-lose
  banker should sit near the bottom.
- **Card balance** — `win% when owned` per store card, sorted. High win% + many copies = strong &
  popular. High win% + few copies = a sleeper. Popular card sitting *far below* the `1/numPlayers`
  baseline = a balance flag.

**What to change based on it:**
- A bot is **mis-tiered** → adjust *its AI params* in `play.js` **and** `personalities.js`.
- A *card* is over/under-powered → adjust the **card stats** (`game-core.js` card DB + `play.js`),
  not the AI. (Then resync game-core if needed — it's "synced from play.js".)

---

## Workflow B — search for better params (`evolve.js`)

```bash
node sim/evolve.js --help
node sim/evolve.js --pop 60 --gens 80 --seeds 60 --trials 3
# Competitive coevolution — breed bots that beat STRONG play, not the diluted whole field:
node sim/evolve.js --coevolve --pop 36 --gens 40 --seeds 40 --holdout 300 --trials 3
```

**`--coevolve`** scores each candidate vs a FIXED opponent pool (the 5 Hard anchors + a growing
Hall of Fame of past champions) instead of vs the evolving population. This is the fitness that
matters for a competitive bot — the default field fitness rewards farming the weak random fill,
which drives `denialWeight`/`positionWeight` to ~0. `maxDraw` is held fixed (`COEVOLVE_MAXDRAW`).
Verdict so far (June 2026): the existing Hard genomes are already optimal — coevolution couldn't
beat them. Use it to re-test after a **logic/feature** change widens the space.

A genetic algorithm seeds generation 0 from the 6 personalities, then mutates/selects toward higher
win-rate. Writes `results/evolve_<timestamp>.json` (git-ignored) and prints the best genome per trial
plus a convergence report.

**What to change based on it:** if multiple trials independently converge on a param value, that's a
strong signal to adopt it. But **keep intentional deviations** — banker's low `cowWeight` / high
`act1DollarBonus` make it the Easy "designed-to-lose" bot; don't let the GA "fix" them. `maxDraw` is a
fixed governor and is **not** evolved.

---

## Workflow C — test ONE knob in isolation (A/B)

When you have a specific hypothesis ("does raising X help?"), copy **`draw-cap-experiment.js`** as a
template. It sweeps one parameter for a focal bot against the field and reports win% **and** bust%
per value, in 2P and 4P.

```bash
node sim/draw-cap-experiment.js            # the shipped example: sweeps maxDraw per personality
```

This is how the current `maxDraw` values (rancher/deputy → 10, aggressive bots stay 7) were decided.

---

## Workflow D — card tierlist vs. real humans (admin)

```bash
node admin/gen-sim-tierlist.js --all --games 10000 > sim/results/sim-tierlist.json
# pull human data, then:
python3 admin/compare-tierlists.py sim/results/sim-tierlist.json /tmp/gameHistory.json /tmp/decisionLog.json
```

`winnerLift > 1` ⇒ winners own the card more than average. The compare tool flags cards where the
sim and real humans diverge most.

---

## Applying a change — checklist

1. Edit params in **both** `src/play.js` `AI_PERSONALITIES` **and** `sim/personalities.js` (or card
   stats in both card DBs).
2. `node sim/test-personality-sync.js` → must pass.
3. Re-validate: `node sim/simulate.js` (and `--players 4`).
4. If you changed a **draw/buy rule** (not just a number) in `play.js`, mirror it in
   `personality-engine.js` so the sim still reflects the live AI.
5. Commit. (GA/CSV outputs in `results/` are git-ignored; the curated `sim-tierlist.json` is tracked.)

---

## Tuning facts locked in (don't re-litigate without new evidence)

- **`banditPenalty` ≈ 2.1 × `cowWeight` (July 2026, the biggest AI gain measured on this project:
  up to +18pp at 4P).** Every Hard bot priced a Bandit at well under half a Cow; R5's forced-buy
  counterfactual (`card-counterfactual.js`) showed one is worth about **5 Cows**. The AI was
  buying `card_43`/`card_51` (5 Cows + 2 Bandits, cost 4) **93–95% of the time it could afford
  them** — the only two cards in the game that are causally worse than burning — and now takes
  them ~14%. All five Hard bots' optima landed independently on the same ~2.1× ratio, which is
  also the analytic threshold where the AI stops preferring `card_43` over `card_18` (2 Cows,
  same cost). Applied to the **Hard tier only**; Medium/Easy keep their genomes by design.
  Found with `node sim/genome-sweep.js --param banditPenalty --values ... --focal <bot>`.
- **The `burn_to_use` (Explosive) scoring bonus was investigated and deliberately LEFT at +2.**
  The theory was strong — an Explosive is one-shot yet is scored like a permanent card *and* given
  a bonus, and R5 measures Explosives at −1.7 herd against their alternatives while the AI buys
  them 90% of the time. But sweeping it over {2, 1, 0, −1, −2, −3} across all five Hard bots moved
  mean 4P win% by **under 1pp** — noise. At cost 3 an Explosive is often the *only* affordable
  card, and scoring cannot change a forced choice. Don't "fix" it without new evidence.
- **A dollar-SATIETY parameter was built, measured, and REJECTED (Aug 2026).** The theory: a buy
  does not deduct cost (`roundDollars` is a spending LIMIT, not a balance — see `emitBuyEvent`),
  so every dollar above the cost of the card you take is wasted that round, and each dollar card
  also displaces a cow in the draw. `dollarWeight` is flat, so it prices a $2 card identically
  whether the buyer is starving for income or swimming in it — a diminishing return no flat weight
  can express. Implemented as `dollarSat` = the collection dollar-density ($/card over
  deck+hand+discard) at which dollars stop scoring, multiplying both the `dollarWeight` and
  `act1DollarBonus` terms by `clamp(0,1, (sat − density) / (sat − 0.70))`, normalised against the
  **0.70 $/card starter density** so a fresh deck always scores at full weight (which isolates
  saturation from a plain weight cut, and makes the disabled cell bit-identical to shipped —
  verified by hashing 1200 games at 2P/3P/4P).
  **Result: nothing.** Swept `{0.85, 1.0, 1.2, 1.5, 2, 3}` × 5 Hard bots × {2P, 4P} @ 8k games:
  rancher/enforcer/drifter/deputy all moved **under ±1pp** at both counts. Only `prospector`
  responded (+2.3pp 4P / +0.9pp 2P) — and setting its `dollarWeight` to 0 instead is worth
  **+4.9pp**, with saturation on top of that adding **0.0pp**. The knob is entirely absorbed by
  the flat weight. Reverted; rebuild from this paragraph only if new evidence appears.
  Two reasons it cannot cash out: (a) the strong bots never reach saturation — rancher/enforcer
  finish at **0.65–0.67 $/card, BELOW the 0.70 starter baseline**, so the multiplier sits pinned
  at 1 all game; (b) they are not wasting purchasing power anyway — mean unused dollars on a buy
  turn is only **0.42–0.84**, and under 5% of buys leave $3+ unspent, because `dollarBuffer`
  already stops the draw phase once the best card is affordable.
- **Optimal `dollarWeight` TRACKS `cowWeight` — SHIPPED Aug 2026 for 4 of the 5 Hard bots.**
  `genome-sweep.js --param dollarWeight` over `{0, .5, 1, 1.5, 2, 3, 5}` @ 8k games, then a fine
  sweep to pick a value mid-plateau rather than on a cliff edge:

  | bot | `cowWeight` | was | **now** | plateau | isolated Δ 4P / 2P |
  |---|---|---|---|---|---|
  | prospector | 4.5 | 1.5 | **0** | 0–1 | +5.1 / +2.3 |
  | deputy | 6 | 1.5 | **0.5** | 0–0.5 | +1.2 / +1.1 |
  | drifter | 7 | 0.8 | *0.8 (unchanged)* | flat | +0.7 / +0.2 — noise at 20k games |
  | rancher | 9 | 0.5 | **2.5** | 2.5–3, cliff at 3.5 | +2.8 / +3.7 |
  | enforcer | 9.5 | 1.5 | **3** | 3–3.5, cliff at 4 | +2.0 / +1.9 |

  The direction REVERSES across the tier — low-`cowWeight` bots want less dollar weight, high-
  `cowWeight` bots want more — which is why a single "cap the dollar cards" rule cannot work.
  **Mechanism: the flat `SPECIAL_BONUS` constants.** They are absolute, so a `+2` is worth 0.44
  cows to prospector (`cowWeight` 4.5) but only 0.21 to enforcer (9.5). Low-`cowWeight` bots are
  therefore already over-valuing the bonus-bearing cards — and every live Explosive is a pure
  dollar card — so stacking `dollarWeight` on top compounds it. Measured on prospector's buy mix
  at 4P: at `dollarWeight 1.5` it spent **40.1% of buys on cards with dollars and no cows** (21.5%
  Explosives); at 0 that falls to 29.9% (15.8%) and cow-cards rise 55.1% → 64.8%.

  ⚠️ **The isolated Δs above did NOT add up when all four shipped together, and that is expected —
  read this before trusting any single-knob sweep.** `genome-sweep.js` measures a focal bot against
  an UNCHANGED field, so its Δ is "value of this change holding opponents fixed". Change four bots
  at once and the field itself gets stronger, which drags every vs-field% down. Realised
  `simulate.js` 4P: rancher 43.1→44.2, enforcer 42.0→42.2, deputy 37.8→**36.5**, prospector
  31.4→34.2 — and **`drifter`, whose genome did not change at all, fell 42.2→40.5**. That drop is
  the proof the field got tougher, not that drifter regressed.
  **vs-field% is relative and cannot answer "did the AI get better".** The absolute check is each
  new genome head-to-head against its own old self (2P, 30k games, seats alternated):
  rancher **55.7%**, deputy **53.9%**, prospector 51.8%, enforcer 51.6% — all ≥50%, so all four
  kept, including deputy despite its negative vs-field number. Do this head-to-head check any time
  a multi-bot retune's vs-field numbers disagree with the sweeps that motivated it.
  Tier ordering survives untouched (Hard floor 34.2 vs Medium ceiling 12.1), so
  `gamesetup.html` `DIFFICULTY_TIERS` was not changed.
- `cowWeight` 9–10 is optimal; evolved AIs converge there.
- `revealBonus` ≈ 0 and `act1DollarBonus` = 0 for top performers (dollars are currency, not score).
- `maxDraw`: **all 5 Hard bots = 10** (rancher/deputy since the first pass; prospector/drifter/
  enforcer added June 2026 — `draw-cap-experiment.js` shows +3–4pp 2P / +6–7pp 4P at ≤+2pp bust).
  Their bandit thresholds already govern risk, so a higher cap lets them overdraw dollars → more
  cows + earlier buy priority at ~no extra bust. **wild_bill / outlaw stay 7** — the cap is a
  load-bearing bust governor for them; raising it makes them bust >50% and collapse. sheriff/banker
  stay 7 by design (Easy tier — they'd improve at cap 10, but we don't buff the easy tier). See
  `draw-cap-experiment.js`.
- ~~**Competitive coevolution (June 2026): the 14-param space is tapped out.**~~ **REFUTED
  (July 2026).** That run concluded the space was exhausted — but it was searching around a
  `banditPenalty` that was **~12× too low**, so "no better genome exists near here" was a
  statement about a badly-miscalibrated neighbourhood, not about the space. Re-run after the fix:
  - the champion beats the best shipped bot at 4P — **50.0% vs field, against `enforcer`'s
    43.2% (+6.8pp)** — though it is slightly WORSE at 2P (72.3% vs 74.2%).
  - **`banditPenalty` converged to 20.00** in the top genomes of the final generation, landing
    independently on the value derived and measured above. Strong corroboration of the fix.
  - `cowWeight` (10.00) and `act3CowBonus` (4.00) sat pinned at the TOP of their search ranges —
    the bounds are binding, so the true optimum may lie outside them. **Widen the ranges before
    the next run.** ✅ **DONE (July 2026)** — and the root cause turned out to be worse than a
    binding bound, see the next entry.
- ⚠️ **THE RANGE TRAP — read before trusting any GA result.** `evolve.js`'s `mutate()` **clamps to
  `PARAM_RANGES`**, but generation-0 seeding does **not**. A shipped value outside its range
  therefore enters the population intact and is then dragged inside the box by the first mutation
  touching that gene: the GA **silently deletes the best-known solution** and then truthfully
  reports that it found no improvement. `banditPenalty` was capped at **8** while the correct value
  is **10–20**, so every GA conclusion before July 2026 came from a box that excluded the largest
  gain on the project.
  Ranges are now widened so every shipped genome is interior — `banditPenalty` 0–40, `cowWeight`
  0–20, `dollarWeight` 0–12, `act3CowBonus` 0–10, `act1DollarBonus` 0–8, `lethalBias` 0.2–4,
  `revealBonus` 0–6 — and **`evolve.js` asserts this at startup and exits 1** if any seed falls
  outside (`RANGE_EXEMPT` covers sentinels like wild_bill's `dollarBuffer: 999`).
  `denialWeight` and `deckMemory` stay capped at 1 on purpose: the first is a boolean the engine
  only tests `>= 0.5`, the second is a blend weight where 1.0 already means perfect deck memory.
  **Rule: if a shipped value lands within ~20% of a boundary, widen the boundary before believing
  the run.**
  - **Nothing from this run has been shipped.** The three trials did not converge tightly
    (`banditPenalty` spread was 75% of its range) and the champion trades 2P strength for 4P.
    Harvesting it properly is a separate, deliberate pass.
- **Re-run #2 with the ranges actually widened (July 2026) — still NOT harvested, and here is
  the honest reason.** The champion is strong at 4P (**55.7% vs field**, against the best shipped
  bot's ~43%) but *weaker* at 2P (72.9% vs 74.4%), and **the three trials disagreed badly**:
  4P-vs-anchors came out 39.3% / 36.0% / 32.0%, with spreads of 40% of range on `banditPenalty`,
  81% on `act3CowBonus`, and 85% on both `positionWeight` and `denialWeight`. A champion picked
  out of a non-converged run is a lucky seed, not a discovery. What the run DOES establish is
  directional, and both directions were already harvested by single-knob sweeps that could be
  validated at both player counts:
  - `banditPenalty` settled at **23.96** — every trial far above the old cap of 8, independently
    corroborating the shipped 20 (and hinting slightly higher may be better).
  - `denialWeight` **0.85** in the champion — corroborating the drifter denial result above.
  Before harvesting a whole genome: run more trials/generations until the spreads come down, and
  decide explicitly whether 2P or 4P is the target, because the frontier trades them off.
- **Denial is BOT-SPECIFIC, not universally good or worthless (measured July 2026,
  `genome-sweep.js --param denialWeight --values 0,1` — the engine only tests `>= 0.5`, so 0-vs-1
  IS the shippable A/B for play.js's `denialBurn` flag).** Per-bot, 2P / 4P:
  - `drifter` **+3.6 / +3.9pp** → **SHIPPED ON.** Consistent at both counts; it is now the
    strongest bot at both (2P 74.4%, 4P 42.9%).
  - `prospector` −1.8 / +1.4pp and `deputy` +1.7 / −2.8pp (measured with denial OFF) → the sign
    FLIPS between counts for both, so neither is shippable. `deputy` keeps denial ON as shipped.
  - `enforcer` −1.2pp at 4P → correctly stays OFF.
  **The mechanism, visible in the herd column: denial LOWERS your own herd every single time**
  (drifter 62.6 → 57.6 at 2P) while raising win%. It buys relative position by spending a turn
  that would otherwise have scored. That is why it helps a bot whose absolute ceiling is already
  adequate and hurts one still building its engine — and why win% is the only metric that can
  judge it.
- ~~**`denialWeight → 0` for focal win-rate.**~~ **ALSO REFUTED by the same re-run** — the
  coevolved champions all want `denialWeight` ≈ **0.7–1.0**. Same root cause: when the AI is
  squandering buys on trap cards, spending a turn on denial looks worthless; once it buys well,
  denying the leader becomes a good use of a turn. Note this cuts against `enforcer`'s stated
  identity ("wins through efficiency, not denial"), so adopting it is a character decision, not
  just a numbers one.
- banker is **intentionally** weak (Easy / designed-to-lose). Low `cowWeight`, high `act1DollarBonus`
  are features, not bugs.
