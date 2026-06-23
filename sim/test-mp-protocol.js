#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — MP Protocol Unit Tests
// Tests the Firebase coordination layer in isolation.
// No browser, no real Firebase, no DOM.
//
// Usage:  node sim/test-mp-protocol.js
// ============================================================

'use strict';

const { MockFirebaseDb, createMockDb } = require('./mock-firebase');
const { createMpClient }               = require('./mp-client');
const { determineBuyWinner }           = require('./tiebreaker.js');

// ---- TEST HARNESS ----

let passed = 0;
let failed = 0;

function assert(desc, actual, expected) {
  const eq = (typeof actual === 'object' || typeof expected === 'object')
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (eq) {
    console.log(`  ✓  ${desc}`);
    passed++;
  } else {
    console.error(`  ✗  ${desc}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name) { console.log(`\n${name}`); }

// Build slotDefs array: human slots are listed by index, rest are AI
function slotDefs(numPlayers, humanSlots) {
  return Array.from({ length: numPlayers }, (_, i) => ({
    name: humanSlots.includes(i) ? `Player${i}` : `AI${i}`,
    isHuman: humanSlots.includes(i),
  }));
}

// Create a shared mock DB + N clients for a game
function createGame(gameCode, numPlayers, humanSlots) {
  const { db } = createMockDb(gameCode);
  const defs = slotDefs(numPlayers, humanSlots);
  const clients = humanSlots.map(slot =>
    createMpClient({ db, gameCode, mySlot: slot, numPlayers, slotDefs: defs })
  );
  return { db, clients, defs };
}

// ============================================================
// 1. MOCK FIREBASE PRIMITIVES
// ============================================================
section('1. Mock Firebase primitives');

{
  const db = new MockFirebaseDb();
  const r  = db.ref('foo/bar');
  db.set(r, 42);
  assert('set + peek', db.peek('foo/bar'), 42);
}

{
  const db = new MockFirebaseDb();
  const r  = db.ref('a');
  db.set(r, 'hello');
  let received = null;
  db.onValue(r, snap => { received = snap.val(); });
  assert('onValue fires immediately with existing value', received, 'hello');
}

{
  const db = new MockFirebaseDb();
  const r  = db.ref('x');
  let received = null;
  db.onValue(r, snap => { received = snap.val(); });
  assert('onValue fires immediately with null when path empty', received, null);
  db.set(r, 99);
  assert('onValue fires again on write', received, 99);
}

{
  const db = new MockFirebaseDb();
  const r  = db.ref('y');
  let callCount = 0;
  const unsub = db.onValue(r, () => callCount++);
  assert('onValue fires once on attach', callCount, 1);
  db.set(r, 'a');
  assert('onValue fires on write', callCount, 2);
  unsub();
  db.set(r, 'b');
  assert('after unsub — listener not called again', callCount, 2);
}

{
  const db = new MockFirebaseDb();
  const root = db.ref('game/CODE');
  db.update(root, { 'drawDone/0': { done: true }, 'buyOrder': null });
  assert('update sets child path', db.peek('game/CODE/drawDone/0'), { done: true });
  assert('update with null deletes child path', db.peek('game/CODE/buyOrder'), null);
}

{
  const db = new MockFirebaseDb();
  const r  = db.ref('val');
  db.set(r, { a: 1, b: 2 });
  assert('set stores object', db.peek('val'), { a: 1, b: 2 });
  db.set(r, null);
  assert('set null deletes path', db.peek('val'), null);
}

{
  // update() should fire listeners on each individual child path
  const db  = new MockFirebaseDb();
  const root = db.ref('g/C');
  let got0 = null;
  let got1 = null;
  db.onValue(db.ref('g/C/drawDone/0'), snap => { got0 = snap.val(); });
  db.onValue(db.ref('g/C/drawDone/1'), snap => { got1 = snap.val(); });
  db.update(root, { 'drawDone/0': { done: true }, 'drawDone/1': { done: true } });
  assert('update fires listener for /0', got0, { done: true });
  assert('update fires listener for /1', got1, { done: true });
}

// ============================================================
// 2. DRAW PHASE — signalDrawDone / waitForAllHumanDrawsDone
// ============================================================
section('2. Draw phase sync');

{
  // Basic round-trip: slot 1 signals, slot 0 receives
  const { clients } = createGame('T1', 2, [0, 1]);
  const [c0, c1] = clients;
  let received = null;
  c0.waitForAllHumanDrawsDone((slotIdx, val) => { received = { slotIdx, val }; });
  assert('before signal — not yet received', received, null);
  c1.signalDrawDone({ dollars: 5, cows: 2, bandits: 0, busted: false, handCount: 3 });
  assert('after signal — slotIdx', received?.slotIdx, 1);
  assert('after signal — dollars', received?.val?.dollars, 5);
  assert('after signal — done flag set', received?.val?.done, true);
}

{
  // One-shot: signalDrawDone called twice, callback fires only once
  const { clients } = createGame('T2', 2, [0, 1]);
  const [c0, c1] = clients;
  let callCount = 0;
  c0.waitForAllHumanDrawsDone(() => callCount++);
  c1.signalDrawDone({ dollars: 3 });
  c1.signalDrawDone({ dollars: 4 }); // second write — should not re-fire
  assert('drawDone one-shot: callback fires exactly once', callCount, 1);
}

{
  // AI slot (slot 2) must be skipped — no listener, callback never fires for it
  const { db, clients } = createGame('T3', 3, [0, 1]); // slot 2 = AI
  const [c0, c1] = clients;
  let received = [];
  c0.waitForAllHumanDrawsDone((slotIdx) => received.push(slotIdx));

  // Simulate AI "signaling" by writing directly (what the game would never do)
  db.set(db.ref('games/T3/drawDone/2'), { done: true, dollars: 7 });
  assert('AI slot 2 not listened to — callback not fired for it', received.length, 0);

  c1.signalDrawDone({ dollars: 3 });
  assert('human slot 1 does fire', received.includes(1), true);
  assert('AI slot 2 never fires', received.includes(2), false);
}

{
  // Self slot must be skipped — c0 doesn't wait for itself
  const { clients } = createGame('T4', 2, [0, 1]);
  const [c0] = clients;
  let selfFired = false;
  c0.waitForAllHumanDrawsDone((slotIdx) => {
    if (slotIdx === 0) selfFired = true;
  });
  c0.signalDrawDone({ dollars: 5 }); // signal self — should NOT trigger c0's own callback
  assert('client does not receive its own drawDone', selfFired, false);
}

{
  // 3P all human: c0 waits for both slot 1 and slot 2; both fire independently
  const { clients } = createGame('T5', 3, [0, 1, 2]);
  const [c0, c1, c2] = clients;
  const fired = [];
  c0.waitForAllHumanDrawsDone((slotIdx) => fired.push(slotIdx));
  c1.signalDrawDone({ dollars: 4 });
  c2.signalDrawDone({ dollars: 7 });
  assert('3P: slot 1 fires', fired.includes(1), true);
  assert('3P: slot 2 fires', fired.includes(2), true);
  assert('3P: exactly 2 callbacks total', fired.length, 2);
}

{
  // Stale data cleared by resetRound: callback must NOT fire with old value after reset
  const { clients } = createGame('T6', 2, [0, 1]);
  const [c0, c1] = clients;
  // Round 1
  c1.signalDrawDone({ dollars: 5 });
  // Reset between rounds
  c0.resetRound();
  // Round 2: set up listener AFTER reset
  let round2Fired = false;
  c0.waitForAllHumanDrawsDone(() => { round2Fired = true; });
  assert('after resetRound — stale drawDone does not trigger listener', round2Fired, false);
}

// ============================================================
// 3. ACT SETUP (host push → guest receive)
// ============================================================
section('3. Act setup');

{
  const { clients } = createGame('T7', 2, [0, 1]);
  const [host, guest] = clients;
  let received = null;
  guest.waitForActSetup(data => { received = data; });
  host.pushActSetup(1, [10, 20, 30, 40, 50]);
  assert('guest receives actSetup act', received?.act, 1);
  assert('guest receives actSetup cardIds', JSON.stringify(received?.cardIds), JSON.stringify([10, 20, 30, 40, 50]));
}

{
  // One-shot: host pushes twice, guest callback fires only once
  const { clients } = createGame('T8', 2, [0, 1]);
  const [host, guest] = clients;
  let callCount = 0;
  guest.waitForActSetup(() => callCount++);
  host.pushActSetup(1, [1, 2, 3]);
  host.pushActSetup(2, [4, 5, 6]); // should not re-fire
  assert('actSetup one-shot', callCount, 1);
}

{
  // Non-host cannot push actSetup
  const { db } = createGame('T9', 2, [0, 1]);
  const guest = createMpClient({ db, gameCode: 'T9', mySlot: 1, numPlayers: 2,
    slotDefs: slotDefs(2, [0, 1]) });
  guest.pushActSetup(1, [1, 2, 3]); // should be a no-op
  assert('non-host pushActSetup is no-op', db.peek('games/T9/actSetup'), null);
}

{
  // Host does not set up a waitForActSetup listener
  const { clients } = createGame('T10', 2, [0, 1]);
  const [host] = clients;
  let hostFired = false;
  host.waitForActSetup(() => { hostFired = true; }); // should be a no-op
  host.pushActSetup(1, [1, 2]);
  assert('host waitForActSetup is a no-op', hostFired, false);
}

{
  // 4P: guest at slot 3 receives actSetup from host (slot 0)
  const { clients } = createGame('T10b', 4, [0, 1, 2, 3]);
  const [host, , , guest3] = clients;
  let got = null;
  guest3.waitForActSetup(d => { got = d; });
  host.pushActSetup(2, [7, 8, 9]);
  assert('4P: slot 3 receives actSetup', got?.act, 2);
}

// ============================================================
// 4. BUY ORDER — push / receive / one-shot / null guard
// ============================================================
section('4. Buy order');

{
  // Host pushes, guest receives
  const { clients } = createGame('T11', 2, [0, 1]);
  const [host, guest] = clients;
  let guestOrder = null;
  guest.waitForBuyOrder(order => { guestOrder = order; });
  assert('before push — guest has not received', guestOrder, null);
  host.pushBuyOrder([0, 1]);
  assert('guest receives buy order', JSON.stringify(guestOrder), JSON.stringify([0, 1]));
}

{
  // Guest wins; guest pushes, host receives
  const { clients } = createGame('T12', 2, [0, 1]);
  const [host, guest] = clients;
  let hostOrder = null;
  host.waitForBuyOrder(order => { hostOrder = order; });
  guest.pushBuyOrder([1, 0]);
  assert('host receives guest-pushed order', JSON.stringify(hostOrder), JSON.stringify([1, 0]));
}

{
  // One-shot: second push doesn't re-fire the callback
  const { clients } = createGame('T13', 2, [0, 1]);
  const [host, guest] = clients;
  let callCount = 0;
  guest.waitForBuyOrder(() => callCount++);
  host.pushBuyOrder([0, 1]);
  host.pushBuyOrder([1, 0]); // second write after round shouldn't fire
  assert('buyOrder one-shot', callCount, 1);
}

{
  // Null guard: waitForBuyOrder must not fire until a real value is pushed
  const { clients } = createGame('T14', 2, [0, 1]);
  const [, guest] = clients;
  let fired = false;
  guest.waitForBuyOrder(() => { fired = true; });
  assert('waitForBuyOrder does not fire on null', fired, false);
}

{
  // resetRound clears buyOrder; new listener set up after reset sees null
  const { clients } = createGame('T15', 2, [0, 1]);
  const [host, guest] = clients;
  host.pushBuyOrder([0, 1]);
  host.resetRound();
  let round2Fired = false;
  guest.waitForBuyOrder(() => { round2Fired = true; });
  assert('after resetRound — buyOrder listener does not fire with stale data', round2Fired, false);
}

{
  // 4P: buy order array has 4 entries in correct slot order
  const { clients } = createGame('T16', 4, [0, 1, 2, 3]);
  const [host, , , guest3] = clients;
  let got = null;
  guest3.waitForBuyOrder(order => { got = order; });
  host.pushBuyOrder([2, 0, 3, 1]);
  assert('4P buy order received correctly', JSON.stringify(got), JSON.stringify([2, 0, 3, 1]));
}

// ============================================================
// 5. BUY ACTIONS — per-slot isolation / one-shot
// ============================================================
section('5. Buy actions');

{
  // Slot 1 acts; slot 0's listener for slot 1 fires; slot 1's listener for slot 0 does not
  const { clients } = createGame('T17', 2, [0, 1]);
  const [host, guest] = clients;
  let hostGot = null;
  let guestGot = null;
  host.waitForBuyAction(1, data => { hostGot = data; });   // host waits for guest's action
  guest.waitForBuyAction(0, data => { guestGot = data; });  // guest waits for host's action
  guest.pushBuyAction('buy', 2, 3);
  assert('host receives guest buyAction', hostGot?.action, 'buy');
  assert('host receives row', hostGot?.row, 2);
  assert('host receives col', hostGot?.col, 3);
  assert('guest waitForBuyAction(0) not fired — host hasn\'t acted', guestGot, null);
}

{
  // Slot isolation: writing slot 0's buyAction doesn't fire slot 1's listener
  const { clients } = createGame('T18', 2, [0, 1]);
  const [host, guest] = clients;
  let misfired = false;
  guest.waitForBuyAction(0, () => { misfired = false; }); // correct slot
  host.waitForBuyAction(1, () => { misfired = true; });  // should NOT fire when slot 0 acts
  host.pushBuyAction('burn', 1, 2);
  assert('buyAction slot isolation — slot 1 listener not fired by slot 0 write', misfired, false);
}

{
  // One-shot: acting twice doesn't re-fire the waiting listener
  const { clients } = createGame('T19', 2, [0, 1]);
  const [host, guest] = clients;
  let callCount = 0;
  host.waitForBuyAction(1, () => callCount++);
  guest.pushBuyAction('buy', 3, 1);
  guest.pushBuyAction('buy', 4, 2); // second push — listener already fired and unsubbed
  assert('buyAction one-shot', callCount, 1);
}

{
  // 4P: each slot's action only fires its dedicated listener
  const { clients } = createGame('T20', 4, [0, 1, 2, 3]);
  const [c0, c1, c2, c3] = clients;
  const received = {};
  c0.waitForBuyAction(1, d => { received[1] = d.action; });
  c0.waitForBuyAction(2, d => { received[2] = d.action; });
  c0.waitForBuyAction(3, d => { received[3] = d.action; });
  c2.pushBuyAction('burn', 0, 0);
  c1.pushBuyAction('buy', 1, 1);
  c3.pushBuyAction('buy', 2, 2);
  assert('4P: c1 action received', received[1], 'buy');
  assert('4P: c2 action received', received[2], 'burn');
  assert('4P: c3 action received', received[3], 'buy');
}

// ============================================================
// 7. RESET ROUND — all per-round paths cleared
// ============================================================
section('7. resetRound clears all paths');

{
  const { db, clients } = createGame('T25', 3, [0, 1, 2]);
  const [c0, c1, c2] = clients;

  // Set all per-round values
  c0.signalDrawDone({ dollars: 5 });
  c1.signalDrawDone({ dollars: 3 });
  c2.signalDrawDone({ dollars: 7 });
  c0.pushDrawState({ hand: [1], dollars: 5 });
  c1.pushDrawState({ hand: [2], dollars: 3 });
  c2.pushDrawState({ hand: [3], dollars: 7 });
  c0.pushBuyOrder([2, 0, 1]);
  c1.pushBuyAction('buy', 0, 0);

  // Verify data is present
  assert('drawDone/0 set before reset', db.peek('games/T25/drawDone/0') !== null, true);
  assert('buyOrder set before reset', db.peek('games/T25/buyOrder') !== null, true);

  c0.resetRound();

  assert('drawDone/0 null after reset', db.peek('games/T25/drawDone/0'), null);
  assert('drawDone/1 null after reset', db.peek('games/T25/drawDone/1'), null);
  assert('drawDone/2 null after reset', db.peek('games/T25/drawDone/2'), null);
  assert('drawState/0 null after reset', db.peek('games/T25/drawState/0'), null);
  assert('drawState/1 null after reset', db.peek('games/T25/drawState/1'), null);
  assert('drawState/2 null after reset', db.peek('games/T25/drawState/2'), null);
  assert('buyOrder null after reset', db.peek('games/T25/buyOrder'), null);
  assert('buyAction null after reset', db.peek('games/T25/buyAction'), null);
}

// ============================================================
// 8. LIVE DRAW STATE (watchOpponentDrawStates — not one-shot)
// ============================================================
section('8. Live draw state (non-one-shot)');

{
  // watchOpponentDrawStates fires on EVERY update, not just the first
  const { clients } = createGame('T26', 2, [0, 1]);
  const [c0, c1] = clients;
  let updates = [];
  c0.watchOpponentDrawStates((slotIdx, state) => updates.push({ slotIdx, dollars: state.dollars }));
  c1.pushDrawState({ dollars: 3, hand: [] });
  c1.pushDrawState({ dollars: 6, hand: [1] });
  c1.pushDrawState({ dollars: 9, hand: [1, 2] });
  assert('watchOpponentDrawStates fires 3 times', updates.length, 3);
  assert('first update dollars', updates[0].dollars, 3);
  assert('last update dollars', updates[2].dollars, 9);
}

{
  // AI slots must not be watched
  const { db, clients } = createGame('T27', 3, [0, 1]); // slot 2 = AI
  const [c0] = clients;
  let aiSlotFired = false;
  c0.watchOpponentDrawStates((slotIdx) => {
    if (slotIdx === 2) aiSlotFired = true;
  });
  db.set(db.ref('games/T27/drawState/2'), { dollars: 9 }); // direct write simulating AI
  assert('AI slot 2 not watched by watchOpponentDrawStates', aiSlotFired, false);
}

// ============================================================
// 9. MULTI-CLIENT COORDINATION — end-to-end scenarios
// ============================================================
section('9. Multi-client coordination');

{
  // Scenario: 2P complete draw → buy order → buy action round-trip
  const { clients } = createGame('T28', 2, [0, 1]);
  const [c0, c1] = clients;
  const log = [];

  // Both clients set up draw-done listeners
  c0.waitForAllHumanDrawsDone((slotIdx) => log.push(`c0 got drawDone from ${slotIdx}`));
  c1.waitForAllHumanDrawsDone((slotIdx) => log.push(`c1 got drawDone from ${slotIdx}`));

  // Both signal done
  c0.signalDrawDone({ dollars: 8, cows: 1, busted: false, handCount: 2 });
  c1.signalDrawDone({ dollars: 5, cows: 2, busted: false, handCount: 3 });

  assert('c0 received c1\'s drawDone', log.includes('c0 got drawDone from 1'), true);
  assert('c1 received c0\'s drawDone', log.includes('c1 got drawDone from 0'), true);

  // c0 (slot 0) wins on $; pushes buy order
  let c1ReceivedOrder = null;
  c1.waitForBuyOrder(order => { c1ReceivedOrder = order; });
  c0.pushBuyOrder([0, 1]);

  assert('c1 received buy order', JSON.stringify(c1ReceivedOrder), JSON.stringify([0, 1]));

  // c0 acts first; c1 waits
  let c1GotAction = null;
  c1.waitForBuyAction(0, d => { c1GotAction = d; });
  c0.pushBuyAction('buy', 3, 2);
  assert('c1 received c0 buy action', c1GotAction?.action, 'buy');
}

{
  // Scenario: guest wins buy order; host must receive guest's push (not deadlock)
  const { clients } = createGame('T29', 2, [0, 1]);
  const [c0, c1] = clients;
  let hostGotOrder = null;
  c0.waitForBuyOrder(order => { hostGotOrder = order; });
  c1.pushBuyOrder([1, 0]); // guest won
  assert('host received guest buy order — no deadlock', JSON.stringify(hostGotOrder), JSON.stringify([1, 0]));
}

{
  // Scenario: tiebreaker + buy order agreement across two client perspectives
  // Uses determineBuyWinner to verify both clients agree who pushes
  const { clients } = createGame('T30', 2, [0, 1]);
  const [c0, c1] = clients;

  // c0's perspective: [slot0, slot1], slot1 has more $
  const hostPlayers  = [{ roundDollars: 4, roundCows: 2, hand: [], busted: false },
                        { roundDollars: 8, roundCows: 1, hand: [], busted: false }];
  const hostOrder    = [0, 1];

  // c1's perspective: [slot1 (self), slot0], slot1 still has more $
  const guestPlayers = [{ roundDollars: 8, roundCows: 1, hand: [], busted: false },
                        { roundDollars: 4, roundCows: 2, hand: [], busted: false }];
  const guestOrder   = [1, 0];

  const hostResult  = determineBuyWinner(hostPlayers,  hostOrder);
  const guestResult = determineBuyWinner(guestPlayers, guestOrder);

  assert('host and guest agree on winner slot', hostResult.winnerSlot, guestResult.winnerSlot);
  assert('winner is slot 1', hostResult.winnerSlot, 1);

  // Guest (slot 1) won — guest pushes buy order; host waits
  let hostGotOrder = null;
  c0.waitForBuyOrder(order => { hostGotOrder = order; });
  c1.pushBuyOrder([1, 0]);
  assert('host receives correct order after guest push', JSON.stringify(hostGotOrder), JSON.stringify([1, 0]));
}

{
  // Scenario: complete tie — BOTH clients use determineBuyWinner, BOTH agree slot 0 won.
  // Only slot 0 pushes; slot 1 only listens. No freeze.
  const { clients } = createGame('T31', 2, [0, 1]);
  const [c0, c1] = clients;

  function runTiebreaker(mySlot) {
    const allSlots = [0, 1];
    const ordered  = [mySlot, ...allSlots.filter(s => s !== mySlot)];
    const players  = ordered.map(() => ({
      roundDollars: 5, roundCows: 3, hand: [{ cost: 4 }], busted: false,
    }));
    return determineBuyWinner(players, ordered);
  }

  const c0Winner = runTiebreaker(0);
  const c1Winner = runTiebreaker(1);

  assert('complete tie — c0 thinks slot 0 wins', c0Winner.winnerSlot, 0);
  assert('complete tie — c1 thinks slot 0 wins', c1Winner.winnerSlot, 0);

  // c0 is slot 0 (local idx 0 for c0); c1 is slot 1 (local idx 1 for c1)
  // Only the client whose mySlot === winnerSlot pushes
  let orderReceived = null;
  c1.waitForBuyOrder(order => { orderReceived = order; });

  if (c0.mySlot === c0Winner.winnerSlot) {
    c0.pushBuyOrder([0, 1]);
  }
  // c1 does NOT push (it lost)

  assert('c1 received buy order — no freeze', JSON.stringify(orderReceived), JSON.stringify([0, 1]));
}

{
  // Scenario: 4P, all human — sequential buy turn simulation
  const { clients } = createGame('T33', 4, [0, 1, 2, 3]);
  const [c0, c1, c2, c3] = clients;

  // c2 wins tiebreaker; buy order is [2, 3, 0, 1]
  const order = [2, 3, 0, 1];

  // Non-c2 clients wait for buy order
  const orders = {};
  [c0, c1, c3].forEach(c => c.waitForBuyOrder(o => { orders[c.mySlot] = o; }));
  c2.pushBuyOrder(order);

  assert('c0 received 4P buy order', JSON.stringify(orders[0]), JSON.stringify(order));
  assert('c1 received 4P buy order', JSON.stringify(orders[1]), JSON.stringify(order));
  assert('c3 received 4P buy order', JSON.stringify(orders[3]), JSON.stringify(order));

  // c2 acts first; all others wait for slot 2's action
  const actions = {};
  [c0, c1, c3].forEach(c => c.waitForBuyAction(2, d => { actions[c.mySlot] = d.action; }));
  c2.pushBuyAction('buy', 5, 2);

  assert('c0 received c2 action', actions[0], 'buy');
  assert('c1 received c2 action', actions[1], 'buy');
  assert('c3 received c2 action', actions[3], 'buy');
}

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${'─'.repeat(56)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(56)}\n`);
process.exit(failed > 0 ? 1 : 0);
