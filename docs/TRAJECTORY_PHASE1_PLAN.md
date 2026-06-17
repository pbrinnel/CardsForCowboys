# Trajectory Benchmark — Phase 1+ Plan

> **Start here in a new session:** read the **Trajectory Capture (`traj`)** section of
> `CLAUDE.md` first (it has the record schema, capture model, and version table), then this doc.
> Phase 0 (capture) is **shipped and live**; everything below is **not built yet**.

## Status

- **Phase 0 (capture):** DONE — commits `a7bc3d1` (capture) + `142d52c` (failsafe hardening).
  Live human/AI games now write trajectories to `traj/{code}` in Firebase.
- **Phase 1+ (analysis):** NOT STARTED. This doc is the plan.

## The binding constraint — read before building anything

**Corpus size.** The site produces very few completed games (≈a dozen ever, ~5 multi-human at
last count). A benchmark built from one or a handful of games overfits to specific seeds and
players. **Do not build the heavy layers, and do not draw any AI-tuning conclusions, until the
corpus is large.** First thing every session: check how much data exists.

```bash
firebase database:get /traj --shallow --project cards-for-cowboys   # list captured game codes
firebase database:get /traj/CODE --project cards-for-cowboys        # one game's records
```

## What Phase 0 already gives you (the substrate)

`traj/{code}` is an append-only push list of records, de-identified by `slotIdx` (no names).
Record kinds (`kind`):

| kind | meaning |
|---|---|
| `hdr` | header: `schemaV`, `gameV`, `cardDbHash`, `gameSeed`, `numPlayers`, flags, `seats:{slot→{isHuman,personality}}` |
| `act` | pyramid card IDs for an act (`act`, `cardIds[]`) |
| `snap` | a seat's deck/hand/discard (card IDs) + `herd` at round start |
| `d` | draw event: `action:'draw'` + `drew:cardId`, or `action:'stop'` |
| `s` | special activation: `special`, `cardId`, optional `detail` (e.g. `replay_pick` card) |
| `b` | buy/burn: `action`, `row`, `col` |
| `ck` | **canary**: ground-truth `herds`/`deckCounts`/`discardCounts` at round end |

**Capture model:** host writes `hdr`/`act`/AI-seat `b`/`ck`; each human client writes its own
seat's `snap`/`d`/`s`/`b`. Human shuffles use `Math.random`, so human draw *outcomes* are logged
(not reconstructable from seed). AI draws are NOT per-event logged in Phase 0 (deterministic from
seed; `snap`+`ck` cover them).

## Build order (each layer is offline; none touches the live game)

### 0a. Pull + canary-validate tool (cheap, do this first / anytime)
A small script (`sim/` or `admin/`) that pulls `/traj/CODE`, checks records are well-formed, and
verifies each `ck` canary is internally consistent with the following round's `snap`
(deck/discard/herd carry-over). This is **operational hygiene, not the ML work** — it catches
capture bugs and card-DB/engine drift early, before a balance change silently poisons the corpus.
Run it as games accumulate.

### 1. Reconstructor (in `sim/`, extends `game-core.js`) — the load-bearing piece
- Load `hdr`. **Refuse to replay if the engine's `gameV` ≠ the trajectory's `gameV`** (else silent
  divergence — the benchmark would rot under rules/card changes).
- For each round: seed state from that round's `snap`, replay the round's `d`/`s`/`b` events,
  then **assert the result against the `ck` canary**. Fail loudly on mismatch (drift detected).
- Output: per-decision reconstructed game states.
- This is the parity-sensitive piece (the repo has documented `play.js ↔ sim` drift history),
  which is exactly why the canaries exist. Build + validate this BEFORE anything on top of it.

### 2. Static decision-puzzle benchmark
From reconstructed states, emit a frozen `{state, human-action}` set. Score any AI — the 14-param
bots, a neural net, an LLM agent — by how it answers the same puzzles. Model-agnostic, no engine
needed at eval time. This is the most direct "compare a future AI to the human" tool.

### 3. Monte Carlo value oracle
Roll the engine forward from each decision over the unknown remaining deck (multiset =
round-start `deck`+`discard` minus what was drawn) to estimate EV of draw-vs-stop / each buy.
Gives each decision a *quality* label independent of any bot — so you measure "did the AI pick a
high-value action" against estimated-optimal, with the human as a strong reference, not the ceiling.

### 4. Personality fitting (reuses `sim/evolve.js`)
Swap evolve.js's fitness from *sim-win-rate* to *agreement-with-logged-human-decisions* (optionally
winner-weighted via a join to `gameHistory` outcomes). Same 14-param genome and GA machinery —
produces a personality fit to humans (equal weight = human-like; winner-weighted = "plays like the
best humans" = your real Hard tier).

## Gotchas / scope caveats

- **Multi-seat merge:** full-game reconstruction needs all seats' streams merged by `slotIdx` +
  `buyOrder`. Each human logged only its own seat; the host logged AI seats + header + canaries.
- **Versioning contract:** `schemaV` (format) / `gameV` (rules+cards) / `cardDbHash` (auto backstop).
  Stored data is immutable — handle versions in the reader (read-time normalization), never migrate
  writes. See the version table in `CLAUDE.md`.
- **v1 legacy:** `decisionLog/{code}` (4 frozen games, "human vs outlaw" shadow-AI format) is a
  **different, retired** schema read by `admin/analyze-decisions.py`. Don't mix it with `traj`.
- **Replay-as-opponent** (dropping a candidate AI into the human's seat) is only clean for the
  draw phase (independent decks); the buy phase shares one pyramid, so once the AI diverges the
  human's recorded buys go stale — needs a human policy model. Scope that layer accordingly.
- **Privacy:** already de-identified by slot; keep it that way (no names in any derived artifact).

## Suggested first session

1. Read `CLAUDE.md` → Trajectory Capture section.
2. `firebase database:get /traj --shallow` — see how many games exist. If few, **stop and wait** for
   more (or run a playtest push); don't build benchmarks on a tiny corpus.
3. Build layer **0a** (validator) and run it on the real games — confirm canaries are clean.
4. Build layer **1** (reconstructor + canary assertion). Validate hard before layers 2–4.
