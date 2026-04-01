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
  //
  // Reveal logic — (R,C) revealed when both (R+1,C) and (R+1,C+1) are gone:
  //   card_12 (3,0): after card_10 (4,0) AND card_11 (4,1) removed
  //   card_13 (3,1): after card_11 (4,1) AND card_77 (4,2) removed
  //   card_15 (3,2): after card_77 (4,2) AND card_74 (4,3) removed
  //   card_75 (3,3): after card_74 (4,3) AND card_76 (4,4) removed
  const PYRAMID_IDS = [
    'card_49',
    'card_80', 'card_48',
    'card_79', 'card_46', 'card_47',
    'card_12', 'card_13', 'card_15', 'card_75',
    'card_10', 'card_11', 'card_77', 'card_74', 'card_76',
  ];

  // ─── Draw queues (0-indexed, one array per tutorial round) ───────────────────
  // Injected into the player's deck at the start of each draw phase.
  const DRAW_QUEUES = [
    // Round 0 (tutorial R1): build up resources, then 3-bandit bust
    // starter_61 ($2) → starter_33 ($1+1cow) → starter_62 (1 bandit+1cow) → starter_64 (2 bandits) = BUST
    ['starter_61', 'starter_33', 'starter_62', 'starter_64'],

    // Round 1 (tutorial R2): double-bandit surprise bust
    // starter_92 ($1) → starter_62 (1 bandit) → starter_64 (2 bandits) = BUST
    ['starter_92', 'starter_62', 'starter_64'],

    // Round 2 (tutorial R3): safe draw then stop and buy
    // Three Rivers → $3, 0 bandits
    ['starter_91', 'starter_92', 'starter_93'],
  ];

  // ─── Script ──────────────────────────────────────────────────────────────────
  // Each step:
  //   message       – shown in #message (or #tutorial-deck-note if inModal: true)
  //   spotlight     – CSS selector of element to ring (or null)
  //   required      – { type } the action that advances this step
  //                   types: 'draw' | 'stop' | 'buy' | 'burn' | 'activate' |
  //                          'open_deck' | 'close_deck' | 'auto'
  //   autoAdvanceMs – if type === 'auto', advance after this many ms
  //   pyramidHint   – { row, col } pyramid card to ring (in addition to spotlight)
  //   inModal       – true: write message to #tutorial-deck-note instead of #message
  const SCRIPT = [

    // ── Round 1: accumulate resources → forced bust ──

    {
      id: 'r1_draw1',
      message: 'Each round you draw cards from your deck to earn resources. Draw your first card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw2',
      // shown after drawing starter_61 ($2, safe Rattlesnake)
      message: 'A Rattlesnake card — red back. This one paid $2 with no risk. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw3',
      // shown after drawing starter_33 ($1+1 cow, safe Cactus)
      message: 'A Cactus card — $1 and a Cow. Cows add permanently to your Herd (bottom left). Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw4_warn',
      // shown after drawing starter_62 (1 bandit). next draw = starter_64 (2 bandits) = bust.
      message: 'A Rattlesnake with 1 Bandit. You have $3 and 2 Cows at risk. One more draw could bust you — draw anyway.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // bust fires automatically after draw4 (starter_64 adds 2 bandits → total ≥ 3)
    // onBust() skips past this draw step and lands here:
    {
      id: 'r1_bust_explain',
      message: '3 Bandits — BUSTED. All $3 and 2 Cows you earned this round are wiped out. No buy phase, no score. That\'s the bust penalty.',
      spotlight: null,
      required: { type: 'auto' },
      autoAdvanceMs: 4500,
    },

    // ── Round 2: 1 bandit then double-bandit surprise ──

    {
      id: 'r2_draw1',
      message: 'Draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw2',
      // shown after drawing starter_92 ($1, safe River)
      message: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw3_warn',
      // shown after drawing starter_62 (1 bandit). next draw = starter_64 = bust.
      message: '1 Bandit. Getting risky — but draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // bust fires automatically after draw3 (starter_64 adds 2 bandits → total ≥ 3)
    {
      id: 'r2_bust_explain',
      message: 'That Rattlesnake carried 2 Bandits at once — 3 total, instant BUST. You can\'t tell how many bandits a card holds until you draw it. 2 bandits is almost always the stopping point.',
      spotlight: null,
      required: { type: 'auto' },
      autoAdvanceMs: 5000,
    },

    // ── Deck Lesson (between rounds 2 and 3) ──
    // These steps run while scoreRound() awaits TUTORIAL.nextRound().

    {
      id: 'deck_open',
      message: 'Before your next draw, open "My Deck" to see what you\'re working with.',
      spotlight: '#btn-show-deck',
      required: { type: 'open_deck' },
    },
    {
      id: 'deck_rivers',
      inModal: true,
      message: '4 River cards (blue back) — always $1, never a Bandit. Completely safe to draw.',
      required: { type: 'auto' },
      autoAdvanceMs: 3000,
    },
    {
      id: 'deck_cacti',
      inModal: true,
      message: '2 Cactus cards (yellow back) — mixed. One gives $1 and a Cow. One carries 1 Bandit with no reward.',
      required: { type: 'auto' },
      autoAdvanceMs: 3500,
    },
    {
      id: 'deck_rattles',
      inModal: true,
      message: '4 Rattlesnake cards (red back) — the risky ones. One pays $2 safely. Two carry 1 Bandit. One carries 2 Bandits at once — as you just experienced.',
      required: { type: 'auto' },
      autoAdvanceMs: 4000,
    },
    {
      id: 'deck_close',
      inModal: true,
      message: '4 safe cards, 6 mixed. Keep that in mind every time you decide to draw again. Close the deck.',
      required: { type: 'close_deck' },
    },

    // ── Round 3: safe draw then stop ──

    {
      id: 'r3_draw1',
      message: 'Draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw2',
      // shown after drawing starter_91 ($1, River)
      message: 'A River — safe. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw3',
      // shown after drawing starter_92 ($1, River). one more River left in queue.
      message: 'Another River. Draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_stop',
      // shown after drawing starter_93 ($1, River). queue exhausted. next real card = Rattlesnake.
      message: 'You have $3 and 0 Bandits. The next card in your deck is a Rattlesnake. You have enough to buy — stop here.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r3_buy',
      message: 'Buy Phase. Buy this Cow card — Cows win at Showdown.',
      spotlight: null,
      required: { type: 'buy', row: 4, col: 1 }, // card_11 (1 cow, cost $2)
      pyramidHint: { row: 4, col: 1 },
    },

    // ── End of current demo ──

    {
      id: 'done',
      message: '(This tutorial is incomplete — more coming soon.)',
      spotlight: null,
      required: { type: 'auto' },
      autoAdvanceMs: 3000,
    },
  ];

  // ─── State ────────────────────────────────────────────────────────────────────
  let _active           = false;
  let _done             = false;
  let _stepIdx          = 0;
  let _round            = 0;
  let _autoTimer        = null;
  let _deckLessonResolve = null; // resolves the Promise returned by nextRound() for deck lesson

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  function currentStep() {
    return SCRIPT[_stepIdx] || null;
  }

  function applyStep() {
    const step = currentStep();
    if (!step) return;

    if (step.inModal) {
      showDeckNote(step.message);
    } else {
      showMessage(step.message);
    }

    clearSpotlight();
    if (step.spotlight) spotlightEl(step.spotlight);
    if (step.pyramidHint) highlightPyramidCard(step.pyramidHint.row, step.pyramidHint.col);

    if (step.required.type === 'auto') {
      if (_autoTimer) clearTimeout(_autoTimer);
      _autoTimer = setTimeout(() => advance(), step.autoAdvanceMs || 2000);
    }
  }

  function advance() {
    if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
    _stepIdx++;
    const step = currentStep();

    if (!step) { complete(); return; }

    if (step.id === 'done') {
      applyStep(); // show "(This tutorial is incomplete)" then auto-advance to complete()
      return;
    }

    applyStep();
  }

  function showMessage(text) {
    const el = document.getElementById('message');
    if (el) el.textContent = text;
  }

  function showDeckNote(text) {
    const el = document.getElementById('tutorial-deck-note');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function clearDeckNote() {
    const el = document.getElementById('tutorial-deck-note');
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

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

  function complete() {
    _active = false;
    _done   = true;
    clearSpotlight();
    clearDeckNote();
    document.body.classList.remove('tutorial-active');
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
      return createCardInstance(tmpl);
    }).filter(Boolean);

    const player = G.players[0];
    player.discard = [...player.deck, ...player.discard];
    player.deck    = cards;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {

    get active() { return _active; },
    get done()   { return _done;   },

    // Called from startGame() when ?tutorial=1 is detected.
    init(G) {
      _active           = true;
      _done             = false;
      _stepIdx          = 0;
      _round            = 0;
      _autoTimer        = null;
      _deckLessonResolve = null;

      document.body.classList.add('tutorial-active');
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

    // Called from scoreRound() — play.js does: await TUTORIAL.nextRound()
    // Returns a Promise if the deck lesson must run before the next round starts.
    nextRound() {
      if (_done) return Promise.resolve();
      _round++;
      if (_round === 2) {
        // Deck lesson runs here; scoreRound() will await this Promise.
        // The bust_explain auto-timer will fire and advance to deck_open while we wait.
        return new Promise(resolve => { _deckLessonResolve = resolve; });
      }
      return Promise.resolve();
    },

    // Returns true if the given action is currently permitted.
    isAllowed(type, params) {
      if (_done) return true;
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
      if (step.required.type !== type) return;
      advance();
      // After deck lesson: resolve the Promise so scoreRound() can resume.
      if (type === 'close_deck' && _deckLessonResolve) {
        const resolve = _deckLessonResolve;
        _deckLessonResolve = null;
        resolve();
      }
    },

    // Called when player's buy phase begins (humanBuyTurn).
    onBuyPhaseStart() {
      if (_done) return;
      const step = currentStep();
      if (!step) return;
      if (step.required.type === 'buy' || step.required.type === 'burn') {
        applyStep();
      }
    },

    // Called when the human player busts.
    // Skips past any remaining 'draw' steps to land on the bust_explain step.
    onBust() {
      if (_done) return;
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
