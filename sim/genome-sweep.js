#!/usr/bin/env node
// sim/genome-sweep.js — sweep ONE genome parameter for a focal bot and report win% + bust%.
// Generalises draw-cap-experiment.js (which hard-codes `maxDraw`) to any numeric genome field,
// so a single-knob hypothesis can be tested without copying the harness again.
//
// Workflow C of TUNING.md: use when you have a specific hypothesis ("banditPenalty is too low"),
// not to go fishing — that is evolve.js's job.
//
// The focal bot plays its swept value against an UNCHANGED field, so the number reported is the
// value of the change to that bot, holding opponents fixed.
//
// Usage:
//   node sim/genome-sweep.js --param banditPenalty --values 1.2,3,6,10,14,18 --focal enforcer
//   node sim/genome-sweep.js --param banditPenalty --values 2,8,14 --focal all --players 4
'use strict';

const engine = require('./personality-engine');
const { GENOMES, byName } = require('./personalities');

const NAMES = GENOMES.map(g => g.name);

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { param: null, values: null, focal: 'all', games: 1200, players: 4 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--param') o.param = a[++i];
    else if (a[i] === '--values') o.values = a[++i].split(',').map(Number);
    else if (a[i] === '--focal') o.focal = a[++i];
    else if (a[i] === '--games') o.games = parseInt(a[++i], 10);
    else if (a[i] === '--players') o.players = parseInt(a[++i], 10);
  }
  return o;
}

// Focal bot (with the swept param) vs a rotating field of the UNCHANGED shipped bots.
function evalFocal(focalGenome, players, games) {
  let wins = 0, busts = 0, draws = 0, herd = 0;
  for (let s = 0; s < games; s++) {
    const opps = Array.from({ length: players - 1 }, (_, k) => byName[NAMES[(s * 3 + k + 1) % NAMES.length]]);
    const seat = s % players;
    const lineup = opps.slice();
    lineup.splice(seat, 0, focalGenome);
    const r = engine.runGame(lineup, players, s + 1);
    if (r.winners.includes(seat)) wins += 1 / r.winners.length;   // ties split
    busts += r.busts[seat]; draws += r.drawRounds[seat]; herd += r.herds[seat];
  }
  return { wr: wins / games, bust: busts / draws, herd: herd / games };
}

function main() {
  const o = parseArgs();
  if (!o.param || !o.values) {
    console.error('usage: node sim/genome-sweep.js --param <name> --values a,b,c [--focal name|all] [--players 4] [--games 1200]');
    process.exit(1);
  }
  const focals = o.focal === 'all' ? NAMES : o.focal.split(',').map(s => s.trim());
  for (const f of focals) if (!byName[f]) { console.error('unknown personality: ' + f); process.exit(1); }

  console.log(`Genome sweep — ${o.param} · ${o.players}P · ${o.games} games per cell · focal vs unchanged field`);
  console.log(`baseline win% = ${(100 / o.players).toFixed(1)}%  (ties split fractionally)\n`);

  for (const name of focals) {
    const base = byName[name];
    const shipped = base[o.param];
    console.log(`${name}   (shipped ${o.param} = ${shipped}, cowWeight ${base.cowWeight})`);
    let bestWr = -1, bestV = null;
    const rows = [];
    for (const v of o.values) {
      const g = { ...base, [o.param]: v };
      const r = evalFocal(g, o.players, o.games);
      rows.push({ v, ...r });
      if (r.wr > bestWr) { bestWr = r.wr; bestV = v; }
    }
    const shippedRow = rows.find(r => r.v === shipped);
    for (const r of rows) {
      const delta = shippedRow ? (r.wr - shippedRow.wr) * 100 : NaN;
      const mark = r.v === bestV ? ' ←best' : (r.v === shipped ? ' (shipped)' : '');
      console.log('   ' + String(r.v).padStart(6) + '   win ' + (100 * r.wr).toFixed(1).padStart(5) + '%' +
        (isFinite(delta) ? ('  ' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pp').padStart(9) : '        ') +
        '   bust ' + (100 * r.bust).toFixed(1).padStart(5) + '%' +
        '   herd ' + r.herd.toFixed(1).padStart(5) + mark);
    }
    console.log('');
  }
  console.log('Adopt a value only if the gain is consistent and large enough to matter — and keep');
  console.log('intentional deviations (banker/greenhorn are designed to lose; do not "fix" them).');
}

main();
