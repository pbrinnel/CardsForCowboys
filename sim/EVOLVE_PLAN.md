# Evolutionary AI Tournament — Implementation Plan

## Purpose

Run a generational genetic algorithm over the Cards For Cowboys AI parameter space to
converge on an optimal strategy. Each generation runs a full round-robin tournament;
winners reproduce with mutations into the next generation. After many generations the
population converges toward a locally optimal genome.

This document is a complete, self-contained spec. A fresh context should be able to
implement `sim/evolve.js` from this file alone.

---

## File to Create

**`sim/evolve.js`** — standalone Node.js CLI script.

### Imports / dependencies

```js
const core = require('./game-core');   // game state, pyramid, card DB, draw/buy logic
// Do NOT import ai-player.js — that module uses fixed profiles and the old bust-prob
// calculation. evolve.js defines its own AI decision layer inline.
```

`game-core.js` exports: `STORE_CARDS`, `STARTER_TEMPLATES`, `createPlayer`,
`initState`, `getAvailablePyramidCards`, `isCardCovered`, `drawFromDeck`,
`applyCardEffects`, `scoreRound`. Check the file for exact export names before using.

> **Important:** `game-core.js` has a `countBanditsInDeck` function that uses the old
> (incorrect) calculation — it sums all bandit pips, not lethal cards. Do NOT import or
> call it in evolve.js. Use `calcBustProb` defined below.

---

## Genome Definition

A genome is a plain JS object. Every parameter is a continuous float (even flags like
`denialWeight` — no booleans). The table below defines the full genome, valid ranges,
and a suggested default for generating the initial random population.

| Parameter | Range | Default | Description |
|---|---|---|---|
| `bustThreshold2` | 0.01 – 0.60 | 0.15 | Max perceived bust-prob willing to accept with 2 bandits in hand |
| `bustThreshold1` | 0.05 – 0.90 | 0.30 | Same with 1 bandit in hand |
| `dollarBuffer` | 0 – 5 | 1 | Extra dollars to accumulate beyond the best-scored card's cost |
| `cowWeight` | 0 – 10 | 4 | Buy-phase multiplier for card's cow value |
| `dollarWeight` | 0 – 6 | 1.5 | Buy-phase multiplier for card's dollar value |
| `banditPenalty` | 0 – 8 | 2.5 | Buy-phase penalty per bandit on a card |
| `positionWeight` | 0 – 2.5 | 0.5 | How strongly to scale bust thresholds based on herd standings |
| `denialWeight` | 0 – 1 | 0.0 | 0 = burn lowest-value-to-self; 1 = burn highest-value-to-leader |
| `deckMemory` | 0 – 1 | 0.5 | 0 = flat prior for bust prob; 1 = exact lethal card count |
| `lethalBias` | 0.2 – 2.5 | 1.0 | Multiplier applied to perceived bust probability |
| `act1DollarBonus` | 0 – 3 | 1.0 | Extra score per dollar on cards scored in Act 1 |
| `act3CowBonus` | 0 – 4 | 2.0 | Extra score per cow on cards scored in Act 3 |
| `revealBonus` | 0 – 4 | 1.5 | Score bonus for buying a card that uncovers a face-down pyramid slot |
| `affordMult` | 1.0 – 2.5 | 1.4 | Draw-aggression multiplier when AI cannot afford any available card |

**Total genome size: 14 parameters.**

### Encoding notes

- `dollarBuffer`: treat as continuous float during evolution; clamp to [0, 5] when applying.
  There is no "999 = ignore target" mode in evolved genomes — that behaviour belonged to
  Wild Bill's fixed personality. If an evolved AI gets `dollarBuffer ≥ 4.5` it will
  effectively keep drawing until it runs out of cards on 0 bandits.
- `denialWeight`: replaces the boolean `denialBurn` flag. Values below ~0.15 behave
  identically to `denialBurn: false`; above ~0.85 to `denialBurn: true`. The range in
  between blends them (burn-target score = `denialWeight * leaderCardScore +
  (1-denialWeight) * selfWorstScore`).

---

## AI Decision Layer (implement inline in evolve.js)

These functions replicate the logic from `play.js` with genomes instead of named
personalities. Implement them verbatim so that simulation results correspond to
actual in-game behaviour.

### `calcBustProb(player, currentBandits, genome)`

```js
function calcBustProb(player, currentBandits, genome) {
  const deck = player.deck;
  if (deck.length === 0) return 0;
  // lethal = cards that cause an immediate bust given current bandit count
  const minLethal = currentBandits === 2 ? 1 : 2;
  const lethalCount = deck.filter(c => (c.bandits || 0) >= minLethal).length;
  const exactProb  = lethalCount / deck.length;
  const FLAT_PRIOR = 0.20;
  return (exactProb * genome.deckMemory + FLAT_PRIOR * (1 - genome.deckMemory))
         * genome.lethalBias;
}
```

With 2 bandits in hand: any card with `bandits >= 1` causes a bust → `minLethal = 1`.
With 1 bandit in hand: only cards with `bandits >= 2` cause an immediate bust → `minLethal = 2`.

### `scoreCard(card, genome, act, allPlayers, thisPlayer)`

```js
function scoreCard(card, genome, act, allPlayers, thisPlayer) {
  let score = 0;
  score += (card.cows    || 0) * genome.cowWeight;
  score += (card.dollars || 0) * genome.dollarWeight;
  score -= (card.bandits || 0) * genome.banditPenalty;
  // Act-phase bonuses
  if (act === 1) score += (card.dollars || 0) * genome.act1DollarBonus;
  if (act === 3) score += (card.cows    || 0) * genome.act3CowBonus;
  // Fixed special bonuses (not evolved — these are structural value estimates)
  if (card.special === 'trash_to_use')       score += 2;
  if (card.special === 'draw4')              score += 2;
  if (card.special === 'replay_discard')     score += 2;
  if (card.special === 'look3_rearrange')    score += 1.5;
  if (card.special === 'trash_buy_burn_first') score += 1;
  if (card.special === 'dollar1_other')      score -= 0.5;
  if (card.special === 'copy_next' && thisPlayer && thisPlayer.deck.length > 0) {
    const avg = thisPlayer.deck.reduce((s, c) =>
      s + (c.cows || 0) * genome.cowWeight + (c.dollars || 0) * genome.dollarWeight, 0)
      / thisPlayer.deck.length;
    score += Math.max(1.5, Math.min(6, avg));
  }
  if ((card.cows || 0) < 0) score -= 2;
  return score;
}
```

### `pyramidRevealBonus(pyramid, row, col, genome)`

```js
function pyramidRevealBonus(pyramid, row, col, genome) {
  if (row === 0) return 0;
  let bonus = 0;
  if (col < row) {
    const parentA = pyramid[row - 1][col];
    if (parentA && !parentA.removed && !parentA.faceUp) {
      const sibA = pyramid[row][col + 1];
      if (!sibA || sibA.removed) bonus += genome.revealBonus;
    }
  }
  if (col > 0) {
    const parentB = pyramid[row - 1][col - 1];
    if (parentB && !parentB.removed && !parentB.faceUp) {
      const sibB = pyramid[row][col - 1];
      if (!sibB || sibB.removed) bonus += genome.revealBonus;
    }
  }
  return bonus;
}
```

### `shouldDraw(player, genome, pyramid, act, allPlayers)`

```js
function shouldDraw(player, genome, pyramid, act, allPlayers) {
  if (player.hand.length >= 7) return false;
  if (player.hand.length < 2)  return true;

  // Position modifier
  let posMult = 1.0;
  if (genome.positionWeight > 0 && allPlayers.length > 1) {
    const maxOpp = Math.max(0, ...allPlayers.filter(p => p !== player).map(p => p.herd || 0));
    const deficit = maxOpp - (player.herd || 0);
    posMult = Math.max(0.5, Math.min(2.0, 1 + (deficit / 10) * genome.positionWeight));
  }

  const avail = core.getAvailablePyramidCards(pyramid);
  const canAfford = avail.some(a => (a.slot.card.cost || 0) <= player.roundDollars);
  const affordMult = canAfford ? 1.0 : genome.affordMult;

  if (player.roundBandits >= 2) {
    if (player.deck.length === 0) return false;
    return calcBustProb(player, 2, genome) < genome.bustThreshold2 * posMult * affordMult;
  }

  if (player.roundBandits === 1) {
    if (player.deck.length <= 1) return false;
    if (calcBustProb(player, 1, genome) >= genome.bustThreshold1 * posMult * affordMult) return false;
    const bestCost = getBestCost(player, genome, pyramid, act, allPlayers);
    return player.roundDollars < bestCost;
  }

  // 0 bandits: draw until we can afford the best card + buffer
  const bestCost = getBestCost(player, genome, pyramid, act, allPlayers);
  const maxCost  = avail.length > 0 ? Math.max(...avail.map(a => a.slot.card.cost || 0)) : bestCost;
  const buf      = Math.min(genome.dollarBuffer, Math.max(0, maxCost - bestCost));
  return player.roundDollars < bestCost + buf;
}
```

### `getBestCost(player, genome, pyramid, act, allPlayers)`

Returns the cost of the highest-scored available pyramid card.

```js
function getBestCost(player, genome, pyramid, act, allPlayers) {
  const avail = core.getAvailablePyramidCards(pyramid);
  if (avail.length === 0) return 99;
  let best = -Infinity, bestCost = 0;
  for (const a of avail) {
    const s = scoreCard(a.slot.card, genome, act, allPlayers, player)
            + pyramidRevealBonus(pyramid, a.row, a.col, genome);
    if (s > best) { best = s; bestCost = a.slot.card.cost || 0; }
  }
  return bestCost;
}
```

### `chooseBuy(player, genome, pyramid, act, allPlayers)`

Returns `{ action: 'buy'|'burn', row, col }` or `{ action: 'pass' }`.

```js
function chooseBuy(player, genome, pyramid, act, allPlayers) {
  const avail = core.getAvailablePyramidCards(pyramid);
  if (avail.length === 0) return { action: 'pass' };

  const affordable = avail.filter(a => (a.slot.card.cost || 0) <= player.roundDollars);
  if (affordable.length > 0) {
    let best = null, bestScore = -Infinity;
    for (const a of affordable) {
      const s = scoreCard(a.slot.card, genome, act, allPlayers, player)
              + pyramidRevealBonus(pyramid, a.row, a.col, genome);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    return { action: 'buy', row: best.row, col: best.col };
  }

  // Burn: blend between burning self-worst and burning leader-best
  const leader = allPlayers
    .filter(p => p !== player)
    .sort((a, b) => (b.herd || 0) - (a.herd || 0))[0];

  let burnTarget = null, worstSelfScore = Infinity, bestLeaderScore = -Infinity;
  let selfWorst = null, leaderBest = null;

  for (const a of avail) {
    const selfScore = scoreCard(a.slot.card, genome, act, allPlayers, player);
    if (selfScore < worstSelfScore) { worstSelfScore = selfScore; selfWorst = a; }
    if (leader) {
      const ls = scoreCard(a.slot.card, genome, act, allPlayers, leader);
      if (ls > bestLeaderScore) { bestLeaderScore = ls; leaderBest = a; }
    }
  }

  // denialWeight blends burn targets: 0 = self-worst, 1 = leader-best
  burnTarget = genome.denialWeight >= 0.5 && leaderBest ? leaderBest : selfWorst;
  return { action: 'burn', row: burnTarget.row, col: burnTarget.col };
}
```

---

## Game Runner

`runGame(genomes, numPlayers, seed)` — runs one complete game and returns final herds.

- `genomes`: array of genome objects, one per player (length = numPlayers).
- `seed`: integer used to seed all shuffles and the pyramid build deterministically.
- Returns: `{ herds: [number], winner: number }` where indices correspond to `genomes`.

Use `core.initState`, `core.createPlayer`, etc. from `game-core.js`. Replicate the
three-act, five-round structure of the real game. For each act:

1. Build pyramid from the act's card pool (shuffle deterministically with the seed).
2. For each round: run draw phase → run buy phase → score round.
3. After 5 rounds, advance to next act (or showdown after act 3).

**Draw phase:** Loop until all players have stopped or busted. Each player: draw cards
one at a time, apply effects, check bust (`roundBandits >= 3`), call `shouldDraw` after
each non-bust draw.

**Buy phase:** Determine buy order (player with most roundDollars goes first; tiebreak
by lowest player index). Each player in order: call `chooseBuy`, apply buy/burn to
pyramid, call `core.revealUncovered` after each removal.

**Seeding:** Use an LCG seeded by `seed` for all shuffles:
```js
function makeLCG(seed) {
  let s = ((seed >>> 0) || 1);
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
}
```

---

## Fitness Evaluation

Fitness for a genome is its average win rate across all matchups in the generation,
evaluated at **multiple player counts and multiple seeds**.

### Per-matchup evaluation

```
matchupFitness(genomeA, genomeB, numPlayers, K_SEEDS) →
  wins_A / (K_SEEDS * numPlayers_per_game)
```

Run K_SEEDS games per matchup (recommended: K_SEEDS = 30). For each seed, seat all
genomes in the game; collect who wins. Average win rate over all seeds is the matchup
score.

### Multi-player count

Run every matchup at both **2P** and **4P**. A genome's total fitness is the
unweighted average of its win rates at both player counts. This prevents overfit to
one configuration.

### Generation fitness

Each genome plays against every other genome in the population (round-robin). A
genome's fitness = average win rate across all its matchup scores.

---

## Evolutionary Algorithm

### Population

- Size: **POP_SIZE = 24** (configurable via CLI).
- Generation 0: initialize with the 6 hand-tuned named personalities as a seed
  population (convert their params to genome format) plus 18 randomly generated genomes
  to ensure initial diversity.

### Named personality seeds (generation 0 only)

```js
const SEED_GENOMES = [
  { name:'sheriff',   bustThreshold2:0.05, bustThreshold1:0.15, dollarBuffer:0,   cowWeight:3,   dollarWeight:1.5, banditPenalty:4,   positionWeight:0,   denialWeight:0,   deckMemory:0.9, lethalBias:1.5, act1DollarBonus:1, act3CowBonus:2, revealBonus:1.5, affordMult:1.4 },
  { name:'wild_bill', bustThreshold2:0.35, bustThreshold1:0.50, dollarBuffer:4.5, cowWeight:5,   dollarWeight:0.5, banditPenalty:0.5, positionWeight:0,   denialWeight:0,   deckMemory:0.1, lethalBias:0.5, act1DollarBonus:1, act3CowBonus:2, revealBonus:1.5, affordMult:1.4 },
  { name:'rancher',   bustThreshold2:0.15, bustThreshold1:0.30, dollarBuffer:2,   cowWeight:6,   dollarWeight:0.5, banditPenalty:2,   positionWeight:0.4, denialWeight:0,   deckMemory:0.6, lethalBias:1.0, act1DollarBonus:1, act3CowBonus:2, revealBonus:1.5, affordMult:1.4 },
  { name:'banker',    bustThreshold2:0.15, bustThreshold1:0.30, dollarBuffer:1,   cowWeight:1.5, dollarWeight:3,   banditPenalty:2,   positionWeight:0.3, denialWeight:0,   deckMemory:0.8, lethalBias:1.2, act1DollarBonus:1, act3CowBonus:2, revealBonus:1.5, affordMult:1.4 },
  { name:'outlaw',    bustThreshold2:0.20, bustThreshold1:0.35, dollarBuffer:1,   cowWeight:4,   dollarWeight:1,   banditPenalty:2,   positionWeight:1.5, denialWeight:0,   deckMemory:0.4, lethalBias:0.8, act1DollarBonus:1, act3CowBonus:2, revealBonus:1.5, affordMult:1.4 },
  { name:'deputy',    bustThreshold2:0.10, bustThreshold1:0.20, dollarBuffer:0,   cowWeight:2,   dollarWeight:2,   banditPenalty:3,   positionWeight:0.3, denialWeight:1.0, deckMemory:0.7, lethalBias:1.3, act1DollarBonus:1, act3CowBonus:2, revealBonus:1.5, affordMult:1.4 },
];
```

Note: Wild Bill's `dollarBuffer:999` maps to `4.5` (near the top of the [0,5] range).

### Selection

After fitness evaluation:

1. Rank all genomes by fitness (descending).
2. **Elites**: top `floor(POP_SIZE * ELITE_FRAC)` survive unchanged (default ELITE_FRAC = 0.25 → 6 elites).
3. **Parents pool**: top 50% are eligible to reproduce.
4. Fill remaining spots via crossover + mutation of randomly chosen parent pairs.
5. Always keep at least 2 randomly-generated genomes per generation (diversity pressure).

### Crossover

Uniform crossover: for each parameter, pick from parent A or parent B with 50% probability.

```js
function crossover(parentA, parentB) {
  const child = {};
  for (const key of PARAM_KEYS) {
    child[key] = Math.random() < 0.5 ? parentA[key] : parentB[key];
  }
  return child;
}
```

### Mutation

After crossover, apply Gaussian noise to each parameter independently.

```js
function mutate(genome, mutationRate = 0.3, mutationStrength = 0.15) {
  const child = { ...genome };
  for (const key of PARAM_KEYS) {
    if (Math.random() < mutationRate) {
      const range = PARAM_RANGES[key].max - PARAM_RANGES[key].min;
      child[key] += gaussianRandom() * range * mutationStrength;
      child[key] = Math.max(PARAM_RANGES[key].min, Math.min(PARAM_RANGES[key].max, child[key]));
    }
  }
  return child;
}
```

`gaussianRandom()`: Box-Muller transform → standard normal sample.

**Default rates:** mutationRate = 0.3 (30% of params mutate per child), mutationStrength = 0.15
(noise std dev = 15% of the parameter's range). Both are CLI-configurable.

### PARAM_RANGES constant

```js
const PARAM_RANGES = {
  bustThreshold2:  { min: 0.01, max: 0.60 },
  bustThreshold1:  { min: 0.05, max: 0.90 },
  dollarBuffer:    { min: 0,    max: 5    },
  cowWeight:       { min: 0,    max: 10   },
  dollarWeight:    { min: 0,    max: 6    },
  banditPenalty:   { min: 0,    max: 8    },
  positionWeight:  { min: 0,    max: 2.5  },
  denialWeight:    { min: 0,    max: 1    },
  deckMemory:      { min: 0,    max: 1    },
  lethalBias:      { min: 0.2,  max: 2.5  },
  act1DollarBonus: { min: 0,    max: 3    },
  act3CowBonus:    { min: 0,    max: 4    },
  revealBonus:     { min: 0,    max: 4    },
  affordMult:      { min: 1.0,  max: 2.5  },
};
const PARAM_KEYS = Object.keys(PARAM_RANGES);
```

---

## Anti-Overfitting Measures

1. **Multi-seed evaluation**: K_SEEDS=30 games per matchup. A genome needs consistent
   performance, not lucky wins.
2. **Multi-player-count evaluation**: fitness averages 2P and 4P. A strategy that only
   dominates 2P is not considered optimal.
3. **Diversity pressure**: 2 random genomes per generation. Prevents full population
   collapse into one local optimum.
4. **Holdout validation**: after convergence (or every 10 generations), run the current
   best genome against the 6 named seed personalities under 200 fresh seeds never used
   during training. Report holdout win rate separately.
5. **Run multiple independent trials**: the CLI supports `--trials N` which runs N
   completely independent evolutionary runs with different initial random populations,
   then compares the converged best from each. If top genomes across trials agree on
   parameter values (within ~10% of range), convergence is genuine.

---

## Generation Loop

```
initialize population (6 seeds + 18 random)
for gen = 1 to MAX_GENERATIONS:
  evaluate fitness for each genome (round-robin, 2P+4P, K_SEEDS per matchup)
  sort population by fitness
  log generation summary (see Output section)
  if converged (top 3 genomes within 1% fitness of each other for 5 consecutive gens):
    run holdout validation on best genome
    break
  build next generation:
    elites = top ELITE_FRAC of population (unchanged)
    randoms = 2 freshly random genomes
    children = fill remaining slots via crossover(parent_a, parent_b) + mutate
  population = elites + randoms + children
run final holdout validation
write results to sim/results/evolve_{timestamp}.json
```

---

## Output Format

### Per-generation console output

```
Gen  3 | best: 0.612 | mean: 0.481 | worst: 0.321 | spread: 0.291
  #1  bustT2=0.08 bustT1=0.22 dolBuf=1.2 cowW=5.1 dolW=1.8 bandPen=3.4 posW=0.6 denW=0.1 mem=0.74 bias=1.3 a1dol=1.2 a3cow=2.8 rev=1.9 aff=1.5  fit=0.612
  #2  bustT2=0.11 bustT1=0.28 ...  fit=0.589
  ...
```

### Per-run JSON file (`sim/results/evolve_{timestamp}.json`)

```json
{
  "config": { "popSize": 24, "maxGenerations": 50, "kSeeds": 30, "eliteFrac": 0.25,
               "mutationRate": 0.3, "mutationStrength": 0.15 },
  "generations": [
    { "gen": 1, "bestFitness": 0.51, "meanFitness": 0.49, "bestGenome": { ... } },
    ...
  ],
  "finalBest": { ... genome object ... },
  "holdout": { "winRate2P": 0.62, "winRate4P": 0.54, "seeds": 200 }
}
```

### Final summary console output

```
═══════════════════════════════════════════
  Evolution complete — 32 generations
  Best genome (holdout 2P: 63.1%, 4P: 55.4%):
    bustThreshold2:  0.09
    bustThreshold1:  0.24
    dollarBuffer:    1.3
    cowWeight:       5.2
    dollarWeight:    1.7
    banditPenalty:   3.6
    positionWeight:  0.7
    denialWeight:    0.12
    deckMemory:      0.71
    lethalBias:      1.28
    act1DollarBonus: 1.1
    act3CowBonus:    2.9
    revealBonus:     1.8
    affordMult:      1.5
═══════════════════════════════════════════
```

---

## CLI Interface

```
node sim/evolve.js [options]

Options:
  --pop       <n>    Population size per generation     (default: 24)
  --gens      <n>    Max generations                    (default: 50)
  --seeds     <n>    Games per matchup per player count (default: 30)
  --elite     <f>    Elite fraction kept unchanged      (default: 0.25)
  --mut-rate  <f>    Probability each param mutates     (default: 0.30)
  --mut-str   <f>    Mutation std dev as fraction of range (default: 0.15)
  --trials    <n>    Independent runs to compare        (default: 1)
  --holdout   <n>    Seeds for final holdout validation (default: 200)
  --out       <dir>  Output directory                   (default: sim/results/)
  --resume    <file> Resume from a previous JSON checkpoint
  --quiet            Suppress per-generation genome detail
```

---

## Implementation Notes and Gotchas

### Do not use `core.countBanditsInDeck`

`game-core.js` exports `countBanditsInDeck` which sums all bandit pips. This is the
old (incorrect) calculation. `evolve.js` defines `calcBustProb` inline (see above)
which computes lethal card count based on current bandit state. Always use that.

### `game-core.js` pyramid and card reveal

After each buy or burn, call `core.revealUncovered(pyramid)` (or equivalent — check the
exact export name). The pyramid uses `faceUp` and `removed` flags. Only `faceUp` cards
are available to buy/burn.

### Seeded shuffles

All shuffles inside a game must use the LCG seeded from the game seed so that two
genomes in the same matchup face identical card sequences. This is what makes
head-to-head comparison meaningful. A different seed per matchup provides variance
across the K_SEEDS games.

### Buy order tiebreak

When two players have equal `roundDollars`, the player with fewer total bandits in the
round goes first. Further tiebreak: lower player index. Replicate whatever
`determineBuyWinner` does in `shared/tiebreaker.js` if that export is available, or
implement the tiebreak inline.

### Herd tracking

`player.herd` accumulates `roundCows` at end of each round (via `core.scoreRound` or
equivalent). The `positionWeight` logic in `shouldDraw` reads `player.herd` to
determine standings — make sure it's updated before each draw phase.

### 4-player games and card pool

`STORE_CARDS` has `minPlayers` fields. For 2P games, include cards with `minPlayers <= 2`.
For 4P games, include all cards. Use the same pool-filtering logic as `game-core.js`.

### Special card handling during draw phase

The evolve.js AI decision layer does NOT need to replicate every special card effect
perfectly — `game-core.js` should handle the actual card effects when you call
`applyCardEffects`. The AI only needs `shouldDraw`, `chooseBuy`, and `calcBustProb`.
The exception is `trash_to_use` activation during draw: the AI should activate it if
the card reduces bandits when at `roundBandits >= 2`, or if it bridges a dollar gap to
an available card. Keep this activation logic the same as play.js to avoid divergence
between simulation and real play.

### Convergence detection

Track the fitness of the top 3 genomes for the last 5 generations. If the max spread
among their fitness values stays below 0.01 for 5 consecutive generations, consider
it converged. This prevents running indefinitely on a flat fitness landscape.

---

## File Checklist

After implementing, verify:

- [ ] `node sim/evolve.js --gens 2 --pop 8 --seeds 5` completes without errors
- [ ] Output JSON is valid and contains `generations` array with correct structure
- [ ] Holdout validation runs and reports separate win rates for 2P and 4P
- [ ] `--resume` flag loads a checkpoint and continues from the correct generation
- [ ] `--trials 2` runs two independent evolutionary sequences and compares final bests
- [ ] Named personality seed genomes appear in generation 0 leaderboard
- [ ] A Wild Bill-seeded genome (high bust thresholds) actually draws aggressively in test games
