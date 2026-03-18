// ============================================================
// AI Player - Configurable strategy profiles
// ============================================================

const core = require('./game-core');

// --- STRATEGY BUILDING BLOCKS ---

// Risk profiles: how aggressively to draw cards
const RISK_PROFILES = {
  reckless: {
    label: 'Reckless',
    bustThreshold2Bandits: 0.35,
    bustThreshold1Bandit: 0.55,
    maxHandSize: 9,
    minDraws: 3,
    overShootBuffer: 5,
  },
  bold: {
    label: 'Bold',
    bustThreshold2Bandits: 0.25,
    bustThreshold1Bandit: 0.45,
    maxHandSize: 8,
    minDraws: 3,
    overShootBuffer: 4,
  },
  moderate: {
    label: 'Moderate',
    bustThreshold2Bandits: 0.15,
    bustThreshold1Bandit: 0.30,
    maxHandSize: 7,
    minDraws: 2,
    overShootBuffer: 2,
  },
  cautious: {
    label: 'Cautious',
    bustThreshold2Bandits: 0.08,
    bustThreshold1Bandit: 0.18,
    maxHandSize: 6,
    minDraws: 2,
    overShootBuffer: 1,
  },
  timid: {
    label: 'Timid',
    bustThreshold2Bandits: 0.03,
    bustThreshold1Bandit: 0.10,
    maxHandSize: 5,
    minDraws: 1,
    overShootBuffer: 0,
  },
};

// Buy preferences: what to prioritize when purchasing cards
const BUY_PREFERENCES = {
  cowFocused: {
    label: 'CowFocused',
    cowWeight: 5,
    dollarWeight: 0.5,
    banditWeight: -2,
    specialBonuses: { trash_to_use: 3, copy_next: 2, draw4: 3, discard_to_player: 1 },
    negativeCowPenalty: -4,
    act1DollarBonus: 0.5,
    act3CowBonus: 4,
  },
  balanced: {
    label: 'Balanced',
    cowWeight: 3,
    dollarWeight: 1.5,
    banditWeight: -2,
    specialBonuses: { trash_to_use: 2, copy_next: 3, draw4: 2, discard_to_player: 1 },
    negativeCowPenalty: -2,
    act1DollarBonus: 1,
    act3CowBonus: 2,
  },
  dollarFocused: {
    label: 'DollarFocused',
    cowWeight: 2,
    dollarWeight: 3,
    banditWeight: -2,
    specialBonuses: { trash_to_use: 2, copy_next: 4, draw4: 2, discard_to_player: 2 },
    negativeCowPenalty: -1,
    act1DollarBonus: 2,
    act3CowBonus: 2,
  },
  banditFriendly: {
    label: 'BanditFriendly',
    cowWeight: 3,
    dollarWeight: 1.5,
    banditWeight: -0.5,
    specialBonuses: { trash_to_use: 1, copy_next: 2, draw4: 3, discard_to_player: 0 },
    negativeCowPenalty: -1,
    act1DollarBonus: 1,
    act3CowBonus: 2,
  },
  banditAverse: {
    label: 'BanditAverse',
    cowWeight: 4,
    dollarWeight: 1,
    banditWeight: -4,
    specialBonuses: { trash_to_use: 4, copy_next: 2, draw4: 1, discard_to_player: 1 },
    negativeCowPenalty: -3,
    act1DollarBonus: 0.5,
    act3CowBonus: 3,
  },
  specialHunter: {
    label: 'SpecialHunter',
    cowWeight: 2,
    dollarWeight: 1,
    banditWeight: -2,
    specialBonuses: { trash_to_use: 5, copy_next: 5, draw4: 5, look3_rearrange: 3, replay_discard: 4, put_on_top: 3, look3_immediate: 3, discard_to_player: 2 },
    negativeCowPenalty: -2,
    act1DollarBonus: 0.5,
    act3CowBonus: 1,
  },
  cheapskate: {
    label: 'Cheapskate',
    cowWeight: 3,
    dollarWeight: 1.5,
    banditWeight: -2,
    specialBonuses: { trash_to_use: 2, copy_next: 3, draw4: 2, discard_to_player: 1 },
    negativeCowPenalty: -2,
    act1DollarBonus: 1,
    act3CowBonus: 2,
    preferCheap: true, // scored with cost penalty
  },
};

// Shared defaults for special card usage
const SPECIAL_DEFAULTS = {
  burnStrategy: 'worst',
  jailThreshold: 2,
  trashFor2: 'smart',
  look3: 'always',
  replayDiscard: 'best',
  putOnTop: 'worst',
};

// --- GENERATE ALL STRATEGY COMBOS ---

function buildStrategy(riskKey, buyKey) {
  const risk = RISK_PROFILES[riskKey];
  const buy = BUY_PREFERENCES[buyKey];
  return {
    name: `${risk.label}-${buy.label}`,
    riskProfile: riskKey,
    buyPreference: buyKey,
    ...risk,
    ...buy,
    ...SPECIAL_DEFAULTS,
    // Override jail threshold for cautious/timid
    jailThreshold: (riskKey === 'cautious' || riskKey === 'timid') ? 1 : 2,
    // Override trashFor2 for dollar focused
    trashFor2: buyKey === 'dollarFocused' ? 'always' : 'smart',
  };
}

const STRATEGIES = {};
for (const riskKey of Object.keys(RISK_PROFILES)) {
  for (const buyKey of Object.keys(BUY_PREFERENCES)) {
    const strat = buildStrategy(riskKey, buyKey);
    const key = `${riskKey}_${buyKey}`;
    STRATEGIES[key] = strat;
  }
}

// --- AI DECISION ENGINE ---

function scoreCard(card, strategy, currentAct) {
  let score = 0;
  score += card.cows * strategy.cowWeight;
  score += card.dollars * strategy.dollarWeight;
  score += card.bandits * strategy.banditWeight;
  if (card.special && strategy.specialBonuses[card.special]) {
    score += strategy.specialBonuses[card.special];
  }
  if (card.cows < 0) score += strategy.negativeCowPenalty;
  // Act 1: favour economy (dollar) cards to build buying power
  if (currentAct === 1) score += card.dollars * (strategy.act1DollarBonus || 1);
  // Act 3: heavily favour cow cards for end-game scoring
  if (currentAct === 3) score += card.cows * strategy.act3CowBonus;
  // Cheapskate penalizes expensive cards
  if (strategy.preferCheap && card.cost) {
    score -= card.cost * 0.5;
  }
  return score;
}

// Score-based: return cost of best-valued affordable card (not just most expensive)
function getBestScoredCost(player, strategy, pyramid, currentAct) {
  const available = core.getAvailablePyramidCards(pyramid);
  if (available.length === 0) return 99;
  let bestScore = -Infinity;
  let bestCost = 0;
  for (const a of available) {
    const score = scoreCard(a.slot.card, strategy, currentAct);
    if (score > bestScore) {
      bestScore = score;
      bestCost = a.slot.card.cost;
    }
  }
  return bestCost;
}

function shouldDraw(player, strategy, pyramid, currentAct) {
  if (player.hand.length >= strategy.maxHandSize) return false;
  if (player.hand.length < strategy.minDraws) return true;

  const banditsRemaining = core.countBanditsInDeck(player);
  const cardsRemaining = player.deck.length;

  // Score-based target: aim for best-valued card, not just most expensive
  const bestCost = getBestScoredCost(player, strategy, pyramid, currentAct || 1);

  if (player.roundBandits >= 2) {
    if (cardsRemaining === 0) return false;
    const bustProb = banditsRemaining / cardsRemaining;
    return bustProb < strategy.bustThreshold2Bandits;
  }

  if (player.roundBandits === 1) {
    if (cardsRemaining <= 1) return false;
    const bustProb = banditsRemaining / cardsRemaining;
    return bustProb < strategy.bustThreshold1Bandit && player.roundDollars < bestCost;
  }

  if (player.roundDollars >= bestCost + strategy.overShootBuffer) return false;

  return true;
}

function chooseBuy(player, strategy, pyramid, currentAct) {
  const available = core.getAvailablePyramidCards(pyramid);
  const affordable = available.filter(a => a.slot.card.cost <= player.roundDollars);

  if (affordable.length > 0) {
    let best = null;
    let bestScore = -Infinity;
    for (const a of affordable) {
      const score = scoreCard(a.slot.card, strategy, currentAct);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return { action: 'buy', row: best.row, col: best.col };
  }

  // Burn worst card from pyramid
  if (available.length > 0) {
    let worst = available[0];
    let worstScore = Infinity;
    for (const a of available) {
      const score = scoreCard(a.slot.card, strategy, currentAct);
      if (score < worstScore) {
        worstScore = score;
        worst = a;
      }
    }
    return { action: 'burn', row: worst.row, col: worst.col };
  }

  return { action: 'pass' };
}

// Determines buy order choice when this AI has priority
function chooseBuyOrder(playerIdx) {
  // AI always chooses to buy first
  return playerIdx;
}

// --- DRAW PHASE (complete draw loop for one player) ---

function executeDrawPhase(player, strategy, pyramid, currentAct) {
  core.resetPlayerRound(player);

  if (player.deck.length === 0 && player.discard.length === 0) {
    player.stoppedDrawing = true;
    return { busted: false };
  }

  while (!player.busted && !player.stoppedDrawing) {
    const card = core.drawFromDeck(player);
    if (!card) {
      player.stoppedDrawing = true;
      break;
    }

    const isFirst = player.hand.length === 0;
    player.hand.push(card);
    core.applyCardEffects(player, card, isFirst);
    // Note: bandits:-1 on card is already applied by applyCardEffects above

    // Handle draw4
    if (card.special === 'draw4' && !player.busted) {
      for (let i = 0; i < 4; i++) {
        if (player.busted) break;
        const extra = core.drawFromDeck(player);
        if (!extra) break;
        player.hand.push(extra);
        core.applyCardEffects(player, extra, false);
        if (player.roundBandits >= 3) {
          handleBust(player);
          break;
        }
      }
      if (player.busted) break;
    }

    // Handle trash_to_use: activate based on situation (card contributed nothing on draw)
    for (const tCard of player.hand.filter(c => c.special === 'trash_to_use')) {
      let activate = false;
      if (tCard.bandits < 0 && player.roundBandits >= strategy.jailThreshold) activate = true;
      if (tCard.dollars > 0 && player.roundBandits >= 2) {
        const bestCost = getBestScoredCost(player, strategy, pyramid, currentAct || 1);
        if (player.roundDollars < bestCost) activate = true;
      }
      if (!activate) continue;
      const idx = player.hand.indexOf(tCard);
      if (idx >= 0) {
        player.hand.splice(idx, 1);
        player.roundDollars += tCard.dollars;
        player.roundBandits = Math.max(0, player.roundBandits + tCard.bandits);
        player.roundCows += tCard.cows;
      }
    }

    // Handle trash_for_2
    if (card.special === 'trash_for_2') {
      let shouldTrash = false;
      if (strategy.trashFor2 === 'always') {
        shouldTrash = true;
      } else if (strategy.trashFor2 === 'smart') {
        const bestCost = getBestScoredCost(player, strategy, pyramid, currentAct || 1);
        shouldTrash = (player.roundDollars + 1 >= bestCost && player.roundDollars < bestCost);
      }
      if (shouldTrash) {
        player.roundDollars += 1;
        const idx = player.hand.indexOf(card);
        if (idx >= 0) player.hand.splice(idx, 1);
      }
    }

    // Handle look3_rearrange (trash to rearrange top 3)
    if (card.special === 'look3_rearrange' && strategy.look3 === 'always' && player.deck.length >= 2) {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
      top3.sort((a, b) => a.bandits - b.bandits);
      player.deck.unshift(...top3);
    }

    // Handle look3_immediate (peek and rearrange without trashing)
    if (card.special === 'look3_immediate' && player.deck.length >= 2) {
      const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
      top3.sort((a, b) => a.bandits - b.bandits);
      player.deck.unshift(...top3);
    }

    // Handle replay_discard
    if (card.special === 'replay_discard' && player.discard.length > 0 && strategy.replayDiscard === 'best') {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < player.discard.length; i++) {
        const s = scoreCard(player.discard[i], strategy, currentAct || 1);
        if (s > bestScore) { bestScore = s; bestIdx = i; }
      }
      const replayed = player.discard.splice(bestIdx, 1)[0];
      player.hand.push(replayed);
      core.applyCardEffects(player, replayed, false);
    }

    // Handle trash_buy_burn_first
    if (card.special === 'trash_buy_burn_first') {
      player.hasBuyBurnFirst = true;
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.roundCows -= card.cows;
    }

    // Check bust
    if (player.roundBandits >= 3) {
      handleBust(player);
      break;
    }

    // Decision to continue drawing
    if (!shouldDraw(player, strategy, pyramid, currentAct)) {
      // Before stopping: activate $N trash_to_use cards if it helps afford a better card
      for (const tCard of player.hand.filter(c => c.special === 'trash_to_use' && c.dollars > 0)) {
        const avail = core.getAvailablePyramidCards(pyramid);
        const unlocksBetter = avail.some(a =>
          a.slot.card.cost > player.roundDollars && a.slot.card.cost <= player.roundDollars + tCard.dollars
        );
        if (unlocksBetter) {
          const idx = player.hand.indexOf(tCard);
          if (idx >= 0) {
            player.hand.splice(idx, 1);
            player.roundDollars += tCard.dollars;
            player.roundCows += tCard.cows;
          }
        }
      }
      player.stoppedDrawing = true;
    }
  }

  // Handle put_on_top at stop
  if (player.stoppedDrawing && !player.busted) {
    const putOnTopCard = player.hand.find(c => c.special === 'put_on_top');
    if (putOnTopCard && player.hand.length > 1) {
      let worstIdx = -1;
      let worstScore = Infinity;
      for (let i = 0; i < player.hand.length; i++) {
        const c = player.hand[i];
        const s = c.dollars + c.cows * 2 - c.bandits * 3;
        if (s < worstScore) { worstScore = s; worstIdx = i; }
      }
      if (worstIdx >= 0) {
        const returned = player.hand[worstIdx];
        player.roundDollars -= returned.dollars;
        player.roundCows -= returned.cows;
        player.roundBandits -= returned.bandits;
        player.hand.splice(worstIdx, 1);
        player.deck.unshift(returned);
      }
    }
  }

  return { busted: player.busted };
}

function handleBust(player) {
  player.busted = true;
  player.discard.push(...player.hand);
  player.hand = [];
  player.roundDollars = 0;
  player.roundCows = 0;
}

// --- EXPORTS ---

module.exports = {
  RISK_PROFILES,
  BUY_PREFERENCES,
  STRATEGIES,
  scoreCard,
  shouldDraw,
  chooseBuy,
  chooseBuyOrder,
  executeDrawPhase,
  handleBust,
};
