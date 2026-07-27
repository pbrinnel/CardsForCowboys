# `rules.html` audit — July 2026

Audited against [`RULEBOOK_WRITING_STANDARDS.md`](RULEBOOK_WRITING_STANDARDS.md) section H.
Target: [`rules.html`](../rules.html) as of commit `3b8ea3c`.

**Score at audit time: 3 ✅ / 10 ⚠️ / 10 ❌ of 23.**
**Current: 8 ✅ / 10 ⚠️ / 5 ❌** — after fixes 1–3 plus the Draw-4 clarification (July 2026).

The page is strong on *reference* material (symbols, errata, buy-order tiebreaks, setup diagrams)
and weak on *teaching* — it reads as a rules reference for someone who already knows the game, with
no on-ramp for a first-time reader and no navigation for a mid-game lookup.

---

## Structure — 0 ✅ / 3 ⚠️ / 3 ❌

| Item | | Finding |
|---|---|---|
| Objective in one sentence, before any mechanic | ❌ | The page goes `<h1>Rules</h1>` → **Setup**. No theme, no objective. A reader is told to separate Act decks and brick-stagger rows before learning they are collecting cows. This is the most-cited rule in every source and the page's biggest defect. |
| Win/end condition stated early | ❌ | First appears [rules.html:180](../rules.html), four sections and ~140 lines down, at the end of "3. The Showdown". |
| Sections build progressively, no forward references | ❌ | Six found — see [Forward references](#forward-references) below. |
| Setup numbered, matched to a diagram | ⚠️ | Diagrams are genuinely good (3 pyramid demos, colour-coded act bands + key, player-count table). But setup is a `<ul>`, not an `<ol>`, so there are no step numbers for the diagrams to reference. Stray markup: orphan `</div>` at [:125](../rules.html) and an empty `<ul></ul>` at [:127](../rules.html). |
| Turn structure as explicit ordered sequence | ✅ | **Fixed July 2026 (fix 2).** Was ⚠️ for two reasons, both now resolved: **(a)** the three phases were sibling `<section>`s, two with no `<h2>` at all, so screen readers and any generated contents list were told Buy Phase and Showdown weren't part of the sequence — they are now one `<section id="sequence">` with the phases as `h3`s under the `h2`. **(b)** the round *loop* was never stated; the Objective block now ends "Repeat until the Store is empty." |
| Complex rules broken out and linked from the sequence | ⚠️ | Errata and Card Clarifications exist and are separate — correct. But nothing in the Draw Phase points to them, and Explosive activation timing (a draw-phase mechanic) lives only in the Symbols section. |

### Forward references

1. [:58](../rules.html) "Store cards" and "Act decks" — neither **Store** nor **Act** is ever defined. Acts are used as deck labels with no explanation that they gate power/cost.
2. [:61](../rules.html) "the same progression **as before**, with none of the mid-game shuffling" — "before" means *a previous edition of the rules*. A first-time reader has no "before." Leftover changelog voice.
3. [:174](../rules.html) "**instead of** the game ending immediately" — same problem; compares to a rule that does not exist in this document.
4. [:139](../rules.html) bust rule uses **Bandits**; defined at [:217](../rules.html).
5. [:148](../rules.html) uses **Herd**; only glossed in passing at [:213](../rules.html).
6. ~~[:229](../rules.html) Explosive says "see Errata"; [:240](../rules.html) Errata says "see Explosive above." Circular, and neither is a link.~~ **Both are links now (fix 2).** They still point at each other, but that's a genuine mutual definition and it's one click either way.

Items 1–5 are still open — see fix 4 in the ranked list for the two edition-relative sentences.

---

## Language — 2 ✅ / 2 ⚠️ / 1 ❌

| Item | | Finding |
|---|---|---|
| Present tense, active voice, second person | ⚠️ | Person switches inside single lists. Draw Phase: "All players draw…", "If a player draws… **they** bust" ([:137–139](../rules.html)) then "If **you** want to draw and **your** draw pile is empty" ([:140](../rules.html)). Buy Phase repeats it: "Players who did not bust add any Cows **they** drew" ([:148](../rules.html)) → "On **your** turn **you** must take an action" ([:149](../rules.html)). |
| "May" vs "must" unambiguous | ✅ | Consistently precise. "must draw at least one card, then may stop"; "must take an action — either buy or burn… You cannot pass"; "may pause between each draw." Best-handled rule on the page. |
| One term per concept | ⚠️ | The Burn/Explosive distinction is explicitly policed — exactly right. **Money drift fixed July 2026 (fix 3):** *$ / coins / sell value* were three words for two concepts; the page now uses **$** for money and **cost** for a card's price, everywhere. (On **collection** the original audit was wrong — the Showdown defines it inline with an em-dash gloss, "deck, hand, and discard".) **Still drifting:** **personal deck** / **draw pile** / **deck** for the pile you draw from. |
| Every term defined before first use | ✅ | **Fixed across fixes 1 and 3.** "Sell value" was the only term defined nowhere on the page, and it was load-bearing in a tiebreak — it turned out to mean a card's **cost**, compared position by position (`sim/tiebreaker.js` narrows on `hand[i].cost`), and the page now says exactly that. Herd, Bandit, Cow, bust, Store and $ are all introduced in context by the Objective block before Setup uses them; the Act hats are explained in the Setup bullet that first needs them. |
| No paragraph buries its point | ✅ | Bullets are short and lead with the point throughout. |

---

## Format — 0 ✅ / 2 ⚠️ / 4 ❌

| Item | | Finding |
|---|---|---|
| Consistent bold/italic/caps system | ⚠️ | Bold does two jobs: marking game terms (**Bandits**, **Store**, **bust**) and emphasising instructions (**must take an action**, **not**, **once, at the start of the game**). Capitalisation of game terms is inconsistent — Cows/Herd/Store/Bandits/Act capitalised, bust/burn/buy lowercase. Defensible as noun-vs-verb, but nowhere stated. |
| Diagrams for setup, component anatomy, icons | ⚠️ | Setup and icons: strong, and the act bands were made colour-blind-safe in July 2026 — the old three-shades-of-brown ramp stepped only ~10 L\* and read as one mud colour, so the tiers now separate on **lightness** (L\* ≈ 20/43/66) **and hatch direction** (45° / -45° / horizontal), neither of which is hue. Verified under a full greyscale filter. Hues deliberately stay brown: blue/yellow/red are the suit colours and a tinted band would read as a suit. **Component anatomy: still missing.** No labelled card diagram. [:58](../rules.html) asks the reader to find "the cowboy hat number at the bottom-right" with no picture of it, and **card purchase cost is never explained anywhere** — [:150](../rules.html) says buy "using the total coins drawn" without saying cards have a printed price or where it is. |
| Callouts for interrupt/forgettable rules | ❌ | No callout styling exists (`css/rules-page.css` has only `.setup-note`, which is centred small text). Bust-at-3, reveal-when-uncovered, the last-card-ends-the-round trigger, and Explosive timing all carry the same visual weight as everything else. |
| Navigable table of contents | ✅ | **Fixed July 2026 (fix 2).** Every section carries an `id` (plus the three phase `h3`s); a `.rules-toc` contents panel lists all 13 targets, inline on narrow screens and `position: fixed` beside the 760px column at ≥1240px. It sits *after* the Objective in the DOM so it can't push the goal below the fold on a phone; on wide screens it's fixed, so DOM order doesn't affect where it renders. The four in-text cross-references are now real links. |
| Quick-reference summary | ❌ | Nothing for a returning player. |
| Version number | ❌ | Absent. The game is internally at `gameV 3` after the July 2026 single-Store rework, and the page still contains text written against the prior version (items 2 and 3 under Forward references). No version, no last-updated date. |

---

## Coverage — 1 ✅ / 3 ⚠️ / 2 ❌

| Item | | Finding |
|---|---|---|
| Every component explained | ⚠️ | No components list. Starter deck is shown as card images (good). **Fix 3 closed two of the three gaps** — cards having a purchase cost, and what the cowboy-hat number is, are both explained now (Buy Phase + "Reading a card"). **Still missing:** total Store card count / anything a physical-copy owner could check box contents against. |
| Edge-case examples are non-obvious ones | ⚠️ | **Upgraded from ❌ July 2026** — the page now has exactly one worked example, and it is the right kind: Draw-4 chaining in Card Clarifications, with the arithmetic spelled out (owe 4 → draw a Draw 4 → owe 7). Everything else still has none. Worst gap remains the covering/reveal rule, which is purely verbal — "so two cards cover the one above" ([:60](../rules.html)), "reveal any cards underneath that are no longer covered" ([:152](../rules.html)) — with no diagram of the *uncovering* and no treatment of the end-of-row card that only one card covers. That is the spatial edge case every source says must be shown. |
| Worked scoring example | ❌ | None. "Count all **positive** Cows… Negative Cow values do not count" ([:177](../rules.html)) has real subtlety and gets no example. |
| Tie-breaking stated | ⚠️ | Buy-order ties: ✅ five levels deep, the best-written block on the page ([:156–162](../rules.html)). **Final-victory ties: nothing.** [:180](../rules.html) declares most-Cows wins with no tie rule. |
| First-player rule | ⚠️ | Works by accident — the most-$ buy-order rule covers round 1 too — but nothing says so, and "Buying proceeds clockwise from **the first player**" ([:163](../rules.html)) uses "first player" as a defined role that was never defined. |
| FAQ / errata inside the page | ✅ | Errata + Card Clarifications are on-page, not outsourced to a forum. |

### Also found (not on the checklist)

**Busted players and the buy phase.** Never stated explicitly that a busted player skips buying.
[:148](../rules.html) says non-busted players score Cows; [:149](../rules.html) says "on your turn you must take an
action"; [:166](../rules.html) says "once all **eligible** players have bought" — *eligible* is undefined.
[:178](../rules.html) confirms busted players still join the Showdown. So "can a busted player buy?"
is answerable only by inference from an undefined word.

---

## Ranked fix list

**Do now — cheap, high impact**

1. ~~Add an **Objective** block above Setup: theme (2–3 sentences), the goal in one sentence, and
   how the game ends.~~ **DONE** (July 2026). `#objective` section added ahead of Setup with a
   themed lede, a one-line goal callout (`.rules-goal`), a 3-step "How a round works" overview, and
   "How the game ends". Cleared: *objective missing*, *win condition late*, and partially
   *progressive build* (Cows, Herd, Bandits, bust, Store and $ now all appear in context before
   Setup uses them). The overview is deliberately non-normative — the phase sections stay
   authoritative, so the two can't drift into contradiction. `#setup` also got an id.
2. ~~Add `id` attributes to the remaining sections + a sticky TOC, and turn "see Errata" / "see
   Explosive above" into real links.~~ **DONE** (July 2026). Also merged the three phase
   `<section>`s into one so the heading nesting is valid (that was item 9's first half — the TOC
   could not be built correctly without it). Four cross-references linked: Objective→Showdown,
   Explosive→Errata, Errata→Symbols, 5+ Player Rules→Setup.
   **Watch out:** the contents panel is a `<nav>`, and `css/style.css` styles bare `nav` /
   `nav ul` for the site header (`display:flex`, `justify-content:space-between`, `gap`). Those
   are element selectors, so a class rule only beats them on properties it actually names —
   the panel first rendered as a flex row with "CONTENTS" floating beside a clipped list.
   `.rules-toc` and `.rules-toc ol, .rules-toc ul` now reset `display`/`gap` explicitly.
   In-body links also needed styling or they fell back to browser-default blue — bad on a page
   where blue is a suit colour.
3. ~~Define **sell value**, and reconcile **$ / coins / sell value** to one term.~~ **DONE**
   (July 2026). "Sell value" appeared exactly once in the whole repo and meant a card's **cost**:
   `sim/tiebreaker.js` narrows on `hand[i].cost` position by position, and the in-game log already
   said "1st card cost". The page now uses **$** for money and **cost** for price, and tiebreak
   step 4 states the positional comparison instead of hand-waving at "sell value in order".
   Also added a **Reading a card** subsection to Symbols — suit top-right, cost bottom-left, Act
   hats bottom-right — and split the `$` entry, because the card art uses the same `$` glyph for
   two different things: **in a circle** = money you gain, **plain, bottom-left** = cost.
   (Verified against the card art itself: `Card_70.jpg` shows a circled `$2` gain and a plain
   `$3` cost.) Still drifting, not yet fixed: **personal deck** / **draw pile** / **deck**.
4. Delete the two edition-relative phrases ([:61](../rules.html), [:174](../rules.html)) — they reference a document
   the reader doesn't have.
5. Add a final-victory tie rule.

**Do next — needs assets or layout work**

6. Labelled card-anatomy **diagram** (cost, act hat, $, cows, bandits). Fix 3 added the anatomy
   in prose ("Reading a card"), which covers the rules gap; a labelled image would still be the
   better teaching tool. Needs an asset — don't generate one.
6b. Standardise **personal deck / draw pile / deck** on one term (the last surviving synonym drift).
7. Worked example: one full round (draw → bust or stop → buy order → buy → reveal).
8. Covering/uncovering diagram, including the single-covered end-of-row card.
9. ~~Fix the `<h2>`/`<h3>` nesting so Buy Phase and Showdown sit under Sequence of Play~~ (done
   with fix 2); still to do: convert Setup to `<ol>`, remove the orphan `</div>` and empty `<ul>`.
10. Callout style for interrupt rules; one pass to normalise to second person; version/last-updated
    stamp; quick-reference summary.
