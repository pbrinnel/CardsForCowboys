# MP Sync Protocol — Adversarial Audit (July 2026)

**Scope:** the full multiplayer sync protocol in `src/play.js` (MP IIFE + every game-flow
touchpoint), `src/host.js`, `src/lobby.js`, `sim/tiebreaker.js`, and `database.rules.json`,
plus a determinism audit of the "all clients run AI locally" model.
**Method:** full source read (not the CLAUDE.md index), a catalog of every Firebase path's
writer/reader/clear/stale-guard semantics, then an adversarial walk of refresh, eviction,
reconnect, and race windows through every phase (lobby → draft → draw → buy → score →
showdown → rejoin). Every "Confirmed" finding below was verified against the actual code
(grep-checked call sites); "Race window" findings are mechanism-verified but need specific
timing to fire.

**Status: FIXES SHIPPED (July 3 2026).** Everything except N1/N2 and systemic item 2 was
fixed in the day-after-audit pass (see the commit referencing this doc). Two ADDITIONAL
confirmed bugs were found during fixing: **C8** (draft packs keyed by local player index)
and **C9** (database rules never deployed → every trajectory header since the Pioneer Mode
launch was silently rejected in production — fixed by deploying, no code change). The
finding write-ups below are kept as the reasoning record; each notes its fix. Line numbers
are as of the audit (±10 after edits; grep the identifier).

---

## Ranked summary

| # | Finding | Severity | Confidence | Class | Status |
|---|---------|----------|------------|-------|--------|
| C1 | card_4 Swap never applies on other clients (uid-resolved) | High | Confirmed | Silent divergence | **FIXED** |
| C2 | `claimBuyFirst` keys on undefined → once-per-game, not per-round | High (5-8P) | Confirmed | Broken mechanic | **FIXED** |
| C3 | MP rejoin mid-draw with AI seats → permanent softlock | High | Confirmed | Softlock | **FIXED** |
| C4 | Rejoin resets AI RNG → all subsequent AI play diverges per client | High | Confirmed | Silent divergence | **FIXED** |
| C5 | card_24 (`dollar1_other`) drawn by a human desyncs AI dollars + drops the effect | High | Confirmed | Silent divergence | **FIXED** |
| C6 | `spectatorState.currentBuyerIdx` stale-by-one → rejoin replays the previous buy turn | Medium-High | Confirmed | Softlock / double-buy | **FIXED** |
| C7 | Rejoin drops `hasBuyBurnFirst`/`hasExtraBuy`/`extraBuyUsed` (not in spectatorState) | Medium | Confirmed | Softlock / deadlock | **FIXED** |
| C8 | Draft packs keyed by LOCAL player index → per-client pack mismatch in MP (found during fixing) | High (Quick Draw MP) | Confirmed | Silent divergence | **FIXED** |
| C9 | Deployed DB rules predate Pioneer Mode → every traj header since ~June 25 rejected (found during fixing) | Medium (research data) | Confirmed | Silent data loss | **FIXED** (rules deployed) |
| R1 | `buyAction` is last-writer-wins, not a queue — extra-buy double actions can be lost | Medium | Race window | Softlock / divergence | **FIXED** (seq) |
| R2 | Force-continue racing the stuck player's late real action → divergence | Medium | Race window | Divergence | **FIXED** (tombstones) |
| R3 | Buy-winner tiebreaker can diverge on stale opponent hands | Low-Medium | Race window | Softlock | **FIXED** (hand in drawDone) |
| H1 | drawState listeners accumulate every round → k× render + k× spectator writes | Medium | Confirmed | Perf / write flood | **FIXED** (named subs) |
| H2 | Two drifted spectator-state serializers (MP inline vs `buildSpectatorState`) | Low | Confirmed | Maintenance hazard | **FIXED** (unified) |
| H3 | Rejoin during `score`/`showdown` phase → dead-end message, no retry | Low | Confirmed | UX softlock | **FIXED** (watch+resume) |
| H4 | Quick Draw draft has no recovery path (no snapshot, no force valve) | Medium | Confirmed | Softlock | **FIXED** (valve + pick auto-resume) |
| H5 | Host fresh-start fallthrough can rebuild Act 1 despite an existing `actSetup` | Low | Confirmed (tiny window) | Divergence | **FIXED** (consume existing) |
| N1 | Host wifi blip in waiting room deletes the lobby | Low | Confirmed | UX | Open (accepted for now) |
| N2 | Seat hijack: identity URL is a bearer token and game codes are public | Info | Confirmed | Abuse model | Open (accepted model) |

Also fixed in passing: the trajectory `s` record for card_4 swaps passed the raw spec
OBJECT as `detail`, which the rules validate as a string ≤20 — every swap record was
silently dropped. Swap details now use a compact string (`p{row},{col}:{id}` /
`h{slot}:{id}` / `d{slot}:{id}`, with `card_N`→`N`, `starter_N`→`sN`).

---

## Confirmed bugs

### C1 — card_4 Swap silently never applies on other clients

**Where:** `applySwapLocal` — `play.js:4807`
`const c4idx = player.hand.findIndex(c => c.uid === spec.card4Uid); if (c4idx < 0) return false;`

**Mechanism:** the swap spec resolves *targets* by stable keys (pyramid row/col, pile by card
`id`) — per the design note — but resolves **card_4 itself by `uid`**. `uid` is a per-client
monotonic counter: the instances in a receiver's copy of the activator's hand were created
locally by the drawState sync (`createCardInstance`) and carry entirely different uids. So on
every client except the activator, `findIndex` misses → `return false` → **the swap is silently
dropped** (`mpOpponentBuyTurn` ignores `applySwapLocal`'s return value at `play.js:4565`).
Worse: uid spaces overlap across clients, so a coincidental match would swap the **wrong card**.

**Impact:** every human card_4 use in MP (card_4 is 4P-only): the activator sees the steal; the
victim keeps the card on their own client; the pyramid cell keeps its original card on other
clients. The stolen card is counted in two different herds at showdown depending on which
client you look at, and any later buy of that pyramid cell buys a *different card* per client —
the "shops not synced" divergence family. The AI swap path is unaffected (spec built locally
per client, uid is local).

**Fix sketch:** resolve card_4 by `id` (`c.id === 'card_4'` — or carry `card4Id` in the spec;
there is exactly one card_4 per game at ≤4P, and hand order is id-synced so a hand *index*
would also work). Also make `mpOpponentBuyTurn` log loudly when `applySwapLocal` returns false.

---

### C2 — `claimBuyFirst` transacts on `buyFirstClaim/undefined_undefined`

**Where:** `claimBuyFirstPriority` — `play.js:4172`
`return await MP.claimBuyFirst(G.act, G.round);`

**Mechanism:** the state fields are `G.currentAct` / `G.roundNumber`; `G.act` and `G.round`
do not exist anywhere else in the file (grep-verified). The per-round claim key
`buyFirstClaim/${act}_${round}` is therefore the constant `undefined_undefined` for the whole
game.

**Impact:** 5-8P MP only (the gate). The intended "one first-buy claim per round" becomes
"one per **game**": the first player to use card_14 wins; every other player's claim aborts
(the transaction sees the original claimant's slot) and they're told "already taken this
round" — for the rest of the game. The original claimant, conversely, would always re-win.

**Fix sketch:** `MP.claimBuyFirst(G.currentAct, G.roundNumber)`. One line. (Sim parity
already keys correctly per CLAUDE.md; only the live gate is broken.)

---

### C3 — MP rejoin mid-draw with AI seats softlocks the rejoiner

**Where:** `resumeDrawPhase` — `play.js:2896-2968`

**Mechanism:** it zeroes `G.drawsDone` for **all** seats (2899), then arms watchers that mark
done only for **human** slots (via `drawDone` signals) and the local player. Nothing ever sets
`drawsDone[i]` for AI seats: `aiDrawPhase` is never re-run, and there is no inference from the
restored `busted`/`stoppedDrawing` flags. `checkDrawPhaseComplete` requires *every* index →
`allDone` is never true.

Contrast the **solo** resume path, which handles this correctly (`play.js:2681-2687`: restores
saved `drawsDone`, re-runs `aiDrawPhase` for unfinished AI seats).

**Impact:** any MP game with at least one AI seat: a player who refreshes / gets evicted during
a draw phase reconstructs fine, finishes their draw, then sits on "Waiting for other players to
finish drawing..." forever. The host force valve doesn't help (`forceDrawPhase` skips
`!p.isHuman`, and the *rejoiner's* local `drawsDone` for the AI is what's stuck). A second
refresh during the buy phase happens to recover (resumeBuyPhase path).

**Fix sketch:** in `resumeDrawPhase`, set `G.drawsDone[i] = true` for AI seats whose restored
state shows `busted || stoppedDrawing` (which is virtually always — AI draws complete in
seconds and spectatorState is pushed continuously); for a genuinely mid-draw AI, either mark
done with current restored stats or re-run `aiDrawPhase(i)` (see C4 for the RNG caveat).
`spectatorState` should also start carrying `drawsDone` (see C7 fix pass).

---

### C4 — Rejoin resets the AI RNG streams → all post-rejoin AI play diverges

**Where:** `reconstructG` — `play.js:2837` (`initAiRng(slotIdx, cfg.gameSeed)`), comment
claims "AI card choices going forward are fine".

**Mechanism:** the per-slot LCG streams on the other clients have been *advanced* by every
shuffle since game start (starter deal, per-act reshuffles, mid-draw reshuffles, look3
reshuffles). The rejoiner re-seeds from scratch. Deck *contents* are restored identically from
spectatorState, but the **next seeded shuffle** for any AI slot (next act boundary, next
discard→deck reshuffle) produces a different permutation on the rejoiner than everywhere else.
AI draws are not synced — every client simulates — so from that shuffle on, the rejoiner's AI
seats draw different cards, make different stop/buy decisions, and mutate a different pyramid.

**Impact:** silent, compounding divergence in every MP-with-AI game after any rejoin (and
rejoin now includes plain mobile tab eviction, which is routine). If the *host* rejoins, its
diverged view becomes the spectatorState/gameHistory "truth". This likely contributes to the
observed post-rejoin weirdness family (bug #11's compounding was fixed; this is the remaining
AI-side analogue).

**Fix sketch:** `_aiRngs[slot].seed` is a single uint32 per AI slot. Add `aiRngSeeds` to
spectatorState (host pushes; it's authoritative for AI anyway) and restore it in
`reconstructG` instead of calling `initAiRng`. Belt-and-braces: also add an act-boundary
re-sync (see systemic section).

---

### C5 — `dollar1_other` (card_24) drawn by a human desyncs MP

**Where:** `applyCardEffects` — `play.js:1629-1633`

**Mechanism:** the "+$1 to each other player" loop mutates the **drawing client's local
copies** of the other players. Remote clients never execute it — they sync the drawer's own
stats wholesale from `drawState` and never see a per-card event. Consequences per seat type:

- **Human recipients:** never receive the dollar on their own client (their self-tracked
  `roundDollars` is authoritative and their next push overwrites the drawer's local bump).
  The card effect is simply lost for them — and the drawer transiently *sees* opponents with
  +$1 that later snaps back.
- **AI recipients:** the +$1 sticks on the drawer's client only. AI `roundDollars` now differ
  across clients → `aiShouldDraw`'s dollar-target logic diverges → the AI stops drawing at
  different points on different clients → different hands/decks/buys for the rest of the game.
  This breaks the seeded-determinism contract *without any rejoin involved* — one card draw
  in normal play is enough.

AI-drawn card_24 is fine (every client runs the AI's draw locally and applies the loop
consistently, including to their own local human).

**Impact:** card_24 is a 2P+ Act 2 card — in the candidate pool of essentially every MP game.
Whenever a human draws or replays it, AI-seat divergence begins. Another likely standing
contributor to the "shops not synced" family.

**Fix sketch (options):**
1. Sync the effect: receivers diff the opp hand during drawState sync for newly-appeared
   card_24 instances and apply +$1 to their local player + AI seats (skip other remote humans —
   their own client handles theirs). Fragile but no protocol change.
2. Cleaner: add an optional `grants` field to `drawState`/a tiny event node the drawer writes
   (`dollarGrants/{round}: {bySlot: n}`), receivers apply once (idempotent by count).
3. Bluntest: rework the card (physical-game parity permitting) — e.g. make it self-only — or
   exclude it from MP pools until fixed. Given the physical game is the product, (1)/(2) are
   the real options.

---

### C6 — `spectatorState.currentBuyerIdx` is stale-by-one during every buy wait

**Where:** `executeBuyLocal`/`executeBurnLocal` push spectatorState (`play.js:4687`, `4748`)
**before** `advanceOrExtraBuy` increments `G.currentBuyerIdx` (`4714`). Nothing pushes after
the increment until the *next* buyer's action lands (`processBuyTurn` and `mpOpponentBuyTurn`
don't push).

**Mechanism:** for the entire window while the table waits on buyer k+1 (≥1s for AI turns,
unbounded for human turns), the snapshot says `currentBuyerIdx = k` with a pyramid that
already reflects k's action. A rejoiner reconstructs exactly that and calls `processBuyTurn`:

- **k was AI:** the rejoiner re-runs `aiBuyTurn` on the post-buy pyramid → the AI buys a
  *second, different* card on the rejoiner's client only (local divergence; AI buys don't push
  `buyAction` — `play.js:4664` gates pushes to the local human).
- **k was a remote human:** the rejoiner waits on `buyAction/{k}` — which the other clients
  already consumed **and cleared** (`clearBuyAction`) → waits forever; the force valve only
  arms on the host.
- **k was the rejoiner:** they get their buy turn again → double-spend locally; their second
  `buyAction` push is ignored by everyone else (already advanced) → divergence.

**Impact:** refresh/eviction during the buy phase — a common moment (players background the
tab while waiting for others to buy) — lands in this window with high probability.

**Fix sketch:** host pushes spectatorState at the top of `processBuyTurn` (the post-increment
chokepoint) — one call covers buy, burn, skip, and busted-skip paths. Alternatively push
inside `advanceOrExtraBuy` after the increment.

---

### C7 — Rejoin drops buy entitlements (and more): fields missing from spectatorState

**Where:** both serializers — MP inline `pushSpectatorState` (`play.js:342-370`) and
`buildSpectatorState` (`play.js:941-975`) — omit `hasBuyBurnFirst`, `hasExtraBuy`,
`extraBuyUsed` (also `copyNext*` linkage, `forcedDraws` [documented-accepted], and
`G.drawsDone`). The **solo** save (`saveLocalGame`) persists all of these; the MP snapshot
never did. `reconstructG` therefore can't restore them.

**Mechanism / impact:**
- Rejoiner held **first-buy priority** (card_14): other clients wait for *them* to push the
  buy order (`onDrawPhaseComplete` priority branch); the rejoiner, with the flag lost,
  computes the normal winner path → if that winner isn't the rejoiner, both sides wait on each
  other → deadlock until the host force valve (which then produces a *different* order than
  the priority holder would have chosen — order divergence risk on top).
- Rejoiner held **extra buy**: other clients (who synced the flag from the earlier
  `drawDone`) wait for a second `buyAction` from them; the rejoiner believes their turn is
  over → softlock until force-skip.
- Lost `drawsDone` is what forces C3's inference workaround.

**Fix sketch:** one enrichment pass: add the entitlement fields + `drawsDone` + `aiRngSeeds`
(C4) to the spectator snapshot and restore them in `reconstructG`. Do it in **one** serializer
(see H2) so it can't drift again.

---

### C8 — Quick Draw draft packs were keyed by LOCAL player index (found during fixing)

**Where:** `runQuickStartDraft` — packs were built as `packs[i] = pool.slice(i*6, i*6+6)`
with `i` = `G.players` index, and passed to `(i+1) % numPlayers`.

**Mechanism:** in MP, `G.players` ordering differs per client (the local player is always
index 0). So every client dealt itself `pool.slice(0..6)` — multiple players drafting from
the SAME six cards, each on their own client — while computing AI picks and the pass
rotation from mismatched packs. Broadcast picks then frequently missed
(`packs[i].find(id)` on the wrong slice), silently dropping opponents' drafted cards from
the local view. Human decks partially self-corrected later via drawState sync, but AI-seat
drafts diverged from Act 2 round 1, and duplicate physical cards could be drafted by two
seats.

**Fix (shipped):** packs are keyed by **slotIdx** (`packsBySlot`) with the rotation in slot
space — one shared layout on every client; SP unchanged (slot === index there). Also fixed
in passing: pack filtering now removes exactly ONE instance of the picked id (5-8P packs
can hold duplicate ids under the doubled act pool; `.filter(id !== picked)` stripped both).

---

### C9 — Deployed database rules predated Pioneer Mode: every traj header rejected (found during fixing)

**Where:** production Firebase rules vs `database.rules.json`.

**Mechanism:** the traj rules use `$other: false`; the June 2026 Pioneer Mode change added
`pioneerMode` to the trajectory header AND to the repo's rules file — but the rules were
**never deployed**. From the Pioneer launch (~June 25) until July 3, every `hdr` record was
rejected with `permission_denied` (verified in live data: headers present through 06-25,
absent after — e.g. game R37LYX). All other record kinds still landed, but a trajectory
without its header (gameSeed, seats, version stamps) can't be replayed by the planned
offline reconstructor.

**Fix (shipped):** `firebase deploy --only database` (verified: fresh game's header lands
with `pioneerMode`). **Process rule:** any edit to `database.rules.json` isn't done until
it's deployed — CLAUDE.md's mode-flag checklist now says so explicitly.

---

## Race windows (mechanism-verified; need timing to fire)

### R1 — `buyAction` is a last-writer-wins cell, not a queue

`buyAction/{slot}` holds at most one action; a slot legitimately acts **twice in the same
round** (extra buy). The second `pushBuyAction` overwrites the first at the same path, and
every consuming client writes `null` afterwards (`clearBuyAction` — all clients, not one).
Two loss modes:

1. **Coalescing / reconnect:** a client that reconnects (mobile blip) between the two pushes
   re-syncs to the *latest* value only — it applies action #2 as if it were #1, then waits
   forever for a second action that already happened. Its pyramid also misses action #1's
   removal → divergence + softlock.
2. **Clear-clobber:** a slow client's `clearBuyAction` for action #1 can land at the server
   *after* the actor already pushed action #2 → the null wipes #2 before other clients consume
   it → they wait forever.

Both need an extra-buy turn plus adverse timing — rare, but bug #16's history says these
windows do get hit, and this one survives the #16 fix (which only handles the *cell-already-
gone* no-op, not a *missing* action).

**Fix sketch:** make actions sequenced: write to `buyAction/{slot}/{act}_{round}_{seq}` (or
include a `seq` the receiver tracks per slot+round and match `seq === expected`), and stop
clearing entirely — staleness guards already exist, and append-only removes both loss modes.

### R2 — Force-continue racing the stuck player's late real action

`forceBuyAction` writes `{action:'skip'}` to the same cell the stuck player may be about to
write their real action to. Attached clients consume whichever lands first (then unsubscribe),
but the stuck player's own client **already applied its buy locally** (`executeBuy` applies
before/independent of the push). If the skip wins the race: everyone else skips the turn, the
actor keeps their purchase locally → pyramid + herd divergence for the rest of the game. The
same class exists for `forceSignalDrawDone` (cards the "stuck" player draws after being forced
are counted only on their own client) and `forceBuyOrder` vs the real chooser's push (late
attachers can consume the second value).

**Fix sketch:** before applying a local buy/burn in MP, the actor checks (or listens to) its
own `buyAction` cell for a forced skip stamped with the current round → if present, discard
the local action and show "your turn was skipped". Cheap tombstone check that makes the valve
safe. (The systemic reconciliation below also mops up the residue.)

### R3 — Buy-winner tiebreaker can diverge on stale opponent hands

`determineBuyWinner` narrows by `roundDollars` → `roundCows` → **`hand.length`** →
**`hand[i].cost`**. Stats come authoritatively from `drawDone` (`doneData`), but the hand
comes from the last `drawState` — and once `drawsDone[playerIdx]` is set, later drawState
re-fires are *deliberately ignored* (`play.js:3064`, the stats-protection guard). A reconnect
that delivers the drawDone listener before the drawState re-fire leaves that opponent's hand
permanently stale on one client. If the round happens to tie on dollars+cows, that client
narrows the tie differently → believes a different player chooses the order → cross-waiting
softlock (or, in the AI-winner-vs-human-winner case, applies a locally-computed order nobody
else uses). `signalDrawDone` already carries `handCount` — it's just never used on receipt.

Note: showdown *totals* are immune to intra-round hand staleness (deck+hand+discard union is
invariant within a round — cards only move between the three piles), so this is confined to
the tiebreaker.

**Fix sketch:** include the hand card-id list (or at least reconcile `hand.length` from
`handCount` + costs) in `drawDone`, applied in `waitForAllHumanDrawsDone`'s callback alongside
the stats.

---

## Hygiene / performance

### H1 — drawState listeners accumulate every round

`startRound` calls `MP.watchOpponentDrawStates(...)` **every round** (`play.js:3053`;
`resumeDrawPhase` adds another set at 2903). Subscriptions are only torn down in `cleanup()`
at game end. All stale listeners still pass the round/act guards (they read *current* `G`
values at fire time), so by Act 3 a single opponent draw event fires ~10-15 duplicate
callbacks — each rebuilding the opp piles, calling `render()`, and (on the host) pushing a
**full spectatorState write**. That is k× write amplification on the exact shared WebSocket
that CLAUDE.md's trajectory-capture section flags as the MP-stall risk surface, growing
linearly with rounds played.

**Fix sketch:** store per-slot unsubs inside the MP layer; `watchOpponentDrawStates`
unsubscribes the previous watcher for a slot before re-subscribing (idempotent), or subscribe
once per game and route through the callback (guards already handle staleness).

### H2 — Two drifted spectator-state serializers

`MP.pushSpectatorState` builds its own inline snapshot (`play.js:342`) while `AI_SPEC.push`
uses `buildSpectatorState` (`play.js:941`). They have **already drifted**: `quickStartMode` /
`showdownTallies` exists only in `buildSpectatorState`. (`pioneerMode` and `hiddenHerdMode` were also listed here; both modes were removed from the game in July 2026 and no longer appear in the snapshot.)
Any C7/C4 enrichment applied to one and not the other recreates the class of bug this audit
is full of. Make `MP.pushSpectatorState` call `buildSpectatorState`.

### H3 — Rejoin during `score`/`showdown` is a dead end

`startGame`'s rejoin branch handles `draw`, `buy`, `gameOver`; anything else ("score" — a
~1s+ window pushed every round boundary; "showdown" — the whole ~30s+ animation) falls to
`setMessage('Waiting for the current phase to begin…')` with **no listener and no retry**
(`fetchSpectatorState` is a one-shot get). The player is stuck until they manually refresh
again. **Fix sketch:** replace the one-shot fetch fallback with an `onValue` on
`spectatorState` that resumes as soon as a resumable phase arrives (and treat `showdown` like
`gameOver` — render the static board).

### H4 — Quick Draw draft has no recovery path

During the draft there is **no spectatorState** (first push happens at Act 2's `startRound`),
`waitForDraftRoundPicks` has **no force valve**, and the rejoin flow explicitly dead-ends
("Could not restore game") for an evicted player because state is null while `MP.recovered`
is true. Net: a mobile player whose tab is evicted mid-draft is locked out, the rest of the
table waits on their pick with no recovery button, and the game dies only via the 5-minute
disconnect countdown. A desktop F5 mid-draft falls through to a *fresh* start and re-drafts —
mostly self-healing (seeded packs; others ignore overwritten picks via their `fired` flags),
but the refresher can re-pick differently, temporarily diverging their local deck until
drawState syncs paper over it.

**Fix sketch:** (a) arm `armForceContinue` around the draft wait with a host force that
pushes a default pick (e.g. `aiDraftPick` on the stuck player's pack) to `draftPick/{round}/
{slot}`; (b) let the marker/recovered rejoin fall through to the draft when the game node
shows `quickStartMode && no spectatorState` instead of dead-ending — the seeded draft +
existing `draftPick` values make the replay converge.

### H5 — Host fresh-start fallthrough can rebuild Act 1 over an existing one

The marker-set/no-spectatorState fallthrough in `startGame` (comment at `play.js:2583`:
"setupAct will no-op safely on the host because no actSetup exists yet") is wrong in one
window: `setupAct` pushes `actSetup` **before** the first spectatorState ever lands
(`pushSpectatorState` refuses `phase==='start'`; the first accepted push is in `startRound`).
A host refresh inside that gap re-runs `setupAct(1)` with a **fresh `Math.random` shuffle** →
new pyramid pushed as actSetup #2 → guests (who consumed #1, `fired` flag) keep pyramid A
while the host plays pyramid B. Sub-second window on desktop, seconds on slow mobile.
**Fix sketch:** on the fallthrough, `get(actSetup)` first — if one exists for act 1, consume
it (build from its cardIds) instead of rebuilding.

---

## Notes / accepted-model tensions

- **N1:** `host.js` arms `onDisconnect(gameRef).remove()` for the whole waiting room — a
  momentary wifi blip while waiting for players deletes the lobby and every joined guest gets
  "The host cancelled the game." Consider a `status:'hostDropped'` marker + grace instead.
- **N2 (abuse):** the identity URL (`code/slot/name`) is a bearer credential by design
  (eviction recovery), and `games/$code` is world-writable ("code = access token"). But codes
  are **published** — `liveSummary` lists every active game for the Live Now feature. Anyone
  can therefore join any live game as any slot (or write arbitrary game state) with zero
  friction. Accepted for a friendly-fire audience; worth revisiting if the game grows (e.g. a
  per-slot secret issued at claim time, checked client-side — rules can't enforce it, but it
  raises the bar).
- **Force-continue residue (design):** all three force paths trade a softlock for potential
  divergence (R2). That's the right trade for a 30s-stuck table, but pairing them with the
  reconciliation below would make them near-lossless.

---

## Verified clean (checked, held up)

- **Empty-array omission (bug #11 class):** every synced array that can be empty is read with
  `(x || [])` — drawState hand/deck/discard (both watcher sites), spectatorState
  hand/deck/discard/buyOrder in `reconstructG`, solo-save restore. No remaining
  `!== undefined` gates on arrays.
- **Per-slot RNG independence:** each AI slot's LCG stream is consumed only by that slot's
  shuffles, so the per-client `G.players` ordering (local player first) cannot skew streams.
  Human shuffles use `Math.random` and are synced by outcome, never by seed.
- **Stale-signal guards:** `drawState`/`drawDone`/`buyAction`/`buyOrder` all stamp **round +
  act** and every consumer checks both (the bug #2 class is closed everywhere, including the
  force-path writes).
- **`resetRound` clears own slots only** (fast-opponent done signals survive), and the
  awaited `signalDrawDone` + retry (bug #6) and no-bust-shortcut (bug #10) are intact in both
  draw entry paths (`startRound`, `resumeDrawPhase`).
- **Bug #16 no-op advance** is in place in `mpOpponentBuyTurn` for both buy and burn.
- **Tiebreaker determinism:** `determineBuyWinner` sorts tied candidates by slot before the
  seeded pick; all narrowing keys are order-independent; AI denial-burn leader tiebreak keys
  on slot index, not local player order. `aiDraftPick` ties break by card id. Modern-engine
  `sort()` stability makes the look3 reorder deterministic.
- **Showdown totals are immune to intra-round hand staleness** (pile-union invariance): only
  cross-round mutations (buys, swaps — see C1) can diverge final counts.
- **Act-boundary flow:** `clearActSetup` → `pushActSetup` with act-matched consumption
  converges for slow guests; draft pack dealing is seeded and pick application id-checked.
- **Lobby atomic slot claim** (transaction on the name node) is sound, including duplicate
  names; `data.status !== 'waiting'` blocks late joins.

---

## Systemic recommendation (ties into bug #16's open follow-up)

Nearly every divergence family above shares one root: **after the initial broadcast, nothing
ever reconciles.** The host already pushes a complete authoritative snapshot
(`spectatorState`) after every action; guests only read it on rejoin. Three changes, in
order of leverage:

1. **Make the snapshot complete and single-sourced** (C4 + C6 + C7 + H2 in one pass): unify
   on `buildSpectatorState`, add `aiRngSeeds`, entitlement flags, `drawsDone`, and push at
   the post-increment chokepoint (`processBuyTurn`). This alone makes rejoin lossless — the
   single most bug-productive surface in the project's history.
2. **Guest reconciliation at round boundaries:** at `startRound`, non-host clients fetch
   `spectatorState` and diff their pyramid (`removed`/`faceUp` flags), AI stats, and AI RNG
   seeds against it, adopting the host's values on mismatch (log loudly when this fires — it's
   the divergence telemetry the project currently lacks). This converts every "silent
   divergence for the rest of the game" finding (C1 fallout, C5, R2 residue) into a
   one-round blip, and is the self-healing mechanism bug #16's follow-up asked for.
3. **Sequence the buyAction channel** (R1): append-only per-turn keys, no clears.

Items 1 and 3 are small, mechanical changes. Item 2 is the real design work — but it is far
smaller than it sounds because the authoritative snapshot and the reconstruction code
(`reconstructG`) already exist; it's a scoped re-application of pieces of that path at a safe
phase boundary.

**Status (July 3 2026): items 1 and 3 are SHIPPED** (snapshot enriched + single-sourced +
pushed post-increment; buyAction sequenced with clears removed). **Item 2 — guest
reconciliation at round boundaries — is the remaining open work** and the recommended next
MP investment: it converts any residual divergence (force-race leftovers, unknown-unknowns)
into a one-round blip and doubles as divergence telemetry.
