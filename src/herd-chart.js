// ============================================================
// HERD CHART — end-of-game "cows per round" line graph.
//
// ONE renderer, TWO surfaces:
//   • playgame.html — inside #showdown-footer, revealed with the winner title
//   • spectate.html — inside #spec-showdown (which also serves history.html's
//     "Review" link, since that just opens spectate on the persisted snapshot)
//
// It can be shared without an adapter on either side because spectatorState's
// player records deliberately mirror G.players field names (name / isHuman /
// slotIdx / herd / herdHistory / bustRounds). Both callers pass the objects
// they already hold. Do NOT add a per-surface massaging step — if a field is
// missing on one side, fix the serializer in buildSpectatorState instead.
//
// Loaded as a CLASSIC script exposing a global, the same idiom as
// sim/tiebreaker.js. play.js is not a module and showShowdownResult/gameOver
// are synchronous, so a global avoids making the rejoin path async.
// spectate.html's <script type="module"> is deferred, so a plain <script> tag
// above it has already run by the time the module body executes.
//
// Self-contained: injects its own stylesheet once. Neither page carries CSS
// for it, so there is nothing to keep in sync.
// ============================================================

window.CFC_HerdChart = (() => {

  // Series colour is keyed by slotIdx, NOT array index: G.players is you-first
  // while spectatorState.players is host slot order, so index colouring would
  // paint the same game differently on your screen and a spectator's.
  const SERIES_COLORS = [
    '#1e1610', // 0 ink
    '#b03a2e', // 1 brick
    '#1f6f8b', // 2 steel blue
    '#c98a1b', // 3 gold
    '#4a7c2f', // 4 olive
    '#7d3c98', // 5 plum
    '#d2603a', // 6 coral
    '#2f4f7a', // 7 navy
  ];

  // Shape is a second, colour-independent channel. Eight hues alone are not
  // distinguishable (and blue/yellow/red are already the suit colours), so
  // marker shape + the direct end-of-line name label carry the identification.
  const SERIES_SHAPES = [
    'circle', 'square', 'triangle', 'diamond',
    'triangleDown', 'plus', 'hexagon', 'pentagon',
  ];

  const BUST_COLOR = '#a8322b'; // sibling of the bandit red in setBanditCount()

  const NS = 'http://www.w3.org/2000/svg';

  // Chart box, in viewBox units. The SVG scales freely to the container width —
  // deliberately NO min-width. A min-width put the whole right-hand label column
  // behind a horizontal scrollbar on a phone, which is where the player names and
  // final totals live. Type is sized in viewBox units generous enough to stay
  // legible once scaled down to ~480px instead.
  const W = 760, H = 340;
  const PAD_L = 46, PAD_R = 152, PAD_T = 26, PAD_B = 46;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;

  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  // Firebase stores a sparse array as an object with numeric keys, and drops an
  // empty array entirely. Accept every shape and return a dense array with holes
  // as null (a hole should never occur in normal play — scoreRound writes every
  // round for every player — but a hole must not shift the x-axis if one does).
  function toSeries(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(v => (typeof v === 'number' ? v : null));
    const keys = Object.keys(raw).map(Number).filter(n => Number.isFinite(n));
    if (!keys.length) return [];
    const out = new Array(Math.max(...keys) + 1).fill(null);
    keys.forEach(k => { if (typeof raw[k] === 'number') out[k] = raw[k]; });
    return out;
  }

  function toRoundSet(raw) {
    const vals = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
    return new Set(vals.filter(n => typeof n === 'number'));
  }

  // Integer y ticks: pick the step first, then let it define the top of the axis.
  function niceStep(raw) {
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function markerEl(shape, x, y, r, fill) {
    const pts = (list) => list.map(p => p.join(',')).join(' ');
    switch (shape) {
      case 'square':
        return svgEl('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, fill });
      case 'diamond':
        return svgEl('polygon', { points: pts([[x, y - r * 1.3], [x + r * 1.3, y], [x, y + r * 1.3], [x - r * 1.3, y]]), fill });
      case 'triangle':
        return svgEl('polygon', { points: pts([[x, y - r * 1.4], [x + r * 1.3, y + r], [x - r * 1.3, y + r]]), fill });
      case 'triangleDown':
        return svgEl('polygon', { points: pts([[x, y + r * 1.4], [x + r * 1.3, y - r], [x - r * 1.3, y - r]]), fill });
      case 'plus': {
        const t = r * 0.55;
        return svgEl('polygon', {
          points: pts([[x - t, y - r], [x + t, y - r], [x + t, y - t], [x + r, y - t], [x + r, y + t],
            [x + t, y + t], [x + t, y + r], [x - t, y + r], [x - t, y + t], [x - r, y + t],
            [x - r, y - t], [x - t, y - t]]),
          fill,
        });
      }
      case 'hexagon': {
        const p = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          p.push([x + r * 1.15 * Math.cos(a), y + r * 1.15 * Math.sin(a)]);
        }
        return svgEl('polygon', { points: pts(p), fill });
      }
      case 'pentagon': {
        const p = [];
        for (let i = 0; i < 5; i++) {
          const a = (2 * Math.PI / 5) * i - Math.PI / 2;
          p.push([x + r * 1.25 * Math.cos(a), y + r * 1.25 * Math.sin(a)]);
        }
        return svgEl('polygon', { points: pts(p), fill });
      }
      default:
        return svgEl('circle', { cx: x, cy: y, r, fill });
    }
  }

  // A bust is marked with a red X rather than a series marker: it is an event,
  // not a data identity, so it reads the same on every line. It also explains a
  // flat segment that would otherwise be ambiguous ("busted" vs "scored no cows").
  function bustEl(x, y, round) {
    const g = svgEl('g', { class: 'cfc-hc-bust' });
    const r = 4.6;
    g.appendChild(svgEl('line', { x1: x - r, y1: y - r, x2: x + r, y2: y + r }));
    g.appendChild(svgEl('line', { x1: x - r, y1: y + r, x2: x + r, y2: y - r }));
    g.appendChild(svgEl('title', null, `Busted in round ${round}`));
    return g;
  }

  function injectCss() {
    if (document.getElementById('cfc-herd-chart-css')) return;
    const s = document.createElement('style');
    s.id = 'cfc-herd-chart-css';
    s.textContent = `
.cfc-herd-chart {
  background: #e9e0c6;
  border: 2px solid #1e1610;
  box-shadow: 2px 2px 0 #1e1610;
  padding: 0.7rem 0.6rem 0.5rem;
  margin: 0 0 1rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.cfc-herd-chart figcaption {
  font-family: 'Playfair Display', Georgia, serif;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 2px;
  font-size: 0.9rem;
  color: #1e1610;
  text-align: center;
  margin-bottom: 0.15rem;
}
.cfc-herd-chart .cfc-hc-sub {
  text-align: center;
  font-size: 0.72rem;
  font-style: italic;
  color: rgba(30,22,16,0.65);
  margin-bottom: 0.35rem;
}
.cfc-herd-chart svg { display: block; width: 100%; height: auto; }
.cfc-hc-grid { stroke: rgba(30,22,16,0.14); stroke-width: 1; }
.cfc-hc-axis { stroke: rgba(30,22,16,0.55); stroke-width: 1.5; }
.cfc-hc-tick {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 15px; fill: rgba(30,22,16,0.7);
}
.cfc-hc-name {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 16px; font-weight: bold; dominant-baseline: middle;
}
.cfc-hc-leader { stroke: rgba(30,22,16,0.3); stroke-width: 1; fill: none; }
.cfc-hc-line { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.cfc-hc-line.showdown-leg { stroke-dasharray: 6 4; }
.cfc-hc-bust line { stroke: ${BUST_COLOR}; stroke-width: 2.2; stroke-linecap: round; }
.cfc-hc-sd-band { fill: rgba(30,22,16,0.05); }
.cfc-hc-sd-rule { stroke: rgba(30,22,16,0.25); stroke-width: 1; stroke-dasharray: 3 3; }

/* Reveal: only playgame passes animate:true (it mounts once). spectate re-renders on
   every snapshot, where a restarting animation would flicker.
   A stroke-dasharray "draw-in" was tried and removed: it needs getTotalLength(), and
   when the rAF measured a path the browser had not finished laying out, the short
   length became a dash PATTERN — lines rendered as stubs with the rest invisible.
   A plain opacity fade needs no measurement and cannot fail that way. */
@keyframes cfc-hc-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.cfc-herd-chart.anim { animation: cfc-hc-fade 0.5s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .cfc-herd-chart.anim { animation: none; opacity: 1; transform: none; }
}`;
    document.head.appendChild(s);
  }

  /**
   * Render the herd chart into `container`.
   *
   * @param {Element} container
   * @param {Object}  opts
   * @param {Array}   opts.players  G.players or spectatorState.players
   * @param {number}  opts.round    G.roundNumber / state.round
   * @param {string}  opts.phase    G.phase / state.phase
   * @param {number} [opts.youIndex]  index to label "You" (play.js passes 0)
   * @param {boolean}[opts.animate]   draw-in animation (play.js only)
   * @returns {boolean} false when there is nothing to draw (pre-existing games
   *          finished before herdHistory shipped) — callers hide the container.
   */
  function render(container, opts) {
    if (!container) return false;
    container.innerHTML = '';
    const players = (opts && opts.players) || [];
    if (!players.length) return false;

    const youIndex = (opts && typeof opts.youIndex === 'number') ? opts.youIndex : -1;
    const phase = opts && opts.phase;
    const hasShowdown = phase === 'showdown' || phase === 'gameOver' || phase === 'gameover';
    const round = (opts && opts.round) || 0;

    // Names are player-supplied, so cap them — the label column is a fixed 152 units
    // and a long name would run off the right edge of the viewBox.
    const short = (n) => (n.length > 11 ? n.slice(0, 10) + '…' : n);

    const series = players.map((p, i) => ({
      name: i === youIndex ? 'You' : short(String(p.name || `P${i + 1}`)),
      slotIdx: typeof p.slotIdx === 'number' ? p.slotIdx : i,
      points: toSeries(p.herdHistory),
      busts: toRoundSet(p.bustRounds),
    }));

    const maxLen = Math.max(0, ...series.map(s => s.points.length));
    if (!maxLen) return false; // legacy game: no history was ever captured

    // The Showdown occupies index G.roundNumber — one past the last scored round.
    const sdIdx = hasShowdown ? round : -1;
    const nCols = Math.max(maxLen, sdIdx >= 0 ? sdIdx + 1 : 0);

    const values = series.flatMap(s => s.points.filter(v => typeof v === 'number'));
    if (!values.length) return false;
    const step = niceStep(Math.max(1, Math.max(...values)) / 4);
    const yMax = Math.max(step * 4, Math.ceil(Math.max(...values) / step) * step);

    const x = (i) => (nCols === 1 ? PAD_L + PLOT_W / 2 : PAD_L + (i * PLOT_W) / (nCols - 1));
    const y = (v) => PAD_T + PLOT_H - (v / yMax) * PLOT_H;

    injectCss();

    const fig = document.createElement('figure');
    fig.className = 'cfc-herd-chart';
    const cap = document.createElement('figcaption');
    cap.textContent = 'Herd by Round';
    fig.appendChild(cap);
    const sub = document.createElement('div');
    sub.className = 'cfc-hc-sub';
    sub.textContent = series.some(s => s.busts.size)
      ? 'Cows in each herd after every round. ✕ marks a bust.'
      : 'Cows in each herd after every round.';
    fig.appendChild(sub);

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': 'Herd size by round. Final herds: ' +
        series.map(s => `${s.name} ${s.points.filter(v => v != null).slice(-1)[0] ?? 0}`).join(', ') + '.',
    });

    // --- Showdown band: the last column is a different kind of event, so it gets
    // its own shaded strip rather than pretending to be another round.
    if (sdIdx > 0 && nCols > 1) {
      const bandL = (x(sdIdx - 1) + x(sdIdx)) / 2;
      svg.appendChild(svgEl('rect', {
        class: 'cfc-hc-sd-band',
        x: bandL, y: PAD_T, width: (W - PAD_R) - bandL, height: PLOT_H,
      }));
      svg.appendChild(svgEl('line', {
        class: 'cfc-hc-sd-rule', x1: bandL, y1: PAD_T, x2: bandL, y2: PAD_T + PLOT_H,
      }));
    }

    // --- Y grid + ticks
    const nTicks = Math.round(yMax / step);
    for (let t = 0; t <= nTicks; t++) {
      const v = t * step;
      const yy = y(v);
      svg.appendChild(svgEl('line', { class: 'cfc-hc-grid', x1: PAD_L, y1: yy, x2: W - PAD_R, y2: yy }));
      svg.appendChild(svgEl('text', {
        class: 'cfc-hc-tick', x: PAD_L - 8, y: yy, 'text-anchor': 'end', 'dominant-baseline': 'middle',
      }, String(v)));
    }
    svg.appendChild(svgEl('line', {
      class: 'cfc-hc-axis', x1: PAD_L, y1: PAD_T + PLOT_H, x2: W - PAD_R, y2: PAD_T + PLOT_H,
    }));

    // --- X ticks. Thin the round labels when the game ran long; the Showdown
    // column is always labelled.
    const everyN = nCols > 14 ? 2 : 1;
    for (let i = 0; i < nCols; i++) {
      const isSd = i === sdIdx;
      if (!isSd && i % everyN !== 0 && i !== nCols - 1) continue;
      svg.appendChild(svgEl('text', {
        class: 'cfc-hc-tick', x: x(i), y: PAD_T + PLOT_H + 18, 'text-anchor': 'middle',
      }, isSd ? 'Showdown' : String(i + 1)));
    }
    svg.appendChild(svgEl('text', {
      class: 'cfc-hc-tick', x: PAD_L + PLOT_W / 2, y: H - 6, 'text-anchor': 'middle',
    }, 'Round'));

    // --- Series
    const linesG = svgEl('g');
    const marksG = svgEl('g');
    const labelsG = svgEl('g');

    series.forEach((s) => {
      const color = SERIES_COLORS[s.slotIdx % SERIES_COLORS.length];
      const shape = SERIES_SHAPES[s.slotIdx % SERIES_SHAPES.length];

      // Split at holes so a missing round breaks the line instead of faking a value.
      const runs = [];
      let cur = [];
      for (let i = 0; i < s.points.length; i++) {
        const v = s.points[i];
        if (typeof v === 'number') cur.push({ i, v });
        else if (cur.length) { runs.push(cur); cur = []; }
      }
      if (cur.length) runs.push(cur);
      if (!runs.length) return;

      const pathD = (pts) => pts.map((pt, k) => `${k ? 'L' : 'M'}${x(pt.i)},${y(pt.v)}`).join(' ');

      runs.forEach((run) => {
        // The leg into the Showdown column is dashed — it is a one-off bonus, not
        // another round of play, and shouldn't read as part of the trend.
        const sdSplit = run.findIndex(pt => pt.i === sdIdx);
        const mainPts = sdSplit > 0 ? run.slice(0, sdSplit) : run;
        const sdPts = sdSplit > 0 ? run.slice(sdSplit - 1) : [];

        if (mainPts.length >= 2) {
          linesG.appendChild(svgEl('path', { class: 'cfc-hc-line', d: pathD(mainPts), stroke: color }));
        }
        if (sdPts.length >= 2) {
          linesG.appendChild(svgEl('path', {
            class: 'cfc-hc-line showdown-leg', d: pathD(sdPts), stroke: color,
          }));
        }
      });

      // Markers
      const allPts = runs.flat();
      allPts.forEach((pt) => {
        const px = x(pt.i), py = y(pt.v);
        const roundNo = pt.i + 1;
        if (pt.i !== sdIdx && s.busts.has(roundNo)) {
          marksG.appendChild(bustEl(px, py, roundNo));
          return;
        }
        const m = markerEl(shape, px, py, pt.i === sdIdx ? 4.4 : 3.4, color);
        m.appendChild(svgEl('title', null,
          `${s.name} — ${pt.i === sdIdx ? 'Showdown' : 'Round ' + roundNo}: ${pt.v} cows`));
        marksG.appendChild(m);
      });

      const last = allPts[allPts.length - 1];
      // dataY is the true point; y is nudged by the collision pass below.
      if (last) {
        s._label = { x: x(last.i), y: y(last.v), dataY: y(last.v), color, text: `${s.name} ${last.v}` };
      }
    });

    // --- End-of-line labels, nudged apart so 8 players stay readable. A legend
    // would force a colour lookup; direct labels don't.
    const labels = series.map(s => s._label).filter(Boolean).sort((a, b) => a.y - b.y);
    const GAP = 16;
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < GAP) labels[i].y = labels[i - 1].y + GAP;
    }
    const overflow = labels.length ? labels[labels.length - 1].y - (PAD_T + PLOT_H) : 0;
    if (overflow > 0) {
      for (let i = labels.length - 1; i >= 0; i--) {
        labels[i].y -= overflow;
        if (i > 0 && labels[i].y - labels[i - 1].y >= GAP) break;
      }
    }
    const labelX = (labels.length ? Math.max(...labels.map(l => l.x)) : PAD_L) + 12;
    labels.forEach((L) => {
      // Leader line back to the real data point, so a nudged label still reads
      // as belonging to its line.
      labelsG.appendChild(svgEl('path', {
        class: 'cfc-hc-leader', d: `M${L.x + 6},${L.dataY} L${labelX - 4},${L.y}`,
      }));
      labelsG.appendChild(svgEl('text', {
        class: 'cfc-hc-name', x: labelX, y: L.y, fill: L.color,
      }, L.text));
    });

    svg.appendChild(linesG);
    svg.appendChild(marksG);
    svg.appendChild(labelsG);
    fig.appendChild(svg);
    if (opts && opts.animate) fig.classList.add('anim');
    container.appendChild(fig);

    return true;
  }

  return { render };
})();
