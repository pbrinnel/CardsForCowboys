# mockups/

Throwaway design mockups. **Nothing here ships and nothing links to it from the site.**

These exist so a UI change can be looked at, compared, and chosen before any of it
touches `src/` or `css/`. Once the decision is made and implemented, the mockup is a
record of *why* — keep it or delete it, but do not wire it into the game.

## Convention for a new mockup

1. **Put it here**, not at the repo root. Three of these were floating loose before
   August 2026 (`demo/layout-demo.html`, `mockup-collapse*.html`).
2. **Load the real stylesheets** — `../css/play.css` etc. A mockup styled from scratch
   proves nothing about how the change lands in the actual game.
3. **Paths are one level up** (`../css/`, `../assets/`). Serve from the repo root so
   they resolve: `.claude/launch.json` → `http://localhost:5500/mockups/<file>.html`.
4. **If it mocks a mobile layout, render it in a 375px `<iframe>`.** A 375px-wide
   *column* inside a desktop page does NOT match `@media (max-width: 768px)`, so the
   real mobile rules never fire and the mockup lies to you. See below.

## Contents

| File | What it compared | Outcome |
|---|---|---|
| `opponent-collapse.html` + `opponent-collapse-frame.html` | Three ways to signify that opponent hand zones expand/collapse. The shipped chevron was `rgba(233,224,198,.5)` on `#e9e0c6` — identical RGB, contrast 1.00:1, invisible. | **Option B (peek strip) chosen** Aug 2026 and implemented, together with per-opponent toggling. |
| `layout-demo.html` | Wide-screen tile layout for the game page (May 2026). Self-contained, no external refs. | Fed the opponent-rail layout now in `playgame.html`. |

### The iframe trap, concretely

`opponent-collapse.html` renders each phone as a real 375px `<iframe>` of
`opponent-collapse-frame.html?opt=A|B|C|NOW`. The first version of that mockup used
375px *columns* instead, and the opponent header rendered at desktop font sizes and
wrapped to two lines — something it never does on an actual phone. Every measurement
taken from it was wrong.

The frame posts its measured collapsed-bar height up to the shell, so the captions
under each option are read from the DOM rather than typed in by hand and left to rot.
