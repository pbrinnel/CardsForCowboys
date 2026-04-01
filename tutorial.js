// tutorial.js — Tutorial mode for Cards For Cowboys
// Loaded before play.js via a plain <script> tag in playgame.html.
// play.js calls TUTORIAL hooks at key action points when TUTORIAL.active is true.

const TUTORIAL = (() => {

  // ─── Pyramid layout ──────────────────────────────────────────────────────────
  // 15 cards for Act 1, 2-player pyramid (5 rows).
  // buildPyramid() fills row 0 (top, 1 card) → row 4 (bottom, 5 cards, face-up).
  //
  //   Row 4 (face-up): card_10, card_11, card_77, card_74, card_76
  //   Row 3 (hidden):  card_12, card_13, card_15, card_75
  //   Row 2 (hidden):  card_79, card_46, card_47
  //   Row 1 (hidden):  card_80, card_48
  //   Row 0 (hidden):  card_49
  const PYRAMID_IDS = [
    'card_49',
    'card_80', 'card_48',
    'card_79', 'card_46', 'card_47',
    'card_12', 'card_13', 'card_15', 'card_75',
    'card_10', 'card_11', 'card_77', 'card_74', 'card_76',
  ];

  // ─── Draw queues (0-indexed, one array per tutorial round) ───────────────────
  const DRAW_QUEUES = [
    // Round 0 (R1): build up $+cows then forced bust
    ['starter_61', 'starter_33', 'starter_62', 'starter_64'],
    // Round 1 (R2): double-bandit surprise bust
    ['starter_92', 'starter_62', 'starter_64'],
    // Round 2 (R3): safe Rivers, stop, buy
    ['starter_91', 'starter_92', 'starter_93'],
  ];

  // ─── Script ──────────────────────────────────────────────────────────────────
  // Each step:
  //   message   – shown in the popup
  //   required  – { type } the action that advances this step
  //               'info'       → Got it in popup advances immediately
  //               'draw'       → Got it closes popup; player clicks Draw
  //               'stop'       → Got it closes popup; player clicks Stop
  //               'buy'        → Got it closes popup; player clicks pyramid card + Buy
  //               'open_deck'  → Got it closes popup; player clicks My Deck
  //               'close_deck' → Got it closes popup; player clicks × on deck modal
  //   spotlight  – CSS selector to ring after popup dismissed (action steps only)
  //   hint       – short text shown in #message after popup dismissed (action steps)
  //   pyramidHint – { row, col } pyramid card to ring (buy steps)
  const SCRIPT = [

    // ── Round 1: accumulate then forced bust ──

    {
      id: 'r1_draw1',
      message: 'Each round you draw cards from your deck to earn resources. Draw your first card.',
      hint: 'Draw a card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw2',
      // shown after drawing starter_61 ($2, safe Rattlesnake)
      message: 'A Rattlesnake card — red back. This one paid $2 with no risk. Draw again.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw3',
      // shown after drawing starter_33 ($1 + 1 cow, Cactus)
      message: 'A Cactus card — yellow back. $1 and a Cow. Cows add permanently to your Herd (the counter at bottom left). Draw again.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw4_warn',
      // shown after drawing starter_62 (1 bandit). next draw = starter_64 (2 bandits) = bust.
      message: 'A Rattlesnake with 1 Bandit. You have $3 and 2 Cows at risk — one more draw could bust you. Draw anyway.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // bust fires automatically after draw 4 (starter_64 = 2 bandits → total ≥ 3)
    {
      id: 'r1_bust_explain',
      message: '3 Bandits — BUSTED.\n\nAll $3 and 2 Cows you earned this round are wiped out. No buy phase, no score. That\'s the bust penalty.',
      required: { type: 'info' },
    },

    // ── Round 2: double-bandit surprise ──

    {
      id: 'r2_draw1',
      message: 'Draw.',
      hint: 'Draw a card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw2',
      // shown after drawing starter_92 ($1, River)
      message: 'Draw again.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw3_warn',
      // shown after drawing starter_62 (1 bandit). next draw = starter_64 = bust.
      message: '1 Bandit. Getting risky — but draw once more.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // bust fires automatically (starter_64 = 2 bandits → total ≥ 3)
    {
      id: 'r2_bust_explain',
      message: 'That Rattlesnake carried 2 Bandits at once — 3 total, instant BUST.\n\nYou can\'t see bandit counts from the card back. This is why 2 bandits is almost always the stopping point.',
      required: { type: 'info' },
    },

    // ── Deck Lesson (runs at start of Round 3's draw phase, gates the Draw button) ──

    {
      id: 'deck_open',
      message: 'Before drawing, open "My Deck" to understand what you\'re working with.',
      hint: 'Click "My Deck" above.',
      spotlight: '#btn-show-deck',
      required: { type: 'open_deck' },
    },
    {
      id: 'deck_rivers',
      message: '4 River cards (blue back) — always $1, never a Bandit. Completely safe to draw.',
      required: { type: 'info' },
    },
    {
      id: 'deck_cacti',
      message: '2 Cactus cards (yellow back) — mixed. One gives $1 and a Cow. One carries 1 Bandit with no reward.',
      required: { type: 'info' },
    },
    {
      id: 'deck_rattles',
      message: '4 Rattlesnake cards (red back) — the risky ones. One pays $2 safely. Two carry 1 Bandit. One carries 2 Bandits at once — as you just experienced.',
      required: { type: 'info' },
    },
    {
      id: 'deck_close',
      message: '4 safe cards, 6 mixed. Keep that in mind every time you consider drawing again.\n\nClose the deck.',
      hint: 'Click × to close the deck.',
      required: { type: 'close_deck' },
    },

    // ── Round 3: safe draw then stop ──

    {
      id: 'r3_draw1',
      message: 'Draw.',
      hint: 'Draw a card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw2',
      // shown after drawing starter_91 ($1, River)
      message: 'A River — safe. Draw again.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw3',
      // shown after drawing starter_92 ($1, River)
      message: 'Another River. Draw once more.',
      hint: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_stop',
      // shown after drawing starter_93 ($1, River). next card would be a Rattlesnake.
      message: 'You have $3 and 0 Bandits. The next card in your deck is a Rattlesnake. You have enough to buy something — stop here.',
      hint: 'Stop drawing.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r3_buy',
      message: 'Buy Phase. Buy this Cow card — Cows are what wins at Showdown.',
      hint: 'Click the highlighted store card, then confirm.',
      required: { type: 'buy', row: 4, col: 1 }, // card_11 (1 cow, cost $2)
      pyramidHint: { row: 4, col: 1 },
    },

    // ── End of current demo ──

    {
      id: 'done',
      message: '(This tutorial is a work in progress — more coming soon.)',
      required: { type: 'info' },
    },
  ];

  // ─── State ────────────────────────────────────────────────────────────────────
  let _active          = false;
  let _done            = false;
  let _stepIdx         = 0;
  let _round           = 0;
  let _popupVisible    = false; // true while popup is on screen (gates all actions)
  let _popupDismissed  = false; // true once popup for current step has been dismissed

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  function currentStep() {
    return SCRIPT[_stepIdx] || null;
  }

  function applyStep() {
    const step = currentStep();
    if (!step) return;

    // Don't re-show popup if player already dismissed it for this step
    // (onRoundStart can call applyStep() mid-deck-lesson, etc.)
    if (_popupDismissed) {
      // Just re-apply spotlight/hint in case it was lost
      clearSpotlight();
      if (step.spotlight) spotlightEl(step.spotlight);
      if (step.pyramidHint) highlightPyramidCard(step.pyramidHint.row, step.pyramidHint.col);
      return;
    }

    showPopup(step.message);
  }

  function advance() {
    _stepIdx++;
    _popupDismissed = false;
    _popupVisible   = false;

    const step = currentStep();
    if (!step) { complete(); return; }
    if (step.id === 'done') { applyStep(); return; } // show done popup then complete on dismiss
    applyStep();
  }

  // ─── Popup UI ─────────────────────────────────────────────────────────────────

  function showPopup(text) {
    const popup = document.getElementById('tutorial-popup');
    const textEl = document.getElementById('tutorial-popup-text');
    if (!popup || !textEl) return;
    textEl.textContent = text;
    popup.classList.remove('hidden');
    _popupVisible = true;
  }

  function hidePopup() {
    const popup = document.getElementById('tutorial-popup');
    if (popup) popup.classList.add('hidden');
    _popupVisible  = false;
    _popupDismissed = true;
  }

  // ─── Spotlight helpers ────────────────────────────────────────────────────────

  function spotlightEl(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add('tutorial-spotlight');
  }

  function clearSpotlight() {
    document.querySelectorAll('.tutorial-spotlight, .tutorial-pyramid-hint').forEach(el => {
      el.classList.remove('tutorial-spotlight', 'tutorial-pyramid-hint');
    });
  }

  function highlightPyramidCard(row, col) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`#pyramid .card[data-row="${row}"][data-col="${col}"]`);
      if (el) el.classList.add('tutorial-pyramid-hint');
    });
  }

  function showMessage(text) {
    const el = document.getElementById('message');
    if (el) el.textContent = text;
  }

  // ─── Complete ─────────────────────────────────────────────────────────────────

  function complete() {
    _active = false;
    _done   = true;
    clearSpotlight();
    document.body.classList.remove('tutorial-active');
    document.removeEventListener('keydown', _onKeyDown);
    showMessage('You\'re on your own now. Good luck.');
  }

  // ─── Draw queue injection ─────────────────────────────────────────────────────

  function injectDrawQueue(G) {
    if (_done || _round >= DRAW_QUEUES.length) return;
    const ids = DRAW_QUEUES[_round];
    const cards = ids.map(id => {
      const tmpl = (typeof STARTER_TEMPLATES !== 'undefined' ? STARTER_TEMPLATES : [])
        .concat(typeof STORE_CARDS !== 'undefined' ? STORE_CARDS : [])
        .find(t => t.id === id);
      if (!tmpl) { console.warn('Tutorial: unknown card id', id); return null; }
      const card = createCardInstance(tmpl);
      card._tutorialTemp = true; // not part of the player's permanent deck
      return card;
    }).filter(Boolean);

    const player = G.players[0];
    player.discard = [...player.deck, ...player.discard];
    player.deck    = cards;
  }

  // ─── Popup dismiss (internal, shared by button click and Enter key) ──────────

  function _dismissPopup() {
    if (!_active) return;
    const step = currentStep();
    if (!step) return;

    if (step.required.type === 'info') {
      hidePopup();
      clearSpotlight();
      if (step.id === 'done') {
        complete();
      } else {
        advance();
      }
    } else {
      hidePopup();
      clearSpotlight();
      if (step.hint) showMessage(step.hint);
      if (step.spotlight) spotlightEl(step.spotlight);
      if (step.pyramidHint) highlightPyramidCard(step.pyramidHint.row, step.pyramidHint.col);
    }
  }

  // ─── Enter key shortcut ───────────────────────────────────────────────────────

  function _onKeyDown(e) {
    if (!_active || _done) return;
    if (e.key === 'Enter' && _popupVisible) {
      e.preventDefault();
      _dismissPopup();
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {

    get active() { return _active; },
    get done()   { return _done;   },

    // Called from startGame() when ?tutorial=1 is detected.
    init(G) {
      _active         = true;
      _done           = false;
      _stepIdx        = 0;
      _round          = 0;
      _popupVisible   = false;
      _popupDismissed = false;

      document.body.classList.add('tutorial-active');
      document.addEventListener('keydown', _onKeyDown);
      G._tutorialMode = true;
    },

    getPyramidIds() {
      return PYRAMID_IDS;
    },

    // Called at the start of each draw phase (from startRound()).
    onRoundStart(G) {
      if (_done) return;
      injectDrawQueue(G);
      applyStep();
    },

    // Called from scoreRound(). Synchronous — no Promise blocking needed.
    nextRound(G) {
      if (_done) return;
      // Purge scripted draw cards so they don't accumulate in the player's deck across rounds.
      if (G && G.players && G.players[0]) {
        const p = G.players[0];
        const purge = arr => arr.filter(c => !c._tutorialTemp);
        p.deck    = purge(p.deck);
        p.discard = purge(p.discard);
        p.hand    = purge(p.hand);
      }
      _round++;
    },

    // Called when the "Got it →" button is clicked.
    onPopupDismiss() { _dismissPopup(); },

    // Returns true if the given action is currently permitted.
    isAllowed(type, params) {
      if (_done) return true;
      if (_popupVisible) return false; // popup must be dismissed first
      const step = currentStep();
      if (!step) return true;
      if (step.required.type !== type) return false;
      if (type === 'buy' || type === 'burn') {
        return step.required.row === params.row && step.required.col === params.col;
      }
      return true;
    },

    // Called after an allowed action completes.
    onActionDone(type) {
      if (_done) return;
      const step = currentStep();
      if (!step) return;
      if (step.required.type === type) advance();
    },

    // Called when player's buy phase begins (humanBuyTurn).
    onBuyPhaseStart() {
      if (_done) return;
      const step = currentStep();
      if (!step) return;
      if (step.required.type === 'buy' || step.required.type === 'burn') {
        if (!_popupDismissed) {
          applyStep();
        } else {
          highlightPyramidCard(step.pyramidHint?.row, step.pyramidHint?.col);
        }
      }
    },

    // Called when the human player busts.
    // Skips past remaining 'draw' steps to land on the bust_explain step.
    onBust() {
      if (_done) return;
      _popupDismissed = false;
      _popupVisible   = false;
      while (_stepIdx < SCRIPT.length) {
        const step = SCRIPT[_stepIdx];
        if (!step || step.required.type !== 'draw') break;
        _stepIdx++;
      }
      applyStep();
    },

    flashBlocked() {
      const el = document.getElementById('message');
      if (!el) return;
      el.classList.add('tutorial-blocked-flash');
      setTimeout(() => el.classList.remove('tutorial-blocked-flash'), 600);
    },
  };

})();
