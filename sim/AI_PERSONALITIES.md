# AI Personalities Reference

Parameter glossary for the 6 personalities. For the **tuning/simulation workflow** (how to
validate, search, and apply changes) see [`TUNING.md`](TUNING.md).

---

## Overview

All AI personalities share the same decision engine (`aiShouldDraw`, `scoreCardForAI`,
`aiBuyTurn` in `play.js`) but differ entirely through their parameter objects in
`AI_PERSONALITIES`. There is no bespoke code per personality — changing a personality is purely
a data change.

The genomes live in **two** places that must stay in sync: `src/play.js` `AI_PERSONALITIES`
(what ships) and `sim/personalities.js` (what the sim runs — also seeds `evolve.js` and drives
`simulate.js`). **`node sim/test-personality-sync.js` fails if they drift** — run it after any
edit. (The sim genome uses `denialWeight` numeric where play.js uses `denialBurn` boolean; the
sync test bridges them.)

---

## Measured difficulty tiers (June 2026)

Tiers are assigned by **measured win-rate** (`node sim/simulate.js`), not archetype. The
`gamesetup.html` picker uses exactly these bands. Re-run the sim and re-tier if params change.

| Tier | Personalities | 2P / 4P win% vs field |
|---|---|---|
| **Hard** | drifter, enforcer, deputy, prospector, rancher | 64–70% / 34–41% |
| **Medium** | outlaw, wild_bill (+ banker on the boundary) | 40–43% / 14–16% |
| **Easy** | banker, sheriff, greenhorn | 6–38% / 0–10% |

> **June 2026 Hard-tier upgrade:** prospector/drifter/enforcer raised `maxDraw` 7→10 (rancher/deputy
> already there), lifting the whole Hard cluster ~3–4pp (2P) / ~6–7pp (4P). Competitive coevolution
> (`evolve.js --coevolve`) confirmed the genomes are otherwise optimal — it converged to `enforcer`.

The dividing line is **bust discipline**, not aggression: the Medium "Hard-sounding" aggressors
(outlaw, wild_bill) bust ~44% of rounds and net to mid-tier; the Hard bots win by *not* busting.
(The per-personality "Difficulty" notes below describe each bot's *archetype* and may read a tier
off from this table — this table is authoritative.)

---

## Parameter Reference

### Draw-phase parameters

| Parameter | Type | Effect |
|---|---|---|
| `bustThreshold2` | float 0–0.60 | Max perceived bust-probability willing to accept when holding **2 bandits**. Higher = more aggressive. |
| `bustThreshold1` | float 0–0.90 | Same with **1 bandit** in hand. |
| `dollarBuffer` | float 0–5 (or 999) | Keeps drawing until `roundDollars >= bestCardCost + buffer`. `999` = no target (draw until bust or dry). |
| `positionWeight` | float 0–2.5 | Scales bust thresholds up when trailing, down when leading. `0` = ignores standings entirely. |
| `affordMult` | float 1.0–2.5 | Multiplier applied to bust thresholds when the AI **cannot afford any available card**. Higher = draws harder when broke. |
| `deckMemory` | float 0–1 | `1` = uses exact lethal-card count from deck. `0` = uses a flat 20% prior. Blended between the two. |
| `lethalBias` | float 0.2–2.5 | Multiplier on the perceived bust probability after `deckMemory` blending. `>1` = more fearful; `<1` = discounts danger. |
| `maxDraw` | int (default 7) | Hard hand-size cap — stop drawing at this many cards regardless of bust odds. For disciplined bots it just clips profitable dollar accumulation (rancher/deputy = **10**); for aggressive bots (wild_bill/outlaw) it's a load-bearing bust governor (= **7**). Absent in play.js ⇒ 7. Not evolved. See [`draw-cap-experiment.js`](draw-cap-experiment.js). |

**Bust probability formula:**
```
bustProb = (exactProb * deckMemory + 0.20 * (1 - deckMemory)) * lethalBias
```
Where `exactProb = lethalCards / deckSize`.  
With 2 bandits: lethal = cards with `bandits >= 1`.  
With 1 bandit: lethal = cards with `bandits >= 2`.

### Buy-phase parameters

| Parameter | Type | Effect |
|---|---|---|
| `cowWeight` | float 0–10 | Score multiplier for cow value on buyable cards. Evolution found 9–10 is optimal. |
| `dollarWeight` | float 0–6 | Score multiplier for dollar value. |
| `banditPenalty` | float 0–8 | Score penalty per bandit on a card. |
| `act1DollarBonus` | float 0–3 | **Additional** score per dollar on cards bought in Act 1. Stacks with `dollarWeight`. |
| `act3CowBonus` | float 0–4 | **Additional** score per cow on cards bought in Act 3. Stacks with `cowWeight`. |
| `revealBonus` | float 0–4 | Score bonus added when buying a card would uncover a hidden pyramid slot above it. |
| `denialBurn` | bool | When `true` and AI can't afford to buy: burns the card most valuable to the current leader instead of its own worst card. |

**Card scoring formula:**
```
score  = cows * cowWeight
       + dollars * dollarWeight
       - bandits * banditPenalty
       + [Act 1: dollars * act1DollarBonus]
       + [Act 3: cows   * act3CowBonus   ]
       + specialBonus  (fixed per card type, see below)
       + pyramidRevealBonus (if buying this card uncovers a hidden slot)
```

**Fixed special bonuses** (not per-personality — structural value estimates):

| Special | Bonus |
|---|---|
| `burn_to_use` | +2 |
| `draw4` | +2 |
| `replay_discard` | +2 |
| `look3_rearrange` | +1.5 |
| `burn_buy_first` | +1 |
| `copy_next` | +1.5 to +6 (scales with deck quality) |
| `dollar1_other` | -0.5 |
| Any card with `cows < 0` | -2 |

---

## Personality Profiles

### Sheriff — *Easy*

> Methodical, deck-aware, extremely cautious. Builds economy early, plans the pyramid.
> The tutorial-adjacent AI — a new player can observe and understand his logic.

```
bustThreshold2:  0.05   // almost never draws with 2 bandits
bustThreshold1:  0.15   // very cautious at 1 bandit
dollarBuffer:    0      // stops the moment he can afford the best card
cowWeight:       5
dollarWeight:    2
banditPenalty:   4      // despises buying risky cards
positionWeight:  0      // ignores standings — plays his own game
denialBurn:      false
deckMemory:      0.9    // near-perfect deck tracking
lethalBias:      1.5    // amplifies danger signals
affordMult:      1.2    // barely draws harder when he can't afford anything
act1DollarBonus: 1.5    // economy-focused early; buys dollar engines in Act 1
act3CowBonus:    2.5    // moderate ramp to cows late
revealBonus:     2.5    // actively plans pyramid — high value on uncovering hidden cards
```

**Difficulty:** Easy. Conservative bust avoidance and moderate cowWeight mean he rarely
wins against optimized opponents. Good opening AI for new players.

---

### Banker — *Easy–Medium*

> Dollar-first strategy. Intentionally suboptimal — represents a real strategic path
> a new player might try and find wanting. Economy focused in Acts 1–2; doesn't pivot
> hard enough to cows in Act 3.

```
bustThreshold2:  0.15
bustThreshold1:  0.30
dollarBuffer:    1
cowWeight:       1.5    // intentionally low
dollarWeight:    3      // values income above cows
banditPenalty:   2
positionWeight:  0.3
denialBurn:      false
deckMemory:      0.8
lethalBias:      1.2
affordMult:      1.2    // conservative; stops when he can't afford
act1DollarBonus: 2.5    // LOVES economy in Act 1 — his defining strategy
act3CowBonus:    0.5    // even in Act 3 still chases dollars over cows
revealBonus:     1.0
```

**Difficulty:** Easy–Medium. His dollar focus generates good draw currency but low cow
totals. Beats Sheriff occasionally; loses to everyone else consistently.

> **Design note:** Keep Banker's `cowWeight` low and `act3CowBonus` low. He is
> intentionally designed to represent a suboptimal but thematically coherent strategy.
> Do not "fix" him.

---

### Deputy — *Hard (measured strongest)*

> Tactical denial burner. Controls the pyramid shape through denial burns and reveal
> planning. Conservative draw but not passive — his buy decisions are informed and
> his denial targeting is precise.

```
bustThreshold2:  0.10
bustThreshold1:  0.28
dollarBuffer:    1
cowWeight:       6
dollarWeight:    1.5
banditPenalty:   2.5
positionWeight:  0.3
denialBurn:      true   // burns the card most valuable to the current leader
deckMemory:      0.7
lethalBias:      1.3
affordMult:      1.4
act1DollarBonus: 0.5
act3CowBonus:    2.5
revealBonus:     2.0    // uses denial + reveals to actively shape the pyramid
```

**Difficulty:** Medium. His denial burns apply real pressure in multiplayer. In 2P he is
a genuine threat when the pyramid cooperates. Loses to Rancher/Outlaw in straight
head-to-head due to lower cowWeight and conservative draw.

---

### Sheriff → Deputy → Rancher is the intended difficulty ramp for single-player AI selection (future feature).

---

### Rancher — *Hard*

> Cow-optimizing grinder. Closest to the evolutionary optimum. Methodical but bolder
> than Sheriff — draws until he can reach the best cow card, with a buffer to spare.
> No denial, no position games — just efficient cow accumulation.

```
bustThreshold2:  0.22   // meaningfully bolder than pre-overhaul (was 0.15)
bustThreshold1:  0.42   // draws confidently at 1 bandit (was 0.30)
dollarBuffer:    3      // draws extra to reach better cards (was 2)
cowWeight:       9      // near evolutionary optimum (was 6)
dollarWeight:    0.5
banditPenalty:   1.5    // willing to buy risky high-cow cards
positionWeight:  0.4    // adapts slightly to standings
denialBurn:      false
deckMemory:      0.6
lethalBias:      1.0    // accurate, unbiased risk assessment
affordMult:      1.6    // draws harder when pyramid is out of reach
act1DollarBonus: 0      // doesn't bonus-weight dollars — just spends them
act3CowBonus:    3.5    // serious late-game cow push
revealBonus:     1.0    // some pyramid planning
```

**Difficulty:** Medium–Hard. The benchmark opponent. Consistently accumulates cows
and rarely makes a bad buy decision. Loses most often to Wild Bill (variance) and
Outlaw (position pressure + denial).

---

### Wild Bill — *Medium (high variance)*

> Pure aggressor. No dollar target — draws until bust or dry. When he survives, he
> now buys the best cow cards in the pyramid. High bust rate means he loses roughly
> 1 in 3 rounds to busts, but his up-rounds are decisive.

```
bustThreshold2:  0.35   // keeps drawing with 2 bandits often
bustThreshold1:  0.50   // barely slows at 1 bandit
dollarBuffer:    999    // no target — draws until out of cards or busted
cowWeight:       9      // when he buys, he goes for the best (was 5)
dollarWeight:    0.5
banditPenalty:   0.5    // will buy 5-cow/2-bandit cards without hesitation
positionWeight:  0
denialBurn:      false
deckMemory:      0.1    // barely tracks the deck — plays on chaos
lethalBias:      0.5    // actively discounts danger signals
affordMult:      2.0    // draws extremely hard when he can't afford anything
act1DollarBonus: 0      // doesn't care about economy at all
act3CowBonus:    4.0    // goes all-in on cows in Act 3
revealBonus:     0      // chaotic — no pyramid planning
```

**Difficulty:** Hard, but swingy. Wins big when his draws go through; busts out of
contention frequently. The hardest opponent over a single game; not the most
consistent over multiple rounds.

---

### Outlaw — *Medium (swingy; busts too often to reach top-tier)*

> Ruthless position-aware aggressor with denial. Draws as boldly as Wild Bill when
> trailing, locks in when ahead. Burns the leader's best card when he can't buy.
> The most complete and consistently dangerous AI after the overhaul.

```
bustThreshold2:  0.35   // matches Wild Bill at 2 bandits (was 0.20)
bustThreshold1:  0.55   // draws very hard at 1 bandit (was 0.35)
dollarBuffer:    2
cowWeight:       8      // was 4 — the critical fix
dollarWeight:    1
banditPenalty:   1.0    // buys risky high-cow cards readily
positionWeight:  1.5    // highly position-aware
denialBurn:      true   // was false — burns leader's best when he can't buy
deckMemory:      0.4    // plays on feel more than math
lethalBias:      0.6    // discounts danger — reckless when position demands it
affordMult:      2.0    // draws extremely hard when pyramid is unaffordable
act1DollarBonus: 0
act3CowBonus:    3.5    // closes out strong
revealBonus:     0.5
```

**Difficulty:** Hard. The post-overhaul top-end AI. Combines:
- Wild Bill-level aggression when trailing
- Rancher-level cow buying
- Deputy-style denial when he can't afford the best card
- Position awareness that adapts his draw aggressiveness round-by-round

Most dangerous in multiplayer (2+ opponents) where his denial burns genuinely hurt.

---

## Difficulty Tiers (Future AI Selection)

Intended difficulty order for a "choose your opponent" feature:

| Tier | Personality | Notes |
|---|---|---|
| 1 — Easy | Banker | Dollar-first, predictable, loses consistently |
| 2 — Easy | Sheriff | Conservative, rarely busts, buys decently |
| 3 — Medium | Deputy | Denial pressure; stronger in multiplayer |
| 4 — Medium–Hard | Rancher | Efficient grinder; the benchmark |
| 5 — Hard | Wild Bill | Swingy; dangerous but inconsistent |
| 6 — Hard | Outlaw | Most complete; the intended hardest opponent |

For a "Hard Mode" or "Expert" single-player setting, Outlaw is the target opponent.
For a "Normal" game, Rancher is the benchmark.

---

## Evolutionary Optimization Notes

Personalities were calibrated using `sim/evolve.js` (see [`TUNING.md`](TUNING.md)),
which runs a genetic algorithm over the 14-parameter genome space. Key findings
from 3 independent trials (100 generations, 100 seeds each):

**Strongly converged signals (genuine optima):**
- `cowWeight` → 9–10. Cow cards win. Dollar engines are currency, not scoring.
- `revealBonus` → ~0 for top performers. Burning to uncover hidden cards is not worth it.
- `act1DollarBonus` → 0 for top performers. No bonus weighting needed; dollars are just spent.
- `positionWeight` → ~0. Adjusting draw aggression based on standings doesn't help evolved AIs.

**Equivocal signals (multiple valid strategies):**
- `denialWeight` — two of three trials converged to denial-burn (~0.75), one to self-worst-burn (~0). Both reach similar fitness.
- `banditPenalty` — 0.71 to 6.69 across trials. Multiple viable buy philosophies.
- `bustThreshold1` — 0.45 to 0.89. Risk tolerance with 1 bandit is genuinely multi-modal.

**Intentional deviations from the evolved optimum:**
- Banker's `cowWeight` (1.5) and Banker's `act3CowBonus` (0.5) are intentionally below
  optimal — he is a designed-to-lose archetype.
- Sheriff's `bustThreshold2/1` are intentionally conservative — he is the entry-level AI.
- Wild Bill's `dollarBuffer: 999` is a character choice — the evolved optimum would be ~4.5,
  which produces similar behavior anyway.

---

## Adding a New Personality

1. Add a new key to `AI_PERSONALITIES` in `play.js` with all 14 parameters.
2. Mirror the entry in `simulate.js`.
3. Add the personality name to the draft/game setup UI wherever personalities are assigned.
4. Add a seed genome to `SEED_GENOMES` in `sim/evolve.js` if you want future evolution
   runs to include it as a generation-0 anchor.
5. Update this file with the new profile.
