// tutorial.js — Tutorial mode for Cards For Cowboys
// Loaded before play.js via a plain <script> tag in playgame.html.
// play.js calls TUTORIAL hooks at key action points when TUTORIAL.active is true.

const TUTORIAL = (() => {

  // ─── Pyramid layout ─────────────────────────────────────────────────────────
  // 15 cards for Act 1, 2-player pyramid (5 rows).
  // buildPyramid() iterates row 0 (top, 1 card) → row 4 (bottom, 5 cards).
  // Row 4 is face-up at game start; the rest are face-down.
  //
  //   Row 0 (idx 0):      card_83
  //   Row 1 (idx 1-2):    card_82, card_48
  //   Row 2 (idx 3-5):    card_79, card_46, card_47
  //   Row 3 (idx 6-9):    card_12, card_13, card_15, card_75
  //   Row 4 (idx 10-14):  card_10, card_11, card_74, card_77, card_76   ← face-up
  //
  // Reveal logic: slot (R, C) is revealed when both (R+1, C) and (R+1, C+1) are removed.
  //   (3,0)=card_12 revealed after (4,0) bought R1 AND (4,1) burned R4 → shown in R4 buy phase
  //   (3,1)=card_13 revealed after (4,1) burned R4 AND (4,2) bought R3
  //   (3,2)=card_15 revealed after (4,2) bought R3 AND (4,3) bought R2
  const PYRAMID_IDS = [
    'card_83',
    'card_82', 'card_48',
    'card_79', 'card_46', 'card_47',
    'card_12', 'card_13', 'card_15', 'card_75',
    'card_10', 'card_11', 'card_74', 'card_77', 'card_76',
  ];

  // ─── Draw queues ─────────────────────────────────────────────────────────────
  // One array per tutorial round. Each string is a card template id.
  // TUTORIAL.nextCard() injects these into the top of the player's deck before each draw.
  // card_77_tut = a fresh card_77 instance injected for round 6 (trash_to_use demo).
  const DRAW_QUEUES = [
    // Round 1: two safe River cards → $2, 0 bandits
    ['starter_91', 'starter_92'],
    // Round 2: Cactus (+$1+1cow) then Rattlesnake ($2, 0 bandits) → $3
    ['starter_33', 'starter_61'],
    // Round 3: three Rivers → $3, 0 bandits (aggressive draw demo)
    ['starter_94', 'starter_93', 'starter_92'],
    // Round 4: two Rivers + Rattlesnake 1-bandit → $2, 1 bandit (stop wisely) + burn demo
    ['starter_91', 'starter_93', 'starter_62'],
    // Round 5: two Rattlesnakes (1 bandit each) then 2-bandit Rattlesnake → bust
    ['starter_63', 'starter_62', 'starter_64'],
    // Round 6: trash_to_use card_77 + River → activate trash, then stop
    ['card_77', 'starter_91'],
    // Round 7: Cactus + two Rivers → $3 (final guided round)
    ['starter_33', 'starter_94', 'starter_93'],
  ];

  // ─── Script ──────────────────────────────────────────────────────────────────
  // Each step:
  //   message        – shown in the #message area
  //   spotlight      – CSS selector of the element to highlight (or null)
  //   required       – { type } or { type, row, col } the action that advances this step
  //                    type: 'draw' | 'stop' | 'buy' | 'burn' | 'activate' | 'auto'
  //   autoAdvanceMs  – if set, step auto-advances after this many ms (no player action needed)
  const SCRIPT = [
    // ── Round 1 ──
    {
      id: 'r1_draw1',
      message: 'Welcome. Draw a card to start your turn.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_draw2',
      message: 'That River card gave you $1. Draw again to earn more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r1_stop',
      message: 'You have $2. Stop drawing to lock in what you earned this round.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r1_buy',
      message: 'Buy Phase. Click the highlighted card in the store, then click Buy.',
      spotlight: null, // pyramid card highlighted separately by tutorialHighlightPyramid()
      required: { type: 'buy', row: 4, col: 0 }, // card_10 ($2)
      pyramidHint: { row: 4, col: 0 },
    },

    // ── Round 2 ──
    {
      id: 'r2_draw1',
      message: 'A new round. Draw a card.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_draw2',
      message: 'That Cactus card gave $1 and 1 Cow. Cows add permanently to your Herd. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r2_stop',
      message: 'A Rattlesnake card — red back means higher risk. This one paid $2 with no bandits. You have $3. Stop drawing.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r2_buy',
      message: 'Buy this card. It has a special ability you\'ll use in a later round.',
      spotlight: null,
      required: { type: 'buy', row: 4, col: 3 }, // card_77 (trash_to_use, $3)
      pyramidHint: { row: 4, col: 3 },
    },

    // ── Round 3 ──
    {
      id: 'r3_draw1',
      message: 'You have 0 bandits drawn. No risk yet — draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw2',
      message: 'Still 0 bandits. When you haven\'t drawn any bandits, draw as much as you want. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_draw3',
      message: 'Draw one more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r3_stop',
      message: 'Three draws, $3, no bandits. Zero bandits = push as far as you like. Stop drawing.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r3_buy',
      message: 'Buy this River card. More $ in your deck means more buying power in future rounds.',
      spotlight: null,
      required: { type: 'buy', row: 4, col: 2 }, // card_74 ($1, cost $3)
      pyramidHint: { row: 4, col: 2 },
    },

    // ── Round 4 ──
    {
      id: 'r4_draw1',
      message: 'Draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r4_draw2',
      message: 'Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r4_draw3',
      message: 'Draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r4_stop',
      message: 'You drew 1 bandit. Bust happens at 3 — you\'re still safe. But you have $2 and something worth buying. Stop here.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r4_burn',
      message: 'Buy Phase. That cheap Cactus card isn\'t worth buying. Burn it instead — trashing a card reveals the one hidden underneath.',
      spotlight: null,
      required: { type: 'burn', row: 4, col: 1 }, // card_11 (burn to reveal card_12)
      pyramidHint: { row: 4, col: 1 },
    },
    {
      id: 'r4_buy',
      message: 'Burning revealed a new Cow card. Buy it.',
      spotlight: null,
      required: { type: 'buy', row: 3, col: 0 }, // card_12 ($0, 1 cow, cost $2)
      pyramidHint: { row: 3, col: 0 },
    },

    // ── Round 5 ──
    {
      id: 'r5_draw1',
      message: 'Draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r5_draw2',
      message: '1 bandit. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r5_draw3',
      message: '2 bandits — the danger zone. In a real game you\'d stop here. Let\'s see what happens if you keep going.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    // After r5_draw3 the bust animation fires automatically (roundBandits >= 3).
    // We catch the bust in onBust() and advance past any pending draw step.
    {
      id: 'r5_bust_explain',
      message: '3 bandits — BUSTED. Your entire hand is discarded. No buy phase, no Cows, no $. Two bandits is almost always the stopping point.',
      spotlight: null,
      required: { type: 'auto' },
      autoAdvanceMs: 3500,
    },

    // ── Round 6 ──
    {
      id: 'r6_draw1',
      message: 'Draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r6_activate',
      message: 'That\'s the special card you bought earlier. On its own it does nothing — click it in your hand to activate its ability.',
      spotlight: '#player-hand',
      required: { type: 'activate' },
    },
    {
      id: 'r6_draw2',
      message: 'The card is permanently gone from your deck — it won\'t slow you down again. Draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r6_stop',
      message: 'Stop drawing.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r6_buy',
      message: 'Buy this Cow card. Late game, Cows matter more than $.',
      spotlight: null,
      required: { type: 'buy', row: 3, col: 1 }, // card_13 ($0, 1 cow, cost $2)
      pyramidHint: { row: 3, col: 1 },
    },

    // ── Round 7 ──
    {
      id: 'r7_draw1',
      message: 'Draw.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r7_draw2',
      message: 'Final tip: at Showdown, every $2 in your entire deck gives +1 bonus Cow. Those $ cards from early rounds still score. Draw again.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r7_draw3',
      message: 'Draw once more.',
      spotlight: '#actions',
      required: { type: 'draw' },
    },
    {
      id: 'r7_stop',
      message: 'Stop drawing.',
      spotlight: '#actions',
      required: { type: 'stop' },
    },
    {
      id: 'r7_buy',
      message: 'Last guided buy.',
      spotlight: null,
      required: { type: 'buy', row: 3, col: 2 }, // card_15 ($0, 1 cow, cost $3)
      pyramidHint: { row: 3, col: 2 },
    },
    {
      id: 'done',
      message: 'You know the mechanics. Finish the game on your own — good luck.',
      spotlight: null,
      required: { type: 'auto' },
      autoAdvanceMs: 3000,
    },
  ];

  // ─── State ────────────────────────────────────────────────────────────────────
  let _active    = false;
  let _done      = false;
  let _stepIdx   = 0;           // index into SCRIPT
  let _round     = 0;           // 0-based tutorial round (0 = round 1)
  let _drawIdx   = 0;           // position within current round's draw queue
  let _autoTimer = null;

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function currentStep() {
    return SCRIPT[_stepIdx] || null;
  }

  function applyStep() {
    const step = currentStep();
    if (!step) return;

    // Show message
    showMessage(step.message);

    // Spotlight
    clearSpotlight();
    if (step.spotlight) {
      spotlightEl(step.spotlight);
    }
    if (step.pyramidHint) {
      highlightPyramidCard(step.pyramidHint.row, step.pyramidHint.col);
    }

    // Auto-advance
    if (step.required.type === 'auto') {
      if (_autoTimer) clearTimeout(_autoTimer);
      _autoTimer = setTimeout(() => advance(), step.autoAdvanceMs || 2000);
    }
  }

  function advance() {
    if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
    _stepIdx++;
    const step = currentStep();
    if (!step || step.id === 'done') {
      // 'done' step shows its message + auto-advances → then we complete
      if (step && step.id === 'done') {
        applyStep(); // show "Finish the game on your own" message
        // autoAdvanceMs on 'done' step calls advance() again → hits !step branch
      } else {
        complete();
      }
      return;
    }
    applyStep();
  }

  function showMessage(text) {
    const el = document.getElementById('message');
    if (el) el.textContent = text;
  }

  function spotlightEl(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add('tutorial-spotlight');
  }

  function clearSpotlight() {
    document.querySelectorAll('.tutorial-spotlight, .tutorial-pyramid-hint').forEach(el => {
      el.classList.remove('tutorial-spotlight');
      el.classList.remove('tutorial-pyramid-hint');
    });
  }

  function highlightPyramidCard(row, col) {
    // Pyramid cards render as div.card[data-row][data-col] inside #pyramid.
    // Schedule a RAF so the DOM is settled after render() before querying.
    requestAnimationFrame(() => {
      const el = document.querySelector(`#pyramid .card[data-row="${row}"][data-col="${col}"]`);
      if (el) el.classList.add('tutorial-pyramid-hint');
    });
  }

  function complete() {
    _active = false;
    _done   = true;
    clearSpotlight();
    document.body.classList.remove('tutorial-active');
    showMessage('You\'re on your own now. Good luck.');
  }

  // ─── Draw queue injection ─────────────────────────────────────────────────────

  // Called from play.js at the start of the draw phase for the human player.
  // Replaces the player's deck with the scripted cards for this tutorial round.
  function injectDrawQueue(G) {
    if (_done || _round >= DRAW_QUEUES.length) return;
    const ids = DRAW_QUEUES[_round];
    // Build fresh card instances from STARTER_TEMPLATES + STORE_CARDS
    const cards = ids.map(id => {
      const tmpl = (typeof STARTER_TEMPLATES !== 'undefined' ? STARTER_TEMPLATES : [])
        .concat(typeof STORE_CARDS !== 'undefined' ? STORE_CARDS : [])
        .find(t => t.id === id);
      if (!tmpl) { console.warn('Tutorial: unknown card id', id); return null; }
      return createCardInstance(tmpl);
    }).filter(Boolean);

    // Set the player's deck to exactly the scripted cards (in order, top = index 0).
    // Move any real deck + discard to discard so counts stay honest.
    const player = G.players[0];
    const surplus = [...player.deck, ...player.discard];
    player.discard = surplus;
    player.deck    = cards;
    _drawIdx       = 0;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {

    get active() { return _active; },
    get done()   { return _done;   },

    // Called from startGame() when ?tutorial=1 is detected.
    init(G) {
      _active  = true;
      _done    = false;
      _stepIdx = 0;
      _round   = 0;
      _drawIdx = 0;

      // Mark body so CSS can style the tutorial callout
      document.body.classList.add('tutorial-active');

      // Override the pyramid for act 1
      G._tutorialPyramidIds = PYRAMID_IDS;

      // AI opponent passes during tutorial (see aiBuyTurn hook)
      G._tutorialMode = true;
    },

    // Called from setupAct() when act === 1 and tutorial is active.
    getPyramidIds() {
      return PYRAMID_IDS;
    },

    // Called at the start of each draw phase (from startRound()).
    onRoundStart(G) {
      if (_done) return;
      injectDrawQueue(G);
      applyStep();
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

    // Called after an allowed action completes. Advances to the next step.
    onActionDone(type) {
      if (_done) return;
      const step = currentStep();
      if (!step) return;
      if (step.required.type === type) advance();
    },

    // Called when the player's buy phase begins (humanBuyTurn).
    onBuyPhaseStart() {
      if (_done) return;
      const step = currentStep();
      if (!step) return;
      // If current step is a buy or burn, re-apply so spotlight lands on buy phase
      if (step.required.type === 'buy' || step.required.type === 'burn') {
        applyStep();
      }
    },

    // Called when a bust occurs (handleBust for human player).
    // Skips any pending draw step and advances to the bust_explain step.
    onBust() {
      if (_done) return;
      // Skip forward until we hit r5_bust_explain (or the next non-draw step)
      while (_stepIdx < SCRIPT.length) {
        const step = SCRIPT[_stepIdx];
        if (!step) break;
        if (step.required.type !== 'draw') break;
        _stepIdx++;
      }
      applyStep();
    },

    // Called when the draw phase is about to begin for a new round.
    // Increments the round counter so the correct draw queue is injected.
    nextRound() {
      if (_done) return;
      _round++;
    },

    // Expose so play.js can flash a "follow the tutorial" hint on blocked clicks
    flashBlocked() {
      const el = document.getElementById('message');
      if (!el) return;
      el.classList.add('tutorial-blocked-flash');
      setTimeout(() => el.classList.remove('tutorial-blocked-flash'), 600);
    },
  };

})();
