# Dead Code Inventory — post single-Store rework (July 2026)

The July 2026 rework deprecated 30 of the 84 Store cards. Every special mechanic except
**Explosive-for-$** (`burn_to_use`) and **Draw 4** (`draw4`) now lives only on deprecated
cards, so the code that implements them is **unreachable in a new game**.

**It was deliberately left in place.** Removing it is a separate, later commit — the
mechanics are tangled into the MP protocol (buy entitlements, deferred cross-player
effects, the extra-buy `seq`), and those paths carry hard-won rejoin/softlock invariants
(see `docs/MP_PROTOCOL_AUDIT.md` and CLAUDE.md bug #17). Rip it out only when the new
build is stable, one mechanic per commit, with an MP smoke test after each.

## Why the cards stay in `STORE_CARDS`

Deprecated cards keep their entries (flagged `deprecated: true`) so `getCardById` still
resolves them when spectating, rejoining, or reviewing a **pre-gameV-3 game**. Do not
delete the card entries themselves — only the effect machinery below is removable.

`getActPool()` filters on `!c.deprecated`, so none of these can reach a live Store.

## Removable mechanics

| Special | Dead cards | play.js entry points | MP / state it owns |
|---|---|---|---|
| `swap_revealed` | 4 | `gatherSwapCandidates`, `openSwapModal`, `applySwapLocal`, `_pendingSwap` | optional `swap` field on `pushBuyAction`; the apply-before-buy ordering in `mpOpponentBuyTurn` |
| `copy_next` | 7, 20 | the `copy_next` branches in `playerDraw` / `aiDrawPhase` (~16 call sites — the widest blast radius) | none |
| `burn_buy_first` | 14 | `handleBurnBuyFirst`, `player.hasBuyBurnFirst` | `claimBuyFirst` + `games/{code}/buyFirstClaim` (the whole 5-8P once-per-round priority claim), `hasBuyBurnFirst` in `buildSpectatorState`/`reconstructG` |
| `extra_buy` | 21 | `handleExtraBuy`, `advanceOrExtraBuy`, `player.hasExtraBuy` / `extraBuyUsed` | `buyAction` **`seq: 2`** (the extra-buy action); entitlements in `buildSpectatorState`/`reconstructG` |
| `replay_discard` | 23 | `handleReplayDiscard` | trajectory `replay_pick` sub-choice (`kind:'s'`) |
| `dollar1_other` | 24 | the `dollar1_other` branch in `applyCardEffects` | `dollar1OtherPlayed` counters, the deferred-grant block in `onDrawPhaseComplete`, `dollar1OtherPlayed` on `drawDone` + `buildSpectatorState`/`reconstructG` |
| `look3_rearrange` | 19 | `handleTrashLook3`, `handleLook3` | none |
| `look3_immediate` | 31 | `handleLook3` | none |
| `2cow_if_first` | 3, 15 | the `isFirstCard` branch in `applyCardEffects` | none |
| jail (`burn_to_use` with −1 bandit) | 39, 50 | no code of its own — but the **jail-activation logic** in the Draw-4 loops (play.js + `sim/personality-engine.js`) now has no card to fire on | none |

## Still live — do NOT remove

- `burn_to_use` — cards 5, 16, 22 (Explosive $3) and 70, 77, 78 (Explosive $2).
- `draw4` — cards 54 (3 cows + Draw 4), 84 and 85 (−1 Bandit + Draw 4).
  84/85 are **passive** −1 Bandit, not Explosives.
- `forcedDraws` and the whole between-draws activation window: Draw 4 still uses it.

## Removal order (lowest risk first)

1. `2cow_if_first`, `look3_immediate`, `look3_rearrange` — self-contained, no MP surface.
2. `copy_next` — large but MP-free; the risk is breadth, not coupling.
3. `replay_discard` — plus its trajectory sub-choice.
4. `swap_revealed` — removes the `buyAction.swap` field.
5. `extra_buy` — removes `seq: 2`; **re-read the `seq` invariant in CLAUDE.md bug #17 first**, since receivers match on round+act+seq.
6. `dollar1_other` — removes the deferred-grant block; audit C6 exists because of this mechanic, so it goes last.
7. `burn_buy_first` — also retires `claimBuyFirst`, `buyFirstClaim`, and the 5-8P priority rule in the rules page.

Anything removed from `buildSpectatorState` must be removed from `reconstructG` in the
same commit, and vice versa — a mismatch is a silent rejoin corruption, not a crash.

## Also now unreachable

- **`sim/`** models the pre-rework game entirely (old triangle Store, old card pool, acts).
  It is stale, not dead — see the AI note in CLAUDE.md and `sim/AI_DISTILLATION_PLAN.md`
  Phase D0.
- **Debug scenarios** in `applyDebugScenario` that exercise the dead specials still work,
  because `getCardById` resolves deprecated cards. They are the cheapest way to
  regression-test a mechanic right before deleting it — use them, then delete them with
  their mechanic.

  Since the July 2026 debug-page audit, `debug.html` groups them under **Retired
  Mechanics** — dimmed, dashed-bordered, `RETIRED`-tagged, and clearly labelled as
  unreachable in a real game. They are deliberately **left clickable**: making them
  `disabled` would break the one job they still have (a last regression run before
  deletion). 20 of the 32 scenarios are retired; the live set is only `burn_to_use` and
  `draw4`.

  Deleting a mechanic means deleting **its button in `debug.html` and its `SCENARIOS`
  entry in `play.js` together**. A button pointing at a missing key is caught loudly now
  (`applyDebugScenario` returns false and the caller aborts) rather than silently starting
  an unplayable game that still writes gameHistory/traj records — but keeping the two in
  step is still on you. Note `buy_phase_*` is NOT retired: those cards (77/78/16/22) are
  live Explosives.
