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
| File | Purpose |
|------|---------|
| `sim/simulate.js` | AI vs AI simulation runner |
| `sim/simulate-showdown.js` | Legacy showdown-only simulation |
| `sim/evolve.js` | Genetic algorithm for AI parameter tuning |
| `sim/ai-player.js` | AI player logic for simulation |
| `sim/game-core.js` | Core game logic extracted for sim use |
| `sim/tiebreaker.js` | Buy-order tiebreaker (shared by game + sim) |
| `sim/stats.js` | Statistics collector |
| `sim/mock-firebase.js` | Firebase mock for MP protocol tests |
| `sim/mp-client.js` | MP client mirror for sim |
| `sim/results/` | Simulation output files |

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
waitForPassCard()           ~229  — waits for discard_to_player card from opponent
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
STORE_CARDS array           ~769  — 55 cards, minPlayers field controls 2P/3P/4P inclusion
getCardById(id)             ~891
getActPool(act)             ~897
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
buildPyramid(act, cardIds)  ~1051 — builds 5-row pyramid from card ID array
isCardCovered(pyr, r, c)    ~1084
revealUncovered(pyramid)    ~1094 — face-up any card no longer covered
getAvailablePyramidCards()  ~1108
isPyramidEmpty(pyramid)     ~1121
```

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
layoutOpponentFan(handEl)   ~4659 — flat overlapping "fan" for an OPP hand: spreads across up to 3 rows (oldest top-left→newest bottom-right); rows added before any overlap, overlap tightens as count grows; newest card on top; no scrollbar. Measures handEl.clientWidth (works while collapsed). Card size must match `.opp-zone .hand .card` in play.css (52×73).
relayoutOpponentFans()      ~4650 — re-runs layoutOpponentFan for every opp hand; debounced on window 'resize'
renderDeckPreview(player)   ~1548
renderPyramid()             ~1585
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
sim/ai-player.js and sim/evolve.js).

### AI Draw Phase (lines ~2667–2950)
```
aiDrawPhase(playerIdx)      ~2669 — full AI draw loop (all clients run this)
aiShouldDraw(ai)            ~2882 — decision logic (reads AI_PERSONALITIES cfg)
calcBustProb(player,n,cfg)  ~2930 — blends exact lethal-card count with flat prior via deckMemory/lethalBias
getBestAffordableCost(ai)   ~2933
```

### Special Card Handlers (lines ~2948–3265)
```
activateSpecialCard()       ~2948 — burn_to_use activation from hand
handleBust(player)          ~2996
handleBurnToUse()           ~3026  — "Burn to Use" (burn_to_use special)
handleBurnFor2()            ~3043  — "Burn for $2" (burn_for_2 special)
handleBurnBuyFirst()        ~3055  — "Burn for Priority" (burn_buy_first special)
handleLook3()               ~3074
handleTrashLook3()          ~3143  — "Burn & Look" (look3_rearrange special)
handleReplayDiscard()       ~3160  — "Burn & Replay" (replay_discard special)
handleExtraBuy()            ~3230  — "Burn for Extra Buy/Burn" (extra_buy special)
NOTE: handlePutOnTop() was permanently removed (May 2026). Card 22 reworked from
      put_on_top (Cactus $5) → burn_for_2 (River $3, $1 on draw). If a future card
      needs put_on_top logic, rebuild from git history (commit before this change).
```

### Pass Card — `discard_to_player` (card_4 only) (lines ~4124–4188)
```
aiPickPassTarget(fromIdx)   ~4128 — AI chooses the recipient (see note)
resolvePassCards()          ~4146 — resolves all held discard_to_player cards at scoreRound
resolveSinglePassCard()     ~4159 — human prompt / AI pick / remote-human Firebase wait
```
NOTE (card_4 is a BENEFIT, not a curse): card_4 is the only `discard_to_player` card —
stats `{dollars:0, cows:0, bandits:-1}`, so when the recipient eventually draws it, it
gives them −1 bandit (raises their bust ceiling) with zero downside. `cacti` is cosmetic
(suit identity only; never scored/tiebroken). Therefore `aiPickPassTarget` hands it to the
WEAKEST opponent (lowest `herd`) to minimize help to a rival — NOT the leader. Ties (several
opponents at the lowest herd) break via a seeded LCG over their sorted Firebase slots so all
MP clients pick the same recipient deterministically. This matches the "pass to weakest
opponent" logic the AI was tuned against in `sim/simulate.js` (~line 210). **Do not regress
to giving it to the leader** — that was the old (June 2026) behavior and it actively helped
the front-runner. Card is opponents-only (passer cannot keep it) in both the human UI and AI.

### Buy Phase (lines ~3265–3590)
```
onDrawPhaseComplete()       ~3269 — called when all draw phases done; kicks off buy ordering
showChooseFirstUI()         ~3348 — host picks who goes first (after tied draw)
startBuyPhase(startIdx)     ~3364
applyBuyOrder(order)        ~3390
processBuyTurn()            ~3399 — dispatcher: human / AI / mpOpponent
mpOpponentBuyTurn(opp)      ~3433 — waits on Firebase buyAction/{slotIdx}
humanBuyTurn(player)        ~3451
onPyramidCardClick(r, c)    ~3469
executeBuy(player, r, c)    ~3506
executeBuyLocal(player, r, c) ~3512
advanceOrExtraBuy(player)   ~3532
executeBurn(player, r, c)   ~3562
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

### Personality parameters (14 total)

All parameters live in `AI_PERSONALITIES` (~line 2813 in `src/play.js`, mirrored in `sim/simulate.js`).
**Both files must be kept in sync.**

Draw-phase: `bustThreshold2`, `bustThreshold1`, `dollarBuffer`, `positionWeight`, `affordMult`, `deckMemory`, `lethalBias`

Buy-phase: `cowWeight`, `dollarWeight`, `banditPenalty`, `act1DollarBonus`, `act3CowBonus`, `revealBonus`, `denialBurn`

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

**Fix in place:** Draw 4 now sets `player.forcedDraws += 4` and routes each extra draw through the normal `playerDraw`/`startPlayerDraw` flow, so the activate buttons (incl. jail) appear between draws. `startPlayerDraw` hides "Stop" while `forcedDraws > 0` (draws stay mandatory — preserves the card's risk/balance); activating a card does NOT decrement `forcedDraws`. Empty deck mid-Draw-4 auto-reshuffles and continues (only ends when both piles are empty). AI parity: the draw4 loops in `play.js`, `sim/ai-player.js`, and `sim/evolve.js` proactively activate a held jail card at 2+ bandits before each forced draw.

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

**AI parity:** the same reshuffle was mirrored into both AI handlers in `aiDrawPhase` (`look3_rearrange` and `look3_immediate`, ~lines 3021/3033) using `shuffleForPlayer(ai.discard, ai.slotIdx, false)` — the seeded path in MP, so every client's AI deck stays identical (same mechanism as `drawFromDeck`'s reshuffle; no desync). Mirrored in the sim too: `sim/ai-player.js` (uses `core.shuffle`, matching its `core.drawFromDeck`) and `sim/evolve.js` (uses `seededShuffle(discard, rng)`, matching `drawFromDeckSeeded`). The AI burn-decision gate (`deck.length >= 2`) was intentionally left unchanged — only the in-branch reshuffle mechanic was added, so AI burn frequency / personality balance is untouched.

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
