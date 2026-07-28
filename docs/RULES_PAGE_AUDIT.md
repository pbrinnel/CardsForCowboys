# `rules.html` audit — July 2026

Audited against [`RULEBOOK_WRITING_STANDARDS.md`](RULEBOOK_WRITING_STANDARDS.md) section H.
Target: [`rules.html`](../rules.html) as of commit `3b8ea3c`.

**Score at audit time: 3 ✅ / 10 ⚠️ / 10 ❌ of 23.**
**Current: 22 ✅ / 1 ⚠️ / 0 ❌** — after fixes 1–6, the full sweep, the card anatomy, the parity
cut and the print pass. `rules.html` is **985 words / 5 sections**. The uncovering diagram shipped;
the one open ⚠️ is the **quick-reference summary**, removed by choice (see Format below).
The original verdict was that the page was strong on *reference* and weak on *teaching* — no
on-ramp for a first-time reader, no navigation for a mid-game lookup. Both are addressed.

---

## Structure — 6 ✅ / 0 ⚠️ / 0 ❌

| Item | | Finding |
|---|---|---|
| Objective in one sentence, before any mechanic | ✅ | **Fixed (fix 1).** Was the page's biggest defect: `<h1>Rules</h1>` went straight to **Setup**, so a reader was told to separate Act decks and brick-stagger rows before learning they collect cows. There is now an `#objective` section ahead of Setup with a themed lede and a one-line goal callout. |
| Win/end condition stated early | ✅ | **Fixed (fix 1).** Was buried four sections down at the end of "3. The Showdown"; the Objective block now carries a "How the game ends" paragraph. |
| Sections build progressively, no forward references | ✅ | **Fixed across fixes 1, 2 and 4.** All six original forward references are closed — see [Forward references](#forward-references) below for what each one was. |
| Setup numbered, matched to a diagram | ✅ | **Fixed July 2026 (full sweep).** Setup is now an `<ol>` under a "Setting up" heading, so the steps are numbered; the orphan `</div>` and empty `<ul></ul>` are gone and step 2 points at the player-count table. Tag balance verified. |
| Turn structure as explicit ordered sequence | ✅ | **Fixed July 2026 (fix 2).** Was ⚠️ for two reasons, both now resolved: **(a)** the three phases were sibling `<section>`s, two with no `<h2>` at all, so screen readers and any generated contents list were told Buy Phase and Showdown weren't part of the sequence — they are now one `<section id="sequence">` with the phases as `h3`s under the `h2`. **(b)** the round *loop* was never stated; the Objective block now ends "Repeat until the Store is empty." |
| Complex rules broken out and linked from the sequence | ✅ | **Fixed July 2026 (full sweep).** The Draw Phase now links to both Symbols on Cards (Explosive timing) and Card Clarifications. |

### Forward references

All six are now closed. Kept as a record of the failure modes to watch for.

1. "Store cards" and "Act decks" — neither **Store** nor **Act** was ever defined. **Mostly fixed (1, 2):** the Objective introduces the Store, and Setup introduces Acts at first use as the cowboy-hat sort key, which is all Setup needs; "Reading a card" covers the hats too. **Small remainder:** the page never says what the Acts *represent* (later Acts cost more and score more — avg cost 3.3 / 4.2 / 6.9, avg Cows 0.7 / 1.3 / 2.3 across Acts 1–3). A bullet saying so was added in fix 4 and **deliberately cut** — PB judged it filler, and the rules do read fine without it. Only revisit if playtesters ask what the Acts are for.
2. ~~"the same progression **as before**, with none of the mid-game shuffling"~~ — "before" meant *a previous edition of the rules*. A first-time reader has no "before." Leftover changelog voice. **Fixed (4).**
3. ~~"**instead of** the game ending immediately"~~ — same problem; compared to a rule that does not exist in this document. **Fixed (4)**, now "the game does not end straight away."
4. ~~bust rule uses **Bandits** before they're defined~~ **Fixed (1):** the Objective states "Draw a 3rd Bandit and you bust."
5. ~~uses **Herd** before it's glossed~~ **Fixed (1):** the Objective's goal line and step 2 both use it in context.
6. ~~Explosive says "see Errata"; Errata says "see Explosive above." Circular, and neither is a link.~~ **Both are links now (fix 2).** They still point at each other, but that's a genuine mutual definition and it's one click either way.

**The pattern to watch:** every one of these except the circular pair came from writing the page as a *diff against the previous edition* rather than as a standalone document. After any rules rework, re-read the page as someone who has never seen the old version.

---

## Language — 5 ✅ / 0 ⚠️ / 0 ❌

| Item | | Finding |
|---|---|---|
| Present tense, active voice, second person | ✅ | **Fixed July 2026 (full sweep).** Draw and Buy phases rewritten in second person; the person no longer switches inside a list. Remaining third person is where it is correct — player-count tables, "the player with the most $ chooses", "clockwise from the first player" — all statements about the table rather than instructions to the reader. |
| "May" vs "must" unambiguous | ✅ | Consistently precise. "must draw at least one card, then may stop"; "must take an action — either buy or burn… You cannot pass"; "may pause between each draw." Best-handled rule on the page. |
| One term per concept | ✅ | **Fixed July 2026 (full sweep).** Settled on three distinct terms: **deck** = everything you own, **draw pile** = the face-down stack, **discard pile**. *personal deck* and *collection* are gone from the page, and Errata now defines deck and draw pile explicitly. |
| Every term defined before first use | ✅ | **Fixed across fixes 1 and 3.** "Sell value" was the only term defined nowhere on the page, and it was load-bearing in a tiebreak — it turned out to mean a card's **cost**, compared position by position (`sim/tiebreaker.js` narrows on `hand[i].cost`), and the page now says exactly that. Herd, Bandit, Cow, bust, Store and $ are all introduced in context by the Objective block before Setup uses them; the Act hats are explained in the Setup bullet that first needs them. |
| No paragraph buries its point | ✅ | Bullets are short and lead with the point throughout. |

---

## Format — 6 ✅ / 0 ⚠️ / 0 ❌

| Item | | Finding |
|---|---|---|
| Consistent bold/italic/caps system | ✅ | **Fixed July 2026 (full sweep).** Convention documented in an HTML comment at the top of `<main>` and applied: capitalised game nouns, lowercase verbs, `<strong>` only for a term being defined or a must/may that changes what a player may do, `.rules-callout` reserved for interrupt rules, `.rules-example` for illustration. |
| Diagrams for setup, component anatomy, icons | ✅ | **Closed July 2026.** Setup and icons were always strong; the act bands were made colour-blind-safe (lightness L\* ≈ 20/43/66 **plus** hatch direction 45° / -45° / horizontal — verified under a full greyscale filter; hues stay brown because blue/yellow/red are the suit colours). Component anatomy now ships as an annotated diagram: `Card_43` for suit / Bandits / Cows / cost / Act hats and `Card_70` for the circled-$-gain vs corner-$-cost ambiguity. Numbered markers positioned in **percent** of the image so they stay locked to their feature at any width — leader lines would break at every size and in print. |
| Callouts for interrupt/forgettable rules | ✅ | **Fixed July 2026 (full sweep).** `.rules-callout` added and used three times, for exactly the rules that interrupt the sequence or get forgotten: **bust at 3 Bandits**, **always reveal uncovered cards**, **the last card ends the round**. Distinguished by border weight, inset and fill — not hue — so it survives greyscale. |
| Navigable table of contents | ✅ | **Fixed July 2026 (fix 2).** Every section carries an `id` (plus the three phase `h3`s); a `.rules-toc` contents panel lists all 13 targets, inline on narrow screens and `position: fixed` beside the 760px column at ≥1240px. It sits *after* the Objective in the DOM so it can't push the goal below the fold on a phone; on wide screens it's fixed, so DOM order doesn't affect where it renders. The four in-text cross-references are now real links. |
| Quick-reference summary | ⚠️ | Added in the full sweep, then **removed on PB's call** once the printed insert was settled: the accordion has no panel for it, and at 985 words across 5 sections the document is close to being its own quick reference. Deliberate, not an oversight. Revisit only if returning players report hunting for the turn order. |
| Version number | ✅ | **Fixed (fix 6).** "Rules v3.1 · last updated 27 July 2026" above the footer CTA. Major tracks `GAME_V` in `src/play.js`; minor is a rules-page revision within that game version. A comment in the markup tells the next editor to bump both. |

---

## Coverage — 5 ✅ / 1 ⚠️ / 0 ❌

| Item | | Finding |
|---|---|---|
| Every component explained | ✅ | **Fixed July 2026 (full sweep).** Setup opens with a "What you need" list: 54 Store cards (18 per Act, marked by the hats) and 10 starter cards per player (4 River, 4 Rattlesnake, 2 Cactus). Counts verified against the card data, not invented. |
| Edge-case examples are non-obvious ones | ✅ | **Closed July 2026.** Two now: the Draw-4 chaining arithmetic, and the showdown scoring example. The covering/reveal rule — the worst gap, taught in words only — now has a before/after diagram built from the same `.pyramid-row`/`.pcard` as the Store diagrams, so the brick stagger shown is the real geometry rather than a redrawing. |
| Worked scoring example | ✅ | **Fixed July 2026 (full sweep).** Worked example under the Showdown: 14 Cows banked from rounds + 9 printed across the deck = 23, and it states that Cows on cards you never drew still count. |
| Tie-breaking stated | ✅ | **Fixed July 2026 (fix 5).** Buy-order ties were always five levels deep — the best-written block on the page — but the *game-winning* tie had no rule at all, and the digital game just showed "It's a Tie!". There is now an **If Herds Are Tied** ladder that mirrors the buy-order one so players reuse one mental model: most **$** across your collection → most **cards**; still level = share the win. Implemented as `resolveShowdownWinners` in `src/play.js`. Deliberately stops at two steps (PB's call) rather than adding the buy-order ladder's card-by-card walk and random pick. |
| First-player rule | ✅ | **Fixed July 2026 (full sweep).** Now explicit: "Whoever is chosen buys first. Play then continues clockwise from them, skipping anyone who busted. The same rule picks the first player every round, including the first." |
| FAQ / errata inside the page | ✅ | Errata + Card Clarifications are on-page, not outsourced to a forum. |

### Also found (not on the checklist)

**Busted players and the buy phase.** Never stated explicitly that a busted player skips buying.
[:148](../rules.html) says non-busted players score Cows; [:149](../rules.html) says "on your turn you must take an
action"; [:166](../rules.html) says "once all **eligible** players have bought" — *eligible* is undefined.
[:178](../rules.html) confirms busted players still join the Showdown. So "can a busted player buy?"
is answerable only by inference from an undefined word.

---

> **The ranked list below is superseded by [`RULES_PLAN.md`](RULES_PLAN.md)** (July 2026), which
> re-prioritises everything around the printed-insert space budget. This section is kept as the
> record of what each fix was. The tables above remain the live scorecard.

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
4. ~~Delete the two edition-relative phrases — they reference a document the reader doesn't have.~~
   **DONE** (July 2026).
   - "the same progression as before, with none of the mid-game shuffling" → **cut entirely.** It
     was first rewritten into a longer bullet about Acts getting richer; PB cut that as filler.
     Nothing was lost — the bullet above it already says the Store is built once with no setup
     between Acts, and the deal order (Act 3 back → Act 1 front) makes the progression obvious.
   - "instead of the game ending immediately" → *"the game does not end straight away."*
5. ~~Add a final-victory tie rule.~~ **DONE** (July 2026) — rules text + `resolveShowdownWinners`
   in `src/play.js`. Note for whoever touches `sim/`: `personality-engine.js`'s `gameResult` still
   reports raw herd ties, so sim win-rates now count tied games differently from the real game.

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
