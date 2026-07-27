# Rules — what's worth doing next (July 2026)

Supersedes the ranked fix list in [`RULES_PAGE_AUDIT.md`](RULES_PAGE_AUDIT.md), which was written
before the printed-insert constraint existed. The audit is still the scorecard; this is the plan.

**Status:** 10 ✅ / 9 ⚠️ / 4 ❌ of 23 checks. Fixes 1–6 shipped (objective block, contents nav,
money terminology, edition-relative sentences, showdown tiebreak, version stamp), plus the
colour-blind-safe act bands and the Draw-4 chaining rule.

---

## 1. The measurement

Current `rules.html`, counted in the browser:

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

## 2. Space math for a bifold

A bifold printed both sides = **4 panels**. Estimates below assume 9pt body type on ~1.3 leading,
which is typical for a card-game insert and about as small as is comfortable.

| Format | Live area / panel | Pure text | Realistic with headings + diagrams | 4-panel budget |
|---|---|---:|---:|---:|
| **A6 bifold** (folded A5, 105×148mm panels) | ~89×132mm | ~256 w | ~150–180 w | **~600–700 words** |
| **A5 bifold** (folded A4, 148×210mm panels) | ~128×190mm | ~500 w | ~300–350 w | **~1,200–1,400 words** |

**Verdict — your instinct is right.**

- **A6 bifold: the current rules are ~2.2× too long.** Not a trim; a rewrite to roughly 600 words.
- **A5 bifold: feasible but at the ceiling.** 1,435 words is already at the top of the range
  *before* the Store diagrams, the player-count table, and 19 images compete for the same space.
  Needs to come down to ~1,000–1,100 to breathe.

The three Store diagrams and the 7-row player-count table are the real estate hogs — they cost far
more panel area than their word counts suggest.

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
Play. That lands A5 comfortably. A6 still needs the harder Learn-to-Play rewrite.

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

1. **Decide the insert format** (A6 vs A5). Everything below sizes off this answer. A5 = trim;
   A6 = Learn-to-Play rewrite.
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
