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
| `rules.html` | Standalone rules page |
| `spectate.html` | Spectator view (reads `liveGames/` path) |
| `history.html` | Game history + leaderboard; "Live Now" list reads the slim `liveSummary/` node |
| `aboutthecreators.html` | About page |
| `bugreport.html` | Bug-report form → writes `bugReports/` in Firebase; auto-attaches game context from `localStorage['cfc_bug_context']` |
| `privacy.html` | Privacy policy (GDPR-aligned: controller, legal basis, retention, data-subject rights; contact: info@cardsforcowboys.com) |
| `database.rules.json` | Firebase Realtime Database security rules |

### `src/` — App JavaScript
| File | Purpose |
|------|---------|
| `src/play.js` | Entire game engine — MP layer (IIFE, top), card DB, game state, rendering, flow |
| `src/tutorial.js` | Tutorial mode hooks (loaded before play.js) |
| `src/lobby.js` | Join (guest) flow for lobby.html; sets `sessionStorage` keys for play.js. Atomic slot claim via `runTransaction`. |
| `src/firebase-config.js` | Firebase init, exports `db` — used by lobby.js / host.js as ESM module |
| `src/host.js` | Host (create) flow + inline waiting room on gamesetup.html. Exposes `window.CFC_startHosting()`. Game auto-launches only when all human slots fill. Replaces the old `src/creategame.js`. |

### `css/` — Stylesheets
| File | Purpose |
|------|---------|
| `css/play.css` | Game UI styles |
| `css/style.css` | Shared/general styles |
| `css/rules-page.css` | Rules page styles |
| `css/theme.css` | Theme variables / font imports |

### `sim/` — Simulation & AI tooling
**Start at [`sim/TUNING.md`](sim/TUNING.md)** — the authoritative goal/steps/outputs guide for
tuning & validating the AI. The AI-tuning files share ONE deterministic engine + ONE genome source.

| File | Purpose |
|------|---------|
| `sim/TUNING.md` | **Read first.** How to validate/search/apply AI changes (the workflow). |
| `sim/personalities.js` | **The 6 bots (data) — single source of truth, synced to play.js.** Consumed by every sim tool. |
| `sim/personality-engine.js` | Shared AI decision layer + deterministic one-game `runGame` (mirrors play.js's live AI logic). Used by evolve/simulate/experiments. 2–4P only. |
| `sim/evolve.js` | Genetic algorithm — SEARCHES param space for better genomes. Seeds gen-0 from `personalities.js`. |
| `sim/simulate.js` | VALIDATES current bots: pairwise win matrix + per-card balance table (win% when owned). Replaces the retired RISK_PROFILES sim. |
| `sim/draw-cap-experiment.js` | Focused single-knob A/B (sweeps `maxDraw` per bot). Copy as a template for one-parameter experiments. |
| `sim/test-personality-sync.js` | Guard: fails if `personalities.js` drifts from play.js `AI_PERSONALITIES`. Run after any personality edit. |
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
| `docs/` | Rules PDF, planning docs |
| `admin/` | Gitignored admin scripts (email tools) |
| `test/` | Playwright tests |

---

## play.js Function Index

Line numbers are approximate (±10). Grep to verify exact location.

### MP Layer (IIFE, lines 22–580)
```
(IIFE identity hydration)   ~27   — resolves identity sessionStorage → URL(code/slot/name) → localStorage(cfc_rejoin); sets MP.recovered on a recovery load
gameRef(path)               ~52   — builds Firebase ref under games/{code}/
init()                      ~56   — dynamic Firebase ESM import, arms onDisconnect
startPresence()             ~81   — marks slot connected, watches opponent drops (30s grace, debounced message)
watchOpponentDrawStates()   ~168  — live-syncs opp hand/deck/discard/stats from drawState/{slot}
waitForAllHumanDrawsDone()  ~199  — resolves when all human slots push drawDone
waitForDraftRoundPicks()    ~252  — waits for all draft picks in a round
pushSpectatorState()        ~362  — host pushes full game snapshot to spectatorState; also calls pushLiveSummary()
pushLiveSummary()           ~401  — host writes slim liveSummary/{code} for the Live Now list (no card state)
waitForActSetup()           ~361  — non-hosts wait for host to push actSetup (pyramid card IDs)
waitForBuyAction()          ~396  — waits for a specific slot's buyAction push
waitForBuyOrder()           ~426  — waits for host to push buyOrder
showDisconnectMessage()     ~444  — shows disconnect UI, offers return to home
startRejoinCountdown()      ~453  — 5-min rejoin window timer
cleanup()                   ~506  — unsubscribes all Firebase listeners
watchForDisband()           ~532  — watches for status='disbanded' (or null for legacy)
```

### Card Database (lines ~752–900)
```
STARTERS array              ~754  — IDs 91-94 (River), 61-64 (Rattlesnake), 33-34 (Cactus)
STORE_CARDS array           ~769  — 84 cards total (per-act 4P pool = 28 distinct; the "55" is just the 2P total). minPlayers field controls 2P/3P/4P inclusion (no 5+ tier).
getCardById(id)             ~891
getActPool(act)             ~897  — act+minPlayers filter; for numPlayers>=5 returns the act pool DOUBLED (second deck — see 5-8P note below)
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
pyramidRowWidth(row)        — cards per row: min(row+1, 7). Triangle caps at width 7; 5-8P rows past the triangle are flat 7s.
pyramidColCenter(row, col)  — pure x-center (card units) of a cell. Triangle centered; 5-8P flat rows use BRICK offset (alternate rows +0.5 card). Used by covering + render.
buildPyramid(act, cardIds)  — numRows = numPlayers+3 (2P→5 … 8P→11); triangle cap + flat rows of 7 (see 5-8P note).
isCardCovered(pyr, r, c)    — GEOMETRY/overlap-based (any non-removed cell below within ~½ card). Reduces to old nextRow[col]/[col+1] for the 2-4P triangle.
revealUncovered(pyramid)    — face-up any card no longer covered
getAvailablePyramidCards()
isPyramidEmpty(pyramid)
```

### 5-8 Player Support (SHIPPED June 2026 — full log: `docs/FIVE_TO_EIGHT_PLAYER_PLAN.md`)
Rules identical to 2-4P; only setup/pyramid scale. Pyramid = 7-row triangle cap + one flat row of 7
per player past 4 (5P=35 … 8P=56 cards), brick offset. `getActPool` doubles the act pool for
numPlayers>=5 (second deck; card.id can repeat, uid stays unique). Buy-first (`burn_buy_first`/card_14)
is once-per-round: `MP.claimBuyFirst(act,round)` (atomic `runTransaction` on
`games/{code}/buyFirstClaim/{act}_{round}`, fail-open) via gate `claimBuyFirstPriority()` (only when
`MP.active && numPlayers>=5`); lost claim keeps the card. Sim parity at the buy-order layer
(`computeBuyOrder` / evolve) — honor only the first holder, inert at ≤4P. `fitPyramid()` (end of
renderPyramid + on resize) recenters & scales the pyramid into `#pyramid-zone` so 11 rows never clip
(numPlayers>=5 only). **Short-viewport draw-phase fit (June 2026):** `fitPyramid` only downscales when
its zone is height-bounded; the grid row auto-sizes to the pyramid, so without a cap `scale` computes
to 1 and an 11-row pyramid (~640px) shoves the draw-phase hand below the fold on ≤900px-tall laptops
(buy phase fits — its hand is smaller). Fix: `render()` toggles a `body.count-5plus` class
(numPlayers>=5), and playgame.html caps `body.count-5plus.phase-draw #pyramid-zone { max-height:40vh }`
inside `@media (min-width:1200px) and (max-height:900px)` (vh auto-scales: 360px@900 / 300px@750 /
272px@680). The cap (with the zone's `overflow:hidden`) gives `fitPyramid` a bounded box so it actually
scales the pyramid down and frees ~280px for the hand. Scoped to **draw phase + 5-8P only**: buy phase
(needs the big clickable pyramid) and 2-4P (where `fitPyramid` is a no-op — a cap would just clip) are
untouched. Count-agnostic for 5+: same cap, shorter pyramids (5P=8 rows … 8P=11) all exceed it and fit
identically. **Opponent layout (Option 3 "rail", June 2026 — ALL player counts):** on
desktop (`@media min-width:1200px`, grid in playgame.html) opponents are a fixed-width **scrolling
rail** on the right — `#opponents-zone` spans grid rows "action/pyramid" + "player" (`grid-area:opp`),
`position:sticky; max-height:calc(100vh-1rem); overflow-y:auto; flex-direction:column`. This decouples
your draw/hand area from opponent count: a tall/growing stack of opponent tiles scrolls inside the
rail instead of pushing your `#player-zone` below the fold (the "tiles keep expanding, you keep
scrolling" problem; pre-rail the opp block hit ~931px and shoved the player zone to y≈1028 on a 900px
screen). The desktop block also overrides `.opp-grid` back to a flex column and the opp `.hand-row`
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
**spectate.html** also mirrors the brick offset in its own `renderPyramid` (flat row of 7 where
`rowIdx>=7 && (rowIdx-7)%2===0` gets `.spec-pyramid-row.brick-offset`, a half-card `translateX` keyed
to `--spec-cw`); without it 5-8P flat rows render as a plain grid that doesn't match the game geometry.
Spectate does NOT scale (no fitPyramid equiv) — the tall pyramid just scrolls.

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
render()                    ~1403 — full DOM refresh; does NOT clear opp zones
renderPlayerZone(player)    ~1482 — opponents fan their hand via layoutOpponentFan (local player hand untouched)
layoutOpponentFan(handEl)   ~4659 — flat overlapping "fan" for an OPP hand: spreads across up to 3 rows (oldest top-left→newest bottom-right); rows added before any overlap, overlap tightens as count grows; newest card on top; no scrollbar. Measures handEl.clientWidth (works while collapsed); on a 0 read (pre-layout) borrows parent width and clamps W to ≥ cardW — NEVER a fixed 240px fallback (that overflowed the narrow 5-8P grid cells and overflow:hidden clipped the whole hand away). Card size must match `.opp-zone .hand .card` in play.css (52×73). 5-8P note: `.opp-grid .opp-zone .hand-row` stacks (deck-preview ON TOP of the fan) so the fan claims the full ~90px cell width instead of a ~2px sliver beside the 60px deck-preview; `.collapsible:not(.collapsed)` max-height bumped to 410px for the taller stacked layout (the `:not` keeps the `.collapsed{max-height:0}` collapse working).
relayoutOpponentFans()      ~4650 — re-runs layoutOpponentFan for every opp hand; debounced on window 'resize'
renderDeckPreview(player)   ~1548
renderPyramid()             ~1585 — sets z-index inline (generalizes past CSS nth-child(1..7)) + tags `.brick-offset` flat rows; calls fitPyramid() at the end
fitPyramid()                       — 5-8P only: recenters + scales the pyramid to fit #pyramid-zone (width+height) so 11 rows never clip. No-op for 2-4P. Also runs on window resize. NOTE: only downscales when the zone is height-bounded — on ≤900px-tall screens the `body.count-5plus.phase-draw #pyramid-zone {max-height:40vh}` cap (playgame.html) supplies that bound so the draw-phase hand stays on-screen (see 5-8P section).
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
seededDraftShuffle()        ~1786
aiDraftPick(pack, ai)       ~1801 — quick-draft AI pick; scores each card via scoreCardForAI(card, ai) (personality-driven, cost-free) and takes the max, tiebreak by card id for cross-client determinism. Scored under current act (Act 1 lens, draft runs before setupAct(2)). NOT mirrored in sim (quick-draft isn't simulated).
showDraftPackAndWait(pack)  ~1822 — human draft pick UI
runQuickStartDraft()        ~1900 — full draft flow (3 rounds × N players)
startGame()                 ~1982 — entry point; branches MP rejoin vs normal; calls setupAct
restartGame()               ~2119
```

### Rejoin / Reconstruction (lines ~2128–2265)
```
reconstructG(state, cfg)    ~2132 — rebuilds G from spectatorState on rejoin
resumeDrawPhase()           ~2189 — re-enters draw phase after rejoin
resumeBuyPhase()            ~2262 — re-enters buy phase after rejoin
```

### Round Flow (lines ~2268–2415)
```
setupAct(act)               ~2268 — host builds pyramid + pushes actSetup; non-hosts receive
startRound()                ~2311 — resets players, deals, starts draw phase
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
showChooseFirstUI()         ~3348 — host picks who goes first (after tied draw)
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
scoreCardForAI(card, ai)    ~3673  — uses cfg.act1DollarBonus / cfg.act3CowBonus (per-personality)
pyramidRevealBonus(r, c, b) ~3707  — b = cfg.revealBonus (per-personality, was hardcoded 1.5)
```

### End Phases (lines ~3805–4070)
```
endBuyPhase()               ~3807
scoreRound()                ~3812
endAct()                    ~3846
startShowdown()             ~3861 — final scoring + card flip animations; ends by calling showShowdownResult (no more "See Who Wins" button / separate game-over screen)
showShowdownResult()        ~4426 — crowns the top-herd player's section inline (.showdown-winner + 🏆), sets the gold "X Wins!" title, reveals the action footer (Play Again / Review / Home), then calls finalizeGame. Merges what used to be the separate gameover-screen into the showdown screen (Option A, June 2026).
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
showRules() / closeRules()  ~4087
showDeck() / closeDeck()    ~4097  — My Deck modal (2-row × 3-col suit grid)
showDeckPeek()              ~4147  — draw-phase ordered deck back preview
showCardZoom()              ~4186
toggleOppZone()             ~4219  — flips opponent-hand visibility for the CURRENT viewport bucket only (see oppHands note below)
applyOppHands()             ~4219  — applies the current bucket's pref (.collapsed class + arrow) to every opp zone; called from render() and on matchMedia change
ensureOpponentZone(i)       ~4232  — creates opp zone DOM only if not already present (detail starts WITHOUT .collapsed; applyOppHands sets it)
toggleLog()                 ~4274
preloadImages()             ~4283
applyDebugScenario(name)    ~4302
```

---

## Key State Shape

```js
// Global game state (window.G)
G = {
  act: 1|2|3,
  round: 1..5,
  phase: 'draw'|'buy'|'score'|'showdown'|'gameover',
  pyramid: [[{id, imgFile, faceUp, row, col}]],  // 5 rows, row 0 = top (1 card)
  players: [Player],       // players[0] = always local human
  playerOrder: [slotIdx],  // Firebase slot index for each G.players[i]
  gameSeed: number,
  buyOrder: [playerIdx],   // G.players indices in buy sequence this round
  quickStartMode: bool,    // skip Act 1, draft 4 cards (gamesetup checkbox)
  hiddenHerdMode: bool,    // conceal opponents' herd totals until showdown (gamesetup checkbox)
}

// Player object
player = {
  name, isHuman, slotIdx,
  hand: [CardInstance], deck: [CardInstance], discard: [CardInstance],
  roundDollars, roundCows, roundBandits, totalHerd,
  busted, stoppedDrawing, hasBuyBurnFirst, hasExtraBuy,
  _syncedDiscardCount,  // MP: synced from Firebase, used in renderPlayerZone
}
```

---

## Game Mode / Setup Flags

Optional modes are toggled by checkboxes on `gamesetup.html` and flow through a fixed 3-layer path. To add a new one, mirror an existing flag (`quickStartMode`, `hiddenHerdMode`) at each layer:

1. **`gamesetup.html`** — checkbox + handler set a JS flag, written to `sessionStorage['<flag>_mode']` in `startGame()`.
2. **`src/host.js`** — read the sessionStorage flag and include it in the `set(gameRef, {...})` payload so all MP clients agree (the game node is the source of truth in MP).
3. **`src/play.js`** — MP layer surfaces `data.<flag>Mode` in `buildPlayersConfig`'s return (~line 187); `startGame` sets `G.<flag>Mode` in all branches (MP cfg ~2225, tutorial ~2236, AI/sessionStorage ~2251); **rejoin must also set it in `reconstructG`** (~2347) or a refresh loses the mode.

**Hidden Herd** specifically: when `G.hiddenHerdMode`, opponents' herd totals are concealed UI-side. `renderPlayerZone` (~1626) shows `?` for `prefix !== 'player'` until `G.phase === 'showdown'`; `scoreRound` (~4245) suppresses the opponent herd-bump animation and redacts the running total from the log (shows only cows-this-round). It is **UI-only concealment** — the real herd still syncs to Firebase `spectatorState`/`liveSummary` (needed for the showdown reveal and rejoin reconstruction), so spectators and a Firebase-savvy player can still read it. AI decision logic reads real opponent herd locally (unchanged; unavoidable since all clients run AI locally).

---

## AI Personality System

**Full reference:** [`sim/AI_PERSONALITIES.md`](sim/AI_PERSONALITIES.md)

### Quick difficulty tiers

| Tier | Personality | Character |
|---|---|---|
| Easy | `banker` | Dollar-first; intentionally suboptimal — designed-to-lose archetype |
| Easy | `sheriff` | Conservative draw, methodical buys, high pyramid awareness |
| Medium | `deputy` | Denial burner; controls pyramid shape; conservative draw |
| Medium–Hard | `rancher` | Cow-optimizing grinder; closest to evolved optimum |
| Hard | `wild_bill` | High-variance aggressor; wins big or busts; swingy |
| Hard | `outlaw` | Most complete threat: aggressive draw + cow buying + denial |

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
- For **disciplined** bots whose bandit thresholds already govern stopping (rancher, deputy — both
  now **10**), the old hardcoded 7 was dead weight clipping the winning human line (overdraw dollars →
  more cows + earlier buy priority, since buy order is `roundDollars`-first). Raising to 10 is
  sim-validated **+2–4pp win (2P) / up to +8pp (4P) at ~flat bust rate**.
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

### Future: AI difficulty selection

When implementing a difficulty picker, the intended mapping is:
- Easy: sheriff or banker (player choice)
- Normal: rancher (benchmark)
- Hard: outlaw (most consistently dangerous)
- Wild card: wild_bill (fun, swingy)

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
  buys, host-gated), `trajLogCanary` (scoreRound). Skips debug + tutorial games.
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

**Do not regress:** Never re-introduce an auto-loop that draws multiple cards without returning to `startPlayerDraw` between them — that's the only place burn-to-use cards can be activated, and skipping it re-breaks the activate-before-bust rule. Keep "Stop" hidden while `forcedDraws > 0`, and keep `forcedDraws` cleared in `handleBust`/`resetPlayerRound`. Errata in rules.html documents the caveat for players.

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

The game code appears in the URL (`?mp=GAMECODE`) and in `sessionStorage.getItem('mp_code')` in the browser console. The `gameHistory` push key can be found by dumping `/gameHistory --shallow` and identifying the entry by timestamp or by cross-referencing the game code in the entry's `code` field.

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
