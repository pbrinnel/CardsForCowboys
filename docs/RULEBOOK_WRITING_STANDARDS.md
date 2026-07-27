# Rulebook Writing Standards — compiled conventional wisdom

Compiled July 2026 from board-game-design sources (see Sources at the bottom). This is the
yardstick for auditing [`rules.html`](../rules.html) and the rules PDF. It is **not** CFC-specific
advice — it's the industry consensus, stated so it can be checked against.

Where sources disagree, the disagreement is noted rather than resolved.

---

## A. The spine — canonical section order

Near-universal agreement on the *first three*: **theme → goal → components/setup**. A player must
know what they are trying to do before they are told what anything is.

The consensus spine:

1. **Story / theme hook** — 2–4 sentences. Primes the player, sets tone. Not lore.
2. **Objective / goal** — *what you are trying to do*, in one sentence, up front.
3. **Game end / win condition** — several sources put this immediately after the goal, before
   components. Rationale: knowing where the game *stops* frames everything after it.
4. **Components** — with pictures and the exact names used everywhere else.
5. **Setup** — with a numbered diagram whose numbers match the numbered steps.
6. **Overview of play / "master statement"** — one paragraph: the shape of a round.
7. **Turn structure** — explicit sequential steps. This is the core; everything else hangs off it.
8. **Special cases / complex rules** — broken out into their own sections, *referenced from* the
   turn structure rather than inlined into it.
9. **Scoring / ending the game** — the detailed version.
10. **Appendix** — icon glossary, card-by-card reference, FAQ, edge cases, strategy tip, version
    number.

**Disagreement worth noting:** a minority order puts the **components list first** (before the
objective). Most sources reject this — playtesters skip component lists, and a components-first
rulebook makes the reader hold nouns in memory with no purpose attached to them. Some designers
merge components *into* setup for the same reason.

**Progressive build:** each section may only use concepts already introduced. A rule that
forward-references a later section is a defect.

---

## B. The three audiences

Every rulebook serves three readers, and most bad rulebooks serve only the first:

1. **First-time learner** — needs teaching order, examples, diagrams, conversational tone.
2. **Player mid-game** — needs to find one answer fast. Needs headings, index, skimmability.
3. **Returning player** — needs a refresher, not a re-read. Needs a summary/quick-rules page.

Big games split these into two documents (*Learn to Play* + *Rules Reference*; Root is the
canonical example). Small games serve all three in one document by making it **skimmable** —
headings, callouts, and a one-page summary do the work the second document would.

**Audit question:** can a mid-game player find "what happens when I bust?" in under 10 seconds
without reading prose?

---

## C. Language rules (sentence level)

1. **Present tense, active voice, second person.** "Shuffle the deck and deal 5 cards." Not "the
   deck is shuffled" or "players will shuffle."
2. **Commands, not description.** Rules are "do this, then do this" — not "a general encyclopedia
   of concepts the player must assemble."
3. **"May" vs "must" is never loose.** Optional and mandatory must be lexically distinguishable
   every time. This is the single most-cited ambiguity failure.
4. **One term per concept, forever.** Never alternate synonyms for variety. "It's better to sound
   repetitive than confusing." Pick the word, define it once, use only it.
5. **Define a term before using it**, and define it exactly once — at first use or in the glossary,
   not both with different wording.
6. **Lead each paragraph with its most important sentence.** Readers scan first lines.
7. **Cut wordiness.** Excessive wordiness tops the common-mistakes list. Short paragraphs and
   bullets beat prose blocks.
8. **Humor sparingly**, and only where it reinforces a rule. Never where it costs clarity.
9. **Second person or singular "they."** Avoid defaulting to he/him.

---

## D. Formatting & skimmability

1. **Consistent typographic system, documented.** Decide what bold, italic, ALL CAPS, and
   Capitalized Game Terms each mean; apply uniformly. Bold for section titles; caps for critical
   warnings; italics sparingly.
2. **Moderate capitalization.** Capitalizing every game term destroys scannability — the thing
   capitalization exists to buy.
3. **Pictures carry the load** for: setup, component anatomy, icon meanings, spatial layout, and
   any mechanic playtesters keep asking about. Label images and reference them by label in the
   text.
4. **In-text icons** so a skimming reader can find the rule by shape, not by reading.
5. **Callout boxes** for rules that interrupt the normal sequence — the rules players forget.
6. **Table of contents** for anything past a couple of pages; index for long ones.
7. **Quick-reference / player aid** with page references back into the full rules.
8. **Version number on the rules**, so errata can be pinned to a version.

---

## E. Coverage — what must be there

1. **Every component on the list has a stated reason to exist** in the rules. A listed component
   never explained is a defect.
2. **Edge cases get real examples, not obvious ones.** "Don't take the easy way out giving obvious
   examples." The example should show the interaction people actually argue about.
3. **Worked examples for anything with math or ordering** — scoring, turn order, timing.
4. **FAQ / clarifications inside the rules**, not outsourced to a forum or a website. Relying on an
   online FAQ to carry rules is listed as a common mistake.
5. **First-player rule** stated explicitly (a routinely forgotten section).
6. **Explicit statement of what happens on a tie**, and on draws/losses — not just wins.

---

## F. Process & validation

1. **Blind playtest** — new players learn from the document alone, with the designer silent. 1–2
   passes minimum; 3 for medium-to-heavy games. Give every player a copy so one person's
   interpretation doesn't paper over gaps.
2. **Test with non-gamers**, who don't have rulebook-reading fluency to fall back on.
3. **Watch for "what do I do now?"** — that phrase marks the exact paragraph that failed.
4. **Write iteratively in passes**, each with one goal: (a) capture all rules, (b) clarify what
   playtests kept asking, (c) enforce term consistency, (d) format for readability.
5. **Two reviewers minimum**, ideally one professional editor. The designer cannot see their own
   gaps — duplicated words, inconsistent terms, and unstated assumptions are invisible from inside.
6. **Write the rulebook late** in development, so it isn't chasing a moving design.

---

## G. Adapting this to a web rules page

The sources assume print. A few translate differently for [`rules.html`](../rules.html):

- **Page-count/spread constraints (divisible by 4, facing pages) don't apply.** Ignore those.
- **Scroll replaces flipping**, so cross-references become anchor links — strictly better than
  "see page 7." Every "see below" should be a real link.
- **The table of contents becomes navigation** and should stick or be reachable, not just sit at
  the top once.
- **Skimmability matters more, not less** — a long scroll has no page numbers to orient by.
- **Version number still applies**, and matters more: a web page changes silently.
- **The three audiences are all on the same URL**, so a collapsed/anchored "quick rules" summary
  does the job a separate reference booklet would.

---

## H. Audit checklist (use this against `rules.html`)

Score each: ✅ pass / ⚠️ partial / ❌ fail.

**Structure**
- [ ] Objective stated in one sentence, before any mechanic
- [ ] Win/end condition stated early, not only at the bottom
- [ ] Sections build progressively; no forward references
- [ ] Setup is numbered and matches a diagram
- [ ] Turn structure is an explicit ordered sequence
- [ ] Special/complex rules are broken out and linked from the turn structure

**Language**
- [ ] Present tense, active voice, second person throughout
- [ ] "May" vs "must" unambiguous everywhere
- [ ] One term per concept; no synonym drift
- [ ] Every term defined before first use
- [ ] No paragraph buries its point past sentence one

**Format**
- [ ] Consistent bold/italic/caps system
- [ ] Diagrams for setup, component anatomy, icons
- [ ] Callouts for interrupt/forgettable rules
- [ ] Navigable table of contents
- [ ] Quick-reference summary exists
- [ ] Version number present

**Coverage**
- [ ] Every component explained
- [ ] Edge-case examples are non-obvious ones
- [ ] Worked scoring example
- [ ] Tie-breaking stated
- [ ] First-player rule stated
- [ ] FAQ/errata inside the page

---

## Sources

- [Top Six Rules for Rulebook Writing — Meeple Mountain](https://www.meeplemountain.com/top-six/top-six-rules-for-writing-rulebooks/)
- [Writing Rulebooks — Resonym](https://resonym.com/writing-rulebooks/)
- [Writing a Rulebook — daniel.games](https://daniel.games/writing-a-rulebook/)
- [Laying Down the Law: a guide to rulebook writing — I Slay the Dragon](https://islaythedragon.com/featured/laying-down-the-law-a-guide-to-rulebook-writing/)
- [How to Make the Perfect Board Game Rule Book — Brandon the Game Dev](https://brandonthegamedev.com/how-to-make-the-perfect-board-game-rule-book/)
- [How to Write a Good Board Game Rulebook — Tim Chuon](https://medium.com/@tim.chuon/how-to-write-a-good-board-game-rulebook-5e66cd9f7e40)
- [Don't Make This Board Game Design Mistake — QinPrinting](https://www.qinprinting.com/blog/board-game-design-mistakes/)
- [Writing Rules — Board Game Design Lab](https://boardgamedesignlab.com/rules/)
