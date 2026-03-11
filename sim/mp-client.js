// ============================================================
// mp-client.js — Testable MP protocol client
//
// Mirrors the MP IIFE in play.js but accepts an injectable
// mock (or real) Firebase db instead of importing from CDN.
// No DOM, no sessionStorage, no browser APIs.
//
// Usage:
//   const { createMpClient } = require('./mp-client');
//   const { createMockDb }   = require('./mock-firebase');
//
//   const { db, gameRef } = createMockDb('TESTGAME');
//   const host  = createMpClient({ db, gameCode: 'TESTGAME', mySlot: 0, numPlayers: 2,
//                                   slotDefs: [{name:'Alice',isHuman:true},{name:'Bob',isHuman:true}] });
//   const guest = createMpClient({ db, gameCode: 'TESTGAME', mySlot: 1, numPlayers: 2,
//                                   slotDefs: [{name:'Alice',isHuman:true},{name:'Bob',isHuman:true}] });
// ============================================================

'use strict';

function createMpClient({ db, gameCode, mySlot, numPlayers, slotDefs }) {
  const isHost = mySlot === 0;

  // All refs scoped under games/{gameCode}
  function ref(path) {
    return db.ref(path ? `games/${gameCode}/${path}` : `games/${gameCode}`);
  }

  const rootRef = ref('');

  function fbSet(r, v)       { return db.set(r, v); }
  function fbUpdate(r, v)    { return db.update(r, v); }
  function fbGet(r)          { return db.get(r); }
  function fbOnValue(r, cb)  { return db.onValue(r, cb); }

  // ---- Draw phase ----

  async function signalDrawDone(stats) {
    return fbSet(ref(`drawDone/${mySlot}`), { done: true, ...stats });
  }

  // Fires slotDoneCallback(slotIdx, val) once per human opponent slot when they signal done.
  // AI slots are skipped entirely (computed locally; no Firebase sync).
  function waitForAllHumanDrawsDone(slotDoneCallback) {
    for (let s = 0; s < numPlayers; s++) {
      if (s === mySlot || !slotDefs[s] || !slotDefs[s].isHuman) continue;
      let fired = false;
      let unsub = null;
      const slotIdx = s;
      unsub = fbOnValue(ref(`drawDone/${slotIdx}`), (snap) => {
        const val = snap.val();
        if (val && val.done === true && !fired) {
          fired = true;
          if (unsub) unsub();
          slotDoneCallback(slotIdx, val);
        }
      });
    }
  }

  async function pushDrawState(state) {
    return fbSet(ref(`drawState/${mySlot}`), state);
  }

  // Fires callback(slotIdx, state) on EVERY update (not one-shot) — used for live HUD
  function watchOpponentDrawStates(callback) {
    for (let s = 0; s < numPlayers; s++) {
      if (s === mySlot || !slotDefs[s] || !slotDefs[s].isHuman) continue;
      const slotIdx = s;
      fbOnValue(ref(`drawState/${slotIdx}`), (snap) => {
        const val = snap.val();
        if (val) callback(slotIdx, val);
      });
    }
  }

  // ---- Act setup (host → non-host) ----

  async function pushActSetup(act, cardIds) {
    if (!isHost) return;
    return fbSet(ref('actSetup'), { act, cardIds, ts: Date.now() });
  }

  // One-shot listener; host is excluded (it pushed, not waiting)
  function waitForActSetup(callback) {
    if (isHost) return;
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(ref('actSetup'), (snap) => {
      const data = snap.val();
      if (data && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
  }

  async function clearActSetup() {
    return fbSet(ref('actSetup'), null);
  }

  // ---- Buy phase ----

  // slotOrder = array of Firebase slot indices in buy turn order
  async function pushBuyOrder(slotOrder) {
    return fbSet(ref('buyOrder'), { slotOrder, ts: Date.now() });
  }

  function waitForBuyOrder(callback) {
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(ref('buyOrder'), (snap) => {
      const data = snap.val();
      if (data && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data.slotOrder);
      }
    });
  }

  async function pushBuyAction(action, row, col) {
    return fbSet(ref(`buyAction/${mySlot}`), { action, row, col, ts: Date.now() });
  }

  function waitForBuyAction(slotIdx, callback) {
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(ref(`buyAction/${slotIdx}`), (snap) => {
      const data = snap.val();
      if (data && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(data);
      }
    });
  }

  // ---- Pass card (end-of-round) ----

  async function pushPassCard(cardId, toSlot) {
    return fbSet(ref(`passCard/${mySlot}`), { cardId, toSlot, ts: Date.now() });
  }

  function waitForPassCard(fromSlot, callback) {
    let fired = false;
    let unsub = null;
    unsub = fbOnValue(ref(`passCard/${fromSlot}`), (snap) => {
      const val = snap.val();
      if (val && !fired) {
        fired = true;
        if (unsub) unsub();
        callback(val);
      }
    });
  }

  // ---- Round reset ----

  async function resetRound() {
    const updates = { buyAction: null, buyOrder: null };
    for (let i = 0; i < numPlayers; i++) {
      updates[`drawDone/${i}`]  = null;
      updates[`drawState/${i}`] = null;
      updates[`passCard/${i}`]  = null;
    }
    return fbUpdate(rootRef, updates);
  }

  // ---- Debug ----

  function dump() { return db.dump(); }

  return {
    mySlot, isHost, numPlayers, slotDefs,
    signalDrawDone,
    waitForAllHumanDrawsDone,
    pushDrawState,
    watchOpponentDrawStates,
    pushActSetup,
    waitForActSetup,
    clearActSetup,
    pushBuyOrder,
    waitForBuyOrder,
    pushBuyAction,
    waitForBuyAction,
    pushPassCard,
    waitForPassCard,
    resetRound,
    dump,
  };
}

module.exports = { createMpClient };
