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
game-core.js            ← card DB, pyramid build, card effects (lower level).
tiebreaker.js           ← buy-order tiebreak (shared with the live game).

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
```

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

- `cowWeight` 9–10 is optimal; evolved AIs converge there.
- `revealBonus` ≈ 0 and `act1DollarBonus` = 0 for top performers (dollars are currency, not score).
- `maxDraw`: **rancher/deputy = 10** (their bandit thresholds already govern risk, so a higher cap
  lets them overdraw dollars → more cows + earlier buy priority at ~no extra bust). **wild_bill /
  outlaw stay 7** — the cap is a load-bearing bust governor for them; raising it makes them bust
  >50% and collapse. sheriff/banker stay 7 by design (Easy tier). See `draw-cap-experiment.js`.
- banker is **intentionally** weak (Easy / designed-to-lose). Low `cowWeight`, high `act1DollarBonus`
  are features, not bugs.
