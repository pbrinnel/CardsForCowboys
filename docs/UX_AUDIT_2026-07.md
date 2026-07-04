# UX/UI Audit — July 2026

**Method:** Hands-on, evidence-based audit conducted in-browser against a local static server.
Flows exercised: naive first-visit pass; full 2P solo-vs-AI game through the showdown (~26 rounds,
3 acts, incl. two busts, reshuffles, a special-card buy, burn flow, tied-order choice); 4P AI game
(desktop rail + mobile); 8P AI game at 1280×800 (short-viewport cap); tutorial end-to-end; host
waiting room (created + cancelled, no live MP game); lobby join incl. bad-code error; rejoin banner;
rules / history / spectate / bugreport / about / privacy. Viewports: 375×812, 768 spot checks,
1280×800 (also the ≤900px-tall laptop case). All Firebase records created during testing were
deleted afterward.

**Caveats:** Multiplayer was audited UI-only (waiting room + lobby); live MP turn-handoff UX was not
exercised. The audit ran in a headless-style tab, so animation *timing* judgments are approximate;
two findings are marked *unverified on real devices*. Desktop screenshots in this environment had an
intermittent capture-scaling artifact — every surprising visual was cross-verified with DOM geometry
before being reported.

---

## 1. Executive summary

The core game UX is in better shape than most web board-game demos: moment-to-moment feedback is
strong (bandit warnings, red bust highlighting on the correct cards, buy/burn confirmation with a
zoomed card, reshuffle prompts, clear waiting messages), the host waiting room and lobby are
genuinely excellent, the bug-report page with auto-attached game context is best-in-class for a
hobby project, and the desktop 4P/8P layouts (opponent rail, short-viewport Store cap) work as
designed.

The site's biggest problem is not the game — it's that **the site does not do its stated job of
selling the physical game**. The only conversion element (the Kickstarter email capture) is
invisible on load at every tested viewport, the landing headline reads like a digital-game tagline,
and the two highest-intent surfaces (end-of-game showdown, rules page) contain zero physical-game
pitch. The second theme is **first-run comprehension**: a new player who clicks Play (the primary
CTA) is never told the objective or the bust stakes — everything the excellent tutorial teaches,
the main game assumes, and nothing routes newcomers to the tutorial. Third: the **default first
game is the longest possible version** of the game (~26 rounds; Quick Draw and Pioneer both default
off), a heavy ask for a first-session demo.

**Five highest-impact changes:**
1. Put the physical-game story on screen at load: one headline line ("A tabletop deck-builder
   coming to Kickstarter — play it free online") + move/duplicate the email signup above the fold. (S)
2. Add a signup CTA to the showdown footer and the rules page — the two moments of highest intent. (S)
3. Teach stakes in-game with three copy changes: an objective line for round 1, "Two bandits — one
   more busts you!", and a bust message that says the haul is lost. Add a "First time? Try the
   tutorial" link on game setup. (S)
4. Recompress the card images (94 cards ≈ 16 MB at 375×525; backs ~600 KB each) → ~75% lighter
   first-game load on mobile. (S)
5. Offer a "Short game" preset (Quick Draw + Pioneer) and nudge first-timers toward it. (M)

---

## 2. Prioritized findings

Severity: **Blocker** = prevents/derails a core flow · **Major** = significant friction or
comprehension failure for a typical user · **Minor** = noticeable rough edge · **Polish** = refinement.
Effort: S/M/L.

| ID | Surface | Sev | Finding | Evidence | Recommendation | Effort |
|----|---------|-----|---------|----------|----------------|--------|
| C1 | index.html | **Major** (Blocker for the sales mission) | The Kickstarter email capture — the site's only conversion element — is invisible on load. The fixed footer visually terminates the page, hiding that content exists below. | At 1280×800 the email input (y 761–801) sits entirely behind the fixed footer (y 721–800). At 375×812 it is below the fold. Verified via getBoundingClientRect. | Move the signup (or a "Get the physical game" button) into the main button stack above the fold; keep the long-form section below. | S |
| C2 | index.html | **Major** | Headline never says this is a physical card game. "A Streamlined Deck Builder / No Draw Limits…" reads as a digital game. The only physical mention is footer fine print at ~3.7:1 effective contrast (rgba alpha .5 over dark). | Screenshots at 1280 and 375; contrast computed from computed styles. | Reframe the subtitle: physical game, Kickstarter 2027, playable free online now. Raise footer text contrast. | S |
| C3 | Showdown, rules.html | **Major** | Zero conversion hooks at peak-intent moments. The showdown footer offers Play Again / Game Setup / Review / Home — no pitch, no signup. rules.html (5,000 px of engaged reading) contains no Kickstarter/physical mention at all. | Showdown footer button inventory; full-text search of rules.html. | One-line CTA + email field (or link to the signup) in the showdown footer and at the end of the rules page. | S |
| F1 | playgame.html | **Major** | Play-first users never learn the objective or the bust stakes. Round 1 says only "Draw your first card." The 2-bandit warning ("Two bandits in hand.") states a fact, not the consequence; "BUSTED! Review your hand…" never says the round's haul is wiped. The tutorial teaches all of this, but nothing routes players to it (no link on gamesetup; Play is the landing page's primary CTA). | Observed through a full game as a naive player; tutorial comparison ("All the $3 and 2 cows you earned this round are wiped out… That's the bust penalty."). | (a) One-time objective line at game start ("Most cows wins — bust at 3 bandits"); (b) "Two bandits — one more busts you!"; (c) bust message states the loss; (d) "First time? Try the tutorial" link on gamesetup. | S |
| F2 | playgame.html | Minor | "Buy Phase — Who goes first?" never explains that choosing is the *reward for winning the draw* (most $). The reason exists only in the collapsed log ("You choose buy order (most $ ($3))"). New players don't know why they're being asked or whether going first matters. | Observed rounds 2/5/8; log vs message comparison. | Message: "You had the most $ ($3) — choose who buys first." | S |
| F3 | playgame.html | Minor | Act transitions have no ceremony. "=== Act 1 complete! ===" / "--- Act 2 begins! ---" appear only in the collapsed log; the Store silently refills. No standings recap between acts. | Observed Act 1→2 and 2→3 transitions. | Brief interstitial banner: "Act 2 — new Store, bigger herds. Standings: Gus 12 · You 12." | M |
| F4 | playgame.html | Minor | The game log holds the entire narrative (buy-order reasons, purchases, herd adds) but is collapsed by default behind a subtle "Game Log ▼" toggle; most players will never read it. | Log inspection during play. | Surface key beats (act summaries, buy-order reason) in the message zone; keep the log as the archive. | M |
| P1 | Game pacing | **Major** (product) | The default first game is the longest version of the game. A full 2P game ran ~26 rounds across 3 acts; Quick Draw and Pioneer both default off. End-of-act rounds drag: a full draw+buy cycle can serve a single leftover Store card (rounds 8–9 of each act had 1–3 cards left). | Full 2P playthrough (9 + 9 + 8 rounds); store counts logged per round. | "Short game" preset (Quick Draw + Pioneer) surfaced on setup; nudge first-timers toward it. Bigger bet: end an act early when the Store is nearly empty (rules change — needs design). | M |
| T1 | Tutorial | Minor | The tutorial never ends. After 3 coached rounds it says "You're on your own now. Good luck." and silently continues into a full ~30-min 3-act game. No completion moment, no keep-playing/exit choice; burn, Explosives, and the showdown are never taught. | tutorial.js `complete()`; played end of coached script. | Completion popup ("You've got the basics!") with Keep Playing / Back to Home; consider one burn lesson. | M |
| M1 | playgame mobile | **Major** (*unverified on real device*) | The desktop hover zoom (#card-hover-preview, 180×252 px) can appear and persist on touch screens, covering ~half the play area. Touch fires mouseover but mouseleave is unreliable — especially when the hovered card is removed by the buy that follows. It is pointer-events:none (taps pass through) but visually blocks the Store and message. | Observed stuck over the buy phase at 375×812 (automation pointer parked on a card — same mechanism as a touch tap). | Disable the hover preview under `@media (hover: none)`; the tap→confirm dialog already provides the readable zoom. | S |
| M2 | playgame mobile | Minor | 3–4P+ Store is visually dense at 375 px: brick rows overlap heavily and it's hard to parse which cards are actually available; will worsen at 5–8P. Functional (fitPyramid keeps everything on-screen, scale ≈ .96). | 4P mobile screenshots (settled state verified by geometry). | Slightly larger vertical row offset below ~480 px, or a depth shadow separating rows. | M |
| M3 | playgame mobile | Minor | Collapsed opponent tiles' expand affordance is nearly invisible — the ▼ exists in the DOM but doesn't read as a control on the tile. Players may never discover opponents' hands. | 4P mobile screenshot + DOM check. | Make the chevron visible/tappable (right-aligned, higher contrast), or label "show hand". | S |
| D1 | playgame desktop | Minor | The red BUSTED overlay in opponent tiles collides with the tile's stats and hand cards (readable but messy, 4P and 8P rails). | 4P/8P desktop screenshots. | Dim the tile's hand under the overlay, or move BUSTED to a badge next to the name. | S |
| D2 | playgame | Polish | Transient mis-scaled pyramid flash at act start / resize (fitPyramid runs before layout settles; self-corrects). Likely a brief flash on real devices. | Captured twice mid-transition; settled geometry correct both times. | Debounce fitPyramid until images/layout settle, or fade the Store in. | S |
| X1 | playgame copy | Minor | Log/message copy inconsistencies: "adds 1 cows", "1 bandits" (pluralization); "(3$" vs "$1" (symbol placement); own-draw vs opponent-draw lines use different formats; "Buy Phase -" (hyphen) vs "Buy Phase —" (em dash). | Log excerpts from the 2P game. | One pass over addLog/setMessage strings; a tiny plural helper. | S |
| X2 | playgame | Minor | 👑 crown appears on an opponent while herds are 0–0 (draw-leader marker) with no explanation; ✓/🔥 markers likewise unexplained. | Round 1 screenshots. | Tooltip/legend ("current draw leader"), or suppress the crown until stats are nonzero. | S |
| X3 | playgame | Polish | Stats row can show negative values ("🐄 -1", "bandit -1") after on-draw modifiers — truthful but momentarily confusing. | Act 3 round 7 screenshot/state. | Keep the number, add a subtle "modifier" style or tooltip naming the card. | S |
| A1 | All pages | **Major** (accessibility) | No keyboard path and no screen-reader semantics for core play: pyramid/hand cards are divs with onclick (no tabindex/role/aria — zero ARIA attributes in play.js), and focus outlines are suppressed (outline: none) on landing links. | Code + computed-style checks. | Cheap first step: restore :focus-visible outlines site-wide. Full keyboard support for card selection is a larger effort. | S→L |
| A2 | playgame | Minor | No `prefers-reduced-motion` handling anywhere; flips/pulses/animations always run. | Grep of css/ + playgame.html. | Wrap nonessential animations in a reduced-motion media query. | S |
| PF1 | Assets | **Major** (performance) | Card images are heavily under-compressed: 94 cards at 375×525 average ~170 KB (≈16 MB total); card backs ~600 KB each — for cards rendered at ≤95 px wide (≈380 px zoom). First-game mobile load pays for this. (The eager-starters/deferred-store preload strategy is already good.) | File inventory; sips dimensions. | Batch recompress (mozjpeg q≈70 or WebP) → ~75% smaller with no visible loss at render sizes. | S |
| PF2 | Repo | Polish | Dead asset weight never fetched by users but shipped in the repo/Pages deploy: assets/symbols/texture-export.png (22 MB) + three unused ~2 MB "* Back.png" files in symbols/. | Grep shows zero references. | Delete (git history preserves them). | S |
| B1 | Firebase (bug) | Minor | A `liveSummary/null` node was written during an AI-game start (code-less write path in the AI_SPEC/pushLiveSummary flow) — a stray "active" entry keyed `null`. Cleaned up during this audit. | Observed /liveSummary/null with ts 2026-07-03 18:29 and my test-game player names. | Guard the write: skip/queue pushLiveSummary until the game code exists. | S |
| B2 | Firebase (bug) | Minor | Tutorial free-play leaks a **headerless trajectory**: after `TUTORIAL.complete()` sets active=false, the traj gate re-opens mid-game and partial records are written (observed /traj/FBEURP = {snap:2, b:1, ck:1}, no hdr) — unreplayable corpus pollution. Cleaned up during this audit. | Firebase dump of /traj/FBEURP. | Make the tutorial exclusion sticky for the whole game (e.g., G.isTutorialGame set at startGame, checked by trajActive). | S |
| B3 | Solo play | Polish (*not reproducible on visible tabs*) | No recovery valve exists in single-player: the MP "Force continue" arms only in MP, so any future AI-loop stall soft-locks a solo game with no UI out. (Observed only under background-tab timer throttling, which self-heals when the tab is foregrounded — not a live bug today.) | AI draw loop paused indefinitely in a hidden tab; no watchdog appeared. | Optional: lightweight SP watchdog (if AI makes no progress for 60 s, offer "Skip AI turn"). | M |

**Positive findings worth preserving** (do not regress): empty-name → "Cowboy" default (zero-friction
start); buy/burn confirmation dialog with zoomed card; bust flow (red highlight on the *hand* bandits,
strikethrough in the turn bar, review-before-clear); reshuffle decision prompt; host waiting room
(share link + code fallback + live slots + clean Cancel that removes the Firebase node — verified);
lobby bad-code error handling; rejoin banner; bug-report page with auto-attached game context;
history leaderboard; plain-language privacy page; desktop 4P rail and the 8P ≤900px-tall Store cap
(both verified working); turn-order bar semantics (highlight + strikethrough).

---

## 3. Journey walkthroughs

### New visitor (desktop 1280×800)
Lands on a handsome, on-theme page: title, three-card art, five buttons, footer. Reads "A
Streamlined Deck Builder" — concludes this is a web game. Nothing above the fold says *physical
game*, *Kickstarter*, or *sign up*; the footer reads as the end of the page, so the signup below it
is never seen (C1/C2). Clicks Play (correctly the most prominent button). Setup page is a clean
mobile-width column: name (optional — good), player count, AI/Human seats with difficulty, three
well-described mode checkboxes. No pointer to the tutorial (F1). Clicks Start Game and is
immediately in the game.

### First game (the naive player)
"Draw your first card." is good direct guidance, and the red Draw Card button is unmissable. The
player draws; stats appear ($, cows, bandits). At two bandits the message warns — but the player
doesn't know what three bandits *means* until it happens, and when it does, "BUSTED!" doesn't say
the haul is gone (F1); the tutorial's version of this lesson is excellent but was never offered.
The buy phase is well-handled: click a card → confirmation with a big readable card and Buy / Burn
/ Cancel. "Burn" is unexplained on first contact (X-copy). Winning the draw produces "Who goes
first?" with no stated reason (F2). Rounds flow well; act transitions pass almost silently (F3);
by Act 3 the player has been playing ~25–35 minutes (P1). The showdown is a genuine payoff — big
reveal, trophy, herd totals — and then offers Play Again/Home with no "get the physical game"
moment (C3).

### Mobile player (375×812)
Landing and setup are clean and touch-friendly. In-game, the single-column order (turn bar → act
bar → action → your zone → Store → opponents → log) is right. The 2P Store reads fine; at 4P the
brick rows compress into a dense stack that's hard to parse (M2), and opponents collapse into
header-only tiles whose expand control is effectively invisible (M3). The desktop hover-zoom can
appear on tap and linger over the middle of the screen (M1). The showdown is a long but satisfying
scroll. Nothing broke; the phone experience is playable throughout at 2P and gets progressively
more cramped with player count — as expected, but worth polish.

---

## 4. Quick wins (high impact, S effort)

1. **Landing reframe + visible signup** (C1/C2): one subtitle line + signup above the fold + footer contrast.
2. **Showdown + rules signup CTA** (C3).
3. **Stakes copy pack** (F1/F2): objective line, "one more busts you!", bust-penalty line, who-goes-first reason.
4. **Tutorial link on gamesetup** (F1).
5. **Card image recompression** (PF1) — biggest perf win available, zero design cost.
6. **Restore focus outlines** (A1 first step).
7. **Disable hover-preview on touch** (M1).
8. **Copy/pluralization pass on log strings** (X1).
9. **Firebase write guards** (B1/B2) — protects the Live Now list and the research corpus.
10. **Delete dead 28 MB of unreferenced assets** (PF2).

## 5. Bigger bets (worth planning)

- **First-session length** (P1): "Short game" preset, first-timer nudge, and (design question) early
  act termination when the Store is nearly empty — the end-of-act rounds are the flattest part of
  the loop.
- **Act interstitials with standings** (F3) + surfacing key log beats in the message zone (F4) —
  makes the three-act arc legible without opening the log.
- **Tutorial completion + coverage** (T1): an ending, an exit, and a burn/Explosive lesson.
- **Mobile Store legibility at high player counts** (M2) — revisit row offsets/shadows below 480 px.
- **Keyboard-accessible play** (A1): tabbable cards with roles/labels; pairs naturally with a
  reduced-motion pass (A2).
- **Conversion instrumentation**: today there is no way to know how many players reach the showdown
  or see the signup. Even a simple counter in Firebase (games started / finished / signups) would
  make the funnel measurable before the Kickstarter.

---

*Audit performed 2026-07-03. All test games created during the audit were removed from Firebase
(liveGames, liveSummary incl. the stray `null` key, traj, gameHistory). The audit changed no
application code.*
