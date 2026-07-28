# Rules — what's worth doing next (July 2026)

Supersedes the ranked fix list in [`RULES_PAGE_AUDIT.md`](RULES_PAGE_AUDIT.md), which was written
before the printed-insert constraint existed. The audit is still the scorecard; this is the plan.

**Status:** 23 ✅ / 0 ⚠️ / 0 ❌ of 23 checks — the uncovering diagram closed the last one. Fixes 1–6, the full sweep, the annotated card
anatomy, and the parity cut are all shipped. The one open item is the **uncovering diagram** —
the covering/reveal rule is still taught in words only, and it needs art.

**Format decision: parity.** One ruleset, identical in print and on the web. `rules.html` is now
**1,061 words / 6 sections**, ≈**9.5 print panels** against a cross fold booklet's 8 — see
"Re-measured July 2026" below for where that goes and how to close the gap.

---

## 1. The original measurement (superseded — see §2 "Resolved")

`rules.html` as it stood *before* the sweep and the parity cut, counted in the browser. Kept
because the per-section breakdown is what showed where the words actually were:

| Section | Words | Visuals |
|---|---:|---|
| Sequence of Play | 450 | — |
| Symbols on Cards | 247 | 6 symbol images |
| Setup | 192 | 10 card images, 1 table (7 rows), 3 Store diagrams |
| Objective | 186 | — |
| Card Clarifications | 91 | — |
| Errata | 84 | — |
| Strategy Tips | 66 | — |
| Card Backs & Suits | 55 | 3 card-back images |
| 5+ Player Rules | 51 | — |
| Variants | 13 | — |
| **Total** | **1,435** | **19 images + 1 table + 3 diagrams** |

## 2. Space math for the real format options

Two families are on the table:

- **Cross fold booklet**, 100×100mm folded, printed both sides → **8 panels**, and it opens out to a
  **200×200mm spread on each side**.
- **Poker-size folds**, 2.5×3.5in (63.5×88.9mm) folded → **bifold 4 / Z fold 6 / accordion 8** panels.

Estimates assume 8–8.5pt body type on 1.3 leading (about as small as stays comfortable for rules),
~0.5em average character width, and 5–7mm margins.

| Format | Panels | Live area / panel | Pure text / panel | Realistic / panel | **Total budget** |
|---|---:|---|---:|---:|---:|
| **Cross fold booklet** 100×100mm | 8 | ~86×86mm | ~220 w | ~130–150 w | **~1,040–1,200 w** |
| Poker **accordion** | 8 | ~53×79mm | ~147 w | ~90–110 w | ~720–880 w |
| Poker **Z fold** | 6 | ~53×79mm | ~147 w | ~90–110 w | ~540–660 w |
| Poker **bifold** | 4 | ~53×79mm | ~147 w | ~90–110 w | ~360–440 w |

Against the current 1,435 words, and against a trimmed print ruleset (~900) or a Learn-to-Play
(~650):

| Format | Current 1,435 w | Trimmed ~900 w | Learn-to-Play ~650 w |
|---|---|---|---|
| Cross fold booklet | over by ~25% | ✅ comfortable | ✅ roomy |
| Poker accordion | ~1.8× over | ⚠️ tight | ✅ fits |
| Poker Z fold | ~2.4× over | ❌ | ⚠️ tight |
| Poker bifold | ~3.6× over | ❌ | ❌ quick-start only |

### Recommendation: cross fold booklet

Three reasons, in order of weight:

1. **The 200×200mm unfolded spread solves the layout problem the panels can't.** The Store diagram
   and the 7-row player-count table are the two things that cost far more area than their word
   count. On a spread they're easy. On a panel they're a fight.
2. **Line length.** A poker panel is 63.5mm wide; after margins the text column is ~53mm, which at
   8pt is about 38 characters. That is below the comfortable range for prose and forces heavy
   ragging or hyphenation. The 100mm panel gives ~86mm / ~57 characters, which reads properly.
3. **It's the only option that fits a real ruleset**, not just a Learn-to-Play. At ~1,040–1,200
   words you can carry everything except Strategy, Variants and 5–8 player support.

**The table is close to decisive on its own.** A 5-column player-count table will not fit in a 53mm
column at any readable size — on the poker formats you'd have to drop it to 2–4 players and push
the rest to the web, or replace it with prose.

If poker size matters to you for box-fit reasons, the honest trade is: **poker accordion + a
Learn-to-Play insert**, with `rules.html` carrying the full reference. That works. Z fold and
bifold at poker size don't hold a ruleset.

⚠️ **Proof-print at 100% before committing to any of these.** Screen estimates for 8pt type are
reliable enough to choose a format and wrong enough to ruin a layout.

### Re-measured after the July 2026 sweep — no fold fits the full rules

The page is now **1,989 words**, of which **1,562** is print-core (everything except Strategy,
Variants, 5+ Player, Card Clarifications and the Quick Reference).

But word count stopped being the binding constraint. **Visuals now dominate.** Estimated panel area
at 100×100mm:

| Element | ≈ panels |
|---|---:|
| Card anatomy (2 cards + keys) | 1.0 |
| Symbols grid (6 entries with icons) | 1.0 |
| One Store diagram | 0.6 |
| Setup table (7 × 5) | 0.5 |
| Starter-deck grid (10 cards) | 0.4 |
| Suits (3 card backs) | 0.3 |
| **Visuals subtotal** | **~3.8** |
| Print-core text, 1,562 w at ~140 w/panel | ~11 |
| **Total** | **~15 panels** |

**A cross fold booklet is 8 panels — about half of what the full rules now need.** Every fold
option is out for the complete ruleset.

### Re-measured July 2026, after the anatomy rebuild and the footprint trims

Measured off the rendered page, then re-estimated at **print** width (86×86mm live) rather than
scaled from screen pixels — these blocks *reflow* (cards per row changes) rather than shrink.

| Visual | ≈ panels |
|---|---:|
| Card anatomy (35mm card + key beside) | 0.58 |
| Store diagram + act key | 0.58 |
| Starter grid (10 cards, 5×2) | 0.56 |
| Setup table (8 rows × 5 cols) | 0.53 |
| Suits (3 backs + labels) | 0.48 |
| Symbols (6 entries, 2 × 3) | 0.42 |
| Uncovering demo | 0.35 |
| **Visuals** | **3.50** |
| Prose, 876 w at ~180 w/panel | 4.87 |
| ~12 headings × 8mm | 1.12 |
| **Total** | **≈ 9.5 panels** |

**Still ~1.5 over the cross fold booklet's 8**, and *not* the improvement the trims implied.
Three things cancelled out:

1. The symbols block really did shrink — a full panel down to **0.42**. That worked.
2. The **uncovering demo was added** (+0.35), which didn't exist at the last estimate.
3. Two earlier estimates were **too optimistic**, and re-measuring corrected them upward: suits
   0.30 → **0.48**, starter grid 0.40 → **0.56**.

Headings are also a real cost that earlier passes folded into prose: ~1.1 panels across 12 of them.

### Closing the last ~1.5 panels

Ranked by saving per unit of harm. None of these drops a rule.

1. **Tighten Sequence of Play** — 402 words, the biggest single block. To ~320 saves **~0.45**.
2. **Suits row → a text line** — the suit is already region 1 on the anatomy card, and its "shows
   on the back" point is one sentence. Dropping the three back images saves **~0.35**, at the cost
   of never showing what a back looks like.
3. **Setup table → 2–4 players only**, with 5–8P as a sentence. Saves **~0.25**.
4. **Starter grid at 5×2 smaller** — saves **~0.15**, and PB has already ruled that setup clarity
   wins here, so this is the last one to touch.

1 + 3 lands ≈ **8.8**. 1 + 2 + 3 lands ≈ **8.4**. Getting under 8 needs all four, or accepting a
9th panel.

⚠️ These are still screen-derived estimates with a band of roughly ±1 panel. **A proof print at
100% is the only thing that settles it**, and it should happen before any more cutting — there is a
real chance the layout already fits and further trimming would be damage for nothing.

### Resolved: parity, achieved by cutting the web page (July 2026)

PB's call: **one ruleset, identical in print and on the web.** Not a Learn-to-Play insert plus a
fuller web reference — the same words in both, so the two can never drift and there is only one
place to fix errata.

That made `rules.html` itself the thing to cut. **1,989 → 1,016 words, 11 sections → 6**, with
every rule preserved (40 checked against the rendered page, 0 missing).

| | before | after |
|---|---:|---:|
| Text | 1,989 w (~11 panels) | 1,025 w (~5.7 panels) |
| Visuals | ~3.8 panels | ~3.2 panels |
| **Total** | **~15 panels** | **~9.2 panels** |

Against a cross fold booklet's 8 panels that is *in range* — it needs one more tightening pass or a
slightly smaller card-anatomy block, where before it was nearly double the budget.

Merged rather than dropped: Card Backs & Suits + Symbols → **Reading the Cards**; Errata +
Clarifications + Variants → **Fine Print**; 5+ Player Rules → Setup step 3 plus the existing table.

Cut outright: the Objective's 3-step round overview (it duplicated Sequence of Play directly
below it), 2 of the 3 Store diagrams (~0.6 panel each; the table carries every other player count),
and Strategy Tips (not rules).

The 10-thumbnail starter-deck grid was cut and then **restored** — cutting it broke setup. The
replacement text ("4 River, 4 Rattlesnake, 2 Cactus") gave the suit counts but not *which* cards,
and it exposed that the page had never stated how to tell a starter from a Store card at all; the
grid had been carrying that job implicitly. Checked against the art: **starters have no cost in the
bottom-left and no Act hats in the bottom-right, Store cards have both.** Setup step 1 now says so,
and the grid stays as verification — the thumbnails visibly show empty bottom corners, so rule and
picture reinforce each other. Costs ~0.4 panel; in print it wraps 5×2 smaller, as it already does
on mobile. Quick Reference went 206 → 64 words: at this length the document is close to being its
own quick reference, so it keeps only the round order and both tie ladders as a back panel.

### The two paths that were considered

**Path A — cut to a real Learn-to-Play (recommended).** ~650 words + the card anatomy + one Store
diagram + the symbols grid ≈ **6–7 panels**. Fits the cross fold booklet with room to breathe, or a
poker accordion tightly. `rules.html` carries everything else: it's navigable, versioned, free to
correct, and it's already the sales tool.

**Path B — if everything must be on paper, stop folding and bind it.** ~15 panels means a
**saddle-stitched square booklet, 12–16 pages at 100×100mm**. That is a different product with a
different unit cost, and it locks errata into print permanently.

**Recommendation: Path A.** Three reasons:

1. Print cost scales with page count, and this is heading for a Kickstarter where unit cost matters.
2. Paper errata is forever. The web rules already carry a version stamp and can be fixed the day a
   problem is found.
3. Nobody reads 15 panels at the table. Teach on paper, reference on screen — the three-audiences
   split again.

## 3. The decision that unlocks everything

**Stop treating the printed insert and the web page as the same document.**

This is the "three audiences" split from [`RULEBOOK_WRITING_STANDARDS.md`](RULEBOOK_WRITING_STANDARDS.md)
§B, and it's the standard answer to exactly this problem:

- **The insert is Learn-to-Play.** Everything a table needs to start and finish a first game, and
  nothing else. It carries a short URL / QR to the full rules.
- **`rules.html` is the Rules Reference.** Everything: strategy, variants, full errata, edge cases,
  FAQ, 5–8 player support. It costs nothing to be long on the web and it's already navigable.

Once that's decided, the insert stops fighting for room and the web page stops being pressured to
shrink.

### What goes where

| Content | Insert | Web |
|---|---|---|
| Objective + goal | ✅ | ✅ |
| Setup (2–4P) + one Store diagram | ✅ | ✅ |
| Setup table, all 7 player counts | ⚠️ 2–4P only | ✅ full |
| Sequence of Play | ✅ tightened | ✅ |
| Card anatomy (annotated card) | ✅ | ✅ |
| Symbols | ✅ | ✅ |
| Buy-order + Showdown tiebreaks | ✅ | ✅ |
| Errata (can't look at discard, burn definition) | ✅ folded into place | ✅ |
| Draw-4 chaining | ❌ | ✅ |
| Strategy Tips | ❌ | ✅ |
| Variants (Hidden Herd) | ❌ | ✅ |
| 5+ Player Rules | ❌ | ✅ |

Cutting Strategy (66) + Variants (13) + 5+ Player (51) + the "Reading a card" prose (~90, replaced
by the annotated card) + errata dedup (~40) is **~260 words** before any tightening of Sequence of
Play (450 w, the biggest single block).

- → **~1,175 w**: fits the cross fold booklet, with the Store diagram and player-count table on the
  200×200mm spread.
- → also tighten Sequence of Play to ~300 and drop Draw-4 chaining: **~1,025 w**, comfortable.
- → for a poker accordion, keep cutting to a **~650 w Learn-to-Play** and let `rules.html` carry the
  full reference.

## 4. Annotated example cards — yes, do it

Worth it, and **for print it's a net space saver**: it replaces ~90 words of prose ("Reading a
card") with one fixed-size image that teaches faster. The standards call a component-anatomy
diagram a required element, and it's the last big ⚠️ in the audit's Diagrams row.

**Two cards cover the entire vocabulary. No third card needed.**

### Card A — [`Card_43.jpg`](../assets/cards/All-Cards/Card_43.jpg)

Rattlesnake, 2 Bandits, 5 Cows, cost $4, Act 2. The risk/reward tension in one picture.

Callouts:
1. **Top-right → "Suit."** Rattlesnake. High risk, high reward.
2. **Bandits → "2 Bandits."** Your 3rd Bandit in a round busts you.
3. **Cows → "5 Cows."** Added to your Herd when you don't bust.
4. **Bottom-left → "Cost: $4."** What you pay to buy it from the Store.
5. **Bottom-right → "Act 2."** Two hats. Used only when sorting the Store during setup.

### Card B — [`Card_70.jpg`](../assets/cards/All-Cards/Card_70.jpg)

River, Explosive, circled $2 gain, cost $3, Act 1. Exists to kill the one genuine ambiguity: the
card art uses the same `$` glyph for two different things.

Callouts:
1. **Dynamite icon → "Explosive."** One-time use. Does nothing when drawn; use it on your turn,
   then it's gone from your deck for good.
2. **Circled $2 → "Money you gain."** Spend it this round.
3. **Corner $3 → "What it costs to buy."** Not money you gain.
4. Optionally reuse the suit / act callouts to reinforce Card A.

**Asset requirements** (for you to produce — I won't generate art):
- Card image at print resolution, callout lines to each labelled point.
- Callout text ≥7pt at final print size; test legibility at the real panel width, not on screen.
- Line/label colour must survive greyscale — same rule as the act bands. Don't encode meaning in
  hue alone.
- Ship an SVG or high-res PNG; the web page will use the same asset, so size it for print and let
  the browser scale down.

## 5. Revised priority

**Do next**

1. **Decide the insert format.** Everything below sizes off it. Recommendation: **cross fold
   booklet** (8 × 100mm panels + two 200×200mm spreads) — the only option that holds a real
   ruleset and the only one where the player-count table fits. Poker accordion is the viable
   fallback if box-fit wins, at Learn-to-Play scope.
2. **Annotated cards A and B.** Highest teaching value per unit space, saves ~90 words of print,
   and closes the last Diagrams ⚠️. Blocked on you making the art.
3. **Split the documents.** Add the print/web tags above to `rules.html` so the insert copy can be
   lifted straight out. Tighten Sequence of Play (450 words) while doing it.

**After that**

4. Callout styling for interrupt rules (bust-at-3, reveal-when-uncovered, last-card-ends-round).
   Helps both media; on paper it's what stops people missing a rule.
5. Worked scoring example — the last real ❌. One round, drawn cards → bust or stop → buy order →
   buy → reveal.
6. Quick-reference summary (turn order + tiebreaks on one panel / one screen). On the insert this
   is arguably the **back panel**, and it's what a returning player actually uses.

**Deliberately not doing**

- Standardising *personal deck / draw pile / deck* — real drift, but low reader impact next to the
  above. Fold it into whatever rewrite happens.
- Re-adding what the Acts represent. Cut once already as filler; only revisit if playtesters ask.

## 6. Open question for you

The showdown tiebreak changed who wins a tied game, which by the definition in
[`CLAUDE.md`](../CLAUDE.md)'s version table is a rules change and warrants **`GAME_V` 3 → 4**.
It hasn't been bumped. Consequences if you do:

- `history.html`'s leaderboard filters `gameV >= 3`, so it keeps working.
- The offline trajectory reconstructor refuses to replay when engine `gameV` ≠ trajectory `gameV`,
  so the existing gameV-3 corpus would stop replaying under a v4 engine — even though the tiebreak
  changes no card movement or herd total, only the winner declared on an exact tie.

Your call. Bumping is the letter of the rule; not bumping keeps a small corpus replayable.
