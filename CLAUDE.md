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
| `index.html` | Landing page (Play vs AI / Play Online / Rules) |
| `playgame.html` | Game UI shell |
| `gamesetup.html` | Player count + slot config screen |
| `lobby.html` | Online matchmaking lobby |
| `creategame.html` | Online game creation |
| `rules.html` | Standalone rules page |
| `spectate.html` | Spectator view (reads `liveGames/` path) |
| `history.html` | Game history + leaderboard |
| `aboutthecreators.html` | About page |
| `bugreport.html` | Bug-report form → writes `bugReports/` in Firebase; auto-attaches game context from `localStorage['cfc_bug_context']` |
| `privacy.html` | Privacy policy (GDPR-aligned: controller, legal basis, retention, data-subject rights; contact: pbrinnel@gmail.com) |
| `database.rules.json` | Firebase Realtime Database security rules |

### `src/` — App JavaScript
| File | Purpose |
|------|---------|
| `src/play.js` | Entire game engine — MP layer (IIFE, top), card DB, game state, rendering, flow |
| `src/tutorial.js` | Tutorial mode hooks (loaded before play.js) |
| `src/lobby.js` | Online matchmaking logic, sets `sessionStorage` keys for play.js |
| `src/firebase-config.js` | Firebase init, exports `db` — used by lobby.js as ESM module |
| `src/creategame.js` | Online game creation logic |

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
gameRef(path)               ~52   — builds Firebase ref under games/{code}/
init()                      ~56   — dynamic Firebase ESM import, arms onDisconnect
startPresence()             ~81   — marks slot connected, watches opponent drops
watchOpponentDrawStates()   ~168  — live-syncs opp hand/deck/discard/stats from drawState/{slot}
waitForAllHumanDrawsDone()  ~199  — resolves when all human slots push drawDone
waitForPassCard()           ~229  — waits for discard_to_player card from opponent
waitForDraftRoundPicks()    ~252  — waits for all draft picks in a round
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
renderPlayerZone(player)    ~1482
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
aiDraftPick(pack)           ~1801
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
startPlayerDraw()           ~2456 — sets up human draw UI
playerDraw()                ~2512 — resolves a single draw action
playerStopDraw()            ~2624
onPlayerDrawDone()          ~2640 — human done; triggers MP sync + checkDrawPhaseComplete
checkDrawPhaseComplete()    ~2654 — advances to buy phase when all draws done
```

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
startShowdown()             ~3861 — final scoring, card flip animations
revealWinner()              ~3996
gameOver()                  ~4001
disbandGame()               ~4064
```

### UI Helpers (lines ~4070–4380)
```
showRules() / closeRules()  ~4087
showDeck() / closeDeck()    ~4097  — My Deck modal (2-row × 3-col suit grid)
showDeckPeek()              ~4147  — draw-phase ordered deck back preview
showCardZoom()              ~4186
toggleOppZone(i)            ~4219
ensureOpponentZone(i)       ~4232  — creates opp zone DOM only if not already present
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

---

## Security Checklist

Run through this whenever touching Firebase-related files, auth, or configuration:

### Firebase API Key
The Firebase API key is **intentionally public** — Firebase web app keys are not secrets; security is enforced via Database Rules. However:
- [ ] The key is hardcoded in TWO places: `src/firebase-config.js` line 9 and `src/play.js` line 13. If the key ever changes, update both.
- [ ] `database.rules.json` must restrict write access appropriately. Review it when adding new Firebase paths.
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
