// tutorial.js — Tutorial mode for Cards For Cowboys
// Loaded before play.js via a plain <script> tag in playgame.html.
// play.js calls TUTORIAL hooks at key action points when TUTORIAL.active is true.

const TUTORIAL = (() => {

  // ─── Pyramid layout ──────────────────────────────────────────────────────────
  // 14 cards for Act 1, 2-player store (2 rows of 7, brick-staggered).
  // buildPyramid() fills row 0 (top, hidden) → row 1 (bottom, face-up). IDs are
  // listed top row first, then bottom row.
  //
  //   Row 0 (hidden):  card_13, card_15, card_75, card_46, card_47, card_48, card_80
  //   Row 1 (face-up): card_10, card_11, card_77, card_74, card_76, card_79, card_12
  //                            └ card_11 (1 cow, $2) is the buy target, at row 1 col 1.
  const PYRAMID_IDS = [
    'card_13', 'card_15', 'card_75', 'card_46', 'card_47', 'card_48', 'card_80',
    'card_10', 'card_11', 'card_77', 'card_74', 'card_76', 'card_79', 'card_12',
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
      .replace(/\[river\]/g,   back('River Back.jpg',         'River'))
      .replace(/\[cactus\]/g,  back('Cactus Back.jpg',        'Cactus'))
      .replace(/\[rattle\]/g,  back('Rattlesnake Back.jpg',   'Rattlesnake'))
      .replace(/\n/g,          '<br>');
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
      message: '4 [river] River cards\nAlways $1, never a [bandit]. Completely safe to draw.',
      required: { type: 'info' },
      deckHighlight: 1,
    },
    {
      id: 'deck_cacti',
      message: '2 [cactus] Cactus cards — mixed.\nOne gives $1 + a [cow]. One carries a [bandit].',
      required: { type: 'info' },
      deckHighlight: 2,
    },
    {
      id: 'deck_rattles',
      message: '4 [rattle] Rattlesnake cards — the risky ones.\nOne pays $2 safely. Two carry 1 [bandit].\nOne carries 2 [bandit] alone.',
      required: { type: 'info' },
      deckHighlight: 3,
    },
    {
      id: 'deck_summary',
      message: 'All 10 starters: 4 are always safe [river], 6 carry some risk [cactus][rattle].\nThe more you draw, the more likely a [bandit] shows up.',
      required: { type: 'info' },
      deckHighlight: 'all',
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
      message: '$3, 0 Bandits — click "Stop Drawing" on the right to lock in your hand.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r3_buy',
      message: 'Buy the highlighted Cow card.',
      required: { type: 'buy', row: 1, col: 1 }, // card_11 (1 cow, cost $2)
      pyramidHint: { row: 1, col: 1 },
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

    // Hide the deck modal close button during deck-info steps so the player
    // can't dismiss the modal before they're supposed to.
    const deckCloseBtn = document.querySelector('#deck-modal .close-btn');
    if (deckCloseBtn) {
      deckCloseBtn.style.display = step.deckHighlight !== undefined ? 'none' : '';
    }

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

    // If we just dismissed an info popup while the draw phase is running, re-setup
    // draw buttons — startPlayerDraw was blocked by setActions guard while popup was up.
    if (step.required.type !== 'info' &&
        typeof G !== 'undefined' && G.phase === 'draw' &&
        G.players[0] && !G.players[0].busted && !G.players[0].stoppedDrawing) {
      if (typeof startPlayerDraw === 'function') startPlayerDraw();
    }
  }

  // ─── Popup UI (inline — renders into the action zone, not a floating modal) ────

  function showPopup(text) {
    const formatted = formatMsg(text);
    const msgEl = document.getElementById('message');
    if (msgEl) {
      msgEl.innerHTML = formatted;
      msgEl.classList.add('tutorial-info-msg');
    }

    const deckOpen = !document.getElementById('deck-modal')?.classList.contains('hidden');
    if (deckOpen) {
      _showDeckGotIt(formatted);
    } else {
      // Defer one tick so we win any race with synchronous setActions calls
      // (e.g. startPlayerDraw runs right after onRoundStart in the same call stack).
      // Write directly to #actions to bypass any setActions guards in play.js.
      // Bust steps use "Clear Hand" as their dismiss — skip "Got it →" for those.
      setTimeout(() => {
        if (!_popupVisible) return;
        const step = currentStep();
        if (step && step.id && step.id.includes('bust')) return;
        const actionsEl = document.getElementById('actions');
        if (!actionsEl) return;
        actionsEl.innerHTML = '';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Got it →';
        btn.onclick = () => TUTORIAL.onPopupDismiss();
        actionsEl.appendChild(btn);
      }, 0);
    }
    _popupVisible = true;
  }

  function hidePopup() {
    const msgEl = document.getElementById('message');
    if (msgEl) msgEl.classList.remove('tutorial-info-msg');
    _hideDeckGotIt();
    clearDeckHighlight();
    _popupVisible = false;
  }

  // Message + "Got it →" injected into the deck modal footer during deck info steps.
  function _showDeckGotIt(formattedHtml) {
    let footer = document.getElementById('tutorial-deck-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'tutorial-deck-footer';
      const deckContent = document.querySelector('#deck-modal .deck-content');
      if (deckContent) deckContent.appendChild(footer);
    }
    footer.innerHTML = '';
    const msg = document.createElement('p');
    msg.className = 'tutorial-deck-msg';
    msg.innerHTML = formattedHtml;
    footer.appendChild(msg);
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Got it →';
    btn.onclick = () => TUTORIAL.onPopupDismiss();
    footer.appendChild(btn);
    footer.style.display = '';
  }

  function _hideDeckGotIt() {
    const footer = document.getElementById('tutorial-deck-footer');
    if (footer) footer.style.display = 'none';
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
    const all = cactiValue === 'all';
    document.querySelectorAll('#deck-modal-body .card').forEach(el => {
      el.classList.toggle('tut-deck-highlight', all || el.dataset.cacti === String(cactiValue));
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

    // Purge any scripted draw cards still in hand/deck/discard.
    // nextRound() normally does this, but it's gated on TUTORIAL.active which
    // is already false by the time scoreRound() runs after the final buy.
    if (typeof G !== 'undefined' && G.players && G.players[0]) {
      const p = G.players[0];
      const purge = arr => arr.filter(c => !c._tutorialTemp);
      p.hand    = purge(p.hand);
      p.deck    = purge(p.deck);
      p.discard = purge(p.discard);
    }

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
    advance();
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

    get active()       { return _active;       },
    get done()         { return _done;         },
    get popupVisible() { return _popupVisible; },

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

    // Returns true during deck-info steps where the player must not close the deck.
    deckCloseBlocked() {
      if (!_active || _done) return false;
      const step = currentStep();
      return step ? step.deckHighlight !== undefined : false;
    },

    flashBlocked() {
      const el = document.getElementById('message');
      if (!el) return;
      el.classList.add('tutorial-blocked-flash');
      setTimeout(() => el.classList.remove('tutorial-blocked-flash'), 600);
    },
  };

})();
