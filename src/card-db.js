// src/card-db.js — THE card database. Shared by the game and the public Cards List page.
//
// Loaded as a classic script BEFORE src/play.js (playgame.html) and before src/cardslist.js
// (cardslist.html). Top-level `const` in a classic script lives in the shared global lexical
// scope, so both consumers just reference these names directly — there is no export step and
// no second copy to keep in sync.
//
// This lived inside play.js until August 2026. It was moved out so cardslist.html could render
// the real card set without pulling in the whole 6k-line engine (Firebase import, MP IIFE,
// DOM bootstrapping). `getCardById` / `getActPool` stayed in play.js — they depend on G and
// createCardInstance.
//
// The sim keeps its OWN copy in sim/game-core.js (it is headless and runs under Node).
// `node sim/test-card-sync.js` reads THIS file and fails if the two drift. Never hand-edit the
// sim's array — regenerate it from here.

const CARD_IMG_PATH = 'assets/cards/All-Cards/';
const BACK_IMG_PATH = 'assets/backs/';
const CACTI_BACK = { 1: 'River Back.jpg', 2: 'Cactus Back.jpg', 3: 'Rattlesnake Back.jpg' };

// --- CARD DATABASE ---

// --- STARTERS (IDs 91-94 River, 61-64 Rattlesnake, 33-34 Cactus) ---
// River=1 cacti, Cactus=2 cacti, Rattlesnake=3 cacti
const STARTER_TEMPLATES = [
  { id: 'starter_91', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_91.jpg' },
  { id: 'starter_92', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_92.jpg' },
  { id: 'starter_93', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_93.jpg' },
  { id: 'starter_94', dollars: 1, cows: 0, bandits: 0, cacti: 1, count: 1, img: 'Card_94.jpg' },
  { id: 'starter_61', dollars: 2, cows: 0, bandits: 0, cacti: 3, count: 1, img: 'Card_61.jpg' },
  { id: 'starter_62', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Card_62.jpg' },
  { id: 'starter_63', dollars: 0, cows: 1, bandits: 1, cacti: 3, count: 1, img: 'Card_63.jpg' },
  { id: 'starter_64', dollars: 0, cows: 2, bandits: 2, cacti: 3, count: 1, img: 'Card_64.jpg' },
  { id: 'starter_33', dollars: 1, cows: 1, bandits: 0, cacti: 2, count: 1, img: 'Card_33.jpg' },
  { id: 'starter_34', dollars: 0, cows: 0, bandits: 1, cacti: 2, count: 1, img: 'Card_34.jpg' },
];

// --- STORE CARDS ---
// Derived from data/Deck Buster Cards - Cards.csv. Colour→Cacti: River(Blue)=1,
// Cactus(Yellow)=2, Rattlesnake(Red)=3.
//
// 54 LIVE cards — exactly 18 per act. The old `minPlayers` tier (3+P / 4+P card sets) is GONE:
// every player count now draws from the same per-act pool (5-8P doubles it, see getActPool).
//
// `deprecated: true` = cut from the game in the July 2026 single-Store rework. These are KEPT in
// the DB on purpose so getCardById still resolves them for spectating/rejoining/reviewing a
// pre-gameV-3 game. getActPool filters them out, so they can never reach a live Store.
const STORE_CARDS = [
  // --- ACT 1 (18 live) ---
  // River (Blue) – 1 cacti
  { id: 'card_70',   img: 'Card_70.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_74',   img: 'Card_74.jpg',  act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null },
  { id: 'card_77',   img: 'Card_77.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_78',   img: 'Card_78.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 1, special: 'burn_to_use' },
  { id: 'card_79',   img: 'Card_79.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_80',   img: 'Card_80.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_35',   img: 'Card_35.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_36',   img: 'Card_36.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_37',   img: 'Card_37.jpg',  act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_40',   img: 'Card_40.jpg',  act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_46',   img: 'Card_46.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_47',   img: 'Card_47.jpg',  act: 1, dollars:  2, cows:  0, bandits:  0, cost:  3, cacti: 3, special: null },
  { id: 'card_48',   img: 'Card_48.jpg',  act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_49',   img: 'Card_49.jpg',  act: 1, dollars:  0, cows:  2, bandits:  0, cost:  5, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_1',    img: 'Card_1.jpg',   act: 1, dollars:  1, cows:  0, bandits:  0, cost:  2, cacti: 2, special: null },
  { id: 'card_10',   img: 'Card_10.jpg',  act: 1, dollars:  1, cows:  0, bandits:  0, cost:  2, cacti: 2, special: null },
  { id: 'card_11',   img: 'Card_11.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null },
  { id: 'card_12',   img: 'Card_12.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null },

  // --- ACT 2 (18 live) ---
  // River (Blue) – 1 cacti
  { id: 'card_66',   img: 'Card_66.jpg',  act: 2, dollars:  1, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_67',   img: 'Card_67.jpg',  act: 2, dollars:  0, cows:  2, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_81',   img: 'Card_81.jpg',  act: 2, dollars:  1, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_82',   img: 'Card_82.jpg',  act: 2, dollars:  1, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null },
  { id: 'card_83',   img: 'Card_83.jpg',  act: 2, dollars:  0, cows:  2, bandits:  0, cost:  6, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_5',    img: 'Card_5.jpg',   act: 2, dollars:  3, cows:  0, bandits:  0, cost:  3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_16',   img: 'Card_16.jpg',  act: 2, dollars:  3, cows:  0, bandits:  0, cost:  3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_22',   img: 'Card_22.jpg',  act: 2, dollars:  3, cows:  0, bandits:  0, cost:  3, cacti: 3, special: 'burn_to_use' },
  { id: 'card_38',   img: 'Card_38.jpg',  act: 2, dollars:  0, cows:  3, bandits:  0, cost:  5, cacti: 3, special: 'draw4' },
  { id: 'card_41',   img: 'Card_41.jpg',  act: 2, dollars:  2, cows:  1, bandits:  0, cost:  4, cacti: 3, special: null },
  { id: 'card_42',   img: 'Card_42.jpg',  act: 2, dollars:  2, cows:  1, bandits:  0, cost:  4, cacti: 3, special: null },
  { id: 'card_43',   img: 'Card_43.jpg',  act: 2, dollars:  0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_51',   img: 'Card_51.jpg',  act: 2, dollars:  0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_52',   img: 'Card_52.jpg',  act: 2, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_53',   img: 'Card_53.jpg',  act: 2, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 3, special: null },
  { id: 'card_54',   img: 'Card_54.jpg',  act: 2, dollars:  0, cows:  3, bandits:  0, cost:  5, cacti: 3, special: 'draw4' },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_6',    img: 'Card_6.jpg',   act: 2, dollars:  2, cows:  0, bandits:  0, cost:  4, cacti: 2, special: null },
  { id: 'card_18',   img: 'Card_18.jpg',  act: 2, dollars:  0, cows:  2, bandits:  0, cost:  4, cacti: 2, special: null },

  // --- ACT 3 (18 live) ---
  // River (Blue) – 1 cacti
  { id: 'card_72',   img: 'Card_72.jpg',  act: 3, dollars:  0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_73',   img: 'Card_73.jpg',  act: 3, dollars:  4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_86',   img: 'Card_86.jpg',  act: 3, dollars:  3, cows:  0, bandits:  0, cost:  6, cacti: 1, special: null },
  { id: 'card_88',   img: 'Card_88.jpg',  act: 3, dollars:  0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null },
  { id: 'card_89',   img: 'Card_89.jpg',  act: 3, dollars:  4, cows:  0, bandits:  0, cost:  8, cacti: 1, special: null },
  { id: 'card_90',   img: 'Card_90.jpg',  act: 3, dollars:  2, cows:  3, bandits:  0, cost:  9, cacti: 1, special: null },
  // Rattlesnake (Red) – 3 cacti
  { id: 'card_45',   img: 'Card_45.jpg',  act: 3, dollars:  0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_57',   img: 'Card_57.jpg',  act: 3, dollars:  0, cows:  5, bandits:  2, cost:  4, cacti: 3, special: null },
  { id: 'card_58',   img: 'Card_58.jpg',  act: 3, dollars:  0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  { id: 'card_59',   img: 'Card_59.jpg',  act: 3, dollars:  0, cows:  4, bandits:  0, cost:  8, cacti: 3, special: null },
  // Cactus (Yellow) – 2 cacti
  { id: 'card_9',    img: 'Card_9.jpg',   act: 3, dollars:  3, cows:  2, bandits:  0, cost:  8, cacti: 2, special: null },
  { id: 'card_26',   img: 'Card_26.jpg',  act: 3, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null },
  { id: 'card_28',   img: 'Card_28.jpg',  act: 3, dollars:  0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_29',   img: 'Card_29.jpg',  act: 3, dollars:  0, cows:  3, bandits:  0, cost:  6, cacti: 2, special: null },
  { id: 'card_30',   img: 'Card_30.jpg',  act: 3, dollars:  0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null },
  { id: 'card_32',   img: 'Card_32.jpg',  act: 3, dollars:  0, cows:  4, bandits:  0, cost:  9, cacti: 2, special: null },
  { id: 'card_84',   img: 'Card_84.jpg',  act: 3, dollars:  0, cows:  0, bandits: -1, cost:  5, cacti: 2, special: 'draw4' },
  { id: 'card_85',   img: 'Card_85.jpg',  act: 3, dollars:  0, cows:  0, bandits: -1, cost:  5, cacti: 2, special: 'draw4' },

  // --- DEPRECATED (never dealt; retained so historical games still render) ---
  // was Act 1
  { id: 'card_2',    img: 'Card_2.jpg',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null, deprecated: true },
  { id: 'card_3',    img: 'Card_3.jpg',   act: 1, dollars:  0, cows:  1, bandits:  0, cost:  3, cacti: 2, special: '2cow_if_first', deprecated: true },
  { id: 'card_13',   img: 'Card_13.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  2, cacti: 2, special: null, deprecated: true },
  { id: 'card_14',   img: 'Card_14.jpg',  act: 1, dollars:  0, cows:  0, bandits:  0, cost:  2, cacti: 2, special: 'burn_buy_first', deprecated: true },
  { id: 'card_15',   img: 'Card_15.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  3, cacti: 2, special: '2cow_if_first', deprecated: true },
  { id: 'card_65',   img: 'Card_65.jpg',  act: 1, dollars:  0, cows:  1, bandits:  0, cost:  4, cacti: 1, special: null, deprecated: true },
  { id: 'card_68',   img: 'Card_68.jpg',  act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  { id: 'card_69',   img: 'Card_69.jpg',  act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  { id: 'card_75',   img: 'Card_75.jpg',  act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  { id: 'card_76',   img: 'Card_76.jpg',  act: 1, dollars:  1, cows:  0, bandits:  0, cost:  3, cacti: 1, special: null, deprecated: true },
  // was Act 2
  { id: 'card_4',    img: 'Card_4.jpg',   act: 2, dollars:  0, cows:  0, bandits:  0, cost:  6, cacti: 2, special: 'swap_revealed', deprecated: true },
  { id: 'card_7',    img: 'Card_7.jpg',   act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'copy_next', deprecated: true },
  { id: 'card_17',   img: 'Card_17.jpg',  act: 2, dollars:  4, cows:  0, bandits:  1, cost:  3, cacti: 2, special: null, deprecated: true },
  { id: 'card_19',   img: 'Card_19.jpg',  act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'look3_rearrange', deprecated: true },
  { id: 'card_20',   img: 'Card_20.jpg',  act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'copy_next', deprecated: true },
  { id: 'card_21',   img: 'Card_21.jpg',  act: 2, dollars:  0, cows:  0, bandits:  0, cost:  4, cacti: 2, special: 'extra_buy', deprecated: true },
  { id: 'card_23',   img: 'Card_23.jpg',  act: 2, dollars:  0, cows:  0, bandits:  0, cost:  5, cacti: 2, special: 'replay_discard', deprecated: true },
  { id: 'card_24',   img: 'Card_24.jpg',  act: 2, dollars:  3, cows:  0, bandits:  0, cost:  6, cacti: 2, special: 'dollar1_other', deprecated: true },
  { id: 'card_39',   img: 'Card_39.jpg',  act: 2, dollars:  0, cows:  0, bandits: -1, cost:  4, cacti: 3, special: 'burn_to_use', deprecated: true },
  { id: 'card_50',   img: 'Card_50.jpg',  act: 2, dollars:  0, cows:  0, bandits: -1, cost:  4, cacti: 3, special: 'burn_to_use', deprecated: true },
  // was Act 3
  { id: 'card_8',    img: 'Card_8.jpg',   act: 3, dollars:  0, cows:  4, bandits:  1, cost:  7, cacti: 2, special: null, deprecated: true },
  { id: 'card_25',   img: 'Card_25.jpg',  act: 3, dollars:  0, cows:  2, bandits: -1, cost: 10, cacti: 2, special: null, deprecated: true },
  { id: 'card_27',   img: 'Card_27.jpg',  act: 3, dollars:  3, cows:  0, bandits:  0, cost:  5, cacti: 2, special: null, deprecated: true },
  { id: 'card_31',   img: 'Card_31.jpg',  act: 3, dollars:  0, cows:  0, bandits:  0, cost:  8, cacti: 2, special: 'look3_immediate', deprecated: true },
  { id: 'card_44',   img: 'Card_44.jpg',  act: 3, dollars:  0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null, deprecated: true },
  { id: 'card_55',   img: 'Card_55.jpg',  act: 3, dollars:  3, cows:  3, bandits:  0, cost: 10, cacti: 3, special: null, deprecated: true },
  { id: 'card_56',   img: 'Card_56.jpg',  act: 3, dollars:  0, cows:  5, bandits:  0, cost: 11, cacti: 3, special: null, deprecated: true },
  { id: 'card_60',   img: 'Card_60.jpg',  act: 3, dollars:  0, cows:  5, bandits:  1, cost:  9, cacti: 3, special: null, deprecated: true },
  { id: 'card_71',   img: 'Card_71.jpg',  act: 3, dollars:  0, cows: -1, bandits: -1, cost:  5, cacti: 1, special: null, deprecated: true },
  { id: 'card_87',   img: 'Card_87.jpg',  act: 3, dollars:  0, cows:  3, bandits:  0, cost:  7, cacti: 1, special: null, deprecated: true },
];

// Build lookup
const CARD_DB = {};
STORE_CARDS.forEach(c => CARD_DB[c.id] = c);
STARTER_TEMPLATES.forEach(c => CARD_DB[c.id] = c);
