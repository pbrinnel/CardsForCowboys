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
    specialBonuses: { burn_to_use: 3, copy_next: 2, draw4: 3, extra_buy: 3, discard_to_player: 1 },
    negativeCowPenalty: -4,
    act1DollarBonus: 0.5,
    act3CowBonus: 4,
  },
  balanced: {
    label: 'Balanced',
    cowWeight: 3,
    dollarWeight: 1.5,
    banditWeight: -2,
    specialBonuses: { burn_to_use: 2, copy_next: 3, draw4: 2, extra_buy: 3, discard_to_player: 1 },
    negativeCowPenalty: -2,
    act1DollarBonus: 1,
    act3CowBonus: 2,
  },
  dollarFocused: {
    label: 'DollarFocused',
    cowWeight: 2,
    dollarWeight: 3,
    banditWeight: -2,
    specialBonuses: { burn_to_use: 2, copy_next: 4, draw4: 2, extra_buy: 4, discard_to_player: 2 },
    negativeCowPenalty: -1,
    act1DollarBonus: 2,
    act3CowBonus: 2,
  },
  banditFriendly: {
    label: 'BanditFriendly',
    cowWeight: 3,
    dollarWeight: 1.5,
    banditWeight: -0.5,
    specialBonuses: { burn_to_use: 1, copy_next: 2, draw4: 3, extra_buy: 3, discard_to_player: 0 },
    negativeCowPenalty: -1,
    act1DollarBonus: 1,
    act3CowBonus: 2,
  },
  banditAverse: {
    label: 'BanditAverse',
    cowWeight: 4,
    dollarWeight: 1,
    banditWeight: -4,
    specialBonuses: { burn_to_use: 4, copy_next: 2, draw4: 1, extra_buy: 2, discard_to_player: 1 },
    negativeCowPenalty: -3,
    act1DollarBonus: 0.5,
    act3CowBonus: 3,
  },
  specialHunter: {
    label: 'SpecialHunter',
    cowWeight: 2,
    dollarWeight: 1,
    banditWeight: -2,
    specialBonuses: { burn_to_use: 5, copy_next: 5, draw4: 5, extra_buy: 4, look3_rearrange: 3, replay_discard: 4, look3_immediate: 3, discard_to_player: 2 },
    negativeCowPenalty: -2,
    act1DollarBonus: 0.5,
    act3CowBonus: 1,
  },
  cheapskate: {
    label: 'Cheapskate',
    cowWeight: 3,
    dollarWeight: 1.5,
    banditWeight: -2,
    specialBonuses: { burn_to_use: 2, copy_next: 3, draw4: 2, extra_buy: 2, discard_to_player: 1 },
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
  burnFor2: 'smart',
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
    // Override burnFor2 for dollar focused
    burnFor2: buyKey === 'dollarFocused' ? 'always' : 'smart',
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

  // Always activate extra_buy if held (free extra action; no condition needed)
  if (!player.hasExtraBuy) {
    const extraCard = player.hand.find(c => c.special === 'extra_buy');
    if (extraCard) {
      player.hand.splice(player.hand.indexOf(extraCard), 1);
      player.hasExtraBuy = true;
    }
  }

  // Activate dollar-producing hand cards if they unlock a currently unaffordable buy
  for (const tCard of player.hand.filter(c =>
    (c.special === 'burn_to_use' && c.dollars > 0) || c.special === 'burn_for_2'
  )) {
    const bonus = tCard.special === 'burn_for_2' ? 1 : tCard.dollars;
    const unlocks = available.some(a =>
      a.slot.card.cost > player.roundDollars && a.slot.card.cost <= player.roundDollars + bonus
    );
    if (unlocks) {
      player.hand.splice(player.hand.indexOf(tCard), 1);
      player.roundDollars += bonus;
    }
  }

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
        // Parity with the live game: BEFORE each mandatory draw, proactively activate a held
        // jail (-1 bandit) card while at/over jailThreshold bandits, so the AI gets the same
        // between-draw window to negate before busting (mirrors the main-loop jail logic).
        if (player.roundBandits >= strategy.jailThreshold) {
          const jail = player.hand.find(c =>
            (c.special === 'burn_to_use' && c.bandits < 0) ||
            (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor?.special === 'burn_to_use' && player.copyNextDonor.bandits < 0)
          );
          if (jail) {
            player.hand.splice(player.hand.indexOf(jail), 1);
            const jailEffect = (jail.special === 'copy_next') ? player.copyNextDonor : jail;
            if (jail.special === 'copy_next') { player.copyNextDonor = null; player.copyNextCard = null; }
            player.roundDollars += jailEffect.dollars;
            player.roundBandits = Math.max(0, player.roundBandits + jailEffect.bandits);
            player.roundCows += jailEffect.cows;
          }
        }
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

    // Handle burn_to_use: jail cards only (-1 bandit) — dollar cards are saved for the
    // before-stopping window or buy phase (activating mid-draw then continuing is wasteful).
    // Also activates Copy Next if it's linked to a jail donor.
    for (const tCard of player.hand.filter(c =>
      (c.special === 'burn_to_use' && c.bandits < 0) ||
      (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor?.special === 'burn_to_use' && player.copyNextDonor.bandits < 0)
    )) {
      if (player.roundBandits < strategy.jailThreshold) continue;
      const idx = player.hand.indexOf(tCard);
      if (idx >= 0) {
        player.hand.splice(idx, 1);
        const effectCard = (tCard.special === 'copy_next') ? player.copyNextDonor : tCard;
        if (tCard.special === 'copy_next') { player.copyNextDonor = null; player.copyNextCard = null; }
        player.roundBandits = Math.max(0, player.roundBandits + effectCard.bandits);
      }
    }

    // Handle burn_for_2
    if (card.special === 'burn_for_2') {
      let shouldTrash = false;
      if (strategy.burnFor2 === 'always') {
        shouldTrash = true;
      } else if (strategy.burnFor2 === 'smart') {
        const bestCost = getBestScoredCost(player, strategy, pyramid, currentAct || 1);
        shouldTrash = (player.roundDollars + 1 >= bestCost && player.roundDollars < bestCost);
      }
      if (shouldTrash) {
        player.roundDollars += 1;
        const idx = player.hand.indexOf(card);
        if (idx >= 0) player.hand.splice(idx, 1);
      }
    }

    // Handle look3_rearrange (burn to rearrange top 3)
    if (card.special === 'look3_rearrange' && strategy.look3 === 'always' && player.deck.length >= 2) {
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      // Parity with game: reshuffle discard in if the draw pile can't fill a top-3.
      if (player.deck.length < 3 && player.discard.length > 0) {
        player.deck.push(...core.shuffle(player.discard));
        player.discard = [];
      }
      const top3 = player.deck.splice(0, Math.min(3, player.deck.length));
      top3.sort((a, b) => a.bandits - b.bandits);
      player.deck.unshift(...top3);
    }

    // Handle look3_immediate (peek and rearrange without burning)
    if (card.special === 'look3_immediate' && player.deck.length >= 2) {
      // Parity with game: reshuffle discard in if the draw pile can't fill a top-3.
      if (player.deck.length < 3 && player.discard.length > 0) {
        player.deck.push(...core.shuffle(player.discard));
        player.discard = [];
      }
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

    // Handle burn_buy_first
    if (card.special === 'burn_buy_first') {
      player.hasBuyBurnFirst = true;
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
      player.roundCows -= card.cows;
    }

    // Handle extra_buy: always activate (0 stats, no value unactivated)
    if (card.special === 'extra_buy') {
      player.hasExtraBuy = true;
      const idx = player.hand.indexOf(card);
      if (idx >= 0) player.hand.splice(idx, 1);
    }

    // Check bust
    if (player.roundBandits >= 3) {
      handleBust(player);
      break;
    }

    // Decision to continue drawing
    if (!shouldDraw(player, strategy, pyramid, currentAct)) {
      // Before stopping: activate $N burn_to_use cards (including Copy Next copies) if it
      // helps afford a better card.
      for (const tCard of player.hand.filter(c =>
        (c.special === 'burn_to_use' && c.dollars > 0) ||
        (c.special === 'copy_next' && c === player.copyNextCard && player.copyNextDonor?.special === 'burn_to_use' && player.copyNextDonor.dollars > 0)
      )) {
        const effectCard = (tCard.special === 'copy_next') ? player.copyNextDonor : tCard;
        const avail = core.getAvailablePyramidCards(pyramid);
        const unlocksBetter = avail.some(a =>
          a.slot.card.cost > player.roundDollars && a.slot.card.cost <= player.roundDollars + effectCard.dollars
        );
        if (unlocksBetter) {
          const idx = player.hand.indexOf(tCard);
          if (idx >= 0) {
            player.hand.splice(idx, 1);
            if (tCard.special === 'copy_next') { player.copyNextDonor = null; player.copyNextCard = null; }
            player.roundDollars += effectCard.dollars;
            player.roundCows += effectCard.cows;
          }
        }
      }
      player.stoppedDrawing = true;
    }
  }

  return { busted: player.busted };
}

function handleBust(player) {
  player.busted = true;
  // Keep discard_to_player cards in hand so they can still be resolved after the round.
  // Mirrors play.js bust handling (non-pass cards go to discard, pass cards stay in hand).
  player.discard.push(...player.hand.filter(c => c.special !== 'discard_to_player'));
  player.hand = player.hand.filter(c => c.special === 'discard_to_player');
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
