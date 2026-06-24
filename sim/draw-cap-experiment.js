// ============================================================
// Draw-Cap A/B Experiment
// ============================================================
//
// Question: the AI draw logic hard-stops at hand.length >= 7 (play.js aiShouldDraw,
// mirrored in evolve.js shouldDraw). Winning human strategy tends to overdraw dollars
// (more cows + earlier buy priority, since buy order is roundDollars-first). Does
// letting the AI draw deeper actually win more, and at what bust cost?
//
// Method: for each personality F, sweep its maxDraw over a range while opponents stay
// at the shipped cap (7). Measure F's win rate and bust rate. Seat position is balanced
// (every matchup is played in both orderings) so seat-order bias cancels out.
//
// Engine: evolve.js runGame — the personality-genome model that mirrors the LIVE game's
// aiShouldDraw, NOT simulate.js's legacy RISK_PROFILES. Results reflect the shipped AI.
//
// Usage: node draw-cap-experiment.js [seedsPer2P] [seeds4P]
//   defaults: 1500 2P seeds/matchup, 4000 4P games per cell.

const { runGame } = require('./evolve.js');

const SEEDS_2P = parseInt(process.argv[2] || '1500', 10);
const GAMES_4P = parseInt(process.argv[3] || '4000', 10);
const CAPS = [7, 8, 9, 10, 12, 99]; // 7 = shipped baseline; 99 = effectively uncapped

// The 6 canonical tiered personalities, copied VERBATIM from src/play.js AI_PERSONALITIES
// (June 2026) so the numbers reflect the LIVE shipped AI, not evolve.js's GA seed genomes
// (which have drifted: shipped wild_bill dollarBuffer=999 vs seed 4.5, bolder rancher/outlaw).
// Param mapping: play.js `denialBurn` (bool) -> evolve.js genome `denialWeight` (>=0.5 burns leader).
const SHIPPED = [
  { name: 'sheriff',   bustThreshold2: 0.05, bustThreshold1: 0.15, dollarBuffer: 0,   cowWeight: 5,   dollarWeight: 2,   banditPenalty: 4,   positionWeight: 0,   denialWeight: 0,   deckMemory: 0.9, lethalBias: 1.5, affordMult: 1.2, act1DollarBonus: 1.5, act3CowBonus: 2.5, revealBonus: 2.5 },
  { name: 'wild_bill', bustThreshold2: 0.35, bustThreshold1: 0.50, dollarBuffer: 999, cowWeight: 9,   dollarWeight: 0.5, banditPenalty: 0.5, positionWeight: 0,   denialWeight: 0,   deckMemory: 0.1, lethalBias: 0.5, affordMult: 2.0, act1DollarBonus: 0,   act3CowBonus: 4.0, revealBonus: 0   },
  { name: 'rancher',   bustThreshold2: 0.22, bustThreshold1: 0.42, dollarBuffer: 3,   cowWeight: 9,   dollarWeight: 0.5, banditPenalty: 1.5, positionWeight: 0.4, denialWeight: 0,   deckMemory: 0.6, lethalBias: 1.0, affordMult: 1.6, act1DollarBonus: 0,   act3CowBonus: 3.5, revealBonus: 1.0 },
  { name: 'banker',    bustThreshold2: 0.15, bustThreshold1: 0.30, dollarBuffer: 1,   cowWeight: 1.5, dollarWeight: 3,   banditPenalty: 2,   positionWeight: 0.3, denialWeight: 0,   deckMemory: 0.8, lethalBias: 1.2, affordMult: 1.2, act1DollarBonus: 2.5, act3CowBonus: 0.5, revealBonus: 1.0 },
  { name: 'outlaw',    bustThreshold2: 0.35, bustThreshold1: 0.55, dollarBuffer: 2,   cowWeight: 8,   dollarWeight: 1,   banditPenalty: 1.0, positionWeight: 1.5, denialWeight: 1.0, deckMemory: 0.4, lethalBias: 0.6, affordMult: 2.0, act1DollarBonus: 0,   act3CowBonus: 3.5, revealBonus: 0.5 },
  { name: 'deputy',    bustThreshold2: 0.10, bustThreshold1: 0.28, dollarBuffer: 1,   cowWeight: 6,   dollarWeight: 1.5, banditPenalty: 2.5, positionWeight: 0.3, denialWeight: 1.0, deckMemory: 0.7, lethalBias: 1.3, affordMult: 1.4, act1DollarBonus: 0.5, act3CowBonus: 2.5, revealBonus: 2.0 },
];

const names = SHIPPED.map(g => g.name);
const byName = Object.fromEntries(SHIPPED.map(g => [g.name, g]));

function withCap(genome, cap) { return { ...genome, maxDraw: cap }; }

// --- 2P: focal F (at cap) vs each standard personality (at 7), both seat orders ---
function run2P(focalName, cap) {
  const focal = withCap(byName[focalName], cap);
  let wins = 0, games = 0, busts = 0, drawRounds = 0;
  for (const oppName of names) {
    const opp = withCap(byName[oppName], 7); // opponents always shipped cap
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
  const others = names.map(n => withCap(byName[n], 7));
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
console.log(`Engine: evolve.js runGame (personality model, mirrors live aiShouldDraw). Baseline cap = 7.\n`);

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
