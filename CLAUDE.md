# Cards For Cowboys — Claude Reference

## ⚠️ Maintenance Instructions (READ FIRST)

This file is your primary reference. **Keep it updated.** After any session where you:
- Add, rename, or significantly move functions in `src/play.js` → update the Function Index
- Fix a recurring or subtle bug → add it to the Known Bug Watch List
- Change Firebase data structure → update the relevant section in MEMORY.md and here
- Touch anything security-related → re-run the Security Checklist

When starting a new task, **check this file before reading raw source code.** Use the function index to grep directly to what you need rather than reading entire files.

**Git workflow:** Commit and push directly to `main`. Do not use worktrees or PRs for this project.

---

## File Map

### Root (HTML pages + config)
| File | Purpose |
|------|---------|
| `index.html` | Landing page. Two front-door buttons: **Play** (→ gamesetup.html) and **Join with Code** (→ lobby.html). Plus Tutorial / Rules / History and the rejoin banner. |
| `playgame.html` | Game UI shell |
| `gamesetup.html` | **The "Table" screen.** Two states: (A) config — name, player count, per-seat AI/Human + difficulty, modes; (B) inline **host waiting room** (code, share, live slot list, Cancel). The game cannot start until every Human seat has joined (no "fill with AI" shortcut). Solo/all-AI games go straight to playgame; any Human seat creates the game in-place (via `src/host.js`) and shows state B. The former separate `creategame.html` page was merged in here (June 2026) — no more redundant second name prompt. |
| `lobby.html` | **The "Join" screen** (online matchmaking). Name + code entry, invite-link mode (`?join=CODE`), rejoin (`?rejoin=CODE`), and the guest waiting room. |
| `rules.html` | Standalone rules page. Audited July 2026 against `docs/RULEBOOK_WRITING_STANDARDS.md` — scorecard + remaining to-do list in `docs/RULES_PAGE_AUDIT.md`. Section `id`s + the `.rules-toc` contents panel are load-bearing: the panel is a `<nav>`, so it must keep its explicit `display`/`gap` resets or `css/style.css`'s bare `nav`/`nav ul` header rules turn it into a flex row. Store act bands are colour-blind-safe by **lightness + hatch angle**, never hue (blue/yellow/red are the suit colours) — see the comment block in `css/rules-page.css`. |
| `spectate.html` | Spectator view (reads `liveGames/` path) |
| `history.html` | Game history + leaderboard; "Live Now" list reads the slim `liveSummary/` node |
| `aboutthecreators.html` | About page |
| `bugreport.html` | Bug-report form → writes `bugReports/` in Firebase; auto-attaches game context from `localStorage['cfc_bug_context']` |
| `print-proof.html` | **Print layout proof for the physical rules insert.** `noindex`'d working file, not linked from the site. Renders the ruleset into real print panels at real mm/pt so content fit can be tested before committing to a format. Buttons switch panel size (poker 63.5×88.9 / 50mm cross fold / 100mm reference) and body type (6–9pt), and JS flags any panel whose content exceeds the live area — **measuring width as well as height**, since a too-wide Store diagram once passed a height-only check while running off the side. Ships cut/fold/trim guides generated from `--cols`. Current decision: **poker accordion, 8 panels, 7pt, 3mm margins** — the only format on the shortlist that holds the full ruleset. |
| `proofs/` | Rendered PNGs of the above (~407dpi, headless Chrome). Regenerate rather than hand-edit. |
| `debug.html` | **Scenario launcher for dev.** `noindex`'d + `Disallow`'d in robots.txt, not linked from the site. Writes `sessionStorage['debug_scenario']`; `startGame` reads it and calls `applyDebugScenario`, which flags `G.isDebug` so the game writes **no** gameHistory / liveSummary / traj records. Three sections, and the split is load-bearing: **Structural** (end-of-game + 8P stress), **Live Mechanics** (only `burn_to_use` and `draw4` survive on undeprecated cards — everything a real game can deal), and **Retired Mechanics** (dimmed, dashed, `RETIRED`-tagged — cards that are `deprecated: true` and unreachable in a real game). Retired buttons are deliberately **still clickable**: per `docs/DEAD_CODE_INVENTORY.md` they are the regression harness you run once right before deleting the mechanic they cover, so `disabled` would defeat their only remaining purpose. Delete each button together with its mechanic. Every button must map to a `SCENARIOS` key — an unknown name now stops cleanly with a message instead of silently starting an unplayable, record-writing game. |
| `privacy.html` | Privacy policy (GDPR-aligned: controller, legal basis, retention, data-subject rights; contact: info@cardsforcowboys.com) |
| `database.rules.json` | Firebase Realtime Database security rules |

**Home-link convention (July 2026 nav audit).** There is no shared header component — every page
rolls its own — which is how the site drifted into three dead ends (spectate.html had *zero* links
of any kind; lobby.html's exit lived inside `#screen-name` so the waiting/error screens had none;
playgame.html had none at all during a solo game, since Disband is MP-host-only).

**Every page must carry a clickable "Cards For Cowboys" that goes to `index.html`,** and it must be
a real `<a href>` — that is what gives cmd/middle-click "open home in a new tab", which plain text
and a `window.location` button do not. Rules for a new page:

- Put it wherever the page shows the brand (nav logo, `<h1>`, or footer). Wrapping an existing `h1`
  is fine — see `gamesetup.html` / `lobby.html`.
- Place it **outside** any screen/state div, or it will vanish on the states that don't render that
  div (the exact lobby.html bug).
- A bottom-of-page "← Back to Home" is **not sufficient on its own**. On the long pages it sat
  ~6800px down. Where the footer is `position:fixed` (privacy, bugreport, aboutthecreators),
  linking the footer brand is what makes the exit always reachable.
- Guard it only where navigating away destroys something — playgame.html's uses
  `confirmLeaveGame()`, which deliberately lets a modified click through untouched.

### `src/` — App JavaScript
| File | Purpose |
|------|---------|
| `src/play.js` | Entire game engine — MP layer (IIFE, top), card DB, game state, rendering, flow |
| `src/tutorial.js` | Tutorial mode hooks (loaded before play.js) |
| `src/lobby.js` | Join (guest) flow for lobby.html; sets `sessionStorage` keys for play.js. Atomic slot claim via `runTransaction`. |
| `src/firebase-config.js` | Firebase init, exports `db` — used by lobby.js / host.js as ESM module |
| `src/host.js` | Host (create) flow + inline waiting room on gamesetup.html. Exposes `window.CFC_startHosting()`. Game auto-launches only when all human slots fill. Replaces the old `src/creategame.js`. |
| `src/herd-chart.js` | **End-of-game "Herd by Round" graph — ONE renderer, TWO surfaces** (showdown screen + spectate). Classic script exposing `window.CFC_HerdChart.render(el, {players, round, phase, youIndex, animate})`, same dual-use idiom as `sim/tiebreaker.js`. See the Herd Chart section below. |

### `css/` — Stylesheets
| File | Purpose |
|------|---------|
| `css/play.css` | Game UI styles |
| `css/style.css` | Shared/general styles |
| `css/rules-page.css` | Rules page styles |
| `css/theme.css` | Theme variables / font imports |
| `css/a11y.css` | Shared accessibility baseline (`:focus-visible` outline + `prefers-reduced-motion` collapse) — linked by ALL pages (July 2026 audit A1/A2). Add the link to any new page. |

### `sim/` — Simulation & AI tooling
**Start at [`sim/TUNING.md`](sim/TUNING.md)** — the authoritative goal/steps/outputs guide for
tuning & validating the AI. The AI-tuning files share ONE deterministic engine + ONE genome source.

| File | Purpose |
|------|---------|
| `sim/TUNING.md` | **Read first.** How to validate/search/apply AI changes (the workflow). |
| `sim/AI_SEARCH_BAKEOFF_PLAN.md` | Search-AI bake-off plan + full phase-by-phase build log. **COMPLETE → SHELVED.** Lookahead/MC search vs the param pros. The conclusive record is `AI_SEARCH_RESULTS.md`. |
| `sim/AI_SEARCH_RESULTS.md` | **THE conclusive verdict + resume guide (read first if revisiting AI search).** Flat-MC buy-phase search beats the pros under a FAIR (human-equivalent) model — clears +5pp at **N=256** (Δ2P +7.9 / Δ4P +11.6). **Product decision: SHELVED — not worth the play.js port for a moderate, human-unproven gain.** Has a reusable-assets inventory + two resume paths (ship online / simulate smarter, incl. a learned-policy distillation idea). Live game untouched. |
| `sim/AI_DISTILLATION_PLAN.md` | **PROPOSAL (July 2026, not started) — the next AI-improvement route (Route C).** Distill the shelved search (teacher, offline high-N labels) into a fast pure-function student policy (enriched scorer → tiny-MLP fallback) shippable as a new top tier ("Legend") with no rollout machinery. Same +5pp pre-registered bar via `search-bakeoff.js`. **Phase D0 (mandatory first): re-sync the sim to the brick Store + regen golden + re-tier + re-baseline the teacher** — all current sim numbers are for the retired triangle board. |
| `sim/personalities.js` | **The 6 bots (data) — single source of truth, synced to play.js.** Consumed by every sim tool. |
| `sim/personality-engine.js` | Shared AI decision layer + deterministic `runGame` (mirrors play.js's live AI logic). 2–4P only. **Also the resumable core (B0):** `createInitialState`/`continueGame(state,policies,horizon)`/`cloneState`/`gameResult`; `runGame` is now a thin wrapper. Genome path is byte-identical to pre-refactor. |
| `sim/test-resume-reproduction.js` | B0 gate: `continueGame`/`cloneState` reproduce `runGame` bit-for-bit (golden + resume/clone/mid-buy checks). |
| `sim/gen-golden.js` | Regenerates `sim/fixtures/golden-runGame.json` (the frozen runGame baseline). Only re-run if card stats / engine semantics legitimately change. |
| `sim/search-ai.js` | **Search-AI bake-off (B1):** flat-MC buy-phase AI (`makeSearchPolicy`/`searchChooseBuy`). A `__search` participant the engine dispatches to via `decideBuy` (no engine→search import). Perfect & default opponent models; seeded rollout RNG. Draw stays heuristic (B3 adds draw search). |
| `sim/search-b1-signal.js` | First-signal harness: search vs each pro head-to-head (2P). B1 result: beats enforcer 62.9% / Hard field 68–73% under the PERFECT model (realistic model = B2). |
| `sim/test-search-mp-determinism.js` | MP-safety evidence: the search buy decision is uid/representation-invariant (depends only on ids/order/stats + shared seeds = what `drawState` shares across clients). The determinism prerequisite for human-v-human-v-AI. |
| `sim/search-bakeoff.js` | Reusable bake-off harness (`--mode sweep`/`ablate`/generic; 2P+4P; perfect/default opponent model; win% + cost). B2 result: **N=64 `endOfGame`** clears the proposed +5pp bar at 2P (+5.9) and 4P (+10.4) under the realistic model; perfect↔default gap small (~5pp). `endOfRound` is worthless; `endOfGame` is the horizon to use. |
| `sim/evolve.js` | Genetic algorithm — SEARCHES param space for better genomes. Seeds gen-0 from `personalities.js`. `--coevolve` mode scores vs fixed Hard anchors + a Hall of Fame (strong-opponent fitness) instead of the whole field. |
| `sim/ceiling-probe.js` | Phase-0 diagnostic: can a fresh GA candidate beat ONLY the Hard bots? Measures whether the current param space has headroom left. |
| `sim/simulate.js` | VALIDATES current bots: pairwise win matrix + per-card balance table (win% when owned). Replaces the retired RISK_PROFILES sim. |
| `sim/draw-cap-experiment.js` | Focused single-knob A/B (sweeps `maxDraw` per bot). Copy as a template for one-parameter experiments. |
| `sim/test-personality-sync.js` | Guard: fails if `personalities.js` drifts from play.js `AI_PERSONALITIES`. Run after any personality edit. |
| `sim/test-card-sync.js` | Guard: fails if `game-core.js`'s card DB drifts from play.js `STORE_CARDS`/`STARTER_TEMPLATES` (stats + `deprecated` + 18-live-per-act). Run after any card edit on either side. Exists because card_84/85 rotted unnoticed through the July 2026 rework. Never hand-edit the sim card array — regenerate it from play.js. |
| `sim/CARD_REBALANCE_PLAN.md` | **Post-rework card power re-ranking plan + RESULTS (§0).** R1-R5 done (July 2026). Holds the measured 4P card table, the causal (forced-buy) card values, and the re-measured tier bands. **⚠️ R6 decision: NO CARD CHANGES** — card stats/costs/acts are frozen (every one is printed art; the Act is the cowboy-hat symbol bottom-right). Balance flags are findings only; **AI scoring is the sole remaining balance lever.** Do not re-propose card edits. |
| `sim/store-sanity.js` | R2 structural gate: rounds/game, buy-vs-burn share, per-row availability timing, bust rates, + hard assertions (row/width/total per count, act tiers exact, no deprecated card dealt, Store always fully consumed). Run after ANY Store-geometry change. |
| `sim/card-flags.js` | R4 analysis: turns a `cardbalance_*.csv` into a ranked rebalance shortlist. Three views (same-cost cohorts / herd-equivalent pricing / pre-registered residual rule) + buy-vs-win divergence, which separates a mispriced CARD from a misjudging AI. Collapses the 17 duplicate stat-lines. |
| `sim/card-counterfactual.js` | **R5 causal card value.** Forced-buy counterfactual: at each sampled buy decision it clones the state, forces every affordable candidate (plus a burn baseline), determinizes hidden decks (fair info) and rolls out to game end. Immune to the who-bought-it selection bias that confounds `simulate.js`'s win%. `--continuation search` re-runs it with the focal seat playing the shelved Monte-Carlo search, which is how you tell a mispriced CARD from a misjudging AI. |
| `sim/genome-sweep.js` | Single-knob genome A/B: `--param <name> --values a,b,c --focal <bot>`. Generalises `draw-cap-experiment.js` to any numeric genome field. This is how the `banditPenalty` optimum was found — use it for a specific hypothesis, not for fishing (that is `evolve.js`). |
| `sim/AI_PERSONALITIES.md` | Parameter glossary (per-param effects, tiers). |
| `sim/game-core.js` | Card DB, pyramid, card effects (lower level; synced from play.js). |
| `sim/tiebreaker.js` | Buy-order tiebreaker (shared by game + sim). |
| `sim/mock-firebase.js`, `sim/mp-client.js`, `sim/test-mp-protocol.js` | MP-protocol tests (separate from AI tuning). |
| `sim/test-tiebreaker.js` | Tiebreaker unit tests. |
| `sim/results/` | Sim output. `evolve_*.json` / `cardbalance_*.csv` git-ignored; `sim-tierlist.json` tracked. |

Retired June 2026: `ai-player.js` + `stats.js` (the legacy RISK_PROFILES model — `simulate.js` now
runs the real personalities via the shared engine) and `EVOLVE_PLAN.md` (build spec; evolve.js is
long since built — in git history if needed). `admin/gen-sim-tierlist.js` was migrated to the shared
engine too.

### Other directories
| Path | Purpose |
|------|---------|
| `assets/` | Card images, card backs, symbols, photos |
| `data/` | Card data CSV (designer reference) |
| `docs/` | Rules PDF, planning docs, `MP_PROTOCOL_AUDIT.md`, `DEAD_CODE_INVENTORY.md`, `RULEBOOK_WRITING_STANDARDS.md` (compiled board-game-industry conventions for rules writing) + `RULES_PAGE_AUDIT.md` (`rules.html` scored against them — **live to-do list**, fix 1 of 10 done) |
| `admin/` | Firebase admin scripts (tracked; only `admin/firebase-backups/` is gitignored). All are `firebase login`–based — no database secret in any file. See the Admin Scripts section below. |
| `test/` | Playwright tests |

---

## play.js Function Index

Line numbers are approximate (±10). Grep to verify exact location.

### MP Layer (IIFE, lines 22–700)
```
(IIFE identity hydration)   ~27   — resolves identity sessionStorage → URL(code/slot/name) → localStorage(cfc_rejoin); sets MP.recovered on a recovery load
gameRef(path)               ~95   — builds Firebase ref under games/{code}/
subscribeNamed(key,ref,cb)  ~100  — idempotent onValue: re-arming a key REPLACES the old sub (fixes the per-round listener leak, audit H1). Use for anything re-armed per round.
init()                      ~110  — dynamic Firebase ESM import, arms onDisconnect
startPresence()             ~135  — marks slot connected, watches opponent drops (30s grace, debounced message)
pushDrawState()             ~205  — full draw state incl. entitlements + dollar1OtherPlayed
watchOpponentDrawStates()   ~235  — live-syncs opp drawState via subscribeNamed (per-slot keys)
signalDrawDone()            ~250  — awaited done signal; carries authoritative hand id list + dollar1OtherPlayed (audit R3/C5)
forceSignalDrawDone()       ~275  — host recovery: forced done w/ last-known stats
waitForAllHumanDrawsDone()  ~290  — resolves when all human slots push drawDone
pushDraftPick/getDraftPick/forceDraftPick ~315 — draft pick push / own-pick read (re-entry) / host force (only-if-absent transaction) (audit H4/C8)
waitForDraftRoundPicks()    ~350  — waits for all draft picks in a round
pushSpectatorState()        ~380  — host pushes buildSpectatorState() (single shared serializer, audit H2)
pushLiveSummary()           ~400  — host writes slim liveSummary/{code} for the Live Now list (no card state)
clearActSetup/pushActSetup  ~425  — host act broadcast
waitForActSetup()           ~440  — non-hosts wait for host to push actSetup (pyramid card IDs)
pushBuyAction()             ~460  — stamps round+act+SEQ (1 normal / 2 extra buy; audit R1). buyAction is never cleared — seq matching replaces the old consume-then-null.
forceBuyAction(slot, seq)   ~480  — host recovery skip; must stamp the seq waiters expect
waitForBuyAction(slot,seq,cb) ~490 — matches round+act+seq (legacy no-seq passes)
watchOwnBuyAction/watchOwnDrawDone ~510 — R2 tombstones: own-cell watches for host-forced signals
pushBuyOrder/waitForBuyOrder ~520 — round+act-stamped buy order
showDisconnectMessage()     ~545  — shows disconnect UI, offers return to home
startRejoinCountdown()      ~555  — 5-min rejoin window timer
fetchSpectatorState()       ~585  — one-shot snapshot get (rejoin)
watchSpectatorState/unwatchSpectatorState ~595 — continuous snapshot watch (transient-phase rejoin, audit H3)
fetchActSetup()             ~615  — read existing actSetup (host fresh-start safety, audit H5)
cleanup()                   ~640  — unsubscribes all listeners incl. named subs
watchForDisband()           ~665  — watches for status='disbanded' (or null for legacy)
claimBuyFirst(act, round)   ~690  — 5-8P once-per-round priority claim (callers MUST pass G.currentAct/G.roundNumber — audit C2)
```

### Card Database (lines ~752–900)
```
STARTERS array                    — IDs 91-94 (River), 61-64 (Rattlesnake), 33-34 (Cactus)
STORE_CARDS array                 — 84 entries: 54 LIVE (exactly 18 per act) + 30 `deprecated: true`.
                                    Deprecated cards are KEPT so getCardById resolves them for
                                    pre-gameV-3 spectate/rejoin/review; they can never be dealt.
                                    The old `minPlayers` (3+P / 4+P) tier is GONE.
getCardById(id)                   — resolves live AND deprecated cards
getActPool(act)                   — filters `act === act && !deprecated` (18 cards); for
                                    numPlayers>=5 returns that pool DOUBLED (36, second deck)
```

### Utilities (lines ~901–975)
```
uid()                       ~904  — monotonic card instance ID counter
shuffle(arr)                ~906  — Fisher-Yates, uses Math.random
initAiRng(slotIdx, seed)    ~920  — seeds per-slot LCG for deterministic AI shuffles
_seededShuffle(arr, slot)   ~931  — seeded Fisher-Yates for AI decks
seededSeatOrder(n, seed)    ~942  — deterministic turn order from gameSeed
shuffleForPlayer(arr, slot) ~957  — uses seeded shuffle for AI, Math.random for human
delay(ms)                   ~964
```

### Game State Init (lines ~972–1050)
```
createCardInstance()        ~977  — wraps card template with uid, state fields
createStarterDeck(slot)     ~992  — 10 starters per player
createPlayer(name, isHuman) ~1002 — full player object (hand, deck, discard, stats, slotIdx)
initState(numPlayers)       ~1025 — creates G: pyramid, players[], round/act counters
```

### Pyramid (lines ~1048–1132)
```
pyramidWidth()              — STORE_WIDTH[numPlayers] (5/7/9 | 8/9/10/11). No longer a constant.
rowsPerTier() / storeRows() — rows per act tier (2 or 3) and in the whole Store (×3 → 6 or 9)
rowAct(row)                 — the act tier a row belongs to (row 0 = Act 3 … front rows = Act 1)
storeStage()                — 1|2|3 from the FRONTMOST row still holding a card. The AI's
                              replacement for G.currentAct; pure + identical on every client.
pyramidRowWidth(row)        — pyramidWidth() (uniform across rows)
pyramidColCenter(row, col)  — pure x-center (card units) of a cell. Rows centered; ODD rows +0.5 card BRICK offset. Used by covering + render.
buildPyramid(cardIds)       — builds the WHOLE Store in one pass (no act param): shuffles each act
                              pool independently, slices rowsPerTier()×width from each, lays them
                              Act 3 → Act 2 → Act 1 top-to-bottom. Front row face-up.
isCardCovered(pyr, r, c)    — GEOMETRY/overlap-based (any non-removed cell below within ~½ card). Interior cards have 2 coverers; the one overhang end card per row has 1.
revealUncovered(pyramid)    — face-up any card no longer covered
getAvailablePyramidCards()
isPyramidEmpty(pyramid)
```

### Store Layout — ONE structure, three act tiers (REWORKED July 2026)
**The Store is built ONCE, at the start of the game.** There is no mid-game setup, no act
boundary, and no between-act deck reshuffle. `setupStore()` (was `setupAct(act)`) runs a single
time from `startGame`; `endAct()` is gone, and `scoreRound()` goes straight to `startShowdown()`
when the Store empties.

The Store is dealt in three **act tiers** — Act 3 at the back (row 0), Act 2 in the middle, Act 1
at the front (bottom, the only face-up row). Play eats it front-to-back, so the act progression is
emergent. Rows are brick-staggered exactly as before (odd rows +0.5 card, `pyramidColCenter`), and
covering is still geometry-based (`isCardCovered`) — both are width-independent and unchanged.

| Players | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| **Width** (`STORE_WIDTH`) | 5 | 7 | 9 | 8 | 9 | 10 | 11 |
| **Rows** (`storeRows()`) | 6 | 6 | 6 | 9 | 9 | 9 | 9 |
| Rows per tier (`rowsPerTier()`) | 2 | 2 | 2 | 3 | 3 | 3 | 3 |
| Cards per act | 10 | 14 | 18 | 24 | 27 | 30 | 33 |
| **Store total** | 30 | 42 | 54 | 72 | 81 | 90 | 99 |

Rows are **no longer** `numPlayers`, and width is **no longer** a constant 7 — both derive from
`numPlayers` alone. `pyramidWidth()` reads `STORE_WIDTH`; `G.pyramidWidth` remains an unused
explicit override hook. **Pioneer Mode is gone** (it was a width mode and no longer composes).

`rowAct(row)` maps a row to its tier, and **`storeStage()`** returns 1|2|3 from the frontmost row
that still holds a card — this is the AI's replacement for the old `G.currentAct` (see AI section).

Card pool: 18 live cards per act. 2-4P draw 10/14/18 from that single pool; **5-8P draw from a
doubled pool (36)** via `getActPool`, so ids repeat (uids stay unique). Note 4P uses ALL 18 act
cards every game — only their positions vary.

`fitPyramid()` now **bails out** when the zone is unmeasurable (0×0 viewport, display:none
ancestor): `availH` went negative there and `scale(-0.01)` mirrored the whole Store out of
existence. The `body.count-5plus.phase-draw` draw-phase cap is **52vh** (was 40vh) — at 40vh the
9-row Store was height-bound and used only ~77% of the available width; 52vh lets it grow into the
width it already has while keeping the hand on screen at 1280×800.

The tutorial builds a REAL 2P Store (5×6, 30 hardcoded live ids, act tiers) — its buy target is at
row 5 col 1. `renderPyramid` calls `TUTORIAL.reapplyPyramidHint()` at the end, because rebuilding
the Store DOM drops the highlight class and the buy step lands in exactly that window.

**spectate.html** mirrors the brick offset in its own `renderPyramid` and now lets a too-wide Store
scroll inside `#spec-pyramid-zone` (`overflow-x:auto`) — it has no `fitPyramid` equivalent.

**SIM STRUCTURALLY RE-SYNCED (July 2026), NUMBERS NOT YET RE-MEASURED.** Plan + status:
[`sim/CARD_REBALANCE_PLAN.md`](sim/CARD_REBALANCE_PLAN.md) (supersedes `AI_DISTILLATION_PLAN.md`
Phase D0, which described only the June brick rework).

Phase **R1 is done**: `sim/game-core.js` + `sim/personality-engine.js` now model the single Store
(one build, act tiers, brick geometry, monotonic rounds ending on Store-empty, no between-act
reshuffle), the 54-live/30-deprecated card pool, `storeStage()` in place of `G.currentAct`, and
`resolveShowdownWinners`' full tiebreak ladder. The engine covers **2-8P** now, not 2-4P.
New guard: **`node sim/test-card-sync.js`** fails if the two card DBs drift.

**Still true — do not trust these yet:** every published sim NUMBER predates the rework. The
Easy/Medium/Hard bands in the tier table below, `sim/results/sim-tierlist.json`, and every
`cardbalance_*.csv` are **historical records, not baselines — do not diff new results against
them.** `fixtures/golden-runGame.json` still freezes the retired triangle game, so
`test-resume-reproduction.js`'s golden check fails **by design** until R2 regenerates it (all its
other checks pass). Re-measurement is R2-R4 of the plan.

### 5-8 Player Support (SHIPPED June 2026 — full log: `docs/FIVE_TO_EIGHT_PLAYER_PLAN.md`)
Rules identical to 2-4P; only setup/Store scale (see **Store Layout** above — 5-8P is 9 rows vs
2-4P's 6, with a per-count width). `getActPool` doubles the act pool for
numPlayers>=5 (second deck; card.id can repeat, uid stays unique). Buy-first (`burn_buy_first`/card_14) is **DEPRECATED as of July 2026** — card_14 is no longer dealt,
so the whole claim path below is dormant (kept, not removed — see `docs/DEAD_CODE_INVENTORY.md`).
It was once-per-round: `MP.claimBuyFirst(act,round)` (atomic `runTransaction` on
`games/{code}/buyFirstClaim/{act}_{round}`, fail-open) via gate `claimBuyFirstPriority()` (only when
`MP.active && numPlayers>=5`); lost claim keeps the card. Sim parity at the buy-order layer
(`computeBuyOrder` / evolve) — honor only the first holder, inert at ≤4P. `fitPyramid()` (end of
renderPyramid + on resize) recenters & scales the pyramid into `#pyramid-zone` so tall stacks never
clip (runs for all counts now; only ever scales down). **Short-viewport draw-phase fit:** `fitPyramid`
only downscales when its zone is height-bounded; without a cap the zone auto-sizes to the pyramid, so a
tall pyramid (up to 8 rows ≈ 540px) shoves the draw-phase hand below the fold on ≤900px-tall laptops
(buy phase fits — its hand is smaller). Fix: `render()` toggles a `body.count-5plus` class
(numPlayers>=5), and playgame.html caps `body.count-5plus.phase-draw #pyramid-zone { max-height:40vh }`
inside `@media (min-width:1200px) and (max-height:900px)`. The cap (with the zone's `overflow:hidden`)
gives `fitPyramid` a bounded box; it only shrinks pyramids taller than the cap, so shorter 5-6P ones
stay full size. Scoped to **draw phase + 5-8P** (≤4 rows fit natively; buy phase needs the big
clickable pyramid). **Opponent layout (Option 3 "rail", June 2026 — ALL player counts):** on
desktop (`@media min-width:1200px`, grid in playgame.html) the page is a **2-column grid**:
`#main-col` (your whole left column) + a fixed-width **scrolling rail** on the right (`grid-area:opp`,
`position:sticky; max-height:calc(100vh-1rem); overflow-y:auto; flex-direction:column`). **`#main-col`
(wraps pyramid+action+player+log) is ONE `align-self:start` grid item with its own nested grid
(`"action pyramid" / "player player" / "log log"`)**, so the rail beside it lays out 100% independently
— a tall/growing rail can no longer drag your Draw Card or hand around. (The earlier 3-col grid had the
rail SHARE the action/pyramid + player rows; once the Store became short (brick rework), the rail's
height drove those shared rows and shoved the action zone + hand. `min-height:0` didn't fix it — auto
grid tracks still grow to a spanning item's max-content; the single-start-aligned-`#main-col` is the
real fix.) On **narrow (<1200px)** `#main-col` is **`display:contents`** — invisible to layout, so its
children flow directly in `#game`'s single-column flex with their existing `order` (NARROW LAYOUT
UNCHANGED; don't give `#main-col` any narrow box or you'll break the `order`-based reflow). The rail
still can't push your area off-screen (sticky + bounded + internal scroll). The desktop block also
overrides `.opp-grid` back to a flex column and the opp `.hand-row`
back to side-by-side (rail tiles are ~290px, so deck-preview + fan read fine — no stacking needed
there). On **narrow (<1200px)** the grid collapses to the single-column flex and opponents "drop
below" your area via `order` (`#opponents-zone {order:6}`, after `#player-zone {order:5}`), so your
draw controls + hand come first and opponents stack at the bottom. **Opp card hover:** `.opp-zone
.hand .card:hover` only bumps z-index + shadow — NO `translateY`/`scale` lift (the rail tiles'
`overflow:hidden` would clip a lifted card's top); the big readable zoom is the floating
`#card-hover-preview`, which `showCardHoverPreview` now also top-clamps (`top<8 → 8`) so it can't run
off the top of the viewport. The narrow `.opp-grid` 2-col grid
(5-8P) + `.hand-row` STACK (`flex-direction:column`, deck-preview on top, fan full-width) is still
used <1200px — without the stack the fan fell back to a fixed 240px width and `overflow:hidden`
clipped the entire hand away (the "8-player hands cut off" bug, June 2026; fix in `layoutOpponentFan`
width fallback + `.opp-grid` CSS). gamesetup: count buttons grouped
2/3/4 + 5/6/7/8 via `.count-break`, slots 5-8 built by `renderDynamicSlots(n)`. `gameHistory.numPlayers`
rule cap is 8 (deployed). Trajectory capture SKIPPED for 5-8P (`trajActive()` requires numPlayers<=4).
**spectate.html** also mirrors the brick offset in its own `renderPyramid` (odd rows, `rowIdx%2===1`,
get `.spec-pyramid-row.brick-offset`, a half-card `translateX` keyed to `--spec-cw`). Spectate does NOT
scale (no fitPyramid equiv) and does not vertically overlap rows — it just staggers + scrolls.

### Deck Operations (lines ~1130–1190)
```
drawFromDeck(player)        ~1132 — draw top card, triggers reshuffle if empty
playerDrawWithReshuffleCheck() ~1147 — handles reshuffle prompt for human
resetPlayerRound(player)    ~1175 — clears hand back to discard, resets round stats
```

### Card Effects & Logging (lines ~1191–1275)
```
applyCardEffects(player, card, isFirstCard) ~1191 — applies dollars/cows/bandits/specials
cardLabel(card)             ~1255
addLog(text, className)     ~1267
```

### Rendering (lines ~1274–1778)
```
cardImgSrc(card, faceUp)    ~1276
renderCardEl(card, faceUp)  ~1283
getDrawLeaders()            ~1303 — used by turn order bar
updateTurnOrderBar()        ~1339
updateZoneStates()          ~1374 — greys out zones, manages pointer-events
render()                    ~1403 — full DOM refresh; does NOT clear opp zones. Renders opponents in SEAT order (derived from G.seatOrder, same as updateTurnOrderBar) and sets each opp zone's inline CSS `order` to its seat position — so the right-hand rail matches the top turn-order bar. (Raw G.players index order is slot-claim order, NOT seat order; iterating 1..n directly mismatched the bar.)
renderPlayerZone(player)    ~1482 — opponents fan their hand via layoutOpponentFan (local player hand untouched)
layoutOpponentFan(handEl)   ~4659 — flat overlapping "fan" for an OPP hand: spreads across up to 3 rows (oldest top-left→newest bottom-right); rows added before any overlap, overlap tightens as count grows; newest card on top; no scrollbar. Measures handEl.clientWidth (works while collapsed); on a 0 read (pre-layout) borrows parent width and clamps W to ≥ cardW — NEVER a fixed 240px fallback (that overflowed the narrow 5-8P grid cells and overflow:hidden clipped the whole hand away). Card size must match `.opp-zone .hand .card` in play.css (52×73). 5-8P note: `.opp-grid .opp-zone .hand-row` stacks (deck-preview ON TOP of the fan) so the fan claims the full ~90px cell width instead of a ~2px sliver beside the 60px deck-preview; `.collapsible:not(.collapsed)` max-height bumped to 410px for the taller stacked layout (the `:not` keeps the `.collapsed{max-height:0}` collapse working).
relayoutOpponentFans()      ~4650 — re-runs layoutOpponentFan for every opp hand; debounced on window 'resize'
renderDeckPreview(player)   ~1548
renderPyramid()             ~1585 — sets z-index inline (generalizes past CSS nth-child) + tags `.brick-offset` on odd rows; calls fitPyramid() at the end
fitPyramid()                       — recenters + scales the pyramid to fit #pyramid-zone (width+height) so tall stacks never clip. Runs for ALL counts now (only ever scales down → recenter-only no-op when it fits). Also runs on window resize. Height budget is `zone.bottom - pad - contentTop` (NOT zone.height): the pyramid sits below the "Store" label and the scale pivots on the content top, so using zone.height over-budgeted by the label height and clipped the bottom rows (8P draw phase under the 40vh cap). NOTE: only downscales vertically when the zone is height-bounded — on ≤900px-tall screens the `body.count-5plus.phase-draw #pyramid-zone {max-height:40vh}` cap (playgame.html) supplies that bound so the draw-phase hand stays on-screen (see Store Layout section).
renderLog()                 ~1638
setMessage(text)            ~1649
setActions(buttons)         ~1653
clearActions()              ~1667
animateDrawnCard(card)      ~1675
doCardFlip(el, img, ...)    ~1738
setCardPreview(card)        ~1751
mpSyncDraw()                ~1770 — pushes local draw state to Firebase drawState/{mySlot}
```

### Game Flow — Setup (lines ~1779–2130)
```
startGame()                       — entry point; branches MP rejoin vs normal; calls setupStore()
                                    (the Quick Draw draft functions were deleted July 2026)
restartGame()               ~2119
```

### Rejoin / Reconstruction (grep the names; July 2026 rework — audit C3/C4/C6/C7/H3)
```
reconstructG(state, cfg)     — rebuilds G from spectatorState; restores buy entitlements,
                               dollar1OtherPlayed, AI RNG seeds (aiRngSeeds — never re-seed
                               mid-game), and stashes slot-keyed drawsDone on G._restoredDrawsDone
applyOppDrawState(slot, st)  — SHARED drawState applier (startRound + resumeDrawPhase; all
                               stale/done/empty-array guards live here — never fork it)
applyOppDoneData(opp, done)  — SHARED drawDone applier; authoritative stats + hand reconcile
resumeDrawPhase()            — re-enters draw phase; completes AI seats from restored
                               drawsDone / busted / stoppedDrawing or re-runs aiDrawPhase
resumeBuyPhase()             — re-enters buy phase after rejoin
resumeFromState(state, cfg)  — the ONE resume entry point: handles draw/buy/gameOver and
                               watches spectatorState through transient phases (score/showdown)
armForcedDrawTombstone()     — adopts a host-forced drawDone instead of drawing past it (R2)
```

### Round Flow (lines ~2268–2415)
```
setupStore()                      — runs ONCE from startGame. Host builds the Store + pushes a
                                    single actSetup (act:1, all card ids); guests wait for it.
                                    No deck merge/reshuffle (there is no act boundary any more).
startRound()                      — resets players, deals, starts draw phase
```

### Draw Phase (lines ~2413–2670)
```
getActivatableCards(player) ~2417
startPlayerDraw()           ~2456 — sets up human draw UI; hides "Stop" while player.forcedDraws > 0
playerDraw()                ~2512 — resolves a single draw action; decrements forcedDraws; draw4 → forcedDraws += 4
playerStopDraw()            ~2624
onPlayerDrawDone()          ~2640 — human done; triggers MP sync + checkDrawPhaseComplete
checkDrawPhaseComplete()    ~2654 — advances to buy phase when all draws done
```
NOTE (Draw 4 / `forcedDraws`): "Draw 4" (card_54) no longer auto-loops the 4 extra draws.
It sets `player.forcedDraws += 4`; the player resolves each draw through the normal
playerDraw flow, so burn-to-use cards (esp. the "-1 bandit" jail cards card_50/card_39)
can be activated BETWEEN draws — i.e. before busting (matches rules errata). startPlayerDraw
omits the "Stop" button while forcedDraws > 0, so the 4 draws stay mandatory. Activating a
card does NOT consume a forced draw. forcedDraws is cleared in handleBust + resetPlayerRound,
and zeroed when both piles are empty. It is local-human-only state (NOT synced to Firebase) —
a hard-refresh mid-Draw-4 resets it (accepted edge). AI parity: the aiDrawPhase draw4 loop
proactively activates a held jail card at 2+ bandits before each forced draw (mirrored in
sim/personality-engine.js).

### AI Draw Phase (lines ~2667–2950)
```
aiDrawPhase(playerIdx)      ~2669 — full AI draw loop (all clients run this)
aiShouldDraw(ai)            ~2882 — decision logic (reads AI_PERSONALITIES cfg); hard cap `hand.length >= cfg.maxDraw ?? 7` (see maxDraw note)
calcBustProb(player,n,cfg)  ~2930 — blends exact lethal-card count with flat prior via deckMemory/lethalBias
getBestAffordableCost(ai)   ~2933
```

### Special Card Handlers (lines ~2948–3265)
```
activateSpecialCard()       ~2948 — burn_to_use activation from hand
handleBust(player)          ~2996
handleBurnToUse()           ~3026  — Explosive activation: "Use" (burn_to_use special)
handleBurnBuyFirst()        ~3055  — "Use for Priority" (burn_buy_first special)
handleLook3()               ~3074
handleTrashLook3()          ~3143  — "Use & Look" (look3_rearrange special)
handleReplayDiscard()       ~3160  — "Use & Replay" (replay_discard special)
handleExtraBuy()            ~3230  — "Use for Extra Buy/Burn" (extra_buy special)
NOTE: handlePutOnTop() (May 2026) and handleBurnFor2() (June 2026) were permanently removed.
      `burn_for_2` is GONE — its three cards (5/16/22) were reworked into `burn_to_use` $3
      Explosives. If a future card needs put_on_top / burn_for_2 logic, rebuild from git history.
```

### Swap Card — `swap_revealed` (card_4 only, 4P-only) (grep `swap_revealed` / `applySwapLocal`)
```
gatherSwapCandidates(player) — grouped candidate list: Store (available pyramid) + each
                               opponent's drawn hand + their discard top. {groups, total}.
openSwapModal(player, card)  — human picker (grouped like My Deck; #special-modal); on pick →
                               applySwapLocal + sets player._pendingSwap (carried on next buyAction).
applySwapLocal(player, spec) — applies the swap on EVERY client identically. spec =
                               {kind:'pyramid'|'hand'|'discard', victimSlot, row, col, takenId, card4Uid}.
```
NOTE (card_4 is now a SWAP, reworked June 2026 from `discard_to_player`): On your **buy turn**,
**in addition** to your normal buy/burn, you may use card_4 to take ANY face-up card — an
available Store/pyramid card, an opponent's drawn hand card, or an opponent's discard top. It's a
**true positional steal**: the taken card → your **discard** (it only scores in a FUTURE round —
herds are locked at the start of the buy phase, confirmed by PB), and card_4 takes the **exact
slot** the taken card vacated (back into that opponent's hand index / discard top, or that pyramid
cell, staying face-up & buyable). Targets resolve by stable keys (pyramid row/col; pile by card
**id**, not uid) so they survive per-client uid differences. **MP:** a human's swap rides inside
their `buyAction` (optional `swap` field on `pushBuyAction`); `mpOpponentBuyTurn` applies
`data.swap` BEFORE the buy/burn so all clients mutate in the same order. **AI:** `aiBuyTurn` only
swaps for a **pyramid** card (never opponents' hands) so the choice is deterministic across clients
without a broadcast (pyramid is shared; opponent-hand views may differ). Edge: a hard refresh in the
tiny window between a human's swap and their buy/burn can lose an un-broadcast swap (accepted, niche).

### Buy Phase (lines ~3265–3590)
```
onDrawPhaseComplete()       ~3269 — called when all draw phases done; kicks off buy ordering
showChooseFirstUI(nonBusted, reason) ~3348 — local draw-winner picks who buys first; message shows WHY they get to choose (the win reason from determineBuyWinner — audit F2). onDrawPhaseComplete also sets G._buyOrderReason (per-round, only when the order STARTS with the player who earned it); aiBuyTurn shows it on the round's first buy turn ("X buys first — most $ ($3)…")
startBuyPhase(startIdx)     ~3364
applyBuyOrder(order)        ~3390
processBuyTurn()            ~3399 — dispatcher: human / AI / mpOpponent
mpOpponentBuyTurn(opp)      ~3433 — waits on Firebase buyAction/{slotIdx}; if executeBuy/BurnLocal returns false (cell already gone on this client) it advances the turn itself so the chain never stalls (bug #16)
humanBuyTurn(player)        ~3451
onPyramidCardClick(r, c)    ~3469
executeBuy(player, r, c)    ~3506
executeBuyLocal(player, r, c) ~3512 — returns true if applied, false if the target cell was already removed/missing (no-op). MP callers must advance on false; human/AI ignore it. See bug #16.
advanceOrExtraBuy(player)   ~3532
executeBurn(player, r, c)   ~3562
executeBurnLocal(player, r, c)    — returns true if applied, false on a no-op (cell already gone), same contract as executeBuyLocal. See bug #16.
```

### AI Buy Phase (lines ~3586–3730)
```
aiBuyTurn(ai)               ~3588  — hoists cfg at top; passes cfg.revealBonus to pyramidRevealBonus
scoreCardForAI(card, ai)    ~3673  — uses cfg.act1DollarBonus / cfg.act3CowBonus, gated on
                                     storeStage() (was G.currentAct)
pyramidRevealBonus(r, c, b) ~3707  — b = cfg.revealBonus (per-personality, was hardcoded 1.5)
```

### End Phases (lines ~3805–4070)
```
endBuyPhase()               ~3807
scoreRound()                ~3812 — Store empty ⇒ startShowdown() directly (endAct() was deleted
                                    July 2026 — one Store means no act transition)
startShowdown()             ~3861 — final scoring + card flip animations; ends by calling showShowdownResult (no more "See Who Wins" button / separate game-over screen)
showdownCollection(player)  ~5341 — deck + hand + discard (what the Showdown lays face-up)
resolveShowdownWinners(ps)  ~5346 — SHOWDOWN TIEBREAK (July 2026). 3 steps, mirroring the
                                    buy-order ladder so players reuse one model:
                                    most Cows → most $ across collection → most cards.
                                    STOPS there: no card-by-card walk, no random pick —
                                    players still level genuinely share the win.
                                    ⚠️ Do NOT add a Bandit step: only 4 of 54 live Store
                                    cards carry any, so nearly all Bandits come from the
                                    identical starter deck and it would almost always tie.
                                    MP-safe (collection contents + printed `dollars` are
                                    shared state). NOT mirrored in sim/ — see D0 note.
showShowdownResult()        ~4426 — ALSO mounts the herd chart into #showdown-chart (the one
                                    mount point covering live showdown + gameOver rejoin).
                                    Crowns the top-herd player's section inline (.showdown-winner + 🏆), sets the gold "X Wins!" title, reveals the action footer (Play Again / Review / Home), then calls finalizeGame. Merges what used to be the separate gameover-screen into the showdown screen (Option A, June 2026).
gameOver()                  ~4470 — REJOIN-ONLY now: rebuilds the showdown board statically (cards face-up, final herds) for a rejoin into an already-finished game, then calls showShowdownResult. (Animated live games go through startShowdown instead.)
finalizeGame(topPlayers)    ~4505 — end-of-game bookkeeping only (MP cleanup, gameHistory log, AI review link). No result DOM.
disbandGame()               ~4064
```
NOTE (final screen, June 2026): the old two-step "See Who Wins" button → separate
`#gameover-screen` overlay was removed. The showdown screen IS the results screen now —
after scoring resolves, the winner's section is crowned in place and the action footer
(`#showdown-footer`) reveals Play Again / Review / Back to Home. `revealWinner()` is gone;
the `#gameover-screen` / `#gameover-title` / `#gameover-scores` markup was deleted from
playgame.html (the review link kept its `#gameover-review-link` id, now inside the footer).
`startGame()` hides `#showdown-screen` (not the deleted gameover screen) on replay.

### UI Helpers (lines ~4070–4380)
```
confirmLeaveGame(e)         ~5490 — guard on the header brand home link. Returns true (allow
                                    navigation) for a MODIFIED click (cmd/ctrl/shift/alt — that
                                    opens a new tab, so the game tab survives) or once the game
                                    is over; otherwise confirms, with different wording for MP
                                    ("others left waiting") vs solo ("progress will be lost").
showRules() / closeRules()  ~4087
showDeck() / closeDeck()    ~4097  — My Deck modal (2-row × 3-col suit grid)
showDeckPeek()              ~4147  — draw-phase ordered deck back preview
showCardZoom()              ~4186
toggleOppZone()             ~4219  — flips opponent-hand visibility for the CURRENT viewport bucket only (see oppHands note below)
applyOppHands()             ~4219  — applies the current bucket's pref (.collapsed class + arrow) to every opp zone; called from render() and on matchMedia change
ensureOpponentZone(i)       ~4232  — creates opp zone DOM only if not already present (detail starts WITHOUT .collapsed; applyOppHands sets it)
toggleLog()                 ~4274
preloadImages()             ~4283
applyDebugScenario(name)    ~5964 — builds a debug game state from a SCENARIOS key. Returns
                                    TRUE on success, FALSE for an unknown name — the caller MUST
                                    stop on false. Falling through starts a 0-row-Store game that
                                    is not flagged isDebug, so it writes real history/traj records.
                                    Helpers: stackedDeck (2P, deck drawn in the given order — the
                                    human deck is NOT shuffled at deal), makeSpecialScenario (no
                                    `act` arg; there is no way to start "in Act 2"), makeEndGame
                                    (4P round 9 + seedHerdHistory), nearEndPyramid(pyr, keep)
                                    (keeps `keep` cards in the BACK row), seedHerdHistory
                                    (back-fills herdHistory/bustRounds so the showdown herd chart
                                    has a series — scoreRound only writes the current round).
```

---

## Key State Shape

```js
// Global game state (window.G)
G = {
  act: 1|2|3,
  roundNumber: 1..N,      // monotonic for the WHOLE game; never resets (no acts)
  phase: 'draw'|'buy'|'score'|'showdown'|'gameover',
  pyramid: [[{card, faceUp, removed}]],  // storeRows() rows × pyramidWidth(), row 0 = back, front row face-up
  currentAct: 1,           // PINNED to 1 — kept only so MP stamps + trajectory records keep their shape
  players: [Player],       // players[0] = always local human
  playerOrder: [slotIdx],  // Firebase slot index for each G.players[i]
  gameSeed: number,
  buyOrder: [playerIdx],   // G.players indices in buy sequence this round
  hiddenHerdMode: bool,    // conceal opponents' herd totals until showdown (gamesetup checkbox)
}

// Player object
player = {
  name, isHuman, slotIdx,
  hand: [CardInstance], deck: [CardInstance], discard: [CardInstance],
  herdHistory: [n],     // herd AFTER each round; [roundNumber] = the Showdown point
  bustRounds: [n],      // round numbers this player busted (herd-chart ✕ marks)
  roundDollars, roundCows, roundBandits, totalHerd,
  busted, stoppedDrawing, hasBuyBurnFirst, hasExtraBuy,
  _syncedDiscardCount,  // MP: synced from Firebase, used in renderPlayerZone
}
```

---

## Herd Chart (end-of-game graph) — July 2026

A "Herd by Round" line graph rendered by **[`src/herd-chart.js`](src/herd-chart.js)** on **two
surfaces from one renderer**:

- **playgame.html** — inside `#showdown-footer`, under `#showdown-winner-title` and **above the
  action buttons**. Mounted from `showShowdownResult()`, which is the ONE mount point that covers
  both the live showdown and `gameOver()` (rejoin into a finished game). The footer is `hidden`
  for the entire reveal sequence, so the chart can never interrupt the showdown. It sits above the
  buttons because Play Again / Game Setup / Back to Home are all exit doors — anything below them
  is read by nobody.
- **spectate.html** — top of `renderShowdown()`, above the per-player blocks. This also covers
  history.html's **Review** link for free, since that just opens spectate on the persisted snapshot.

**Why there is no adapter on either side:** `spectatorState.players` deliberately mirrors
`G.players` field names, so both callers pass the objects they already hold. If a field is missing
on one surface, fix `buildSpectatorState` — do NOT add a per-surface massaging step.

### Data: `player.herdHistory` + `player.bustRounds`

Written in **`scoreRound`**, OUTSIDE the `if (!player.busted && player.roundCows !== 0)` scoring
guard — a busted or zero-cow player still needs a point, or the series goes ragged and the x-axis
stops meaning "round". Uses **indexed assignment** (`herdHistory[G.roundNumber - 1] = herd`), not
`push`: index↔round stays exact and the write is idempotent if `endBuyPhase` ever double-fires.

The Showdown point is written **inside** `startShowdown`'s per-player loop (`herdHistory[G.roundNumber]`),
not after it. That loop pushes a spectatorState per player, so appending after would leave every
intermediate snapshot carrying final herds but no final graph point — a rejoiner landing there
reconstructs an inconsistent chart.

**Restored in THREE places — miss one and the chart silently empties with no error:**
`reconstructG` (MP rejoin), the `loadLocalGame` restore in `startGame` (solo reload), and
serialized by both `buildSpectatorState` and `saveLocalGame`. Always read as `sp.herdHistory || []`,
**never** `!== undefined` — round 1 is an empty array and Firebase drops empty arrays (bug #11).

No `gameV` bump (display-only, no rules/card change) and **no `database.rules.json` change** —
`games/$gameCode` and `liveGames/$gameCode` are open-write with no shape validation, so there is no
deploy step and no C9 risk. Do NOT add these fields to `liveSummary`; that node stays slim.

### Renderer notes

Colour is keyed by **`slotIdx`, not array index** — `G.players` is you-first while
`spectatorState.players` is host slot order, so index colouring would paint the same game
differently on your screen and a spectator's. Marker shape is a second, colour-independent channel
and names are labelled directly at the end of each line (no legend) — eight hues alone are not
distinguishable, and blue/yellow/red are already the suit colours. Busts are a red ✕, which also
disambiguates a flat segment ("busted" vs "scored no cows").

**Two traps, both already hit once:**
- A `stroke-dasharray` **draw-in animation was tried and removed.** It needs `getTotalLength()`, and
  when the rAF measured a path the browser had not finished laying out, the short length became a
  dash *pattern* — lines rendered as stubs with the rest invisible. The reveal is a plain opacity
  fade now; it needs no measurement and cannot fail that way.
- The SVG has **no `min-width`.** An earlier one put the entire right-hand label column (player
  names and final totals) behind a horizontal scrollbar on a phone. Type is sized in viewBox units
  generous enough to stay legible when the whole chart scales down to ~375px instead.

`render()` returns **false** when no series has data (games finished before this shipped); the
spectate caller removes the container so old games don't show an empty frame.

---

## Game Mode / Setup Flags

**No mode is offered at setup today.** Hidden Herd (`hiddenHerdMode`) was removed from the
`gamesetup.html` Mode section in July 2026 — the whole Mode block went with it, since Hidden Herd
was the only entry left. **The mode itself is deliberately still wired end to end** and is the live
worked example for the 3-layer path below: `host.js` payload → `buildPlayersConfig` → `G.hiddenHerdMode`
in every `startGame` branch and `reconstructG` → `spectatorState`/`trajLogHeader` → the
`renderPlayerZone` / `scoreRound` concealment. Two consequences worth knowing:

- **`spectate.html` keeps its Hidden Herd badge**, so games played before the removal still display
  the mode they were played under. Don't "clean up" that badge — it is historical-record rendering,
  not dead code.
- **The only way to enable it now is the `one_card_showdown_hidden` debug scenario** (renamed from
  `act3_one_card_hidden` in the July 2026 debug-page audit), which is why that scenario is kept. It
  is also the only way to exercise the concealment path, so run it after touching
  `renderPlayerZone` or `scoreRound`.
- `gamesetup.html` `startGame()` calls `sessionStorage.removeItem('hidden_herd_mode')` rather than
  simply not writing the key: sessionStorage is per-tab and survives navigation, so a value left by
  an older build would otherwise silently re-enable the mode.

Quick Draw (`quickStartMode`) and
Pioneer Mode (`pioneerMode`) were **removed in the July 2026 single-Store rework** — Quick Draw
"skipped Act 1", which no longer means anything, and Pioneer was a Store-width mode when width was
a constant; width is now per-player-count. Their whole stack is gone: checkboxes, `host.js` payload
fields, `G.*Mode`, the draft flow (`runQuickStartDraft`/`showDraftPackAndWait`/`aiDraftPick`/
`seededDraftShuffle`), the MP draft protocol (`pushDraftPick`/`getDraftPick`/`forceDraftPick`/
`waitForDraftRoundPicks` + the `draftPick` node), the draft overlay markup + CSS.

The `quickStartMode`/`pioneerMode` `.validate` entries were deliberately LEFT in
`database.rules.json`'s `traj` shape — an allowed-but-never-written field is harmless, and removing
them buys nothing while risking a rules/code mismatch.

Modes are toggled by checkboxes on `gamesetup.html` and flow through a fixed 3-layer path. To add a
new one, mirror `hiddenHerdMode` at each layer:

1. **`gamesetup.html`** — checkbox + handler set a JS flag, written to `sessionStorage['<flag>_mode']` in `startGame()`.
2. **`src/host.js`** — read the sessionStorage flag and include it in the `set(gameRef, {...})` payload so all MP clients agree (the game node is the source of truth in MP).
3. **`src/play.js`** — MP layer surfaces `data.<flag>Mode` in `buildPlayersConfig`'s return; `startGame` sets `G.<flag>Mode` in all branches (MP cfg, tutorial, AI/sessionStorage) AND the inline rejoin block; **rejoin must also set it in `reconstructG`** or a refresh loses the mode. Plus `trajLogHeader` records it — **a new flag there needs a matching `.validate` in `database.rules.json`'s `traj` shape (`$other:false` rejects unlisted fields) or every 2-4P trajectory write fails — AND the rules must be DEPLOYED (`firebase deploy --only database`), not just edited: the Pioneer Mode flag sat undeployed ~a week and every trajectory header was silently rejected (audit C9).**

**A width-changing mode is now special:** `reconstructG` no longer restores any width flag, because
width derives from `numPlayers`. If a future mode changes the Store width again it MUST be restored
in `reconstructG` before the first render — the rebuilt rows are already that width, and a mismatch
misaligns the brick offset and breaks `isCardCovered` on rejoin.

**Hidden Herd** specifically: when `G.hiddenHerdMode`, opponents' herd totals are concealed UI-side. `renderPlayerZone` (~1626) shows `?` for `prefix !== 'player'` until `G.phase === 'showdown'`; `scoreRound` (~4245) suppresses the opponent herd-bump animation and redacts the running total from the log (shows only cows-this-round). It is **UI-only concealment** — the real herd still syncs to Firebase `spectatorState`/`liveSummary` (needed for the showdown reveal and rejoin reconstruction), so spectators and a Firebase-savvy player can still read it. AI decision logic reads real opponent herd locally (unchanged; unavoidable since all clients run AI locally).

---

## AI Personality System

**Full reference:** [`sim/AI_PERSONALITIES.md`](sim/AI_PERSONALITIES.md)

> **Tiers RE-MEASURED July 2026** on the single-Store engine, after the `banditPenalty` fix
> below. Numbers are `2P overall % / 4P focal %` from `node sim/simulate.js` (1500 games/pair)
> and `--players 4` (2500 games/bot), ties split fractionally.
>
> **The `banditPenalty` correction (July 2026) is the largest AI gain ever measured on this
> project — up to +18pp at 4P.** R5's forced-buy counterfactual showed a Bandit costs roughly
> **5 Cows** of real value, while every Hard bot priced one at well under half a Cow. The AI was
> taking `card_43`/`card_51` (5 Cows + 2 Bandits) **93-95% of the time it could afford them** —
> the only two cards in the game that are causally worse than burning. It now takes them ~14%.
> **The measured optimum is `banditPenalty ≈ 2.1 × cowWeight`** for every Hard bot independently,
> which is also the analytic threshold at which the AI stops preferring `card_43` over `card_18`
> (2 Cows, same cost). Only the Hard tier was corrected — Medium/Easy keep their genomes by
> design, so the tier gap is now wider.
>
> **5-8P tiers measured for the FIRST time (July 2026)** — the shipped 5-8P mode had never had
> AI win rates checked. The ordering holds at every count, so the difficulty picker is valid
> there. Focal win% (baseline in brackets): **5P** [20%] enforcer 37.2 · drifter 36.0 · rancher
> 35.4 · deputy 28.9 · prospector 26.0 ‖ outlaw 9.8 · wild_bill 9.0 ‖ sheriff 4.3 · banker 0.6 ·
> greenhorn 0.0. **6P** [16.7%] enforcer 30.3 · rancher 30.0 · drifter 28.9 · deputy 26.1 ·
> prospector 22.8. **8P** [12.5%] enforcer 27.3 · rancher 24.4 · deputy 22.5 · drifter 22.3 ·
> prospector 17.3. The Hard bots' edge over baseline GROWS with player count (1.5x at 2P, 1.7x at
> 4P, 2.2x at 8P) — more opponents means more chances for someone else to bust, and the
> disciplined bots bust least.
>
> Two knobs were act-gated and now read **`storeStage()`** instead of `G.currentAct`:
> `act1DollarBonus` / `act3CowBonus` in `scoreCardForAI`, and `actProgress` in `aiBuyTurn`'s denial
> heuristic. Semantics are preserved (early Store = Act 1 cards on offer = economy lens).

### Difficulty tiers (MEASURED — `node sim/simulate.js`, June 2026)

10 personalities, tiered by measured win-rate vs the field (2P overall % / 4P focal %). The
`gamesetup.html` difficulty picker (`DIFFICULTY_TIERS`) maps Easy/Medium/Hard onto these bands;
`banker` straddles the easy/medium boundary. **Re-rank with `node sim/simulate.js` before changing
tiers — don't tier by vibe (the old labels were inverted: deputy/rancher were mislabeled Medium and
outlaw/wild_bill mislabeled Hard).**

Win% below is **vs the whole field** and therefore relative — the June 2026 Hard-tier upgrade
(prospector/drifter/enforcer `maxDraw` 7→10) raised the upgraded bots' *absolute* strength, which
also makes deputy/rancher's vs-field % dip even though their genomes are unchanged (the field got
tougher). Absolute gains are in `draw-cap-experiment.js`.

| Tier | Personality | 2P / 4P win% | Character |
|---|---|---|---|
| **Hard** | `drifter` | 74 / 43 | Cow grinder + denial. `maxDraw 10`; `denialBurn` turned ON July 2026 (+3.6pp 2P / +3.9pp 4P) — now the strongest bot at both counts |
| **Hard** | `enforcer` | 74 / 43 | Near-optimal cow buyer, calibrated aggression, precise fear; `maxDraw 10` (upgraded). Coevolution's convergence target |
| **Hard** | `deputy` | 69 / 38 | Disciplined draw (low bust) + denial + competent cow buying |
| **Hard** | `prospector` | 64 / 31 | Hard's floor; `maxDraw 10` (upgraded) |
| **Hard** | `rancher` | 72 / 43 | Cow-optimizing grinder; the benchmark |
| **Medium** | `outlaw` | 44 / 13 | High-variance aggressor; busts ~44% of rounds — swingy, nets to mid |
| **Medium** | `wild_bill` | 38 / 11 | Pure chaos; `dollarBuffer 999`, busts ~45% — swingy |
| **Easy** | `banker` | 25 / 2 | Dollar-first, intentionally suboptimal (designed-to-lose). **No longer near the easy/medium boundary** — re-measured July 2026 at 2P 27.8 / 4P 3.7. Dollars score nothing at the Showdown, so the dollar-first genome is far weaker than the old (buggy) sim reported |
| **Easy** | `sheriff` | 37 / 7 | Conservative, methodical, low cowWeight |
| **Easy** | `greenhorn` | 3 / 0 | Deliberately terrible — terrified of bandits, hoards dollars. The floor |

### Personality parameters (15 total)

All parameters live in `AI_PERSONALITIES` (~line 2813 in `src/play.js`). The sim-side genome copy
is **`sim/personalities.js`** (single source of truth for evolve/simulate/experiments), and the AI
decision logic is mirrored in **`sim/personality-engine.js`** (`shouldDraw`/`scoreCard`/`runGame`).
`node sim/test-personality-sync.js` fails if play.js ↔ personalities.js drift. Keep `play.js` ↔
`personality-engine.js` in sync for any draw/buy **logic** change. See [`sim/TUNING.md`](sim/TUNING.md).

Draw-phase: `bustThreshold2`, `bustThreshold1`, `dollarBuffer`, `positionWeight`, `affordMult`, `deckMemory`, `lethalBias`, `maxDraw`

Buy-phase: `cowWeight`, `dollarWeight`, `banditPenalty`, `act1DollarBonus`, `act3CowBonus`, `revealBonus`, `denialBurn`

**`maxDraw`** (June 2026) — hard hand-size cap in `aiShouldDraw` (`hand.length >= (cfg.maxDraw ?? 7)`);
absent ⇒ 7. It plays **two opposite roles** depending on the personality, so it is NOT a global
constant:
- For **disciplined** bots whose bandit thresholds already govern stopping (**all 5 Hard bots now
  10** — rancher/deputy first, then prospector/drifter/enforcer in the June 2026 Hard-tier upgrade),
  the old hardcoded 7 was dead weight clipping the winning human line (overdraw dollars → more cows +
  earlier buy priority, since buy order is `roundDollars`-first). Raising to 10 is sim-validated
  **+3–4pp win (2P) / +6–7pp (4P) at ≤+2pp bust rate**.
- For **aggressive** bots (wild_bill `dollarBuffer:999`, outlaw — both stay **7**) the cap is a
  load-bearing bust governor; lifting it makes them bust >50% of rounds and collapse. Do NOT raise
  theirs. sheriff/banker left at 7 by design (Easy / designed-to-lose tiers — not buffed on purpose).
- Tooling: **`sim/draw-cap-experiment.js`** (focal-vs-field sweep over `maxDraw`, reports win%+bust%
  per personality; uses `personality-engine.js`'s `runGame`). Re-run it before retuning any draw cap.

### Evolutionary optimization

Parameters were tuned via `sim/evolve.js` (genetic algorithm, 3 trials × 100 generations × 100 seeds).
Key findings locked into the personalities:
- `cowWeight` 9–10 is optimal; evolved AIs unanimously converge here
- `revealBonus` ≈ 0 for top performers (burning to uncover pyramid is a trap)
- `act1DollarBonus` = 0 for top performers (dollar cards are currency, not score)
- `positionWeight` ≈ 0 (position-adjusted draw aggression doesn't help)
- Banker's low `cowWeight` and high `act1DollarBonus` are **intentional deviations** — do not "fix" them

### AI difficulty selection (IMPLEMENTED)

`gamesetup.html` `DIFFICULTY_TIERS` (~line 540) maps the per-seat Easy/Medium/Hard picker onto the
measured bands above; `pickAiForSlot(difficulty, usedPersonalities)` picks a personality (avoiding
repeats, falling back to reuse when a tier is exhausted) + a themed name from `AI_NAME_POOLS`.
Current mapping (data-driven, June 2026):
- **easy:** `greenhorn`, `sheriff`, `banker`
- **medium:** `banker`, `wild_bill`, `outlaw`
- **hard:** `prospector`, `rancher`, `drifter`, `enforcer`, `deputy`

The earlier "intended" mapping (rancher=Normal, outlaw=Hard) was **wrong** — the sim shows outlaw/
wild_bill are mid-tier and deputy/rancher/enforcer/drifter are the strongest. Re-run `node
sim/simulate.js` and re-tier from the win-rate bands if personality params change.

---

## Trajectory Capture (`traj`) — the human-play benchmark

**Purpose:** capture human games as a **durable, replayable, architecture-agnostic benchmark** so
ANY future AI (the 14-param bots, a neural net, an LLM agent) can be scored against real human play
offline, without re-instrumenting the game. Outcome-only `gameHistory` has no moves; the in-game log
is an unpersisted rolling buffer. This is the move-level substrate.

**Core principle — store thin, reconstruct fat:** capture a compact trajectory; derive every feature,
benchmark, and value label offline by replaying the deterministic engine (`sim/game-core.js`). The
logger records the *situation and the human's choice*, never a bot's verdict — so the AI comparison is
an offline, re-runnable, any-personality (or any-future-model) operation, not baked in at capture time.

**Design (in `src/play.js`, the `TRAJ` module + `trajLog*` helpers, ~line 709):**
- **De-identified:** keyed by `slotIdx`, **no player names**. Header carries only `{isHuman, personality}`
  per seat.
- **Capture model (who writes what):** the **host** (`amTrajHost()` = MP host, or the single AI-mode
  client) writes the header, act setups, AI-seat buys, and canaries (de-duped); each **human client**
  writes its own seat's snapshots + decisions (`G.players[0]`). Remote humans log their own seat (the
  host can't see their draw order — human shuffles use `Math.random`, so draw *outcomes* must be logged,
  not reconstructed from seed).
- **Record kinds** (`kind`): `hdr` (versions, `gameSeed`, seats), `act` (pyramid card IDs), `snap`
  (a seat's `deck/hand/discard` IDs + `herd` at round start), `d` (draw: actual `drew` card id / or
  `action:'stop'`), `s` (special activation + stat-affecting sub-choice, e.g. `replay_pick`), `b`
  (buy/burn coordinate), `ck` (**canary**: ground-truth `herds`/`deckCounts`/`discardCounts` at round
  end — the offline reconstructor asserts replay against these to catch engine/card-DB drift loudly).
- Hooks: `trajLogHeader` (startGame), `trajLogActSetup` (setupAct), `trajLogRoundSnaps` (startRound),
  `trajLogDraw` (after `drawFromDeck` in playerDraw), `trajLogStop` (playerStopDraw), `trajLogSpecial`
  (activateSpecialCard + replay_discard pick), `trajLogBuy` (executeBuy/executeBurn — also catches AI
  buys, host-gated), `trajLogCanary` (scoreRound). Skips debug + tutorial games — the tutorial
  exclusion is the **sticky per-game flag `G.isTutorialGame`** (set in `startGame`'s tutorial
  branch), NOT `TUTORIAL.active`: the active flag drops when the coached steps end while the game
  continues as free play, which used to leak a headerless (unreplayable) trajectory from the
  remainder (July 2026 audit, game FBEURP). `saveLocalGame` uses the same flag for the same reason.
  Any future gate that must exclude the WHOLE tutorial game checks `G.isTutorialGame`.
- **Phase 0 scope:** AI *draws* are NOT per-event logged (deterministic from seed; `snap`+`ck` suffice);
  only human draws are. Look3-rearrange order is not captured (deck-order only, covered by outcome
  logging). The canary flags any under-capture during offline replay.

**Versioning — three independent axes (header):** `schemaV` (record format), `gameV` (game content+logic;
bump on rules/card-stat changes — see table below), `cardDbHash` (auto FNV-1a hash of the card-stat table,
backstop under `gameV`). **Golden rule:** stored data is immutable/append-only; all version handling lives
in the offline reader (read-time normalization), never a write-time migration. The reconstructor refuses
to replay when its engine's `gameV` ≠ the trajectory's, so the benchmark never silently rots.

| `schemaV` | meaning |
|---|---|
| 1 | initial trajectory format (hdr/act/snap/d/s/b/ck) |

| `gameV` | meaning |
|---|---|
| 1 | baseline at trajectory launch (June 2026) |
| 2 | June 2026 card rework: cards 5/16/22 `burn_for_2`→`burn_to_use` $3 (cost 3); card_4 `discard_to_player`→`swap_revealed` ($0, cost 6); `burn_for_2` mechanic removed |
| 3 | **July 2026 single-Store rework.** 30 of 84 Store cards deprecated (54 live, 18/act); the 3+P/4+P `minPlayers` tier removed; cards 84/85 `-1 Bandit / -1 Cow` → `-1 Bandit + Draw 4`; ONE Store built at game start (act tiers, no mid-game setup, no between-act reshuffle); rounds monotonic 1..N; Quick Draw + Pioneer Mode removed. `gameHistory` entries now carry `gameV`; the leaderboard on history.html ranks `gameV >= 3` only. |

**Storage:** top-level `traj/{code}` (push list), **deliberately NOT under `games/{code}`** —
`spectate.html` reads the whole game node, so co-locating would bloat every spectator read (the anti-pattern
the `liveSummary` slim-node redesign fixed). Append-only, shape-validated rules; `.read:false` (CLI-pull
only, owner creds bypass rules). ~15–25 KB/game; fits the free tier for thousands of games. In-game overhead
is lower than the old v1 logger (no shadow-AI scoring at decision time).

**Lifecycle:** treated like `gameHistory` — **permanent research data**, NOT purged by
`admin/cleanup-games.sh` (transient game-state nodes only). Delete test/analyzed trajectories by code
(`firebase database:remove /traj/CODE`). **Do not** add `traj` removal to routine cleanup — losing
un-analyzed human data is the costly mistake.

**v1 legacy (`decisionLog`):** the prior shadow-AI logger (`decisionLog/{code}`, "human vs outlaw" per
decision) is retired. Its 4 captured games remain as a frozen cohort, read by `admin/analyze-decisions.py`.
Its `.read:false` rules stay in place; nothing writes it anymore.

**Roadmap (Phase 1+, offline, not built):** full plan in **[`docs/TRAJECTORY_PHASE1_PLAN.md`](docs/TRAJECTORY_PHASE1_PLAN.md)**
— read it before starting Phase 1. In brief: reconstructor in `sim/` (replay + canary validation) → static
decision-puzzle benchmark → Monte Carlo **value oracle** (EV-label decisions; measure *quality* not just
human-similarity) → fit a new personality by swapping `sim/evolve.js`'s fitness to human-decision-agreement
(optionally winner-weighted). **Do not draw AI-tuning conclusions until the corpus is large** (the binding
constraint — the site produces few completed games).

**Risk to monitor (not yet observed):** all Firebase writes share one WebSocket, and a 4-player MP game
now fires extra `traj` pushes (snaps + per-draw events + canaries) alongside the protocol writes
(`drawDone`/`buyAction`/`spectatorState`). In theory a flood could *delay* a protocol write and contribute
to an MP stall. Low risk (volume is modest, spread over human thinking-time, pushes are queued not
synchronous, and `traj` writes are fire-and-forget + try/caught + read by nobody — see `trajTry`). **If MP
stalls/softlocks recur, instrument `traj` write volume/latency first**, and the cheap mitigation is to
batch or throttle `snap` writes. This is the only place trajectory capture touches a shared resource.

---

## Known Bug Watch List

**⚠️ Read [`docs/MP_PROTOCOL_AUDIT.md`](docs/MP_PROTOCOL_AUDIT.md) before touching MP sync code**
(July 2026 adversarial audit). **All confirmed findings were FIXED July 3 2026** — see bug #17
below for the do-not-regress invariants, and the audit doc for full mechanism write-ups (C1-C9,
R1-R3, H1-H5). Still open by choice: N1 (lobby dies on host wifi blip), N2 (public codes =
joinable seats), and the audit's systemic item 2 (guest pyramid/state reconciliation at round
boundaries — the recommended next MP investment).

### 1. Discard Desync (Recurring — fixed twice)
**Commits:** `eba3437` (Mar 30 2026), `2744b26` (Mar 31 2026)

**Symptom:** Remote player scores wildly incorrect cow counts at showdown (e.g. +99 instead of +29). Cards appear duplicated in their total.

**Root cause pattern:** `opp.discard` on the host is never synced from Firebase — only `hand` and `deck` are reconstructed. When the remote player reshuffles (discard → deck), the host's stale `opp.discard` still contains the old cards, so deck+hand+discard triple-counts them.

**What to check when this recurs:**
- Is `discard` being pushed in `mpSyncDraw()` / `pushDrawState()`? Look at `drawState/{slot}` in Firebase logs.
- Is `opp.discard` being reconstructed in BOTH `watchOpponentDrawStates` (line ~2196) AND the `waitForAllHumanDrawsDone` callback in `startRound` (line ~2360)?
- Is the act boundary guard in place? (`stale` check using both `round` and `act` fields)

**Also watch:** `opp.hasExtraBuy` — was missing from the `startRound` path until `2744b26`.

---

### 2. Act Boundary Stale Draw State
**Commit:** `2744b26` (Mar 31 2026)

**Symptom:** At the start of Act 2 or 3, an opponent appears to have busted immediately without drawing, or draw phase completes too early.

**Root cause:** `round` resets to 1 each act. A `drawState` with `{act:1, round:5}` pushed late could be mistaken for `{act:2, round:1}` if only `round` is checked as the stale guard.

**What to check:** Both `watchOpponentDrawStates` handlers must include `act` in their stale comparison, not just `round`.

---

### 3. Opponent Zone Collapse State Reset
**Symptom:** Collapsed opponent sections re-expand every time any game state updates.

**Root cause:** `render()` was clearing and rebuilding all opponent DOM zones on every call.

**Fix in place:** `ensureOpponentZone(i, container)` (line ~4232) returns early if the zone already exists. `render()` must NOT remove opponent zone elements — only `startGame()` clears them. Do not regress this.

**Opponent-hand default visibility (per-viewport):** opp hands default **expanded on wide / collapsed on mobile** (768px breakpoint), and the header click still toggles all of them. State is two session-only in-memory buckets — `oppHandsPref = {wide:'open', mobile:'closed'}` (NOT persisted; reload resets). `oppHandsBucket()` picks the bucket from `matchMedia('(max-width:768px)')`; `applyOppHands()` writes that bucket's pref onto every opp zone and runs from `render()` (synchronous → no flicker) and on the matchMedia `change` event; `toggleOppZone()` flips only the current bucket. Crossing the breakpoint just shows the other bucket's value — the two are independent. **Collapse reuses the existing `.collapsed` class** (its max-height/opacity/transition are in play.css and its `padding:0` is in playgame.html's inline `<style>`). **Do not** reimplement collapse via separate attribute-selector CSS — doing so orphans that inline `.collapsed { padding:0 }` rule and leaves an ~8px padding sliver in the "collapsed" state (a regression that already cost one debugging session — verify with a screenshot, not `getComputedStyle`, which reads unreliably mid-transition in preview).

---

### 4. Pyramid Dead Zone Click Blocking
**Symptom:** Clicking a face-up pyramid card does nothing; click is swallowed by an empty slot placeholder.

**Root cause:** Empty `.card-slot` elements in higher-z-index rows sit on top of face-up cards in lower rows. If `.card-slot` has `pointer-events: auto`, it consumes clicks.

**Fix in place:** `.card-slot` must NOT have `pointer-events: auto` in `play.css`. Only `.card-slot.available` should be clickable.

---

### 5. Firebase onDisconnect Fires on Navigation (Lobby)
**Symptom:** Host navigates from lobby to play.html; Firebase `onDisconnect` fires and deletes the game before guests can join.

**Fix in place:** `lobby.js` must call `onDisconnect(gameRef).cancel()` before navigating. Do not remove this.

---

### 6. Draw-Done Race Condition (Fire-and-Forget signalDrawDone)
**Commit:** `7b11ce6` (May 2026)

**Symptom:** In a 4-player MP game, one player sees "Waiting for other players to finish drawing" and the other sees "Waiting for {player} to buy or burn." Both are permanently frozen.

**Root cause:** `signalDrawDone()` in `onPlayerDrawDone()` was called without `await`. `checkDrawPhaseComplete()` ran immediately after, saw all local `G.drawsDone` flags set, and advanced to buy phase — before the Firebase write landed. The remote client's `waitForAllHumanDrawsDone()` listener never received the round-N signal, leaving it stuck in draw phase forever.

**Confirmed by Firebase log (game DGB7W3):** `drawDone[1]` showed `{round:3, busted:true}` (stale from prior round) while `spectatorState.round` was 4 and `drawDone[0]` had the correct round-4 signal. The round-4 signal for slot 1 was never written.

**Fix:** `onPlayerDrawDone()` is now `async`; it `await`s `MP.signalDrawDone()` (with one retry on failure) before calling `checkDrawPhaseComplete()`. `playerStopDraw()` and the bust path in `handleBust()` also `await` `onPlayerDrawDone()`.

**Do not regress:** Never call `signalDrawDone()` without `await` in the draw-done path. The buy phase must not start until Firebase confirms receipt.

---

### 7. Fixed Footer Cuts Off Bottom Content on Narrow Viewports
**Symptom:** The last element on a page (button, link, image) is obscured by the fixed footer bar when the viewport is narrow or the content is tall.

**Root cause:** All pages use `position: fixed` footer. Body/page padding-bottom must exceed the footer height — but the footer can grow taller on narrow screens as its two lines of text reflow or wrap further.

**What to check when adding new pages or content:**
- Does the page container have sufficient `padding-bottom`? (~5rem baseline, ~8rem on mobile)
- Add a `@media (max-width: 540px) { body { padding-bottom: 8rem; } }` block for any page whose content might be taller than the viewport.
- Test by resizing the browser to a narrow viewport and scrolling to the bottom.

---

### 8. Page Refresh Re-initializes an In-Progress MP Game (Root cause of the May 28 2026 4-player softlocks)
**Commit:** (June 2026)

**Symptom:** A 4-player game reaches Act 2, then suddenly resets to Act 1 / Round 1 / draw and softlocks — `drawState`/`drawDone` empty, nobody can finish drawing. Confirmed in games **ESN2RK** and **UQJTLL** (both Thu May 28 2026): a fresh `actSetup{act:1}` + `spectatorState{act:1,round:1,draw}` was written ~2 min *after* a `buyOrder{act:2}` already existed.

**Root cause:** `startGame()` decided rejoin-vs-fresh-start solely from the `?rejoin` URL param. A plain browser **refresh** keeps the current URL (which never had `?rejoin`), so it ran the normal path → `setupAct(1)`. On the **host**, `setupAct` unconditionally rebuilds the pyramid, clears+pushes `actSetup`, and resets `spectatorState` — clobbering the in-progress game for everyone. A guest refresh instead waited forever for an Act-1 setup that would never come.

**Fix in place:** `startGame()` now treats re-entry as a rejoin if `?rejoin` is present **OR** a per-tab marker `sessionStorage['cfc_started_<code>']` is set (written once the game starts; survives F5 but not a fresh lobby navigation for a new code). On rejoin it reconstructs from `spectatorState` and resumes — it only falls through to a fresh start when **no** `spectatorState` exists yet. **Do not regress:** never gate resume-vs-fresh-start on the URL param alone; a refresh must never call `setupAct` on an in-progress game.

---

### Host-only "Force Continue" safety valve (recovery for any softlock)
Companion to bug #8 — the general backstop for MP softlocks. After **30s** of the host waiting on others, a host-only amber **"Force continue ▸"** button appears. It broadcasts the forcing signal through Firebase so **all** clients advance uniformly (not just the host's local view):
- Draw wait → `MP.forceSignalDrawDone(slot, stats)` writes each stuck human's `drawDone` (last-known stats) → everyone's `waitForAllHumanDrawsDone` fires.
- Buy-turn wait → `MP.forceBuyAction(slot)` writes `{action:'skip'}` → `mpOpponentBuyTurn`'s listener skips that buyer everywhere.
- Buy-order wait → `forceBuyOrder()` pushes a default seat-order `buyOrder`.

Arming lives in `checkDrawPhaseComplete`, `mpOpponentBuyTurn`, and the two `waitForBuyOrder` sites; `clearForceContinue()` runs at every phase transition (`onDrawPhaseComplete`, `processBuyTurn`, `startRound`, `endBuyPhase`) and inside each wait-resolution callback. Helpers: `armForceContinue(forceFn)` / `clearForceContinue()` / `forceDrawPhase()` / `forceBuyTurn()` / `forceBuyOrder()` (just below `checkDrawPhaseComplete`). Styled `.btn-force` in `play.css`.

---

### 9. Bust Pulse Hits a Pyramid Card Instead of the Hand Bandit (Unscoped `data-uid` lookup)
**Commit:** (June 2026)

**Symptom:** On bust, one or more cards **in the pyramid/store pulse in size** (sequential scale, ~3 cards one at a time) instead of the bandit cards in your hand.

**Root cause:** `showBustAnimation()` (`~line 3247`) looked up each hand bandit card with an **unscoped** `document.querySelector(\`[data-uid="${c.uid}"]\`)`. If any other live element shares that `data-uid`, `querySelector` returns the **first match in DOM order** — and `#pyramid-zone` renders *before* `#player-zone`, so a pyramid card gets the `.bust-bandit-pulse` class. Confirmed in-browser: forcing a hand card's uid to equal a pyramid card's uid made the pyramid card pulse; scoping the query fixed it.

**Fix in place:** Query is now scoped — `document.querySelector(\`#player-hand [data-uid="${c.uid}"]\`)` — mirroring the already-correct scoped lookup in `animateDrawnCard` (`~line 1733`).

**Do not regress:** Any `data-uid` lookup that targets a hand card must be scoped to `#player-hand`. `data-uid` is set on *every* rendered card (pyramid, hand, deck preview), so a bare `[data-uid=...]` query is ambiguous whenever uids can coincide (e.g. rejoin/refresh reconstruction rebuilds both pyramid and hand from saved state).

---

### 10. Busted Player Left Behind in Draw Phase (Buy-before-draw-finished desync)
**Commit:** (June 2026). Reported by playtesters; confirmed in bug reports for games **XZDCUX** ("I was allowed to buy before P2 had finished drawing") and **Z5EPD7** ("buy round ended for Player 1, other players stuck waiting").

**Symptom:** A player busts but doesn't immediately press "Clear Hand." The rest of the table finishes drawing and advances into the buy phase **without** them. The busted player stays stuck on the draw-phase "Clear Hand" screen; when they finally clear, they enter the buy phase late and wait forever on buy turns that already happened.

**Root cause (asymmetry):** `handleBust` (`~line 3310`) calls `mpSyncDraw()` immediately (pushing `drawState.busted=true`) but then blocks on the "Clear Hand" button before calling `onPlayerDrawDone()`→`signalDrawDone()`. Meanwhile `startRound`'s `watchOpponentDrawStates` callback (`~line 2504`) saw `state.busted` and marked that opponent `G.drawsDone[playerIdx]=true` **immediately** + called `checkDrawPhaseComplete()`. So everyone else counted the busted player as done at bust time, but the busted player's OWN client didn't transition until the button press. When the remaining drawers finished, the table advanced without them.

**Fix in place:** Removed the premature "busted = done" shortcut in the `startRound` watcher. The drawState watch now only syncs stats + re-renders; a busted opponent is marked done **only** via the authoritative `drawDone` signal in `waitForAllHumanDrawsDone` (`~line 2518`), which fires when they press "Clear Hand." This matches `resumeDrawPhase` (`~line 2326`), which never had the shortcut. Nothing advances past the draw phase until the busted player clears; the host "Force continue" valve (30s) covers a true disconnect/stall.

**Do not regress:** Never mark a human opponent done from `drawState.busted`. `drawState` is for live display only; `drawDone` is the sole authoritative done signal. The two draw-phase code paths (`startRound`, `resumeDrawPhase`) must stay consistent on this.

---

### 11. Opponent Deck Duplication via Empty-Array Omission (rejoin "double starter cards")
**Commit:** (June 2026). Reported as "after rejoining, non-host players got a second copy of all starter cards" (game 2S5VM9). Confirmed host-side inflation in live data for games 2S5VM9, 73HGM8, DGB7W3, XZDCUX.

**Symptom:** The host's view of a human opponent's deck grows extra copies of cards — specifically the cards that were reshuffled that round. The opponent's OWN client is correct; only the host's `spectatorState` is inflated. On rejoin, `reconstructG` reads the inflated `spectatorState`, so the duplication becomes real for the rejoiner and **compounds with each rejoin**. NOT a rejoin-only bug and NOT related to bug #10 — it happens in normal play whenever an opponent reshuffles; the bust correlation is incidental (busting = heavy drawing = reshuffles).

**Root cause:** Firebase Realtime Database **omits empty arrays** on write. When an opponent reshuffles mid-draw (`discard → deck`), their `discard` becomes `[]`; `pushDrawState` writes `discard: []` but Firebase drops it, so it reads back as `undefined`. The host's `watchOpponentDrawStates` guarded the update with `if (state.discard !== undefined)` (in BOTH `startRound` ~line 2490 AND `resumeDrawPhase` ~line 2345), so it **skipped** the update and left `opp.discard` STALE (still holding the pre-reshuffle cards). Then `scoreRound`'s `opp.discard.push(...opp.hand)` (~line 4148) folded the hand — which now contains those same reshuffled cards — into the stale discard, double-counting them. (`hand`/`deck` were never affected because they're restored with `(state.x || [])`.)

**Fix in place:** Both watcher sites now ALWAYS set discard, treating absent as empty: `opp.discard = (state.discard || []).map(...).filter(Boolean)` — mirroring `hand`/`deck`. `pushDrawState` always writes `discard`, so an absent value unambiguously means empty.

**Do not regress:** Any field synced from Firebase that can legitimately be an empty array (`discard`, and any future array field) must be read with `(value || [])`, never gated on `!== undefined`. Firebase will silently drop the empty case. Verified empirically: writing `discard: []` via REST reads back with the key absent.

---

### 12. "Draw 4" Denied the Burn-to-Use Activation Window (auto-loop drew through bust)
**Commit:** (June 2026). Reported as unfun: a "Draw 4" could pull a jail ("-1 bandit") card AND a lethal bandit in the same burst, busting you before you could activate the jail card.

**Symptom:** Drawing card_54 ("Draw 4") auto-drew all 4 extra cards back-to-back with no interaction. If a `burn_to_use` -1-bandit card (card_50/card_39) and a 3rd bandit both landed in the burst, you busted without ever getting the activate button — violating the existing rules errata ("Jail cards must be activated *before* busting").

**Root cause:** `playerDraw()`'s draw4 handler was a `for` loop that drew, applied effects, and bust-checked each of the 4 cards with no return to the draw UI between them. The activate buttons only render in `startPlayerDraw()` (between draws), which the loop bypassed. The AI had the identical gap (its draw4 loop bust-checked before reaching its jail-activation block).

**Fix in place:** Draw 4 now sets `player.forcedDraws += 4` and routes each extra draw through the normal `playerDraw`/`startPlayerDraw` flow, so the activate buttons (incl. jail) appear between draws. `startPlayerDraw` hides "Stop" while `forcedDraws > 0` (draws stay mandatory — preserves the card's risk/balance); activating a card does NOT decrement `forcedDraws`. Empty deck mid-Draw-4 auto-reshuffles and continues (only ends when both piles are empty). AI parity: the draw4 loops in `play.js` and `sim/personality-engine.js` proactively activate a held jail card at 2+ bandits before each forced draw.

**Do not regress:** Never re-introduce an auto-loop that draws multiple cards without returning to `startPlayerDraw` between them — that's the only place burn-to-use cards can be activated, and skipping it re-breaks the activate-before-bust rule. Keep "Stop" hidden while `forcedDraws > 0`, and keep `forcedDraws` cleared in `handleBust`/`resetPlayerRound`.

**Status July 2026 — the activation window is now unused in practice.** Both `burn_to_use` jail cards (card_39/card_50, the `-1 bandit` Explosives this fix existed for) are `deprecated: true` and never dealt. Every LIVE Explosive is a pure dollar card (70/77/78 = $2; 5/16/22 = $3), so pausing mid-Draw-4 no longer saves you from a bust — it only banks $2–3. The mechanic and the AI-parity jail branch in `aiDrawPhase` are deliberately KEPT (undeprecating a jail card must not silently re-break the rule), but `rules.html` no longer advertises the pause: that clarification was replaced with the Draw-4 **chaining** rule, which is the live edge case (a Draw 4 drawn during forced draws decrements once then `+= 4`, so it stacks — see `playerDraw` ~3278/3288).

---

### 13. Showdown Title/Subtitle Cut Off at Top (CSS specificity: `.overlay` beats `.showdown-overlay`)
**Commit:** (June 2026)

**Symptom:** During the showdown, the title and "Cards on the table, cowboys." subtitle are clipped off the top of the screen and can't be scrolled to (worse with 4 players / short viewports).

**Root cause:** `.showdown-overlay` (top of `play.css`) set `align-items: flex-start`, but the generic `.overlay` rule is defined **later** in the same file with **equal specificity**, so `align-items: center` won. Tall showdown content was vertically centered and overflowed above the scroll origin — unreachable. (`.overlay`'s background also clobbered the showdown's darker bg.)

**Fix in place:** selector changed to `.overlay.showdown-overlay` (higher specificity) so flex-start + the showdown background win. **Do not regress:** when a base class and a variant class live in the same file, the variant must out-specify the base (compound selector), not rely on source order.

---

### 14. "Burn & Look 3" Didn't Reshuffle Discard When Deck < 3
**Commit:** (June 2026)

**Symptom:** Activating a look3/rearrange card with fewer than 3 cards in the draw pile only showed the 1–2 remaining cards instead of reshuffling the discard and showing a full top 3.

**Root cause:** `handleLook3` (`~line 3473`) did `player.deck.splice(0, Math.min(3, deck.length))` with no reshuffle — peeking past the deck should pull from discard, mirroring `drawFromDeck`.

**Fix in place:** `handleLook3` reshuffles `discard → deck` (via `shuffleForPlayer`, then `mpSyncDraw`) when `deck.length < 3 && discard.length > 0` before taking the top 3. Both human look-3 paths (`look3_immediate` and `look3_rearrange`) route through `handleLook3`, so both are covered.

**AI parity:** the same reshuffle was mirrored into both AI handlers in `aiDrawPhase` (`look3_rearrange` and `look3_immediate`, ~lines 3021/3033) using `shuffleForPlayer(ai.discard, ai.slotIdx, false)` — the seeded path in MP, so every client's AI deck stays identical (same mechanism as `drawFromDeck`'s reshuffle; no desync). Mirrored in the sim too: `sim/personality-engine.js` (uses `seededShuffle(discard, rng)`, matching `drawFromDeckSeeded`). The AI burn-decision gate (`deck.length >= 2`) was intentionally left unchanged — only the in-branch reshuffle mechanic was added, so AI burn frequency / personality balance is untouched.

---

### 15. Host Mobile Reload Clobbered In-Progress Game (fetchSpectatorState null fallthrough)
**Commit:** 482c566 (June 2026). Reported by PB after reloading on mobile during Act 3 of a 4-player game — everyone's herd reset to 0 and the pyramid reverted to Act 1.

**Symptom:** Host reloads on mobile mid-game. The page shows Act 1 Round 1 and herds of 0. Other players see herds reset in spectatorState but their local game continues unaffected (they're past the actSetup listener). Host's client pushed a fresh spectatorState with act=1 herds=0, overwriting the real state.

**Root cause:** `startGame`'s rejoin block called `fetchSpectatorState()` once and immediately. On mobile, Firebase's WebSocket may not be fully established in the first milliseconds after `init()`, causing `get()` to return null. With `state = null`, the code fell to the fallback check `if (params.has('rejoin'))` — but a mobile eviction reload uses `MP.recovered` (URL params), not `?rejoin`. So `!params.has('rejoin')` was true, and the code **silently fell through to the normal path → `setupAct(1)`**, clobbering the live game.

**Fix in place (two parts):**
1. `fetchSpectatorState()` is now retried up to 3 times (immediate → +600ms → +1200ms) before giving up, handling the transient connection window on mobile.
2. The fallthrough guard is now `if (params.has('rejoin') || MP.recovered)` — `MP.recovered` being true means identity came from URL params or localStorage (definitively a mid-game reload, not a first-time start), so it's treated exactly like an explicit `?rejoin`.

**Do not regress:** Never let the rejoin block fall through to the fresh-start path when `MP.recovered` is true. If `fetchSpectatorState` still returns null after retries AND `MP.recovered`, show "Could not restore game" and go home — do NOT run `setupAct(1)`. Only the marker-only re-entry (early refresh before any spectatorState was pushed) should fall through.

---

### 16. Remote Buy/Burn on an Already-Gone Cell Stalls the Buy Turn (busted-host buy-phase freeze)
**Commit:** (June 2026). 6/20 bug report, game **M9RBXA**: *"Desync on final turn. Player 1 busted and player 2 was stuck waiting for them to draw."* Host (slot 0) busted in Act 3 R9, then **froze ~6 min inside the buy phase** while the guest legitimately completed R9 and lapped into R10; only the manual host "Force continue" valve broke it. Traced via the `traj/M9RBXA` trajectory: host's last R9 draw at `…981476`, then zero host activity until the R9 canary at `…345523` (force-continue). This is a **residual desync that survives the bug #10 fix** (`8f33e63`, 6/07, which was already deployed) — #10 stopped the *guest* from marking a busted opponent done early, but did not cover the busted player's OWN client stalling in the buy phase.

**Root cause:** `executeBuyLocal` / `executeBurnLocal` guard with `if (!slot || slot.removed) return;` and used to return **without** calling `advanceOrExtraBuy`. `mpOpponentBuyTurn` applied the remote opponent's action through these with no fallback. If the targeted pyramid cell is already `removed` on the **receiving** client (pyramid divergence, or a stale same-round re-fire), the call no-ops, the turn never advances, `G.currentBuyerIdx` is stuck, and the round softlocks. The listener already consumed + cleared the `buyAction`, so nothing re-fires — recovery needs the 30s host-only "Force continue" button (undiscoverable; took the player 6 min). The earlier "shops not synced" complaint (game XZDCUX) is the same pyramid-divergence family feeding this.

**Fix in place:** `executeBuyLocal`/`executeBurnLocal` now **return a boolean** (true = applied, false = cell already gone). `mpOpponentBuyTurn` checks the result and, on `false`, advances the turn itself (`currentBuyerIdx++` → `endBuyPhase`/`processBuyTurn`, mirroring the `skip` branch). Local-human (`executeBuy`/`executeBurn`) and AI callers ignore the return value, so their behavior is unchanged; AI/humans only ever target available cells anyway.

**Do not regress:** Any code path that drives the MP buy-turn chain MUST advance the turn even when the buy/burn no-ops on the receiving client. Never let `mpOpponentBuyTurn` apply a remote action without guaranteeing forward progress — a silent no-op there is a guaranteed round-long softlock. (Open follow-up, not yet done: the manual-only Force Continue is too slow; consider auto-firing it after a longer timeout, or having the host re-assert authoritative pyramid state, so a missed/no-op signal self-heals in seconds.)

---

### 17. MP Protocol Audit Fixes (July 3 2026) — do-not-regress invariants
**Full mechanism write-ups: [`docs/MP_PROTOCOL_AUDIT.md`](docs/MP_PROTOCOL_AUDIT.md)** (findings C1-C9, R1-R3, H1-H5, all fixed in one pass). The invariants the fixes established:

- **Swap (card_4) resolves by card `id`, never `uid`, on receivers** (`applySwapLocal`, spec carries `card4Id`). uids are per-client counters — a uid lookup matches nothing (or the wrong card) on every client but the activator. `mpOpponentBuyTurn` logs a console warning whenever a swap fails to apply; that warning = state divergence.
- **`claimBuyFirst` args are `G.currentAct`/`G.roundNumber`** — `G.act`/`G.round` do not exist; passing them keyed the 5-8P priority claim on `"undefined_undefined"` (once per game instead of per round).
- **`resumeDrawPhase` must complete AI seats**: restore from the snapshot's slot-keyed `drawsDone`, infer from `busted`/`stoppedDrawing`, or re-run `aiDrawPhase`. AI seats never signal via Firebase — leaving them false softlocks every mid-draw rejoin.
- **AI RNG stream positions (`_aiRngs[slot].seed`) are persisted in spectatorState (`aiRngSeeds`) and restored on rejoin.** Never re-seed from gameSeed alone mid-game — the streams have advanced on the other clients, and a fresh stream silently diverges every later AI reshuffle.
- **`dollar1_other` (card_24) grants are DEFERRED in MP** to one deterministic point (`onDrawPhaseComplete`, before the buy-order tiebreak), computed from per-player `dollar1OtherPlayed` counts (own local, remote via drawDone, AI via identical simulation). Never apply cross-player effects live during concurrent draw phases — wall-clock interleaving differs per client. SP keeps live grants.
- **The host pushes spectatorState at the top of `processBuyTurn`** so `currentBuyerIdx` in the snapshot is never stale-by-one (a rejoiner would replay the previous buyer's turn).
- **spectatorState is built ONLY by `buildSpectatorState()`** (MP + AI_SPEC share it). It carries the buy entitlements (`hasBuyBurnFirst`/`hasExtraBuy`/`extraBuyUsed`), `dollar1OtherPlayed`, `aiRngSeeds`, and slot-keyed `drawsDone`; `reconstructG` restores all of them. Add rejoin-relevant fields HERE, nowhere else.
- **`buyAction` is sequenced (`seq`: 1 = normal turn, 2 = extra buy) and never cleared.** Receivers match on round+act+seq; the old consume-then-null pattern raced the actor's second action. `forceBuyAction`/`forceBuyTurn` must stamp the seq waiters expect.
- **Force-continue tombstones**: the forced player's own client watches its own `buyAction`/`drawDone` cells and adopts a forced skip/done instead of applying its late local action (`watchOwnBuyAction`/`watchOwnDrawDone` + guards in `startPlayerDraw`/`playerDraw`); `showChooseFirstUI` adopts a forced buyOrder via a `resolved` flag. Removing these re-opens the force-vs-late-action divergence.
- **`drawDone` carries the hand id list**; `applyOppDoneData` reconciles the opponent's hand from it (tiebreaker inputs `hand.length`/`hand[i].cost` must match the actor's). The draw-phase sync bodies live in `applyOppDrawState`/`applyOppDoneData` — shared by `startRound` and `resumeDrawPhase`; never fork them again.
- **MP watchers that re-arm per round use `subscribeNamed`** (idempotent, replaces the old sub). Plain `fbOnValue` in a per-round path = listener leak (was ~15 duplicate full-snapshot writes per draw event by Act 3).
- **Rejoin has no dead ends**: `resumeFromState` handles every phase; transient phases (`score`/`showdown`) and missing-snapshot recoveries keep an `onValue` watch on spectatorState instead of a static message. The recovered/!state case must still NEVER fall through to fresh-start for a non-quickStart game (bug #8/#15) — quickStart falls through on purpose (draft replay).
- **`setupAct` (host) consumes an existing same-act `actSetup`** before building a new pyramid — a fresh-start fallthrough must not fork the pyramid guests already consumed.
- **Draft state is keyed by `slotIdx`, never local player index** (`packsBySlot`, rotation in slot space); local index order differs per client. Draft re-entry auto-consumes the player's own already-pushed pick; the host gets a 45s force valve (`forceDraftPick`, only-if-absent transaction).
- **`database.rules.json` edits are not done until DEPLOYED** (`firebase deploy --only database`). The Pioneer Mode header field sat undeployed for ~a week and every trajectory header was silently `permission_denied` (audit C9). After changing traj-validated fields, verify with a live game that the record lands.

---

### Peek-at-stats overlay must drop dimming/blur
While the "👁 Peek at stats" mode is active on the rearrange modal, `#special-modal.peeking` sets `background: transparent; backdrop-filter: none` so the player can actually read the game state behind it. Only `#special-modal-content` is `visibility:hidden`; don't reintroduce the dark/blurred backdrop on the peeking state.

---

### MP Identity Recovery Model (mobile tab eviction)
**Commits:** (June 2026) — companion hardening to bug #8.

**Problem:** Mobile browsers evict backgrounded tabs. Reopening the game tab from history is a *fresh page load* with `?mp` still in the URL but **empty sessionStorage**. Previously the MP IIFE read identity only from sessionStorage and returned `{active:false}` when it was gone — the game didn't even recognize itself as MP, so it couldn't resume. Recovery required the player to navigate back to the home screen and tap the localStorage "Rejoin" banner, which non-technical players don't know to do.

**Design now in place (three layers, do not collapse):**
- **Identity resolution order (IIFE ~line 27):** sessionStorage → URL params (`code`/`slot`/`name`) → `localStorage['cfc_rejoin']`. The first hit wins; the result is written back into sessionStorage so all downstream reads are unchanged. A recovery (URL or localStorage) sets **`MP.recovered = true`**.
- **`startGame` rejoin decision (~line 2087):** `isRejoin = ?rejoin param || cfc_started_<code> marker || MP.recovered`. `MP.recovered` covers exactly the case the per-tab marker can't (marker lives in the wiped sessionStorage). All resume still flows through `reconstructG` from `spectatorState`.
- **Self-identifying URL:** host (`host.js`) and guest (`lobby.js`, both join and rejoin navigations) append `&code=&slot=&name=` (name `encodeURIComponent`'d) to `playgame.html`. On the *normal first* navigation sessionStorage is already set, so these params are ignored — they only fire on a recovery load.

**Do not regress:**
- Never gate "is this MP?" on sessionStorage alone — the IIFE must fall back to URL/localStorage before returning `{active:false}`.
- `MP.recovered` must remain part of the `isRejoin` decision; without it an evicted-tab reload (no marker, no `?rejoin`) would hit the **fresh-start path and the host would clobber the game** (bug #8 class).
- The `cfc_started_<code>` marker and the resume-vs-fresh guard are intentionally left intact — recovery is *additive*, not a replacement.
- Nothing may `history.replaceState` away the `code/slot/name` query params, or a later reload loses the URL recovery channel (localStorage still covers same-device).

### Lobby Slot Claim Is Atomic (do not revert to read-then-write)
**Commit:** (June 2026). `lobby.js` claims the first open human slot with a **`runTransaction`** on `games/{code}/slots`, not a `get` + `update`. Two guests joining simultaneously previously could both read slot 1 as empty and both write their name — one clobbered the other and both navigated in as slot 1. The transaction serializes the claim so each guest gets a distinct slot. Keep it a transaction.

---

---

### 18. fitPyramid Produced a NEGATIVE Scale on an Unmeasurable Zone
**Found July 2026 during the single-Store rework.**

**Symptom:** The Store renders as an empty box — 9 rows × 11 cards exist in the DOM with correct
rects, every image loads, but nothing is visible. `#pyramid` carries `transform: scale(-0.0129)`.

**Root cause:** `fitPyramid` computes `availH = (zone.bottom - pad) - contentTop`. When the zone
has not been laid out (0×0 viewport mid-navigation, a `display:none` ancestor), `availH` goes
NEGATIVE, and `Math.min(1, availW/natW, availH/natH)` happily returns a negative scale — which
mirrors the Store and collapses it to nothing. The bigger 8P Store made it easy to hit; the bug
was latent before.

**Fix in place:** bail out early when nothing is measurable — `if (natW <= 0 || natH <= 0 ||
availW <= 0 || availH <= 0) return;`. `transform` is reset to `'none'` at the top of the function,
so returning leaves the Store unscaled and the next render/resize fits it properly.

**Do not regress:** never let a fit/scale computation consume a viewport measurement without
checking it is positive. Returning early beats scaling by a garbage ratio.

---

### 19. Tutorial Store Highlight Wiped by the Next Render
**Found July 2026 during the single-Store rework.**

**Symptom:** The tutorial's final step says "Buy the highlighted Cow card" and **nothing is
highlighted**.

**Root cause:** `highlightPyramidCard` added `.tutorial-pyramid-hint` inside a single
`requestAnimationFrame`. `renderPyramid()` rebuilds the entire Store DOM, dropping the class — and
the buy step's highlight lands in exactly that window, so the hint was applied to an element that
was about to be thrown away.

**Fix in place:** tutorial.js remembers the target cell (`_pyramidHint`, cleared by
`clearSpotlight`) and exposes `reapplyPyramidHint()`; `renderPyramid()` calls it at the end. The
hint is also applied immediately as well as on the next rAF.

**Do not regress:** any class applied to Store DOM from outside `renderPyramid` is transient. Give
it a re-apply hook rather than trusting a single rAF to win the race.

---

### 20. `100vh` Permanently Hid the iOS Browser Ribbon ("the app went fullscreen")
**Found July 2026.** Reported on iOS Chrome: the site pushed the browser ribbon (back / refresh /
URL) off the bottom of the screen and it would not come back.

**Symptom:** On iOS the page feels like it forced fullscreen. The browser chrome retracts on the
first scroll gesture — including a stray drag while tapping a card — and then can't be restored by
scrolling up. Affected every page, worst on the short ones.

**Root cause:** On iOS (Safari *and* Chrome — both WebKit) the `vh` unit is pinned to the **large
viewport**: the height as if the chrome were already retracted. It does NOT shrink to account for
the visible toolbar. So `body { min-height: 100vh }` made every page ~1 toolbar-height taller than
the visible area *even with no content*. That phantom scroll range is enough for iOS to read a
swipe as "scrolling down" and retract the chrome — after which the visible viewport grows to
exactly `100vh`, `scrollHeight === innerHeight`, the page is no longer scrollable at all, and there
is no scroll-up gesture left to bring the chrome back. The fixed `bottom:0` footers compounded it:
iOS lays fixed elements out against that same retracted-height layout viewport, so the footer parks
*under* the ribbon while it's showing (this is also what the 5-8rem `padding-bottom` hacks in
bug #7 are really compensating for).

**Fix in place:** every viewport-height value that applies on mobile is now declared twice — `vh`
first as a fallback, then `svh` (**small** viewport height = the height WITH chrome showing):

```css
min-height: 100vh;
min-height: 100svh;
```

15 sites: `body` in [`css/theme.css`](css/theme.css) + [`css/play.css`](css/play.css) + the 9 inline
`<style>` copies (index, gamesetup, lobby, history, privacy, bugreport, spectate, aboutthecreators,
debug — **these override theme.css, so fixing the shared sheet alone does nothing**), plus `#game`
(play.css), `.overlay-content` (`90svh`) and `#card-zoom-img` (`80svh`).

**`svh`, not `dvh`** — `dvh` tracks the live viewport, so the layout reflows mid-scroll as the
chrome retracts, and on the game page that would re-fire `fitPyramid` on every `resize` iOS emits
during the transition. `svh` is static, so short pages fit exactly when the ribbon is visible and
never trigger the collapse at all. `svh`/`lvh`/`dvh` = iOS 15.4+ / Chrome 108+; older browsers
ignore the second declaration and keep today's behavior.

**Do not regress:** never ship a bare `vh` value that applies on mobile. Always pair it with an
`svh` line. Genuinely-long pages (rules, privacy) still retract the chrome on scroll-down — that's
correct iOS behavior, because a real scroll range means scrolling up restores it. The bug is
specifically making a *short* page ~1 toolbar too tall, which turns the retraction into a one-way
trip. The `vh` values inside `@media (min-width: 1200px)` in [playgame.html](playgame.html) (the
opponent rail's `calc(100vh - 1rem)`, the 52vh Store cap) are desktop-only and deliberately left
alone — no phone ever matches those queries.

## Debugging Approach for Multiplayer Issues

**Always start with Firebase logs, not blind code review.**

Errors in MP games are almost always observable in Firebase Realtime Database logs before they manifest visually. The sequence:

1. **Identify the game code** from the URL (`?mp` param) or from `sessionStorage.getItem('mp_code')` in the browser console.
2. **Dump the game state with the Firebase CLI** (preferred — no browser required):
   ```bash
   # List all active game codes
   firebase database:get /games --shallow --project cards-for-cowboys

   # Dump a specific game (full JSON)
   firebase database:get /games/GAMECODE --project cards-for-cowboys

   # Dump just the paths you care about
   firebase database:get /games/GAMECODE/drawDone --project cards-for-cowboys
   firebase database:get /games/GAMECODE/buyOrder --project cards-for-cowboys
   firebase database:get /games/GAMECODE/spectatorState --project cards-for-cowboys
   ```
   The CLI requires `firebase login` and the project alias `cards-for-cowboys` is already set in `.firebaserc`.
3. **Or use the Firebase Console** → Realtime Database → Data → navigate to `games/{code}/`.
4. **Look at the relevant path first:**
   - Draw sync issues → `drawState/{slot}` and `drawDone/{slot}`
   - Buy sync issues → `buyAction/{slot}` and `buyOrder`
   - Presence/disconnect → `slots/{slot}/connected`
   - Setup issues → `actSetup`
   - Overall game state → `spectatorState` (has round, phase, player hands/decks, pyramid)
5. **Cross-check round/act fields.** If a slot's `drawDone` shows a different `round` or `act` than the current game, that's a stale signal — the root cause of most softlocks.
6. **Compare what each client sees** — open the game in two browser windows and watch the Firebase paths update in real time.
7. **Check timestamps** (`ts` fields) to determine ordering and whether stale data is being processed.
8. Only after understanding the Firebase data flow should you trace back into the logic.

**Key principle:** The game logic runs identically on all clients. If players see different states, the divergence is almost always in what Firebase data was received, when, and whether stale guards fired correctly.

**Real example (game DGB7W3, May 2026):**
Softlock: PB saw "Waiting for other players to finish drawing"; Gus saw "Waiting for PB to buy or burn."
Firebase dump showed: `drawDone[0]` = `{round:4, done:true}` (PB, correct); `drawDone[1]` = `{round:3, busted:true, done:true}` (Gus, stale from prior round). Gus's round-4 signal was never written because `signalDrawDone()` was fire-and-forget — `checkDrawPhaseComplete()` ran before the Firebase write landed, advancing Gus to buy phase while PB remained stuck in draw phase.
Fix: `await MP.signalDrawDone()` before `checkDrawPhaseComplete()` in `onPlayerDrawDone()`. Commit `7b11ce6`.

### Cleaning up test games
Test and debugging games write real records to `gameHistory`, `games/`, and `liveGames/` — they will appear in the finished game log on `history.html`. After any testing session, delete those records:

```bash
# Delete a specific game node (MP games)
firebase database:remove /games/GAMECODE --project cards-for-cowboys

# Delete a specific game node (AI/solo games)
firebase database:remove /liveGames/GAMECODE --project cards-for-cowboys

# Delete the gameHistory entry (find its push key first)
firebase database:get /gameHistory --project cards-for-cowboys --shallow
firebase database:remove /gameHistory/PUSHKEY --project cards-for-cowboys

# Delete the liveSummary entry
firebase database:remove /liveSummary/GAMECODE --project cards-for-cowboys

# Delete the trajectory-capture entry (keyed by game code — see Trajectory Capture section)
firebase database:remove /traj/GAMECODE --project cards-for-cowboys

# Delete the retired v1 decision-telemetry entry (legacy cohort)
firebase database:remove /decisionLog/GAMECODE --project cards-for-cowboys
```

The game code appears in the URL (`?mp=GAMECODE`) and in `sessionStorage.getItem('mp_code')` in the browser console. The `gameHistory` push key can be found by dumping `/gameHistory --shallow` and identifying the entry by timestamp or by cross-referencing the game code in the entry's **`gameCode`** field (added July 2026 — entries before then have no code and can't be matched).

---

## Admin Scripts (`admin/`)

All are `firebase login`–based (no database secret anywhere) and take a `.sh` form plus a
double-clickable `.command` wrapper. Run from the repo root.

| Script | What it does |
|---|---|
| `get-bugs.sh` | Bug reports from `bugReports/`, newest first, with attached game context. |
| `get-emails.sh` | Signups from `emailSignups/`, oldest first. Duplicates are NOT de-duped — the same address can appear twice (it has). |
| `get-unfinished.sh` | **Games started but never completed**, last N days. `--days N` (default 7), `--mode ai\|mp`. |
| `cleanup-games.sh` | Deletes finished/stale `games/`, `liveGames/`, `liveSummary/` nodes. `--days N` (default 14). Never touches `gameHistory` or `traj`. |

### ⚠️ `liveSummary.status === 'finished'` does NOT mean the game was completed

This is the trap `get-unfinished.sh` exists to work around, and it will mislead anyone reading the
node directly. `status` is set to `'finished'` by **three** paths, only one of which is a real
finish:

1. `G.phase === 'gameover'` in the periodic push — a genuine Showdown.
2. **`onDisconnect`** (`AI_SPEC.start`, ~play.js:1049-1050) — fires whenever the tab closes
   mid-game. An abandoned game therefore reads `finished`.
3. `AI_SPEC.finish()` / `MP.setLiveStatus('finished')`.

**The only reliable "this game actually completed" signal is a `gameHistory` entry**, written once
by `finalizeGame`. So: *in `liveSummary` but not in `gameHistory` ⇒ unfinished*. That is exactly
what `get-unfinished.sh` computes. Never re-derive completion from `status`.

Two further gotchas the script reports as notes rather than hiding:

- **`liveSummary` is pruned at 14 days** by `cleanup-games.sh`, so a longer `--days` window
  silently undercounts. (Confirmed: the June 6-7 bug-report games `2S5VM9`/`Z5EPD7`/`XZDCUX` are
  already gone from `liveSummary` while still being referenced by open bug reports.)
- **Tombstone nodes.** A `liveSummary/{code}` holding only `{status:'finished'}` — no `ts`, no
  players — is an `onDisconnect` write that landed *after* `cleanup-games.sh` deleted the real
  node. Harmless (the Live Now list filters on `ts`) but they accumulate; `cleanup-games.sh`
  clears them. The script skips and counts them rather than reporting them as games.

---

## Security Checklist

Run through this whenever touching Firebase-related files, auth, or configuration:

### Firebase API Key
The Firebase API key is **intentionally public** — Firebase web app keys are not secrets; security is enforced via Database Rules. However:
- [ ] The key is hardcoded in TWO places: `src/firebase-config.js` line 9 and `src/play.js` line 13. If the key ever changes, update both.
- [ ] `database.rules.json` must restrict write access appropriately. Review it when adding new Firebase paths.
  - `liveSummary` — **collection-level `.read:true` required** (same RTDB no-upward-cascade reason as below). This is the node `history.html`'s Live Now list reads via `onValue(ref(db,'liveSummary'))`. Each `liveSummary/$gameCode` is a slim summary (`mode, status, numPlayers, players[{name,isHuman}], phase, act, round, ts`) — **no hands/decks/pyramid**. Written by `MP.pushLiveSummary()` (host only, from `pushSpectatorState`) and `AI_SPEC.push()`. Status flips to `finished` (gameover / `AI_SPEC.finish` / onDisconnect) or `disbanded` (`MP.disband`); stale entries (no push >5 min) are hidden by the list's `ts` filter. Full game state is still loaded only when a visitor opens `spectate.html` (which reads the full `games/{code}` or `liveGames/{code}` node by code). Do NOT make Live Now read the full collections again — that ships ~KB–MB of card state to every visitor (the pre-June-2026 behavior).
  - `traj` — **`.read:false`** (durable trajectory benchmark; CLI-pull only). Per `traj/$gameCode/$entry`: append-only (`!data.exists()`), shape-validated over the union of all record-kind fields (hdr/act/snap/d/s/b/ck) with `$other:false`. No client ever reads it. See the Trajectory Capture section.
  - `decisionLog` — **`.read:false`** (retired v1 telemetry; frozen legacy cohort, nothing writes it now). Per `decisionLog/$gameCode/$entry`: append-only, shape-validated with `$other:false`. Read by `admin/analyze-decisions.py` via CLI.
  - `games` / `liveGames` — collection-level `.read:true` is also present (legacy: Live Now used to enumerate these directly). RTDB read rules do NOT cascade upward — per-`$gameCode` read alone makes a whole-collection read fail with Permission denied. Live Now no longer reads these (it reads `liveSummary`), but `spectate.html` still reads them per-code for full state. (This makes all games' full state publicly enumerable; spectating is a public feature and codes are listed anyway.)
  - `games/$gameCode` — fully open read/write (game code acts as access token — acceptable)
  - `gameHistory` — read open, write restricted to new push-only entries (`!data.exists()`); shape validated (required fields, type checks, length limits, no extra fields)
  - `emailSignups` / `bugReports` — `read:false`, append-only (`!data.exists()`), shape-validated with length caps and `$other:false`. Both are pulled with the **CLI** (`firebase database:get`), never with a database secret.
- [ ] Never add server-side secrets (service account keys, admin SDK credentials) to any file in this repo.

### Legacy Database Secret — REVOKE (June 2026)
A long-lived Firebase **database secret** (`meXe…XALp`) used to be hardcoded in `get-emails.js`, `export-emails.html`, and stale `.claude/settings.local.json` allowlist entries. It grants full admin read/write and bypasses all rules. It has been **scrubbed from the working tree** (those files now point to `admin/get-emails.sh`). **Action still required:** revoke it in Firebase Console → Project Settings → Service accounts → Database secrets. Pull emails/bugs only via the CLI tools in `admin/` (`firebase login`–based; no secret in any file).

### .gitignore
Currently gitignored sensitive files: `get-emails.js`, `retrieve-emails.js`, `export-emails.html`, `package-lock.json`

- [ ] If you create any file containing API keys, tokens, admin credentials, or email lists → add it to `.gitignore` immediately before writing it.
- [ ] Never commit `.env` files, service account JSON, or anything from `node_modules/`.
- [ ] The `ref/` directory contains the card CSV — confirm it stays gitignored (`ref/Deck Buster Cards - Cards.csv` is excluded).

### General
- [ ] No server-side code in this repo — it's static hosting on GitHub Pages. Keep it that way.
- [ ] User input (game codes, player names) flows into Firebase paths. Validate/sanitize before use if expanding lobby logic.
- [ ] Never log full Firebase paths containing user data to the browser console in production code.

---

## Symbol / Naming Reference

| Display Name | Internal | Cacti Count |
|---|---|---|
| River | blue suit | 1 cacti |
| Cactus | yellow suit | 2 cacti |
| Rattlesnake | red suit | 3 cacti |

Starter deck IDs: 91-94 (River), 61-64 (Rattlesnake), 33-34 (Cactus)

### "Burn" vs "Explosive"/"Use" (terminology convention — June 2026)

"Burn" used to mean two distinct things; it now means **only one**. Keep these strictly separate in all
**player-facing** text (UI strings, logs, rules, tutorial) and comments:

- **Burn** = remove a **Store/pyramid** card from the game without buying it (`executeBurn`, "Buy or Burn",
  "click a card to burn", the granted "Extra Buy/Burn" action). This is the *only* sense "burn" may carry.
- **Explosive** = a card you consume from **your own** hand for a one-shot effect (the dynamite badge; was
  "Burn If Used" / "Burn to Use"). You **Use** an Explosive ("Use for $2", "Use for Priority", "Use:
  Rearrange Top 3", "Use for Extra Buy/Burn"; logs read "You used your <suit> Explosive card: …"). Never
  say "burn" for this.

**Internal identifiers are intentionally NOT renamed** (protocol/trajectory/sim-coupled): the `special`
keys (`burn_to_use`, `burn_buy_first`), handler names (`handleBurnToUse`, etc.), the trajectory `'burn'`
buy-action value, and CSS classes (`log-burn`, `btn-burn`). Changing the stored `special` strings would
break trajectory replay (`schemaV`) and MP sync — leave them. Only the surface language is "Explosive/Use".
(`burn_for_2` is gone entirely — see card rework.)

**Symbol asset:** the Explosive badge is `assets/symbols/One-Time Use-01.png` (dynamite icon; replaced the
old text graphics `Burn If Used-01.png` + `or Burn for $2-01.png`, both deleted). `rules.html` references it.
