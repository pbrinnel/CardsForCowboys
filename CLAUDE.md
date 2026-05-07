# Cards For Cowboys — Claude Reference

## ⚠️ Maintenance Instructions (READ FIRST)

This file is your primary reference. **Keep it updated.** After any session where you:
- Add, rename, or significantly move functions in `play.js` → update the Function Index
- Fix a recurring or subtle bug → add it to the Known Bug Watch List
- Change Firebase data structure → update the relevant section in MEMORY.md and here
- Touch anything security-related → re-run the Security Checklist

When starting a new task, **check this file before reading raw source code.** Use the function index to grep directly to what you need rather than reading entire files.

**Git workflow:** Commit and push directly to `main`. Do not use worktrees or PRs for this project.

---

## File Map

| File | Purpose |
|------|---------|
| `play.js` | Entire game engine — MP layer (IIFE, top), card DB, game state, rendering, flow |
| `play.html` / `play.css` | Game UI shell and styles |
| `lobby.js` | Online matchmaking, sets `sessionStorage` keys for play.js |
| `firebase-config.js` | Firebase init, exports `db` — used by lobby.js as ESM module |
| `index.html` | Landing page (Play vs AI / Play Online / Rules) |
| `game.html` / `gamesetup.html` | Player count + slot config screen |
| `rules.html` | Standalone rules page |
| `spectate.html` | Spectator view (reads `liveGames/` path) |
| `history.html` | Game history + leaderboard |
| `simulate.js` / `sim/` | Headless simulation for balance testing |
| `database.rules.json` | Firebase Realtime Database security rules |

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
aiShouldDraw(ai)            ~2882 — decision logic
getBestAffordableCost(ai)   ~2933
```

### Special Card Handlers (lines ~2948–3265)
```
activateSpecialCard()       ~2948 — burn_to_use activation from hand
handleBust(player)          ~2996
handleTrashToUse()          ~3026  — "Burn to Use" (trash_to_use special)
handleTrashFor2()           ~3043  — "Burn for $2" (trash_for_2 special)
handleTrashBuyBurnFirst()   ~3055  — "Burn for Priority" (trash_buy_burn_first special)
handleLook3()               ~3074
handleTrashLook3()          ~3143  — "Burn & Look" (look3_rearrange special)
handleReplayDiscard()       ~3160  — "Burn & Replay" (replay_discard special)
handleExtraBuy()            ~3230  — "Burn for Extra Buy/Burn" (extra_buy special)
NOTE: handlePutOnTop() was permanently removed (May 2026). Card 22 reworked from
      put_on_top (Cactus $5) → trash_for_2 (River $3, $1 on draw). If a future card
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
aiBuyTurn(ai)               ~3588
scoreCardForAI(card, ai)    ~3673
pyramidRevealBonus(r, c)    ~3707
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

### 6. Fixed Footer Cuts Off Bottom Content on Narrow Viewports
**Symptom:** The last element on a page (button, link, image) is obscured by the fixed footer bar when the viewport is narrow or the content is tall.

**Root cause:** All pages use `position: fixed` footer. Body/page padding-bottom must exceed the footer height — but the footer can grow taller on narrow screens as its two lines of text reflow or wrap further.

**What to check when adding new pages or content:**
- Does the page container have sufficient `padding-bottom`? (~5rem baseline, ~8rem on mobile)
- Add a `@media (max-width: 540px) { body { padding-bottom: 8rem; } }` block for any page whose content might be taller than the viewport.
- Test by resizing the browser to a narrow viewport and scrolling to the bottom.

---

## Debugging Approach for Multiplayer Issues

**Always start with Firebase logs, not blind code review.**

Errors in MP games are almost always observable in Firebase Realtime Database logs before they manifest visually. The sequence:

1. **Identify the game code** from the URL (`?mp` param) or from `sessionStorage.getItem('mp_code')` in the browser console.
2. **Open Firebase Console → Realtime Database → Data** and navigate to `games/{code}/`.
3. **Look at the relevant path first:**
   - Draw sync issues → `drawState/{slot}` and `drawDone/{slot}`
   - Buy sync issues → `buyAction/{slot}` and `buyOrder`
   - Presence/disconnect → `slots/{slot}/connected`
   - Setup issues → `actSetup`
4. **Compare what each client sees** — open the game in two browser windows and watch the Firebase paths update in real time.
5. **Check timestamps** (`ts` fields) to determine ordering and whether stale data is being processed.
6. Only after understanding the Firebase data flow should you trace back into the logic.

**Key principle:** The game logic runs identically on all clients. If players see different states, the divergence is almost always in what Firebase data was received, when, and whether stale guards fired correctly.

---

## Security Checklist

Run through this whenever touching Firebase-related files, auth, or configuration:

### Firebase API Key
The Firebase API key is **intentionally public** — Firebase web app keys are not secrets; security is enforced via Database Rules. However:
- [ ] The key is hardcoded in TWO places: `firebase-config.js` line 9 and `play.js` line 13. If the key ever changes, update both.
- [ ] `database.rules.json` must restrict write access appropriately. Review it when adding new Firebase paths.
  - `games/$gameCode` — fully open read/write (game code acts as access token — acceptable)
  - `gameHistory` — read open, write restricted to new push-only entries (`!data.exists()`); shape validated (required fields, type checks, length limits, no extra fields)
- [ ] Never add server-side secrets (service account keys, admin SDK credentials) to any file in this repo.

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
