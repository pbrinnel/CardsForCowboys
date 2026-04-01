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

  // ─── Message formatter ────────────────────────────────────────────────────────
  // Used for popup messages (info steps) only.
  // Tags are replaced with small inline images matching the rules page assets.
  function formatMsg(text) {
    const sym = (src, alt) =>
      `<img class="tut-sym" src="assets/symbols/${src}" alt="${alt}">`;
    const back = (src, alt) =>
      `<img class="tut-back" src="assets/backs/${src}" alt="${alt}">`;

    return text
      .replace(/\[bandit\]/g,  sym('1 Bandit-01.png',         'Bandit'))
      .replace(/\[cow\]/g,     sym('1 Cow-01.png',            'Cow'))
      .replace(/\[dollar\]/g,  sym('$1-01.png',               '$'))
      .replace(/\[river\]/g,   back('Blue Inline-01.jpg',     'River'))
      .replace(/\[cactus\]/g,  back('Yellow Inline-01.jpg',   'Cactus'))
      .replace(/\[rattle\]/g,  back('Red Inline-01.jpg',      'Rattlesnake'));
  }

  // ─── Script ──────────────────────────────────────────────────────────────────
  // Each step:
  //   message   – popup text (info steps) or message-area text (action steps)
  //   required  – { type } the action that satisfies this step
  //               'info'       → popup shown; Got it / Enter advances immediately
  //               'draw'       → message shown in action zone; player clicks Draw
  //               'stop'       → message shown; player clicks Stop
  //               'buy'        → message shown; player clicks pyramid card + Buy
  //               'open_deck'  → message shown; player clicks My Deck
  //               'close_deck' → message shown; player closes deck modal
  //   spotlight  – CSS selector to ring (action steps only)
  //   pyramidHint – { row, col } pyramid card to highlight (buy steps)
  const SCRIPT = [

    // ── Round 1: accumulate then forced bust ──

    {
      id: 'r1_draw1',
      message: 'Draw your first card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw2',
      // after drawing starter_61 ($2, safe Rattlesnake)
      message: 'Rattlesnake — $2, no Bandits. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw3',
      // after drawing starter_33 ($1 + 1 cow, Cactus)
      message: 'Cactus — $1 and a Cow. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw4_warn',
      // after drawing starter_62 (1 bandit). next draw = starter_64 (2 bandits) = bust.
      message: '1 Bandit — $3 and 2 Cows at risk. Draw anyway.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // bust fires automatically after draw 4 (starter_64 = 2 bandits → total ≥ 3)
    {
      id: 'r1_bust_explain',
      message: '3 [bandit] — BUSTED.\n\nAll the $3 and 2 [cow] you earned this round are wiped out. No buy phase, no score. That\'s the bust penalty.',
      required: { type: 'info' },
    },

    // ── Round 2: double-bandit surprise ──

    {
      id: 'r2_draw1',
      message: 'Draw a card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw2',
      // after drawing starter_92 ($1, River)
      message: 'River — safe. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw3_warn',
      // after drawing starter_62 (1 bandit). next draw = starter_64 = bust.
      message: '1 Bandit. Draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // bust fires automatically (starter_64 = 2 bandits → total ≥ 3)
    {
      id: 'r2_bust_explain',
      message: 'That [rattle] card carried 2 [bandit] at once — 3 total, instant BUST.\n\nYou can\'t see Bandit counts from the card back. Stopping at 2 [bandit] is almost always the right call.',
      required: { type: 'info' },
    },

    // ── Deck Lesson (at start of Round 3's draw phase) ──

    {
      id: 'deck_open',
      message: 'Open "My Deck" to see what you\'re working with.',
      spotlight: '#btn-show-deck',
      required: { type: 'open_deck' },
    },
    {
      id: 'deck_rivers',
      message: '4 [river] River cards — always $1, never a [bandit]. Completely safe to draw.',
      required: { type: 'info' },
      deckHighlight: 1,
    },
    {
      id: 'deck_cacti',
      message: '2 [cactus] Cactus cards — mixed. One gives $1 and a [cow]. One carries a [bandit] with no reward.',
      required: { type: 'info' },
      deckHighlight: 2,
    },
    {
      id: 'deck_rattles',
      message: '4 [rattle] Rattlesnake cards — the risky ones. One pays $2 safely. Two carry 1 [bandit]. One carries 2 [bandit] — as you just saw.\n\n4 safe cards, 6 mixed. Keep that in mind every time you consider drawing again.',
      required: { type: 'info' },
      deckHighlight: 3,
    },
    {
      id: 'deck_close',
      message: 'Close the deck.',
      required: { type: 'close_deck' },
    },

    // ── Round 3: safe draws then stop and buy ──

    {
      id: 'r3_draw1',
      message: 'Draw a card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw2',
      // after drawing starter_91 ($1, River)
      message: 'River — safe. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw3',
      // after drawing starter_92 ($1, River)
      message: 'Another River. Draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_stop',
      // after drawing starter_93 ($1, River). next card would be a Rattlesnake.
      message: '$3, 0 Bandits — stop here.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r3_buy',
      message: 'Buy the highlighted Cow card.',
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
  let _active       = false;
  let _done         = false;
  let _stepIdx      = 0;
  let _round        = 0;
  let _popupVisible = false; // true while a popup is on screen (gates all actions)

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  function currentStep() {
    return SCRIPT[_stepIdx] || null;
  }

  function applyStep() {
    const step = currentStep();
    if (!step) return;
    clearSpotlight();

    if (step.required.type === 'info') {
      // Info step: show popup — player must dismiss before anything else
      showPopup(step.message);
      if (step.deckHighlight) highlightDeckCards(step.deckHighlight);
    } else {
      // Action step: show hint in message area and spotlight the target
      if (step.message) showMessage(step.message);
      if (step.spotlight) spotlightEl(step.spotlight);
      if (step.pyramidHint) highlightPyramidCard(step.pyramidHint.row, step.pyramidHint.col);
    }
  }

  function advance() {
    _stepIdx++;
    _popupVisible = false;

    const step = currentStep();
    if (!step) { complete(); return; }
    applyStep();
  }

  // ─── Popup UI ─────────────────────────────────────────────────────────────────

  function showPopup(text) {
    const popup = document.getElementById('tutorial-popup');
    const textEl = document.getElementById('tutorial-popup-text');
    if (!popup || !textEl) return;
    textEl.innerHTML = formatMsg(text);
    const deckOpen = !document.getElementById('deck-modal')?.classList.contains('hidden');
    popup.classList.toggle('tutorial-popup--below', deckOpen);
    popup.classList.remove('hidden');
    _popupVisible = true;
    if (deckOpen) _centerDeckPopupPair();
  }

  // Center the deck modal + tutorial popup as a pair vertically on screen.
  function _centerDeckPopupPair() {
    requestAnimationFrame(() => {
      const deckOverlay  = document.getElementById('deck-modal');
      const deckContent  = deckOverlay?.querySelector('.deck-content');
      const popup        = document.getElementById('tutorial-popup');
      if (!deckOverlay || !deckContent || !popup) return;

      const gap     = 12;
      const deckH   = deckContent.offsetHeight;
      const popupH  = popup.offsetHeight;
      const totalH  = deckH + gap + popupH;
      const screenH = window.innerHeight;
      const topOffset = Math.max(8, (screenH - totalH) / 2);

      // Push deck modal down to topOffset
      deckOverlay.style.alignItems = 'flex-start';
      deckOverlay.style.paddingTop  = topOffset + 'px';

      // Position popup directly below the deck content
      const deckRect = deckContent.getBoundingClientRect();
      popup.style.top       = (deckRect.bottom + gap) + 'px';
      popup.style.bottom    = 'auto';
      popup.style.transform = 'translateX(-50%)';
    });
  }

  function hidePopup() {
    const popup      = document.getElementById('tutorial-popup');
    const deckOverlay = document.getElementById('deck-modal');
    if (popup) {
      popup.classList.add('hidden');
      popup.classList.remove('tutorial-popup--below');
      popup.style.top = popup.style.bottom = popup.style.transform = '';
    }
    if (deckOverlay) {
      deckOverlay.style.alignItems = deckOverlay.style.paddingTop = '';
    }
    clearDeckHighlight();
    _popupVisible = false;
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

  function highlightDeckCards(cactiValue) {
    document.querySelectorAll('#deck-modal-body .card').forEach(el => {
      el.classList.toggle('tut-deck-highlight', el.dataset.cacti === String(cactiValue));
    });
  }

  function clearDeckHighlight() {
    document.querySelectorAll('#deck-modal-body .tut-deck-highlight').forEach(el => {
      el.classList.remove('tut-deck-highlight');
    });
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

  // ─── Popup dismiss (internal — shared by button click and Enter key) ──────────

  function _dismissPopup() {
    if (!_active) return;
    const step = currentStep();
    if (!step || step.required.type !== 'info') return;

    hidePopup();
    clearSpotlight();
    if (step.id === 'done') {
      complete();
    } else {
      advance();
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
      _active       = true;
      _done         = false;
      _stepIdx      = 0;
      _round        = 0;
      _popupVisible = false;

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

    // Called from scoreRound(). Purges temp draw cards and advances the round counter.
    nextRound(G) {
      if (_done) return;
      // Purge scripted draw cards so they don't accumulate in the player's permanent deck.
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

    // Called when the human player's buy phase begins.
    onBuyPhaseStart() {
      if (_done) return;
      const step = currentStep();
      if (!step) return;
      if (step.required.type === 'buy' || step.required.type === 'burn') {
        applyStep();
      }
    },

    // Called when the human player busts.
    // Skips past remaining 'draw' steps to land on the bust_explain step.
    onBust() {
      if (_done) return;
      _popupVisible = false;
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
