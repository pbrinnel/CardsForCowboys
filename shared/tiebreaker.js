// ============================================================
// determineBuyWinner — pure tiebreaker function
// Shared between play.js (browser, loaded via <script>) and
// sim/test-tiebreaker.js (Node.js, loaded via require()).
//
// Given players[] and playerOrder[], returns:
//   { winnerIdx, winnerSlot, reason, tieLog }
//
// playerOrder[i] = Firebase slot index for players[i].
// In SP mode playerOrder[i] === i (identity mapping).
// No side effects, no globals, no DOM, no Firebase.
// ============================================================

function determineBuyWinner(players, playerOrder, seed) {
  let candidates = players.map((p, i) => ({ p, i })).filter(c => !c.p.busted);

  if (candidates.length === 0) {
    return { winnerIdx: 0, winnerSlot: playerOrder[0], reason: 'all busted', tieLog: null };
  }

  let reason = '';
  let tieLog = null;

  function narrowBy(scoreFn) {
    if (candidates.length <= 1) return;
    const best = Math.max(...candidates.map(scoreFn));
    candidates = candidates.filter(c => scoreFn(c) === best);
  }

  const preBust = candidates.length;
  const maxDollars = Math.max(...candidates.map(c => c.p.roundDollars));
  narrowBy(c => c.p.roundDollars);
  if (candidates.length < preBust || candidates.length === 1) {
    reason = `most $ ($${maxDollars})`;
  }

  if (candidates.length > 1) {
    const prev = candidates.slice();
    const maxCows = Math.max(...candidates.map(c => c.p.roundCows));
    narrowBy(c => c.p.roundCows);
    if (candidates.length < prev.length) {
      tieLog = `Tied on $${maxDollars} — most cows breaks tie`;
      reason = 'most cows';
    }
  }

  if (candidates.length > 1) {
    const prev = candidates.slice();
    narrowBy(c => c.p.hand.length);
    if (candidates.length < prev.length) {
      tieLog = `Tied on $ and cows — most cards drawn breaks tie`;
      reason = 'most cards drawn';
    }
  }

  if (candidates.length > 1) {
    const ordinal = n => n === 0 ? '1st' : n === 1 ? '2nd' : n === 2 ? '3rd' : `${n + 1}th`;
    const maxLen = Math.max(...candidates.map(c => c.p.hand.length));
    let resolved = false;
    for (let i = 0; i < maxLen; i++) {
      const prev = candidates.slice();
      narrowBy(c => (c.p.hand[i] && c.p.hand[i].cost) || 0);
      if (candidates.length < prev.length) {
        tieLog = `Tied on $, cows, and cards — ${ordinal(i)} card cost breaks tie`;
        reason = `${ordinal(i)} card cost`;
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      // Complete tie — use seeded LCG to pick randomly.
      // Sort tied slot indices so ALL clients operate on the same ordered list,
      // then use the seed to pick one; everyone runs the same LCG and agrees.
      const tiedSlots = candidates.map(c => playerOrder[c.i]).sort((a, b) => a - b);
      let lcgSeed = ((seed || 1) >>> 0) || 1;
      lcgSeed = (Math.imul(1664525, lcgSeed) + 1013904223) >>> 0;
      const pickedSlot = tiedSlots[lcgSeed % tiedSlots.length];
      candidates = candidates.filter(c => playerOrder[c.i] === pickedSlot);
      tieLog = 'Complete tie — random draw decides';
      reason = 'random draw';
    }
  }

  const winner = candidates[0];
  return { winnerIdx: winner.i, winnerSlot: playerOrder[winner.i], reason, tieLog };
}

// Works as browser global or Node module
if (typeof module !== 'undefined') module.exports = { determineBuyWinner };
