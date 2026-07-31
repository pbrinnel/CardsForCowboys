#!/usr/bin/env node
// sim/personalities.js — the canonical AI personality genomes for all sim tools.
//
// SINGLE SOURCE OF TRUTH (sim side). Synced to src/play.js AI_PERSONALITIES — the values
// players actually face. test-personality-sync.js fails CI if these drift from play.js.
//
// Field mapping play.js -> here:
//   denialBurn (bool)  ->  denialWeight (number): true => 1.0, false => 0
//                          (the sim engine burns the leader's card when denialWeight >= 0.5)
//   maxDraw            ->  maxDraw (same; absent in play.js means 7 — written explicitly here)
// All other params are copied verbatim.
//
// Difficulty tiers are assigned by MEASURED strength (see gamesetup.html DIFFICULTY_TIERS +
// sim/AI_PERSONALITIES.md), validated with `node sim/simulate.js`.
'use strict';

const GENOMES = [
  { name: 'sheriff',    bustThreshold2: 0.05, bustThreshold1: 0.15, dollarBuffer: 0,   cowWeight: 5,   dollarWeight: 2,   banditPenalty: 4,   positionWeight: 0,   denialWeight: 0,   deckMemory: 0.9,  lethalBias: 1.5, affordMult: 1.2, act1DollarBonus: 1.5, act3CowBonus: 2.5, revealBonus: 2.5, maxDraw: 7  },
  { name: 'wild_bill',  bustThreshold2: 0.35, bustThreshold1: 0.50, dollarBuffer: 999, cowWeight: 9,   dollarWeight: 0.5, banditPenalty: 0.5, positionWeight: 0,   denialWeight: 0,   deckMemory: 0.1,  lethalBias: 0.5, affordMult: 2.0, act1DollarBonus: 0,   act3CowBonus: 4.0, revealBonus: 0,   maxDraw: 7  },
  { name: 'rancher',    bustThreshold2: 0.22, bustThreshold1: 0.42, dollarBuffer: 3,   cowWeight: 9,   dollarWeight: 0.5, banditPenalty: 20, positionWeight: 0.4, denialWeight: 0,   deckMemory: 0.6,  lethalBias: 1.0, affordMult: 1.6, act1DollarBonus: 0,   act3CowBonus: 3.5, revealBonus: 1.0, maxDraw: 10 },
  { name: 'banker',     bustThreshold2: 0.15, bustThreshold1: 0.30, dollarBuffer: 1,   cowWeight: 1.5, dollarWeight: 3,   banditPenalty: 2,   positionWeight: 0.3, denialWeight: 0,   deckMemory: 0.8,  lethalBias: 1.2, affordMult: 1.2, act1DollarBonus: 2.5, act3CowBonus: 0.5, revealBonus: 1.0, maxDraw: 7  },
  { name: 'outlaw',     bustThreshold2: 0.35, bustThreshold1: 0.55, dollarBuffer: 2,   cowWeight: 8,   dollarWeight: 1,   banditPenalty: 1.0, positionWeight: 1.5, denialWeight: 1.0, deckMemory: 0.4,  lethalBias: 0.6, affordMult: 2.0, act1DollarBonus: 0,   act3CowBonus: 3.5, revealBonus: 0.5, maxDraw: 7  },
  { name: 'deputy',     bustThreshold2: 0.10, bustThreshold1: 0.28, dollarBuffer: 1,   cowWeight: 6,   dollarWeight: 1.5, banditPenalty: 14, positionWeight: 0.3, denialWeight: 1.0, deckMemory: 0.7,  lethalBias: 1.3, affordMult: 1.4, act1DollarBonus: 0.5, act3CowBonus: 2.5, revealBonus: 2.0, maxDraw: 10 },
  { name: 'greenhorn',  bustThreshold2: 0.03, bustThreshold1: 0.08, dollarBuffer: 0,   cowWeight: 1.0, dollarWeight: 3.5, banditPenalty: 6.0, positionWeight: 0,   denialWeight: 0,   deckMemory: 0.2,  lethalBias: 2.5, affordMult: 1.0, act1DollarBonus: 3.0, act3CowBonus: 0.3, revealBonus: 3.5, maxDraw: 7  },
  { name: 'prospector', bustThreshold2: 0.12, bustThreshold1: 0.25, dollarBuffer: 1.5, cowWeight: 4.5, dollarWeight: 1.5, banditPenalty: 10, positionWeight: 0.2, denialWeight: 0,   deckMemory: 0.55, lethalBias: 1.3, affordMult: 1.3, act1DollarBonus: 1.0, act3CowBonus: 1.8, revealBonus: 2.0, maxDraw: 10 },
  { name: 'drifter',    bustThreshold2: 0.18, bustThreshold1: 0.35, dollarBuffer: 2.5, cowWeight: 7.0, dollarWeight: 0.8, banditPenalty: 14, positionWeight: 0.3, denialWeight: 1,   deckMemory: 0.65, lethalBias: 1.1, affordMult: 1.5, act1DollarBonus: 0.3, act3CowBonus: 2.8, revealBonus: 0.8, maxDraw: 10 },
  { name: 'enforcer',   bustThreshold2: 0.30, bustThreshold1: 0.60, dollarBuffer: 3.0, cowWeight: 9.5, dollarWeight: 1.5, banditPenalty: 20, positionWeight: 0.5, denialWeight: 0,   deckMemory: 0.75, lethalBias: 1.8, affordMult: 1.9, act1DollarBonus: 0,   act3CowBonus: 3.0, revealBonus: 0.2, maxDraw: 10 },
];

const byName = Object.fromEntries(GENOMES.map(g => [g.name, g]));

module.exports = { GENOMES, byName };
