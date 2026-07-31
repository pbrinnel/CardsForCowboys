# Card Power Re-Ranking & Rebalance Plan (post single-Store rework)

**Status: DRAFT PROPOSAL — July 2026, not started.** Written to answer one question: *after the
single-Store rework and the card cull, is any card drastically over- or under-powered?*

Prerequisite reading: [`TUNING.md`](TUNING.md) (the workflow) → this doc. This plan **supersedes
Phase D0** in [`AI_DISTILLATION_PLAN.md`](AI_DISTILLATION_PLAN.md), which is itself stale (see §3).

---

---

## 0. RESULTS — R1-R4 complete (July 2026)

**Scope decision (PB):** balance for **4P only**; other counts are a later check. 4P is also the
cleanest count to measure — it deals all 18 live cards of every act in every game, so availability
is universal and non-purchase is a genuine choice. All card numbers below: **4P, 25,000 deals per
card, win% baseline 25%.**

> **CORRECTION (PB caught this).** The first run of these numbers was invalid. `applyShowdown` in
> `sim/personality-engine.js` awarded `floor(totalDollars / 2)` bonus cows at the Showdown — **a
> rule the live game has never had.** `play.js` [startShowdown](../src/play.js) counts printed
> **Cows only**; leftover dollars are worth nothing. The phantom bonus inflated every
> dollar-bearing card. Pre-existing sim code that I took as correct instead of auditing — the port
> checked geometry and structure but not the award rules.
>
> Fixed in `applyShowdown` and in `search-ai.js`'s `estFinalHerds` (same phantom term, so the
> search's value function over-valued holding cash). Golden regenerated; everything below is
> re-measured. New guard: **`node sim/test-scoring-parity.js`** reads play.js's own scoring
> expressions and fails if either engine's award rules drift again.
>
> The correction **strengthened** the finding it was supposed to threaten: dollar cards had been
> measured *with* a bonus they never get, and still lost badly. Removing it dropped them a further
> ~1.6pp and lifted `corr(cow-per-cost, win%)` from 0.18 to **0.51**.

### The headline: dollars are systematically overpriced against cows

| | mean win% | mean buy% |
|---|---|---|
| **cow-bearing cards** (n=31) | **33.4%** | 52.7% |
| **dollar-only cards** (n=21) | **18.4%** | 54.5% |

The AI buys them at the same rate; they perform **15pp** apart across a 25% baseline. The clearest
single comparison is at **identical cost 8, identical act, identical buy round (~14.5)**:

| card | print | win% |
|---|---|---|
| card_58 / 59 / 45 | 4 cows | **38.3-38.8%** |
| card_9 | 2 cows + $3 | 12.9% |
| card_73 / 89 | $4 | **4.9-5.2%** |

**A 33.8pp spread at the same price**, and card_73/89 win barely a fifth of baseline. The mechanism
is exact and provable from the rules, not a sim artefact: **dollars do not score at all.** A
card's only direct contribution to the final herd is its printed Cows, so `$4` is worth exactly
zero herd and `4 cows` is worth four. Dollars are purely purchasing power — and card_73/89 sit in
the act-3 back tier, bought at round ~14.5 of ~18, when the Store is nearly gone and there is
almost nothing left to convert them into. They are close to a dead card at full price.

`corr(cow-per-cost, win%) = 0.507` — cows-per-cost is now the single best printed predictor of
winning, which is itself the finding: **the cost curve prices dollars as if they scored, and they
don't.**

### The four pre-registered suspects: 1 confirmed, 2 refuted, 1 benign

**§4's headline suspect (card_43/51/57, 5 cows for cost 4) is REFUTED — it is a trap, not a bomb.**
The printed curve said 2.5× underpriced. Measured, at cost 4 / act 2, holding cost and timing fixed:

| card | print | win% |
|---|---|---|
| card_18 | 2 cows | 38.6% |
| card_41 | 1 cow + $2 | 31.9% |
| **card_43** | **5 cows + 2 bandits** | **22.9%** — *below the 25% baseline* |

+2 permanent bandits costs more than 3 cows of value. With no between-act reshuffle they never
leave your deck. **Buying it makes you less likely to win than average.**

And the same print splits on *timing* — this is the sharpest result in the run:

| card | act | bought at round | win% |
|---|---|---|---|
| card_43 | 2 | 8.4 | 22.9% |
| card_51 | 2 | 8.5 | 22.6% |
| **card_57** | **3** | **13.7** | **32.9%** |

Identical card, +10pp, driven entirely by *when* it can be bought. Early bandits have ~10 rounds
left to bust you; late ones have ~4. **The card is not mispriced — it is mispriced *early*.**

**Expensive late act-3 cows: REFUTED, opposite of predicted.** They were predicted to underperform
(bought too late to draw). They are among the best cards in the game (38%+) — and the AI barely
buys them (34-35%). card_32 (4 cows, cost 9) wins 35.6% on a **21.7% buy rate — the least-bought
card of all 54.**

**Explosives: CONFIRMED as a problem — but it is the AI, not the card.** The six `burn_to_use`
cards are **buy-rate ranks 1-6 of 54** (89-90%) and **win-rate ranks 38-45** (18.7-21.2%). Largest
buy/win divergence in the game. They are consumed on use, so they contribute **zero** at Showdown,
and `scoreCard` hands `burn_to_use` a flat **+2** on top of `dollarWeight`. The AI is spending ~90%
of its early purchasing power on cards that make it lose.

**Tripled `draw4`: benign.** card_54 (3 cows + draw4) is strong and popular (buy 80.8 / win 34.9).
card_84/85 (−1 bandit + draw4) sit near baseline on a low buy rate (27 / 28) — if anything
underused. No variance problem visible.

### Residual flag rule — 11 distinct stat-lines flagged (20 cards before collapsing duplicates)

Overpriced: `card_73/89` ($4, **−24.3pp**) · `card_9` (−16.8) · `card_52/53/26` ($3, −14.5) ·
`card_86` (−13.4) · `card_90` (−10.8) · `card_70/77/78` (Explosive $2, −9.5).
Underpriced: `card_18` (+11.1) · `card_28/29` (+10.3) · `card_45/58/59` (4 cows, +10.2) ·
`card_72/88` (+9.6) · `card_37/40/48/49` (2 cows, +8.3).

### Tiers did NOT move (R3) — no `DIFFICULTY_TIERS` change needed

| | 2P win% (new / old) | 4P win% (new / old) | tier |
|---|---|---|---|
| drifter | 69.9 / 70 | 41.9 / 41 | Hard |
| enforcer | 69.8 / 70 | 40.1 / 41 | Hard |
| deputy | 68.4 / 68 | 38.0 / 38 | Hard |
| rancher | 66.0 / 64 | 38.3 / 34 | Hard |
| prospector | 65.0 / 65 | 34.9 / 35 | Hard |
| outlaw | 47.5 / 43 | 17.8 / 16 | Medium |
| wild_bill | 43.2 / 40 | 17.8 / 14 | Medium |
| sheriff | 39.6 / 37 | 12.1 / 10 | Easy |
| banker | **27.8** / 38 | **3.7** / 9 | Easy |
| greenhorn | 2.7 / 6 | 0.0 / 0 | Easy |

The Hard/Medium/Easy bands survive the rework intact and **`gamesetup.html`'s `DIFFICULTY_TIERS`
needs no edit** — a useful null.

One real move: **banker fell hard (2P 38 → 27.8, 4P 9 → 3.7).** That is the scoring fix, not the
rework — banker is the deliberately dollar-first bot, so removing the phantom $-to-herd bonus hit
it hardest of all ten. It was already the designed-to-lose Easy bot, so nothing needs doing; but
note that `banker` no longer "straddles the easy/medium boundary" as `CLAUDE.md` has described it
since June. It is now unambiguously Easy, second only to greenhorn.

### Structure (R2) — all invariants hold

Row/width/total correct at all 7 counts, act tiers exact and even, no deprecated card ever dealt,
every game consumes the whole Store, covering census reproduces the live one-overhang-per-row
invariant. Golden regenerated (1800 games, now including 5/6/8P); full reproduction gate green.

Two structural numbers that were not previously known, both measured:

- **~48% of the Store is BURNED, not bought** (every count). A player who cannot afford anything
  burns, and after the act-1 tier is eaten the cheapest cards on offer cost 4+. Verified faithful
  to `play.js` — live uses the same affordable-else-burn fallback.
- **Games run ~18-23 rounds** (4P median 18) vs the old fixed 15, and players end with **~16-card
  collections** vs ~15. Cross-check: the only three real `gameV >= 3` games on record are 2P at
  **17, 22, 23 rounds** — inside the sim's range, but n=3 is a smoke check, not a validation.

### R5 — CAUSAL results (forced-buy counterfactual)

`sim/card-counterfactual.js`. At 11,784 sampled buy decisions we held the state, the buyer and
the alternatives fixed and varied only **which card was taken**, then rolled the rest of the game
out under fair information. **3,026,064 rollouts**, 4P, pro (Hard) field, N=48 per candidate.

- **advantage** = herd margin vs the *average of the other affordable cards at that same decision*.
- **vsBurn** = margin vs burning instead. **Negative means the card is not worth taking at all.**

Because the purchase is forced, this is immune to both R4 confounds (who bought it, and whether
the AI judged the situation well).

> **⚠️ RE-MEASURED under the corrected AI (July 2026). One headline claim below did NOT survive.**
> Everything in this R5 section was first measured with the pre-fix AI. Re-running both passes
> after the `banditPenalty` + drifter-denial changes:
>
> | | pre-fix AI | corrected AI |
> |---|---|---|
> | cow-bearing advantage | +1.08 | **+1.16** |
> | dollar-only advantage | −0.85 | **−0.73** |
> | Explosives advantage | −1.72 | **−1.13** |
> | **card_43 vs burning** | **−1.59** | **+0.33** |
> | **card_51 vs burning** | **−1.80** | **+0.18** |
>
> **"The only two cards worth less than nothing" is now FALSE — no live card is worse than
> burning.** That claim was partly an artefact of the old AI *compounding* the mistake: having
> bought 2 permanent Bandits it would go on buying more bandit-laden cards. A competent
> continuation contains the damage, so the cards land marginally above burning.
>
> What survives, and is now the stronger statement: **card_43/51 are still the two worst cards in
> the game by causal advantage (−2.34 / −2.45), and the cow/dollar gap is unchanged.** The
> ~15pp group gap held under a materially better buyer, which is the robustness check that
> matters for it. The four act-1 `2cow/cost5` cards remain the best in the game (+3.98 to +4.19).
>
> The R4 buy-rate shifts are also worth recording — they show exactly where the AI changed its
> mind: `card_43/51` **−19pp**, `card_57` −15pp, and the bandit-negating `card_84/85` **+24/+23pp**
> (once a Bandit is priced correctly, a card that REMOVES one is worth far more). `card_43`'s
> *win%* fell 22.9 → 11.0 even as the AI bought it less — selection, not a change in the card:
> with the Hard bots fixed, the remaining buyers are mostly the un-fixed Medium/Easy bots.

#### card_43 / card_51 — the two worst cards in the game
*(originally reported as "worth less than nothing" — see the correction above)*

| card | print | advantage | vsBurn |
|---|---|---|---|
| **card_43** | 5 cows + 2 bandits, cost 4, act 2 | **−4.55** ±0.21 | **−1.59** |
| **card_51** | 5 cows + 2 bandits, cost 4, act 2 | **−4.77** ±0.23 | **−1.80** |

Every other one of the 54 live cards has a positive vsBurn. These two are strictly worse than
burning a card and taking nothing — causally, at 400+ observations each. R4's correlational
result was not selection bias; **the card is genuinely a trap.**

And the timing split survives the causal test, at the same magnitude:

| card | act | bought at round | advantage | vsBurn |
|---|---|---|---|---|
| card_51 | 2 | 7.8 | −4.77 | −1.80 |
| card_43 | 2 | 8.1 | −4.55 | −1.59 |
| **card_57** | **3** | **12.6** | **−1.41** | **+1.71** |

Identical print. Buying those 2 permanent bandits around round 8 costs **~3.3 more herd** than
buying them around round 13 — enough to flip the card from "worse than nothing" to "fine".

#### The dollar line: dominated everywhere, but not dead

| group | advantage | vsBurn |
|---|---|---|
| cow-bearing (31 cards) | **+1.08** | +5.87 |
| dollar-only (21 cards) | **−0.85** | +3.36 |
| — of which Explosives (6) | **−1.72** | +2.32 |
| — of which plain $ (15) | −0.45 | +3.83 |

Dollar cards are worth taking over nothing (+3.36 vs burning) but are **the worst affordable
choice at essentially every decision**. The Explosives are the worst of all at −1.72 — and R4
showed the AI buys them at **90%, the highest rate in the game**. That is now confirmed causally
as an AI-scoring fault, not a card fault: `scoreCard` gives `burn_to_use` a flat +2.

#### The decisive test: does a STRONGER player rescue dollars? No.

The one thing that could have exonerated the dollar line is that its value is purely instrumental
— maybe the shipped AI just spends badly. So the whole pass was re-run with the focal seat playing
the **Monte-Carlo search** (the shelved teacher) for every subsequent buy, i.e. the card's value
*to a materially better player*:

| group | default continuation | **search continuation** |
|---|---|---|
| cow-bearing | +1.08 | **+1.18** |
| dollar-only | −0.85 | **−0.96** |
| Explosives | −1.72 | −1.46 |

**Dollars do not improve under stronger play — they get marginally worse.** A better buyer converts
cows into wins better, and cannot convert dollars into anything the cow cards don't already give
more directly. This is the answer to R5's question 1: **the dollar line is genuinely overpriced.
It is not an AI-spending artefact.**

The same run also settles question 2 the other way from "AI's fault": card_43/51 get **worse** under
stronger play (−4.55/−4.77 → **−5.88/−7.10**, vsBurn −1.59/−1.80 → **−4.58/−4.36**), because a
player who is otherwise playing well has more to lose from two permanent bandits. Under search
continuation even card_57 turns negative vs burning (−1.52). **The penalty is intrinsic to the
card, not to the AI mishandling it.** (Smaller sample — n=30-50 per card, ±0.6-1.1 — but the
direction is unambiguous and consistent with the large default-continuation run.)

#### The AI's blind spot, quantified

`card_32` (4 cows, cost 9) has a causal advantage of **+2.38** — 8th best card of 54 — on the
**lowest buy rate in the game (21.7%)**. The four act-1 `2cow/cost5` cards top the whole table at
**+3.56 to +3.75**. The AI is leaving the strongest cards on the board.

### R6 — DECISION: no card changes (PB, July 2026)

> **🚫 CARD STATS, COSTS AND ACTS ARE NOT TO BE CHANGED.** The card-change options below (C1, C2)
> were considered and **declined**. Do not re-propose them in a future session without PB raising
> it first — the analysis that produced them is already recorded here, so re-deriving it is waste.
>
> **This does not invalidate the findings**, and they are kept below deliberately. They remain the
> best evidence available for three things: (1) writing rules/strategy copy that tells players the
> truth about the cards, (2) tuning the AI, which is now the *only* balance lever available, and
> (3) any future print run, if one is ever on the table.
>
> **Consequence worth stating: the AI fixes below are now the whole of R6.** With the card set
> frozen, AI scoring quality is the only thing that can change how the game plays.

**Sequencing matters, and it is not obvious.** Two findings are AI faults, not card faults, and
every card number is measured *through* the AI. Repricing cards to compensate for an AI bug would
bake the bug into the physical game. So:

**AI fixes — DONE (July 2026). Code only, no card touched, no `gameV` bump.**

Before acting, preference was separated from affordability: *conditional on a card being available
AND affordable at a buy turn, how often is it the one taken?* `simulate.js`'s buy% conflates "the
AI didn't want it" with "the AI could never afford it", and that distinction changed both verdicts.

| # | fix | result |
|---|---|---|
| **B1** | **`banditPenalty` was ~12× too low on every Hard bot** — the AI took `card_43`/`card_51` **93-95%** of the time it could afford them, the only two cards causally worse than burning | ✅ **SHIPPED. Up to +18pp at 4P — the largest AI gain measured on this project.** Optimum is **`banditPenalty ≈ 2.1 × cowWeight`**, landed on independently by all five Hard bots. `card_43` picks fell **93.1% → 14.7%**, `card_51` **95.3% → 13.5%**, while `card_18` (2 cows, same cost, +2.31 causal) rose 55.0% → 61.5% |
| ~~A1~~ | Explosive `+2` bonus | ❌ **NOT SHIPPED — swept and refuted.** {2,1,0,−1,−2,−3} moved mean 4P win% <1pp. At cost 3 an Explosive is often the only affordable card, and scoring cannot change a forced choice. Left at +2 |
| ~~A2~~ | "AI undervalues act-3 cows" | ❌ **REFUTED — my error.** Conditional on being affordable, act-3 cows are picked **70-78%**, the *highest* group in the game. `card_32`'s 21.7% buy rate was pure unaffordability (cost 9), not misvaluation |

**Post-fix tiers** (2P overall % / 4P focal %): enforcer 74/43 · rancher 73/44 · drifter 72/39 ·
deputy 69/39 · prospector 65/31 ‖ outlaw 44/13 · wild_bill 38/10 ‖ sheriff 37/7 · banker 26/2 ·
greenhorn 3/0. Hard tier only was corrected, so the **gap to Medium/Easy widened** — the difficulty
picker is more meaningful than before, and `DIFFICULTY_TIERS` still needs no edit.

**Note for a future R4/R5 re-run:** the card measurements above were taken with the OLD, miscalibrated
AI. They are not invalidated (the counterfactual forces the buy, so it never depended on the AI
choosing well), but buy-rate and win%-when-bought figures would move under the corrected bots.

**~~Card changes~~ — DECLINED, retained as findings only.** All of these would need reprinting: the
Act is printed on the card face (bottom-right, cowboy hats) and the stats are printed art, so even
an act reassignment is not free.

| # | card | finding (still true — just not being acted on) |
|---|---|---|
| ~~C1~~ | **card_43 / card_51** (5 cows + 2 bandits, cost 4, act 2) | the **only two cards in the game worth less than burning** (vsBurn −1.59 / −1.80; −4.6 / −4.4 under strong play). The identical print in act 3 (card_57) is fine, so the fault is the act placement, not the numbers |
| ~~C2~~ | **the dollar line** (21 cards) | dominated at every price point, and a *stronger* player extracts no more from them. Dollars score nothing, and the late Store outruns player income (cheapest card on offer reaches ~$7 by round 19 while income plateaus at ~$4) |

**These two are the honest strategy of the game as printed, and are worth saying out loud in
player-facing copy rather than hiding:** buy cows over dollars at equal cost, and be wary of the
cheap 5-cow/2-bandit cards in the middle of the game. If `rules.html` or any strategy blurb ever
gives the opposite advice, it is wrong.

### Earlier notes on what R5 was for

Every number above is **correlational and measured through the AI**. The same-cost cohorts hold
cost and affordability roughly fixed and are the safest basis for a decision, but they cannot
separate "card is mispriced" from "the AI buys it in bad spots" — and the Explosive result proves
the AI *does* misjudge systematically. **R5 (forced-buy counterfactual) is now strongly motivated
rather than optional**, and it has two clearly-scoped questions to answer:

1. Is the dollar line genuinely overpriced, or does a *better* buyer convert dollars into cows well
   enough to justify the cost? (Fix differs: reprice cards vs retune `scoreCard`.)
2. Is card_43/51's negative value intrinsic, or an artefact of the AI buying 2 bandits at the worst
   possible time?

---

## 1. The question, and the shortest honest path to an answer

> "Did the new superstructure + card changes break card balance?"

Card power can only be measured by playing the game, and the only thing that can play it thousands
of times is `sim/`. **`sim/` currently models a game that no longer exists.** So the path is:

```
port the engine  →  prove the port  →  re-tier the bots  →  re-rank the cards  →  decide
     (R1)              (R2)                (R3)                (R4)              (R6)
```

There is no shortcut that skips R1. Every existing card number — `sim/results/sim-tierlist.json`,
every `cardbalance_*.csv`, the tier bands in `CLAUDE.md` — was measured on the retired triangle
board with a card pool that included 30 cards that can never be dealt again. Those files are
**historical records, not baselines**; do not diff new results against them.

**Scope dial.** R1→R4 answers the question as asked ("is anything drastically off?"). R5 (causal
counterfactual) is only needed to *prescribe* new numbers for whatever R4 flags, and only runs on
the flagged cards. Stop after R4 if nothing flags.

---

## 2. What actually changed (the delta the port has to close)

| | sim today | live game (July 2026) |
|---|---|---|
| **Store structure** | 3 separate triangles, one built per act | ONE Store, 3 act tiers, built once at game start |
| **Rows** | 5 / 6 / 7 (triangle, rows = f(numPlayers)) | 6 (2-4P) / 9 (5-8P) |
| **Row width** | 1,2,3…row (triangle) | uniform `STORE_WIDTH` 5/7/9 · 8/9/10/11, **odd rows brick-offset ½ card** |
| **Covering** | index-based (`col`, `col+1` below) | **geometry-based** (`pyramidColCenter`, \|Δx\| < 0.9) |
| **Cards dealt/game** | 45 / 63 / 84 | 30 / 42 / 54 (2-4P), 72–99 (5-8P) |
| **Per-act pool** | `minPlayers <= numPlayers` (17/21/28) | **18 live cards**, doubled to 36 at 5-8P |
| **Deprecated cards** | dealt — 30 cards that cannot appear live | filtered out by `getActPool` |
| **Round structure** | fixed 3 acts × 5 rounds = **15 rounds** | monotonic 1..N, **ends when the Store empties** |
| **Between-act reshuffle** | yes — full deck merge + reshuffle, 3× per game | **none** (decks just cycle through discard) |
| **Game end** | after act 3 round 5 | Store empty → showdown |
| **AI "act" lens** | `act` param = the current pyramid's act | `storeStage()` = act tier of the frontmost live row |
| **card_84 / card_85** | `-1 cow, -1 bandit`, no special | **`0 cow, -1 bandit, draw4`** |
| **Live specials** | 10 distinct modelled | **2** — `burn_to_use`, `draw4` |
| **Showdown tie** | raw herd, ties → lowest seat index | `resolveShowdownWinners`: cows → collection $ → card count |
| **Player counts** | 2-4P | 2-8P |

Two structural consequences worth calling out, because they change what a card *is worth*:

- **No between-act reshuffle.** Previously every deck was merged and reshuffled 3× per game, which
  periodically "reset" deck composition. Now a bought card enters the discard and cycles naturally,
  so *when* you buy a card determines how many times you actually draw it. Bandits you buy never get
  shuffled away either. This directly moves the value of expensive late cows and of any card
  carrying bandits.
- **Game length is now emergent, not fixed.** ~30 cards / ~2 removals per round at 2P lands near the
  old 15 rounds by coincidence, but it now *varies per game* and responds to burn rate. R2 must
  measure the distribution rather than assume it.

Also note **4P has no card-pool variance**: 18 live cards per act, 18 dealt per tier, so every 4P
game contains every live card and only positions vary. 2P (10 of 18) is where availability variance
lives. The two counts now measure different things — see §6.

---

## 3. Why Phase D0 in the distillation plan is not enough

`AI_DISTILLATION_PLAN.md` §D0 describes porting the **June 2026 brick rework** ("uniform 7×N rows,
rows == player count"). The **July 2026 single-Store rework** went considerably further: per-count
widths, 6/9 rows, three act tiers inside one structure, no per-act rebuild, no between-act reshuffle,
monotonic rounds, store-exhaustion end condition, a 54-card pool, and a showdown tiebreak. D0's
work-list closes maybe half the delta in §2.

**Action when this plan is green-lit:** rewrite D0 to point at this document rather than restating
it, so there is one description of the port. (Not done yet — this is a draft.)

---

## 4. Free pre-pass: the printed numbers already name suspects

This needs no simulation and is already done — it is the analytic read of the live 54-card pool. It
gives R4 a pre-registered list to confirm or refute, which is what keeps R4 from being a fishing
expedition.

**Cow price curve (cow-bearing live cards, cows per unit cost):**

| card | act | cost | cows | bandits | cows/cost |
|---|---|---|---|---|---|
| **card_43** | 2 | 4 | 5 | 2 | **1.25** |
| **card_51** | 2 | 4 | 5 | 2 | **1.25** |
| **card_57** | 3 | 4 | 5 | 2 | **1.25** |
| card_54 (draw4) | 2 | 5 | 3 | 0 | 0.60 |
| card_30 | 3 | 7 | 4 | 1 | 0.57 |
| card_45 / 58 / 59 | 3 | 8 | 4 | 0 | 0.50 |
| …18 more cards | | | | | 0.50 → 0.22 |

**The headline: `4/5cow/0$/2bandit` is printed three times and sits 2.5× above the rest of the
curve.** You pay **cost 4 for 5 cows**, while `card_45/58/59` charge **cost 8 for 4 cows**. The only
counterweight is +2 bandits (3 bandits in a round = bust), and because there is no longer a
between-act reshuffle those bandits stay in your deck for the rest of the game. That is a plausible
self-balancing penalty — and it is *exactly* the kind of claim only the sim can settle.

Sharpening it: at **4P all 18 act-2 cards are dealt every game**, so `card_43` *and* `card_51` are
guaranteed present in every 4P game, with `card_57` also guaranteed in the act-3 tier. Three copies
of the steepest card on the curve, always available. If they are underpriced, 4P is where it shows.

**Secondary suspects (pre-registered):**

1. **`card_5` / `card_16` / `card_22`** — `burn_to_use`, $3 for cost 3, the best $/cost in the game
   (1.00). One-shot: activation removes the card permanently (verified parity — both engines
   `splice` without pushing to discard), so it contributes **nothing** at showdown. Compare
   `card_52/53` (permanent $3, cost 5). Is a one-shot $3 worth 3, or is the AI simply bad at using
   them? `CLAUDE.md` already notes the Draw-4 pause "only banks $2–3" now that the jail cards are
   deprecated.
2. **`draw4` tripled** — was 1 live card (`card_54`), now 3 (`54`, `84`, `85`). `84/85` pair
   **`-1 bandit` (bust protection) with `draw4` (more draws)** — self-enabling. Draw-4 also *chains*
   (a Draw 4 pulled during forced draws decrements once then `+= 4`). Three live sources make
   chaining materially more likely than the single-card era it was balanced in.
3. **Act 3 cow cards costing 6–9** (`45/58/59/32/72/88/28/29`) — the top of the cost curve, sitting
   in the 2-row back tier that is only reached late. With no reshuffle, a cow card bought in the
   final rounds may never be drawn for round scoring (it still counts at showdown). Prediction:
   these under-perform their printed value.
4. **17 duplicate stat-lines** across the 54 live cards (e.g. `3/0/2$` appears 5×, `5/2cow` 4×).
   Not a balance fault, but it means per-card win% has correlated siblings — treat duplicate groups
   as one observation when flagging, or the same finding gets counted 3–5 times.

---

## 5. The phases

### R1 — Port the engine to the single Store ✅ **DONE (July 2026)**

Everything below landed. Verification actually run:

- `test-card-sync.js` + `test-personality-sync.js` green — and the card guard was **negative-tested**
  by re-injecting the historical `card_84` drift, which it caught.
- Geometry checked across **all seven player counts**: rows/width/total match the live table
  (30/42/54 · 72/81/90/99), act tiers land in the right rows, only the front row starts face-up, no
  deprecated card is ever dealt, and the covering census reproduces the live invariant exactly —
  **one overhang card per row with a single coverer, every other card with two**.
- Reveal cascade, and `storeStage()` stepping 1 → 2 → 3 as tiers clear.
- `runGame` completes at 2/3/4/5/6/8P; the search path (clone + fair determinization +
  `rolloutSeed`) completes too.
- Stepping `continueGame` at **every** horizon (`endOfRound` / `endOfStage` / `endOfAct` alias /
  `endOfGame`) reproduces `runGame` bit-for-bit.
- `simulate.js` runs end-to-end: all **54 live cards** get bought, **zero** deprecated leak.

**Two bugs were found and fixed during the port, both worth remembering:**

1. `endOfStage` latched the stage *after* the buy phase had already advanced it, so the horizon
   fired by luck rather than on the real tier change (2 steps/game instead of 4). Fixed with
   `state.roundStartStage`, latched in the draw phase — nothing leaves the Store during draws, so
   that is the only correct place to read it.
2. `test-resume-reproduction.js`'s `freshToFirstBuy` **hand-mirrors** `continueGame`'s pre-buy path
   and kept doing the deleted between-act reshuffle. It consumed RNG draws the engine no longer
   consumes, so all 600 seeds diverged. The helper now carries a warning that it must stay in step
   with `continueGame` **including which RNG draws it consumes**.

**Measured immediately, and it needs a decision in R2:** game length is now **~19-22 rounds**
(2P mean 21.9, 4P 19.5, 8P 16.3) against the old **fixed 15**. That follows from the end condition —
every card must be bought or burned, and busted players remove nothing — but it means each game now
has meaningfully more buy decisions than the era the bots were tuned in. Validate against real
`gameV >= 3` round counts in R2 before trusting it.

**Known-failing by design:** `test-resume-reproduction.js`'s golden check (1350/1350 diverge). The
golden freezes the retired triangle game; R2 regenerates it. Every other check in that file passes.

<details>
<summary>Original R1 work-list (for reference)</summary>


**`sim/game-core.js`**
- Replace `getNumRows` with `STORE_WIDTH` / `pyramidWidth()` / `rowsPerTier()` / `storeRows()`,
  mirroring `play.js:1429-1450`.
- Add `pyramidColCenter(row, col)` (brick offset on odd rows) and `rowAct(row)`.
- Replace `isCardCovered` with the geometry version (`|Δ pyramidColCenter| < 0.9`).
- Rewrite `buildPyramid` to build the whole Store in one pass, tiers laid **act 3 → 2 → 1**
  top-to-bottom, front row face-up.
- `getActPool(act, numPlayers)`: filter `!deprecated` (**not** `minPlayers`); double the pool for
  `numPlayers >= 5`.
- Add `storeStage(pyramid)` — act tier of the frontmost non-removed row.
- Fix `card_84` / `card_85` to `cows: 0, special: 'draw4'`.

**`sim/personality-engine.js`**
- `buildPyramidSeeded`: build the one Store (seeded), not a per-act triangle.
- `continueGame`: collapse the `nextAct` phase into a one-time `setup`; **delete the between-act
  deck merge + reshuffle**; `score` → `isPyramidEmpty(pyramid) ? showdown : (round++, draw)`.
- Thread `storeStage(pyramid)` where `act` is threaded today (`scoreCard`'s `act1DollarBonus` /
  `act3CowBonus`, `getBestCost`, `shouldDraw`, `chooseBuy`). Semantics are preserved by design —
  early Store = act-1 cards on offer — so **no personality retune is implied by the port.**
- `gameResult`: mirror `resolveShowdownWinners` (cows → collection $ → card count), and report
  genuine ties as ties instead of awarding them to the lowest seat index.
- **Horizons:** `endOfAct` no longer has a referent. Rename to **`endOfStage`** ("stop after the
  round in which `storeStage()` advances") and keep `endOfAct` as a deprecated alias — three call
  sites depend on it (`search-bakeoff.js:105/198`, `test-search-mp-determinism.js:72`,
  `test-resume-reproduction.js:216`) and it is load-bearing as a *granularity* check in the
  reproduction test.

**R1d — kill the drift class permanently.** The `card_84/85` drift is exactly the failure a guard
catches. Add **`sim/test-card-sync.js`** in the mold of `test-personality-sync.js`: parse
`play.js`'s `STARTER_TEMPLATES` + `STORE_CARDS` and fail on any difference in
`act/dollars/cows/bandits/cost/cacti/special/deprecated`. Cheaper and more durable than re-auditing
by hand next time. (Starters are currently in sync; only `img` differs, which the sim doesn't use.)

**Do NOT do in R1:** touch any personality parameter, or change any card stat. The port must be
*structure only*, so R3/R4 measure the rework and nothing else.

**5-8P (optional, cheap here).** The live geometry is now uniform and count-parameterised, so 5-8P
support falls out of the same port — only the doubled pool and the (dormant, deprecated) buy-first
claim differ. It gives the shipped 5-8P mode its first AI validation. Recommend doing it, but it is
not on the critical path for card rankings; 2P/4P carry those.
*(Done — the engine runs 2-8P.)*

**Gate:** `node sim/test-card-sync.js` and `node sim/test-personality-sync.js` both green. *(Met.)*

</details>

---

### R2 — Prove the port before trusting one number out of it

1. `node sim/gen-golden.js` — regenerate `fixtures/golden-runGame.json`. This IS the "engine
   semantics legitimately changed" case its header reserves. **The old golden is not a
   regression baseline; it is a record of the retired game.** Commit the new one as the new anchor.
2. `node sim/test-resume-reproduction.js` — must be green (`continueGame`/`cloneState` reproduce
   `runGame` bit-for-bit). This is the integrity gate for everything downstream, including R5.
3. `node sim/test-search-mp-determinism.js` — still green (uid/representation invariance).
4. **New: `sim/store-sanity.js`** — a structural report, because the port's failure modes are silent
   and would quietly corrupt every card number:
   - rounds per game (mean + distribution) per player count
   - fraction of Store removed by **buy** vs **burn**
   - fraction of games reaching stage 2 / stage 3
   - per-row availability timing: mean round at which each row's cards first become buyable
   - bust rate and mean herd per bot
   - assertion: total cards dealt == `storeRows() × pyramidWidth()`; every act tier contributes
     exactly `rowsPerTier() × pyramidWidth()`; no deprecated id ever dealt

**Optional external validation (cheap, worth it):** real `gameV >= 3` games are already in Firebase.
Pull round counts and compare against the sim's distribution — it is the only ground truth available
for whether the port's game length matches reality.

```bash
firebase database:get /gameHistory --project cards-for-cowboys > /tmp/gameHistory.json
```

**Gate:** golden regenerated, both reproduction tests green, and the sanity report plausible
(especially game length) before any card table is generated.

---

### R3 — Re-tier the bots *before* ranking cards

Card win% is measured **through** the bots. If the port moved the tier bands, the card table is
reading a field whose strength profile has shifted, and "win% when owned" inherits it. So bots first.

```bash
node sim/simulate.js                  # 2P win matrix
node sim/simulate.js --players 4      # 4P focal field
```

Expect movement. Two named risks: `maxDraw` was tuned when a 15-round game and 3 reshuffles were
guaranteed, and the aggressive bots' cap-7 bust governor was calibrated against the old bandit
density. If the Easy/Medium/Hard bands move, update `gamesetup.html` `DIFFICULTY_TIERS` **and** the
tier table in `CLAUDE.md` — and mark the win% figures as re-measured, since the current ones are
explicitly flagged UNVERIFIED.

**Do not retune personalities to restore the old bands.** Re-label first; retuning is a separate
decision with its own evidence (`draw-cap-experiment.js`, `evolve.js --coevolve`), and mixing it
into this pass makes the card numbers uninterpretable.

**Gate:** a fresh tier table, committed, with bands labelled honestly.

---

### R4 — Card power rankings: triage *(answers the question as asked)*

```bash
node sim/simulate.js --cards-only --csv --games 5000
node sim/simulate.js --cards-only --csv --games 5000 --players 4
node admin/gen-sim-tierlist.js --all --games 10000 > sim/results/sim-tierlist.json
```

**Extend `tallyCards` first** (`simulate.js:53`) — the current tally records only *which* cards a
player ended up owning, which under the new structure conflates card strength with card *position*:

- record the **row** and the **round** each card was bought at
- report `win% when owned`, plus **mean buy-row** and **mean buy-round** per card
- group the 17 duplicate stat-lines (§4.4) so one finding isn't counted 3–5 times

**Pre-registered flag rule** (set now, before seeing results, so this stays falsifiable):

> A card is flagged when, with **≥ 300 owner-observations**, its win%-when-owned deviates by
> **≥ 8pp** from the fitted trend over `(cost, act, mean buy-round)` — i.e. flag on the *residual*,
> not raw win%. Raw win% is confounded: strong bots buy cows, so cow cards inherit strong bots'
> win rates regardless of pricing.

Report the residual table for both 2P and 4P and treat **disagreement between them as a finding in
itself** — 4P has no pool variance (every card present every game) while 2P has 10-of-18, so a card
strong only at 2P is likely an *availability* effect, not a power effect.

**Gate / decision point:** if nothing clears the flag rule, the answer to the user's question is
"nothing drastically off", and this plan stops here. Write the negative result into `TUNING.md` — a
recorded null is worth as much as a change, and prevents re-litigating it.

---

### R5 — Causal card value, on flagged cards only *(prescription, not triage)*

Only if R4 flags something. Triage tells you a card correlates with winning; it cannot tell you
whether the card *caused* it or whether it's mispriced by how much. For that, hold everything fixed
and vary only the purchase.

**The machinery already exists and is sitting unused** — this is a loop over shelved assets, not new
engine work. `search-ai.js` has `cloneState`, `determinizeHiddenDecks` (fair-info hidden-deck
sampling), `applyFocalTurn`, `herdMarginValue`; `continueGame` runs to `endOfGame`.

**`sim/card-counterfactual.js`** (new):

1. Run pro-field self-play; at each buy decision where a flagged card is available and affordable,
   snapshot the state.
2. For each candidate `c` in the affordable set: `cloneState`, force-buy `c`, determinize hidden
   decks, roll out to `endOfGame` **N times**; value = mean `herdMarginValue` for the focal seat.
3. Card advantage = `value(c) − mean(value over the candidate set)` — a **regret-relative** score.
4. Aggregate per card, then regress advantage on `cost`. **A card is mispriced iff its advantage
   sits far off the cost trend line** — and the vertical distance converts directly into a cost or
   stat adjustment. That is the actionable output rebalancing needs.

**Config:** fair determinization ON (mandatory — [[feedback-ai-human-info-only]]), default opponent
model, `endOfGame` horizon, start **N=64** and scale only if the per-card CI is too wide to rank.
Restricting to flagged cards keeps this to minutes-to-hours offline, not the full-corpus cost of the
distillation plan's D1.

**Bonus, free:** this same tool answers the `card_43/51/57` question directly — does +2 permanent
bandits actually pay for +1 cow at half cost? — by comparing forced-buy rollouts of `card_43`
against the `card_45/58/59` line from the same states.

---

### R6 — Decide and apply

For each confirmed mispriced card, in this order of preference:

1. **Change `cost`** — smallest blast radius, no art change, no rules text change.
2. **Change stats** (`cows`/`dollars`/`bandits`) — needs a **card-art change** and touches the
   physical game, so it is a real-world cost, not just a code edit.
3. **Deprecate** — the rework already established the pattern (`deprecated: true`, kept for
   historical rendering). Only for a card that can't be priced into balance.

Then, per `TUNING.md`'s checklist plus the rework's own rules:

- edit stats in **both** `play.js` `STORE_CARDS` and `sim/game-core.js`; `test-card-sync.js` (R1d)
  now enforces this
- **bump `gameV` to 4** and add the row to the `gameV` table in `CLAUDE.md` — any card-stat change
  is by definition a game-content change, and the trajectory reconstructor refuses to replay across
  a `gameV` mismatch, which is what keeps the human benchmark from silently rotting
- keep each act at exactly **18 live cards** (`getActPool` slices `rowsPerTier() × width` from it;
  4P consumes all 18)
- if art changes: `data/` CSV + `assets/cards/` + `rules.html` if any rules text moves
- re-run R2 → R4 to confirm the fix landed and didn't move anything else

---

## 6. Metric notes (why the old card table is weaker now)

Three reasons `win% when owned` degraded under the rework, all handled above:

1. **4P lost its pool variance.** All 18 act cards are dealt every 4P game, so `owners[id]` measures
   *"was it bought"* — a choice — not *"was it available"*. Non-purchase is now informative in a way
   the metric doesn't model. 2P keeps availability variance (10 of 18).
2. **Row position became a strong confounder.** The Store is eaten front-to-back and never rebuilt,
   so the row a card is dealt to determines *when* it becomes buyable, across the whole game rather
   than within one act. Hence the buy-row/buy-round stratification in R4.
3. **It was always correlational.** Cow cards inherit the win rate of the bots that favour cows.
   Only R5's forced-buy counterfactual separates "strong card" from "card strong bots like".

---

## 7. Command reference

```bash
node sim/test-card-sync.js                  # R1d — NEW: card DB drift guard
node sim/test-personality-sync.js           # R1  — existing guard (currently green)
node sim/gen-golden.js                      # R2  — regenerate the golden (new anchor)
node sim/test-resume-reproduction.js        # R2  — engine integrity gate
node sim/test-search-mp-determinism.js      # R2  — MP invariance
node sim/store-sanity.js                    # R2  — NEW: structural + game-length report
node sim/simulate.js                        # R3  — 2P re-tier
node sim/simulate.js --players 4            # R3  — 4P re-tier
node sim/simulate.js --cards-only --csv --games 5000     # R4 — card table
node admin/gen-sim-tierlist.js --all --games 10000 > sim/results/sim-tierlist.json   # R4
node sim/card-counterfactual.js --cards card_43,card_51,card_57 --N 64               # R5 — NEW
```

## 8. Explicitly out of scope

- **AI distillation (Route C).** `AI_DISTILLATION_PLAN.md` D1+ stays parked. This plan delivers
  D0's replacement as a side effect, which unblocks it — but distillation is a separate decision.
- **Personality retuning.** R3 re-*labels* tiers. Retuning is its own evidence-backed pass.
- **The search AI.** Stays shelved. R5 borrows its rollout machinery as a *measurement instrument*;
  nothing ships to `play.js`.
- **Rebalancing for 5-8P specifically.** The port may cover 5-8P, but card decisions are made on
  2P/4P evidence; 5-8P plays the same 18-card pools doubled.

## 9. Risks

| Risk | Handling |
|---|---|
| Silent port bug corrupts every card number | R2's gates exist for exactly this; `store-sanity.js` asserts the structural invariants a subtle geometry bug would violate |
| Tier bands move so far the field is unrecognisable | Expected and fine — re-label in R3, don't retune |
| R4 flags many cards at once | Duplicate-stat-line grouping (§4.4) plus the residual-based rule should collapse most of it; if 10+ survive, that is a *systemic* pricing finding (the cost curve itself), not 10 card bugs |
| Rebalance implies card art changes | Prefer `cost` edits (§R6 order); art is a real-world cost |
| Old sim results get mistaken for baselines | Stated in §1; consider stamping the retired files or moving them to `sim/results/pre-rework/` |
| `gameV` bump forgotten after a stat change | R6 checklist; the trajectory reconstructor's `gameV` refusal is the backstop that makes this loud rather than silent |
