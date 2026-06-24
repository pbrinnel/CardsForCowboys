// ============================================================
// Draw-Cap A/B Experiment
// ============================================================
//
// Question: the AI draw logic hard-stops at hand.length >= 7 (play.js aiShouldDraw,
// mirrored in evolve.js shouldDraw). Winning human strategy tends to overdraw dollars
// (more cows + earlier buy priority, since buy order is roundDollars-first). Does
// letting the AI draw deeper actually win more, and at what bust cost?
//
// Method: for each personality F, sweep its maxDraw over a range while opponents keep their
// SHIPPED caps. Measure F's win rate and bust rate. Seat position is balanced (every matchup
// is played in both orderings) so seat-order bias cancels out.
//
// Engine: the shared personality-engine.js runGame on the canonical personalities.js genomes —
// the same decision logic the live game runs. This is an EXAMPLE of a focused single-knob
// experiment; copy it as a template when tuning one parameter in isolation.
//
// NOTE: the shipped result of this experiment (rancher & deputy → maxDraw 10) is already baked
// into personalities.js, so the "cap7" column no longer equals the live config for those two.
// Re-run it to re-examine the cap, e.g. after a card or threshold change.
//
// Usage: node draw-cap-experiment.js [seedsPer2P] [seeds4P]
//   defaults: 1500 2P seeds/matchup, 4000 4P games per cell.

const { runGame } = require('./personality-engine');
const { GENOMES, byName } = require('./personalities');

const SEEDS_2P = parseInt(process.argv[2] || '1500', 10);
const GAMES_4P = parseInt(process.argv[3] || '4000', 10);
const CAPS = [7, 8, 9, 10, 12, 99]; // 7 = legacy baseline; 99 = effectively uncapped

const names = GENOMES.map(g => g.name);

function withCap(genome, cap) { return { ...genome, maxDraw: cap }; }

// --- 2P: focal F (at swept cap) vs each personality (at its shipped cap), both seat orders ---
function run2P(focalName, cap) {
  const focal = withCap(byName[focalName], cap);
  let wins = 0, games = 0, busts = 0, drawRounds = 0;
  for (const oppName of names) {
    const opp = byName[oppName]; // opponent keeps its shipped maxDraw
    for (let s = 0; s < SEEDS_2P; s++) {
      // seat order A: focal = P0
      let r = runGame([focal, opp], 2, s * 2 + 1);
      if (r.winner === 0) wins++;
      busts += r.busts[0]; drawRounds += r.drawRounds[0]; games++;
      // seat order B: focal = P1 (same seed family, swapped seats)
      r = runGame([opp, focal], 2, s * 2 + 1);
      if (r.winner === 1) wins++;
      busts += r.busts[1]; drawRounds += r.drawRounds[1]; games++;
    }
  }
  return { winRate: wins / games, bustRate: busts / drawRounds, games };
}

// --- 4P: focal F (at cap) + 3 standard opponents (at 7); F rotates through all 4 seats ---
function run4P(focalName, cap) {
  const focal = withCap(byName[focalName], cap);
  const others = names.map(n => byName[n]); // opponents keep their shipped maxDraw
  let wins = 0, games = 0, busts = 0, drawRounds = 0;
  for (let s = 0; s < GAMES_4P; s++) {
    // deterministic-but-varied 3-opponent draw from the seed
    const pick = [];
    let h = (s * 2654435761) >>> 0;
    while (pick.length < 3) {
      h = (h * 1664525 + 1013904223) >>> 0;
      const idx = h % others.length;
      pick.push(others[idx]);
    }
    const seat = s % 4; // rotate focal's seat for position fairness
    const lineup = pick.slice();
    lineup.splice(seat, 0, focal);
    const r = runGame(lineup, 4, s + 1);
    if (r.winner === seat) wins++;
    busts += r.busts[seat]; drawRounds += r.drawRounds[seat]; games++;
  }
  return { winRate: wins / games, bustRate: busts / drawRounds, games };
}

function pct(x) { return (x * 100).toFixed(1).padStart(5); }

console.log(`Draw-Cap Experiment  (2P: ${SEEDS_2P} seeds×6 opp×2 seats = ${SEEDS_2P * 12} games/cell;  4P: ${GAMES_4P} games/cell)`);
console.log(`Engine: personality-engine.js runGame on personalities.js (live AI logic). Sweeping focal maxDraw.\n`);

for (const mode of ['2P', '4P']) {
  const baselineWin = mode === '2P' ? 50.0 : 25.0;
  console.log(`=== ${mode}  (win-rate baseline = ${baselineWin.toFixed(1)}%) ===`);
  // header
  console.log('personality '.padEnd(12) + CAPS.map(c => `cap${c}`.padStart(7)).join('') + '   | bust% (win% / bust%)');
  for (const name of names) {
    const cells = CAPS.map(cap => (mode === '2P' ? run2P(name, cap) : run4P(name, cap)));
    const winRow = cells.map(c => pct(c.winRate)).join('  ');
    const bustRow = cells.map(c => pct(c.bustRate)).join('  ');
    console.log(name.padEnd(12) + winRow);
    console.log(''.padEnd(12) + bustRow + '   <- bust%');
  }
  console.log('');
}
