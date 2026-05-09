#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — Tiebreaker Unit Tests
// Tests determineBuyWinner() in isolation (no DOM, no Firebase).
//
// Usage:  node sim/test-tiebreaker.js
// ============================================================

const { determineBuyWinner } = require('./tiebreaker.js');

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
// 2. COMPLETE TIE → SEEDED RANDOM DRAW
// ============================================================
section('2. Complete tie — seeded random draw');

{
  // All identical stats, empty hands: seeded random picks winner.
  // Without a seed, LCG defaults to seed=1 which produces index 0 → slot 0.
  const players = [p(3, 2), p(3, 2)];
  const r = determineBuyWinner(players, spOrder(2));
  assert('2P complete tie — slot 0 wins (LCG default)', r.winnerSlot, 0);
  assert('2P complete tie — reason is random draw', r.reason, 'random draw');
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
  // Now both sort tiedSlots and run same LCG → agree on same slot.
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
// 6. winnerSlot === playerOrder[winnerIdx] INVARIANT
// ============================================================
section('6. winnerSlot === playerOrder[winnerIdx] invariant');

{
  // SP mode: playerOrder is identity, so winnerSlot should equal winnerIdx
  const players = [p(3, 0), p(7, 0), p(5, 0)];
  const r = determineBuyWinner(players, spOrder(3));
  assert('SP: winnerSlot === winnerIdx when identity order', r.winnerSlot, r.winnerIdx);
}

{
  // MP mode: slot 2 wins by $, but is at local index 0 (guest perspective)
  const players = [p(9, 0), p(3, 0)]; // guest (slot 2) at idx 0, host (slot 0) at idx 1
  const order   = [2, 0];
  const r = determineBuyWinner(players, order);
  assert('MP: winnerSlot === playerOrder[winnerIdx]', r.winnerSlot, order[r.winnerIdx]);
  assert('MP: winner is slot 2 ($9)', r.winnerSlot, 2);
  assert('MP: winner is local idx 0', r.winnerIdx, 0);
}

{
  // 4P rotated: each client computes — winnerSlot always equals playerOrder[winnerIdx]
  const statsBySlot = [
    { dollars: 5, cows: 0 }, // slot 0
    { dollars: 8, cows: 0 }, // slot 1 — wins
    { dollars: 5, cows: 0 }, // slot 2
    { dollars: 5, cows: 0 }, // slot 3
  ];
  const consistent = [0, 1, 2, 3].every(mySlot => {
    const ordered = [mySlot, ...[0,1,2,3].filter(s => s !== mySlot)];
    const players = ordered.map(s => p(statsBySlot[s].dollars, statsBySlot[s].cows));
    const r = determineBuyWinner(players, ordered);
    return r.winnerSlot === ordered[r.winnerIdx];
  });
  assert('4P: winnerSlot === playerOrder[winnerIdx] for all rotations', consistent, true);
}

// ============================================================
// 7. ZERO-COST AND SAME-COST CARD TIEBREAKERS
// ============================================================
section('7. Zero-cost and same-cost card tiebreakers');

{
  // All cards cost 0 — card cost loop doesn't resolve; falls to slot order
  const players = [p(3, 2, hand(0, 0)), p(3, 2, hand(0, 0))];
  const r = determineBuyWinner(players, spOrder(2));
  assert('All zero-cost cards — slot 0 wins (LCG default)', r.winnerSlot, 0);
  assert('All zero-cost cards — reason is random draw', r.reason, 'random draw');
}

{
  // 1st card tied at 0, 2nd card breaks tie
  const players = [p(3, 2, hand(0, 0)), p(3, 2, hand(0, 5))];
  const r = determineBuyWinner(players, spOrder(2));
  assert('Zero 1st card, 2nd card breaks tie (idx 1)', r.winnerIdx, 1);
  assert('2nd card cost reason', r.reason, '2nd card cost');
}

{
  // 4P: all tied on $ + cows, 3rd card breaks it
  const players = [
    p(4, 3, hand(5, 5, 2)), // slot 0
    p(4, 3, hand(5, 5, 2)), // slot 1
    p(4, 3, hand(5, 5, 9)), // slot 2 — wins on 3rd card
    p(4, 3, hand(5, 5, 2)), // slot 3
  ];
  const r = determineBuyWinner(players, spOrder(4));
  assert('4P: 3rd card cost breaks tie (idx 2)', r.winnerIdx, 2);
  assert('4P: 3rd card cost reason', r.reason, '3rd card cost');
}

{
  // MP: 4P, 3rd card tie — all clients agree on same slot winner
  const statsBySlot = [
    { dollars: 4, cows: 3, cards: [5, 5, 2] },
    { dollars: 4, cows: 3, cards: [5, 5, 2] },
    { dollars: 4, cows: 3, cards: [5, 5, 9] }, // slot 2 wins
    { dollars: 4, cows: 3, cards: [5, 5, 2] },
  ];
  const results = [0, 1, 2, 3].map(mySlot => {
    const ordered = [mySlot, ...[0,1,2,3].filter(s => s !== mySlot)];
    const players = ordered.map(s =>
      p(statsBySlot[s].dollars, statsBySlot[s].cows, hand(...statsBySlot[s].cards))
    );
    return determineBuyWinner(players, ordered).winnerSlot;
  });
  assert('MP 4P 3rd-card tie — all clients agree slot 2', results.every(s => s === 2), true);
}

// ============================================================
// 8. MIXED BUSTED + TIE COMBINATIONS
// ============================================================
section('8. Mixed busted + tie combinations');

{
  // 3P: slot 0 busted, slots 1 and 2 tied — slot 1 (lower) wins
  const players = [
    p(5, 3, [], { busted: true }), // slot 0, busted
    p(5, 3),                        // slot 1 — earliest non-busted
    p(5, 3),                        // slot 2
  ];
  const r = determineBuyWinner(players, spOrder(3));
  assert('3P: busted slot 0, tie → slot 1 wins (LCG default)', r.winnerSlot, 1);
  assert('3P: reason is random draw', r.reason, 'random draw');
}

{
  // 4P: slots 0 and 3 busted, slots 1 and 2 tied on everything — slot 1 wins (LCG default)
  const players = [
    p(5, 2, hand(4), { busted: true }), // slot 0, busted
    p(5, 2, hand(4)),                    // slot 1
    p(5, 2, hand(4)),                    // slot 2
    p(5, 2, hand(4), { busted: true }), // slot 3, busted
  ];
  const r = determineBuyWinner(players, spOrder(4));
  assert('4P: slots 0+3 busted, tie → slot 1 wins', r.winnerSlot, 1);
}

{
  // 3P: two busted, sole survivor wins regardless of stats
  const players = [
    p(10, 10, hand(9), { busted: true }), // would have won
    p(2, 1),                               // sole survivor
    p(8, 8, hand(8), { busted: true }),   // would have won
  ];
  const r = determineBuyWinner(players, spOrder(3));
  assert('3P: sole survivor wins despite bad stats', r.winnerIdx, 1);
}

{
  // 4P MP: busted slots differ per client view but canonical slot still wins
  const statsBySlot = [
    { dollars: 6, cows: 2, busted: true  }, // slot 0 busted
    { dollars: 6, cows: 2, busted: false }, // slot 1
    { dollars: 6, cows: 2, busted: false }, // slot 2
    { dollars: 6, cows: 2, busted: true  }, // slot 3 busted
  ];
  const results = [0, 1, 2, 3].map(mySlot => {
    const ordered = [mySlot, ...[0,1,2,3].filter(s => s !== mySlot)];
    const players = ordered.map(s =>
      p(statsBySlot[s].dollars, statsBySlot[s].cows, [], { busted: statsBySlot[s].busted })
    );
    return determineBuyWinner(players, ordered).winnerSlot;
  });
  assert('4P MP busted+tie — all clients agree slot 1 wins', results.every(s => s === 1), true);
}

// ============================================================
// 9. hasBuyBurnFirst UPSTREAM CANONICALITY (DIAGNOSTIC)
// ============================================================
section('9. hasBuyBurnFirst upstream canonicality');

// NOTE: hasBuyBurnFirst priority is handled UPSTREAM of determineBuyWinner, in
// onDrawPhaseComplete(). The function itself ignores the flag (tested in section 5).
//
// The upstream code does:
//   const priorityIdx = G.players.findIndex((p, i) => p.hasBuyBurnFirst && !p.busted);
//   if (priorityIdx !== -1) { /* use priorityIdx as buy-order start */ }
//
// findIndex returns a LOCAL array index, not a Firebase slot. In a complete-tie
// scenario where determineBuyWinner falls back to slot order, different clients
// can disagree on who is at local index N — but hasBuyBurnFirst skips the
// tiebreaker entirely, so the findIndex result IS the winner. This simulates
// that logic to document the behaviour.

function simulatePriorityFindIndex(players, playerOrder, useCanonical) {
  // Simulates upstream priority lookup.
  // useCanonical=true: sorts by slot first (proposed fix)
  // useCanonical=false: raw findIndex on local array (current code)
  const nonBusted = players
    .map((p, i) => ({ p, i, slot: playerOrder[i] }))
    .filter(c => !c.p.busted);

  if (useCanonical) {
    // Canonical: pick lowest-slot player with hasBuyBurnFirst
    const priority = nonBusted
      .filter(c => c.p.hasBuyBurnFirst)
      .sort((a, b) => a.slot - b.slot)[0];
    return priority ? priority.slot : -1;
  } else {
    // Non-canonical: first local index with hasBuyBurnFirst (current behavior)
    const idx = players.findIndex(p => p.hasBuyBurnFirst && !p.busted);
    return idx === -1 ? -1 : playerOrder[idx];
  }
}

{
  // Single hasBuyBurnFirst player: both approaches agree regardless of rotation.
  const makeGame = (mySlot) => {
    const slotHasPriority = [false, true, false, false]; // only slot 1
    const ordered = [mySlot, ...[0,1,2,3].filter(s => s !== mySlot)];
    const players = ordered.map(s => ({
      ...p(4, 2),
      hasBuyBurnFirst: slotHasPriority[s],
    }));
    return {
      naive:     simulatePriorityFindIndex(players, ordered, false),
      canonical: simulatePriorityFindIndex(players, ordered, true),
    };
  };
  const results = [0, 1, 2, 3].map(makeGame);
  assert('Single hasBuyBurnFirst — naive agrees slot 1 (all rotations)',
    results.every(r => r.naive === 1), true);
  assert('Single hasBuyBurnFirst — canonical agrees slot 1 (all rotations)',
    results.every(r => r.canonical === 1), true);
}

{
  // TWO hasBuyBurnFirst players: naive findIndex is non-canonical (disagrees by rotation).
  // canonical sort-by-slot always returns the lower-slot winner consistently.
  const makeGame = (mySlot) => {
    const slotHasPriority = [false, true, true, false]; // slots 1 AND 2
    const ordered = [mySlot, ...[0,1,2,3].filter(s => s !== mySlot)];
    const players = ordered.map(s => ({
      ...p(4, 2),
      hasBuyBurnFirst: slotHasPriority[s],
    }));
    return {
      naive:     simulatePriorityFindIndex(players, ordered, false),
      canonical: simulatePriorityFindIndex(players, ordered, true),
    };
  };
  const results = [0, 1, 2, 3].map(makeGame);

  // Naive is non-canonical: each client picks whichever priority player is earliest
  // in their local array. Slot-1 client (mySlot=1) sees slot 1 at idx 0 → picks slot 1.
  // Slot-0 client (mySlot=0) sees slot 1 at idx 1, slot 2 at idx 2 → picks slot 1 too.
  // But slot-2 client (mySlot=2) sees slot 2 at idx 0 → picks slot 2. DIVERGENCE.
  const naiveResults = results.map(r => r.naive);
  const naiveDiverges = new Set(naiveResults).size > 1;
  assert('Two hasBuyBurnFirst — naive findIndex diverges across clients (KNOWN ISSUE)',
    naiveDiverges, true);

  // Canonical always picks lowest slot among priority players (slot 1 here)
  assert('Two hasBuyBurnFirst — canonical always picks lowest slot (1)',
    results.every(r => r.canonical === 1), true);
}

{
  // Busted priority player: naive and canonical both skip busted slots
  const makeGame = (mySlot) => {
    const slotConfig = [
      { priority: false, busted: false }, // slot 0
      { priority: true,  busted: true  }, // slot 1: priority but busted → skipped
      { priority: true,  busted: false }, // slot 2: priority, not busted → wins
      { priority: false, busted: false }, // slot 3
    ];
    const ordered = [mySlot, ...[0,1,2,3].filter(s => s !== mySlot)];
    const players = ordered.map(s => ({
      ...p(4, 2, [], { busted: slotConfig[s].busted }),
      hasBuyBurnFirst: slotConfig[s].priority,
    }));
    return {
      naive:     simulatePriorityFindIndex(players, ordered, false),
      canonical: simulatePriorityFindIndex(players, ordered, true),
    };
  };
  const results = [0, 1, 2, 3].map(makeGame);
  assert('Busted priority player skipped — naive picks slot 2 (all rotations)',
    results.every(r => r.naive === 2), true);
  assert('Busted priority player skipped — canonical picks slot 2 (all rotations)',
    results.every(r => r.canonical === 2), true);
}

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${'─'.repeat(48)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(48)}\n`);
process.exit(failed > 0 ? 1 : 0);
