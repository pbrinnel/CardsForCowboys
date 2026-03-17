#!/usr/bin/env node
// ============================================================
// Cards For Cowboys — Multiplayer Integration Tests
// Covers: lobby flow + full game play (draw, buy, all 3 acts)
//
// Usage:
//   node test/mp-lobby.test.js               # headless
//   node test/mp-lobby.test.js --headed      # visible browser
//   node test/mp-lobby.test.js --headed --slow  # slow-mo, easier to watch
// ============================================================

const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const path         = require('path');

const PORT    = 8765;
const BASE    = `http://localhost:${PORT}`;
const ROOT    = path.join(__dirname, '..');
const HEADED  = process.argv.includes('--headed');
const SLOW    = process.argv.includes('--slow');
const SLOW_MS = 400;

// ---------- server ----------

function startServer() {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    proc.stderr.on('data', (d) => {
      if (d.toString().includes('Serving')) resolve(proc);
    });
    setTimeout(() => resolve(proc), 1500);
  });
}

// ---------- assertions ----------

let passed = 0;
let failed = 0;

function ok(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ---------- game driver ----------

// Read #message text from the page
async function getMessage(page) {
  return page.$eval('#message', el => el.textContent.trim()).catch(() => '');
}

// Read all enabled button labels from #actions
async function getActionButtons(page) {
  return page.$$eval('#actions button:not([disabled])', els =>
    els.map(b => b.textContent.trim())
  ).catch(() => []);
}

// Is the game-over overlay visible?
async function isGameOver(page) {
  return page.evaluate(() => {
    const el = document.getElementById('gameover-screen');
    return el && !el.classList.contains('hidden');
  }).catch(() => false);
}

// Is the special card modal (look3 / replay) visible?
async function isSpecialModalVisible(page) {
  return page.evaluate(() => {
    const m = document.getElementById('special-modal');
    return m && !m.classList.contains('hidden');
  }).catch(() => false);
}

// Handle the special-modal (look3_rearrange, replay_discard):
// click all cards in order, then confirm
async function handleSpecialModal(page) {
  // Click each unselected card until all are selected
  for (let attempt = 0; attempt < 10; attempt++) {
    const remaining = await page.$$('#special-modal .modal-cards .card:not(.selected)');
    if (remaining.length === 0) break;
    await remaining[0].click();
    if (SLOW) await page.waitForTimeout(SLOW_MS / 2);
  }
  // Click the confirm button if it appears
  const confirm = await page.$('#special-modal-content button');
  if (confirm) await confirm.click();
  if (SLOW) await page.waitForTimeout(SLOW_MS);
}

// Click a button by CSS selector using the page's native click()
// (avoids Playwright stability checks which time out on rapidly re-rendering game UI)
async function nativeClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  }, selector);
}

// Single decision step for one player.
// Returns true if the game is over, false to keep driving.
async function stepPlayer(page, name) {
  if (await isGameOver(page)) return true;

  // Special modal takes priority
  if (await isSpecialModalVisible(page)) {
    await handleSpecialModal(page);
    return false;
  }

  const msg     = await getMessage(page);
  const buttons = await getActionButtons(page);

  if (SLOW) {
    process.stdout.write(`\r  [${name}] ${msg.substring(0, 60).padEnd(62)}`);
  }

  // ── Buy phase: humanBuyTurn() clears all buttons — execute buy/burn directly ──
  // Check this BEFORE the "no buttons" guard.
  // Also verify G.phase === 'buy' to avoid triggering during scoreRound()'s async delays,
  // which keep the "Buy Phase" message visible even though it's no longer buy phase.
  const isActuallyBuyPhase = await page.evaluate(() =>
    typeof G !== 'undefined' && G.phase === 'buy'
  ).catch(() => false);
  if (isActuallyBuyPhase && /buy phase/i.test(msg) && buttons.length === 0) {
    const acted = await page.evaluate(() => {
      // Find first affordable card to buy, otherwise burn first available
      const avail = [];
      for (let r = 0; r < G.pyramid.length; r++) {
        for (let c = 0; c < G.pyramid[r].length; c++) {
          const s = G.pyramid[r][c];
          if (!s.removed && s.faceUp) avail.push({ r, c, s });
        }
      }
      const player = G.players[0];
      const affordable = avail.filter(a => a.s.card.cost <= player.roundDollars);
      const target = affordable[0] || avail[0];
      if (!target) return false;
      if (affordable[0]) {
        executeBuy(player, target.r, target.c);
      } else {
        executeBurn(player, target.r, target.c);
      }
      return true;
    }).catch(() => false);
    if (!acted) await page.waitForTimeout(200);
    if (SLOW) await page.waitForTimeout(SLOW_MS);
    return false;
  }

  // No buttons = waiting for the other player or Firebase
  if (buttons.length === 0) {
    await page.waitForTimeout(250);
    return false;
  }

  // ── Draw phase ── (draw buttons always have class btn-draw)
  const hasDrawBtn = await page.evaluate(() =>
    !!document.querySelector('#actions button.btn-draw')
  ).catch(() => false);

  if (hasDrawBtn) {
    const handLen = await page.evaluate(() =>
      typeof G !== 'undefined' && G.players[0] ? G.players[0].hand.length : 0
    ).catch(() => 0);

    if (handLen >= 3) {
      // Stop after 3 cards to avoid busting too often
      await nativeClick(page, '#actions button.btn-secondary');
    } else {
      const wait = SLOW ? SLOW_MS : 150;
      await page.waitForTimeout(wait);
      await nativeClick(page, '#actions button.btn-draw');
    }
    if (SLOW) await page.waitForTimeout(SLOW_MS);
    return false;
  }

  // ── Special prompts in draw phase (Jail, Trash for $2, Priority, Trash & Look, Replay) ──
  if (/trash|jail|replay|rearrange|return to top|pass card to/i.test(msg)) {
    // Always choose the secondary / "keep" / "no thanks" path
    const clicked = await nativeClick(page, '#actions button.btn-secondary');
    if (!clicked) await nativeClick(page, '#actions button:first-child');
    if (SLOW) await page.waitForTimeout(SLOW_MS);
    return false;
  }

  // ── Choose who buys first ──
  if (/who goes first/i.test(msg)) {
    await nativeClick(page, '#actions button:first-child');
    if (SLOW) await page.waitForTimeout(SLOW_MS);
    return false;
  }

  // ── After UI pyramid click: Buy/Burn/Cancel buttons (fallback if UI path used) ──
  if (/burn\?|can't afford/i.test(msg)) {
    await page.evaluate(() => {
      // Call executeBuy or executeBurn directly using the selected card coords
      const sel = G.selectedPyramidCard;
      if (!sel) return;
      const player = G.players[0];
      const slot = G.pyramid[sel.row][sel.col];
      if (!slot || slot.removed) return;
      if (slot.card.cost <= player.roundDollars) executeBuy(player, sel.row, sel.col);
      else executeBurn(player, sel.row, sel.col);
    }).catch(() => {});
    if (SLOW) await page.waitForTimeout(SLOW_MS);
    return false;
  }

  // ── Deck-empty: shuffle discard into deck? ──
  if (/shuffle.*discard/i.test(msg)) {
    await nativeClick(page, '#actions button:first-child');
    if (SLOW) await page.waitForTimeout(SLOW_MS);
    return false;
  }

  // ── Fallback: click first available button ──
  await nativeClick(page, '#actions button:not([disabled])');
  if (SLOW) await page.waitForTimeout(SLOW_MS);
  return false;
}

// Drive a player page until game over, with a round cap for safety
async function drivePlayer(page, name, { maxSteps = 3000 } = {}) {
  let lastMsg = '';
  let sameCount = 0;
  const startTime = Date.now();
  for (let i = 0; i < maxSteps; i++) {
    // Hard 90-second timeout for diagnosis
    if (Date.now() - startTime > 90000) {
      console.error(`\n  [${name}] 90s timeout reached at step ${i}`);
      return false;
    }
    const done = await stepPlayer(page, name);
    if (done) return true;
    // Detect if stuck on same message for too long
    const msg = await getMessage(page);
    if (msg === lastMsg) {
      sameCount++;
      if (sameCount === 40) { // ~10 seconds stuck on same state
        const btns = await getActionButtons(page);
        const phase = await page.evaluate(() => typeof G !== 'undefined' ? G.phase : 'unknown').catch(() => '?');
        console.log(`\n  [${name}] STUCK(step ${i}): phase="${phase}" msg="${msg}" btns=[${btns.join('|')}]`);
        // Also log game state
        const pyramidInfo = await page.evaluate(() => {
          if (typeof G === 'undefined' || !G) return 'no G';
          const avail = [];
          for (const row of G.pyramid) for (const s of row)
            if (!s.removed && s.faceUp) avail.push(s.card.id);
          return `round=${G.roundNumber} act=${G.currentAct} drawsDone=${JSON.stringify(G.drawsDone)} buyOrder=${JSON.stringify(G.buyOrder)} buyIdx=${G.currentBuyerIdx} avail=[${avail.join(',')}]`;
        }).catch(() => '?');
        console.log(`  [${name}] ${pyramidInfo}`);
        return false; // abort on stuck
      }
    } else {
      sameCount = 0;
      lastMsg = msg;
    }
  }
  console.error(`\n  [${name}] hit maxSteps limit`);
  return false;
}

// ---------- lobby helpers ----------

async function createGame(page, hostName, playerDefs) {
  await page.goto(`${BASE}/creategame.html`);
  await page.evaluate((defs) => {
    sessionStorage.setItem('player_defs', JSON.stringify(defs));
  }, playerDefs);
  await page.fill('#name-input', hostName);
  await page.click('#btn-create');
  await page.waitForSelector('#display-code', { timeout: 8000 });
  return (await page.textContent('#display-code')).trim();
}

async function joinGame(page, guestName, code) {
  await page.goto(`${BASE}/lobby.html`);
  await page.fill('#name-input', guestName);
  await page.fill('#code-input', code);
  await page.click('#btn-join');
}

// ---------- tests ----------

async function testLobbyFlow(browser) {
  console.log('\n── Lobby: Host create → Guest join ──');
  const hostCtx  = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage  = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();
  hostPage.on('console', () => {}); guestPage.on('console', () => {});

  try {
    const code = await createGame(hostPage, 'Alice', [
      { name: '', isHuman: true }, { name: '', isHuman: true }
    ]);
    ok(code.length === 6, `Code generated (${code})`);

    await joinGame(guestPage, 'Bob', code);

    await Promise.all([
      hostPage.waitForURL(`**/playgame.html?mp=1`,  { timeout: 12000 }),
      guestPage.waitForURL(`**/playgame.html?mp=1`, { timeout: 12000 }),
    ]);
    ok(true, 'Both navigated to playgame.html');

    ok(await hostPage.evaluate(()  => sessionStorage.getItem('mp_slot')) === '0', 'Host slot=0');
    ok(await guestPage.evaluate(() => sessionStorage.getItem('mp_slot')) === '1', 'Guest slot=1');

    if (HEADED) await hostPage.waitForTimeout(2000);
  } finally {
    await hostCtx.close(); await guestCtx.close();
  }
}

async function testInviteLink(browser) {
  console.log('\n── Lobby: Invite link flow ──');
  const hostCtx  = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage  = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();
  hostPage.on('console', () => {}); guestPage.on('console', () => {});

  try {
    const code = await createGame(hostPage, 'Carol', [
      { name: '', isHuman: true }, { name: '', isHuman: true }
    ]);
    await guestPage.goto(`${BASE}/lobby.html?join=${code}`);
    await guestPage.locator('#btn-join-invite').waitFor({ state: 'visible', timeout: 4000 });
    await guestPage.fill('#name-input', 'Dave');
    await guestPage.click('#btn-join-invite');

    await Promise.all([
      hostPage.waitForURL(`**/playgame.html?mp=1`,  { timeout: 12000 }),
      guestPage.waitForURL(`**/playgame.html?mp=1`, { timeout: 12000 }),
    ]);
    ok(true, 'Invite link: both navigated to playgame.html');
    ok(await guestPage.evaluate(() => sessionStorage.getItem('mp_slot')) === '1', 'Invite guest slot=1');
  } finally {
    await hostCtx.close(); await guestCtx.close();
  }
}

async function testBadCode(browser) {
  console.log('\n── Lobby: Bad game code ──');
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', () => {});
  try {
    await page.goto(`${BASE}/lobby.html`);
    await page.fill('#name-input', 'Eve');
    await page.fill('#code-input', 'XXXXXX');
    await page.click('#btn-join');
    await page.waitForSelector('#screen-error:not(.hidden)', { timeout: 8000 });
    const msg = await page.textContent('#error-msg');
    ok(msg.toLowerCase().includes('not found'), `Error shown: "${msg}"`);
  } finally {
    await ctx.close();
  }
}

async function testFullGame(browser) {
  console.log('\n── Full game: 2P human vs human (all 3 acts) ──');
  const hostCtx  = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage  = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  // Log browser errors from both pages
  hostPage.on('console',  m => { if (m.type() === 'error') console.error('  [host-err]', m.text()); });
  guestPage.on('console', m => { if (m.type() === 'error') console.error('  [guest-err]', m.text()); });

  try {
    const code = await createGame(hostPage, 'Player1', [
      { name: '', isHuman: true }, { name: '', isHuman: true }
    ]);
    await joinGame(guestPage, 'Player2', code);

    await Promise.all([
      hostPage.waitForURL(`**/playgame.html?mp=1`,  { timeout: 12000 }),
      guestPage.waitForURL(`**/playgame.html?mp=1`, { timeout: 12000 }),
    ]);

    // Wait for game to initialise (message changes from "Connecting...")
    await hostPage.waitForFunction(
      () => document.getElementById('message')?.textContent !== 'Connecting to game...',
      { timeout: 15000 }
    );

    console.log('  Game started — driving both players to completion...');

    // Drive both players concurrently until game over
    const [hostDone, guestDone] = await Promise.all([
      drivePlayer(hostPage,  'P1'),
      drivePlayer(guestPage, 'P2'),
    ]);

    if (SLOW) process.stdout.write('\n');

    ok(hostDone,  'Host reached game over');
    ok(guestDone, 'Guest reached game over');

    // Both should show the game-over screen
    const hostGO  = await hostPage.evaluate(() =>
      !document.getElementById('gameover-screen').classList.contains('hidden')
    );
    const guestGO = await guestPage.evaluate(() =>
      !document.getElementById('gameover-screen').classList.contains('hidden')
    );
    ok(hostGO,  'Host shows game-over screen');
    ok(guestGO, 'Guest shows game-over screen');

    // Read final scores
    const hostTitle  = await hostPage.textContent('#gameover-title');
    const hostScores = await hostPage.textContent('#gameover-scores');
    const guestTitle = await guestPage.textContent('#gameover-title');

    console.log(`\n  Host sees:  "${hostTitle}"`);
    console.log(`             ${hostScores.replace(/\n/g, ' | ').trim()}`);
    console.log(`  Guest sees: "${guestTitle}"`);

    // Both should agree: host sees "You Win!" or "Tie!", guest sees "[Name] Wins!" or "Tie!"
    // Normalise: "You Win!" on host = host won, "Player1 Wins!" on guest = Player1 won.
    // These both mean Player1 won, so they agree.
    const hostWon   = hostTitle === 'You Win!' || hostTitle.includes('You Win');
    const guestHostWon = guestTitle.includes('Player1');
    const bothAgree = (hostWon === guestHostWon) || (hostTitle === guestTitle);
    ok(bothAgree, `Both see same winner (host="${hostTitle}" guest="${guestTitle}")`);

    // Scores contain player names — host shows "You:" for self, guest shows "Player1:" for host
    ok(/Player2/.test(hostScores), 'Scores include Player2');
    ok(/You:|Player1/.test(hostScores), 'Scores include Player1 or "You"');

    if (HEADED) await hostPage.waitForTimeout(5000);
  } finally {
    await hostCtx.close(); await guestCtx.close();
  }
}

// ---------- main ----------

async function main() {
  console.log(`\nCards For Cowboys — MP Integration Tests`);
  console.log(`Mode: ${HEADED ? 'headed' : 'headless'}${SLOW ? ' (slow-mo)' : ''}`);
  console.log(`Server: ${BASE}`);

  const server  = await startServer();
  console.log(`Server started on port ${PORT}`);

  const browser = await chromium.launch({
    headless: !HEADED,
    slowMo: SLOW ? SLOW_MS : 0,
  });

  try {
    await testLobbyFlow(browser);
    await testInviteLink(browser);
    await testBadCode(browser);
    await testFullGame(browser);
  } catch (err) {
    console.error('\nUnhandled error:', err);
    failed++;
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '✅ All tests passed\n' : '❌ Some tests failed\n');
  process.exit(failed > 0 ? 1 : 0);
}

main();
