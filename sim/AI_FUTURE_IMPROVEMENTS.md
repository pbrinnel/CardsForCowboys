# AI Future Improvements

Issues with current AI logic that are known-suboptimal but deferred.
Entries should include: what's wrong, what optimal looks like, where to fix, and any tradeoffs.

---

## 1. Buy-Phase Dollar Card Activation Is Too Narrow

**Filed:** June 2026  
**Affected files:** `src/play.js` (`aiBuyTurn`), `sim/ai-player.js` (`chooseBuy`), `sim/evolve.js` (`chooseBuy`)

### What's wrong

The AI only activates a `burn_to_use` / `burn_for_2` card in the buy phase if it **unlocks** a card the AI currently can't afford at all:

```js
const unlocks = avail.some(a =>
  a.slot.card.cost > ai.roundDollars && a.slot.card.cost <= ai.roundDollars + bonus
);
```

This misses the case where burning would let the AI afford a **higher-scored card** than the best it can already buy. Example:

- AI has $3, holds a +$2 burn card
- Pyramid has a $3 card (score 4) and a $5 card (score 9)
- Current logic: doesn't activate (can already afford the $3 card, $5 is still out of reach → `unlocks = false`)
- **Wrong**: AI should activate, spend $5, get the better card

### What optimal looks like

Activate a dollar card if `scoreOfBestAffordableWithBonus > scoreOfBestAffordableWithout`. In pseudocode:

```js
const bestWithout = bestScoredAffordable(avail, ai.roundDollars);
const bestWith    = bestScoredAffordable(avail, ai.roundDollars + bonus);
if (bestWith.score > bestWithout.score) { activate; }
```

Needs a helper that returns the highest-scored affordable card (using `scoreCardForAI`) rather than just any affordable card.

### Tradeoffs / notes

- Extra_buy unconditional activation is **correct as-is** (extra action is always free value).
- Dollar card activation condition is purely a buy-turn decision — no draw-phase changes needed.
- Low priority until the trajectory corpus is large enough to measure AI quality vs. human play.
- Fix in all three files simultaneously (same function logic in each).

---
