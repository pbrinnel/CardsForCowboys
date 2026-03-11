#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — Tiebreaker Unit Tests
// Tests determineBuyWinner() in isolation (no DOM, no Firebase).
//
// Usage:  node sim/test-tiebreaker.js
// ============================================================

const { determineBuyWinner } = require('../shared/tiebreaker.js');

// --- TEST HARNESS ---

let passed = 0;
let failed = 0;

function assert(desc, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓  ${desc}`);
    passed++;
  } else {
    console.error(`  ✗  ${desc}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertSlot(desc, result, expectedSlot) {
  assert(desc, result.winnerSlot, expectedSlot);
}

function section(name) {
  console.log(`\n${name}`);
}

// Build a minimal player object. hand is array of { cost } objects.
function p(dollars, cows, hand = [], { busted = false } = {}) {
  return { roundDollars: dollars, roundCows: cows, hand, busted };
}

// Build a hand of cards with given costs
function hand(...costs) {
  return costs.map(cost => ({ cost }));
}

// In SP mode playerOrder[i] = i. For MP tests we assign explicit slots.
function spOrder(n) {
  return Array.from({ length: n }, (_, i) => i);
}

// ============================================================
// 1. BASIC STAT-BASED WINNERS
// ============================================================
section('1. Basic stat-based winners');

{
  // Clear dollar winner
  const players = [p(3, 0), p(5, 0)];
  const r = determineBuyWinner(players, spOrder(2));
  assert('Clear $ winner (idx 1)', r.winnerIdx, 1);
  assert('Clear $ winner — reason mentions $', r.reason.includes('$'), true);
}

{
  // Dollar tie, clear cow winner
  const players = [p(4, 2), p(4, 5)];
  const r = determineBuyWinner(players, spOrder(2));
  assert('$ tie — cow winner (idx 1)', r.winnerIdx, 1);
  assert('$ tie — tieLog mentions cows', r.tieLog !== null, true);
  assert('$ tie — reason is most cows', r.reason, 'most cows');
}

{
  // $ + cow tie, most cards wins
  const players = [p(4, 3, hand(5, 4)), p(4, 3, hand(5, 4, 3))];
  const r = determineBuyWinner(players, spOrder(2));
  assert('$ + cow tie — most cards wins (idx 1)', r.winnerIdx, 1);
  assert('$ + cow tie — reason is most cards', r.reason, 'most cards drawn');
}

{
  // $ + cow + card count tie, 1st card cost breaks it
  const players = [p(4, 3, hand(3)), p(4, 3, hand(7))];
  const r = determineBuyWinner(players, spOrder(2));
  assert('Card cost 1st card breaks tie (idx 1, cost 7)', r.winnerIdx, 1);
  assert('Card cost tie — reason is 1st card cost', r.reason, '1st card cost');
}

{
  // 2nd card cost breaks tie (1st cards equal)
  const players = [p(4, 3, hand(5, 2)), p(4, 3, hand(5, 9))];
  const r = determineBuyWinner(players, spOrder(2));
  assert('2nd card cost breaks tie (idx 1)', r.winnerIdx, 1);
  assert('2nd card cost — reason', r.reason, '2nd card cost');
}

{
  // 3-player: middle player wins on $
  const players = [p(3, 0), p(6, 0), p(4, 0)];
  const r = determineBuyWinner(players, spOrder(3));
  assert('3P: clear $ winner (idx 1)', r.winnerIdx, 1);
}

{
  // 4-player: winner on cows
  const players = [p(5, 1), p(5, 3), p(5, 2), p(5, 0)];
  const r = determineBuyWinner(players, spOrder(4));
  assert('4P: cow winner (idx 1)', r.winnerIdx, 1);
}

// ============================================================
// 2. COMPLETE TIE → CANONICAL SLOT ORDER
// ============================================================
section('2. Complete tie — canonical slot order');

{
  // All identical stats, empty hands: earliest slot wins
  const players = [p(3, 2), p(3, 2)];
  const r = determineBuyWinner(players, spOrder(2));
  assert('2P complete tie — slot 0 wins', r.winnerSlot, 0);
  assert('2P complete tie — reason is player position', r.reason, 'player position');
}

{
  // 4P complete tie: slot 0 always wins regardless of local ordering
  const players = [p(4, 4, hand(5)), p(4, 4, hand(5)), p(4, 4, hand(5)), p(4, 4, hand(5))];
  const r = determineBuyWinner(players, spOrder(4));
  assert('4P complete tie — slot 0 wins', r.winnerSlot, 0);
}

{
  // MP scenario: host sees [slot0, slot1], guest sees [slot1, slot0]
  // Both must agree slot 0 wins a complete tie.
  const hostPlayers  = [p(4, 4, hand(5)), p(4, 4, hand(5))];
  const hostOrder    = [0, 1]; // slot 0 = idx 0, slot 1 = idx 1

  const guestPlayers = [p(4, 4, hand(5)), p(4, 4, hand(5))];
  const guestOrder   = [1, 0]; // slot 1 = idx 0 (self), slot 0 = idx 1

  const hostResult  = determineBuyWinner(hostPlayers, hostOrder);
  const guestResult = determineBuyWinner(guestPlayers, guestOrder);

  assert('MP complete tie — host picks slot 0', hostResult.winnerSlot, 0);
  assert('MP complete tie — guest picks slot 0', guestResult.winnerSlot, 0);
  assert('MP complete tie — both agree on same slot', hostResult.winnerSlot, guestResult.winnerSlot);
}

{
  // MP 4P: complete tie, slot 0 canonical winner regardless of local index ordering
  const makeOrderedGame = (mySlot) => {
    // each client sees itself at local index 0
    const slots = [0, 1, 2, 3];
    const rotated = [mySlot, ...slots.filter(s => s !== mySlot)];
    const players = rotated.map(() => p(4, 4, hand(5)));
    const order   = rotated; // playerOrder[localIdx] = slotIdx
    return determineBuyWinner(players, order);
  };

  const r0 = makeOrderedGame(0);
  const r1 = makeOrderedGame(1);
  const r2 = makeOrderedGame(2);
  const r3 = makeOrderedGame(3);

  assert('MP 4P tie — slot 0 client picks slot 0', r0.winnerSlot, 0);
  assert('MP 4P tie — slot 1 client picks slot 0', r1.winnerSlot, 0);
  assert('MP 4P tie — slot 2 client picks slot 0', r2.winnerSlot, 0);
  assert('MP 4P tie — slot 3 client picks slot 0', r3.winnerSlot, 0);
}

// ============================================================
// 3. BUSTED PLAYERS
// ============================================================
section('3. Busted players');

{
  // Winner-would-be-busted: next best wins
  const players = [p(10, 0, [], { busted: true }), p(4, 0)];
  const r = determineBuyWinner(players, spOrder(2));
  assert('Busted winner excluded — idx 1 wins', r.winnerIdx, 1);
}

{
  // All busted: returns idx 0 as fallback
  const players = [p(5, 0, [], { busted: true }), p(4, 0, [], { busted: true })];
  const r = determineBuyWinner(players, spOrder(2));
  assert('All busted — fallback to idx 0', r.winnerIdx, 0);
  assert('All busted — reason', r.reason, 'all busted');
}

{
  // 4P: two busted, tie among remaining — canonical slot wins
  const players = [
    p(5, 3, [], { busted: true }),   // slot 0, busted
    p(5, 3),                          // slot 1
    p(5, 3, [], { busted: true }),   // slot 2, busted
    p(5, 3),                          // slot 3
  ];
  const r = determineBuyWinner(players, spOrder(4));
  assert('4P two busted, tie among rest — earlier slot (1) wins', r.winnerSlot, 1);
}

{
  // 3P: one busted; non-busted clear winner on $
  const players = [p(10, 0, [], { busted: true }), p(3, 0), p(7, 0)];
  const r = determineBuyWinner(players, spOrder(3));
  assert('3P busted leader — clear $ winner among rest (idx 2)', r.winnerIdx, 2);
}

// ============================================================
// 4. MP CONSISTENCY — same game state, different local orderings
// ============================================================
section('4. MP consistency — same outcome from different local orderings');

{
  // Slot 1 clearly wins on $. Host sees [slot0, slot1], guest sees [slot1, slot0].
  const hostPlayers  = [p(2, 0), p(8, 0)];
  const hostOrder    = [0, 1];
  const guestPlayers = [p(8, 0), p(2, 0)]; // guest sees self (slot1) at idx 0
  const guestOrder   = [1, 0];

  const hr = determineBuyWinner(hostPlayers, hostOrder);
  const gr = determineBuyWinner(guestPlayers, guestOrder);

  assert('MP $ winner — host identifies slot 1', hr.winnerSlot, 1);
  assert('MP $ winner — guest identifies slot 1', gr.winnerSlot, 1);
  assert('MP $ winner — both agree', hr.winnerSlot, gr.winnerSlot);
}

{
  // Slot 2 wins on cows ($ tied). 4P game, each client sees self at idx 0.
  const statsBySlot = [
    { dollars: 4, cows: 1 }, // slot 0
    { dollars: 4, cows: 1 }, // slot 1
    { dollars: 4, cows: 5 }, // slot 2 — wins
    { dollars: 4, cows: 1 }, // slot 3
  ];

  function buildGameForSlot(mySlot) {
    const slots = [0, 1, 2, 3];
    const ordered = [mySlot, ...slots.filter(s => s !== mySlot)];
    const players = ordered.map(s => p(statsBySlot[s].dollars, statsBySlot[s].cows));
    return determineBuyWinner(players, ordered);
  }

  const results = [0, 1, 2, 3].map(buildGameForSlot);
  assert('MP cow winner — all 4 clients agree slot 2 wins',
    results.every(r => r.winnerSlot === 2), true);
}

{
  // Partial tie broken by card cost. Slot 3 has the highest-cost 1st card.
  const statsBySlot = [
    { dollars: 3, cows: 2, cards: [4] }, // slot 0
    { dollars: 3, cows: 2, cards: [4] }, // slot 1
    { dollars: 3, cows: 2, cards: [4] }, // slot 2
    { dollars: 3, cows: 2, cards: [9] }, // slot 3 — wins on card cost
  ];

  function buildGameForSlot(mySlot) {
    const slots = [0, 1, 2, 3];
    const ordered = [mySlot, ...slots.filter(s => s !== mySlot)];
    const players = ordered.map(s =>
      p(statsBySlot[s].dollars, statsBySlot[s].cows, hand(...statsBySlot[s].cards))
    );
    return determineBuyWinner(players, ordered);
  }

  const results = [0, 1, 2, 3].map(buildGameForSlot);
  assert('MP card cost tiebreak — all 4 clients agree slot 3 wins',
    results.every(r => r.winnerSlot === 3), true);
}

{
  // The original freeze scenario: complete tie, each client previously
  // picked local idx 0 (themselves) → both called showChooseFirstUI → freeze.
  // Now must both agree on canonical slot 0.
  const makeClient = (mySlot) => {
    const slots = [0, 1];
    const ordered = [mySlot, ...slots.filter(s => s !== mySlot)];
    const players = ordered.map(() => p(5, 3, hand(4)));
    return determineBuyWinner(players, ordered).winnerSlot;
  };

  assert('Freeze regression — slot 0 client picks slot 0', makeClient(0), 0);
  assert('Freeze regression — slot 1 client picks slot 0', makeClient(1), 0);
}

// ============================================================
// 5. EDGE CASES
// ============================================================
section('5. Edge cases');

{
  // Single player (shouldn't happen but shouldn't crash)
  const players = [p(3, 2)];
  const r = determineBuyWinner(players, [0]);
  assert('Single player — wins trivially', r.winnerIdx, 0);
}

{
  // Negative cows don't throw (player drew negative cow cards)
  const players = [p(3, -1), p(3, 2)];
  const r = determineBuyWinner(players, spOrder(2));
  assert('Negative cows — higher cows wins (idx 1)', r.winnerIdx, 1);
}

{
  // Zero-dollar tie with empty hands — falls to slot order
  const players = [p(0, 0), p(0, 0), p(0, 0)];
  const r = determineBuyWinner(players, spOrder(3));
  assert('All-zero stats, empty hands — slot 0 wins', r.winnerSlot, 0);
}

{
  // hasBuyBurnFirst is NOT handled by determineBuyWinner —
  // it's pre-screened upstream. Verify function still returns a consistent
  // stat-based winner even if the flag is present on players.
  const players = [
    { ...p(2, 0), hasBuyBurnFirst: true },  // has priority but lower $
    { ...p(8, 0), hasBuyBurnFirst: false },
  ];
  const r = determineBuyWinner(players, spOrder(2));
  assert('hasBuyBurnFirst ignored by determineBuyWinner — $ wins', r.winnerIdx, 1);
}

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${'─'.repeat(48)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(48)}\n`);
process.exit(failed > 0 ? 1 : 0);
