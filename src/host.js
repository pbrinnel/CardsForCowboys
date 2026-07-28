// ============================================================
// Cards For Cowboys - Host flow (inline waiting room on gamesetup)
// ============================================================
// Folded in from the former creategame.html/creategame.js page. The host
// "waiting room" is now a STATE of gamesetup.html (#table-waiting), not a
// separate page — so the name is collected once on the setup screen and the
// redundant second name prompt is gone.
//
// Identity / launch contract is preserved verbatim from the old creategame.js
// (do not regress): onDisconnect(gameRef).remove() armed at create, cancelled
// right before launch, and the launch URL carries code/slot/name so a reopened
// tab can recover even when sessionStorage was wiped (mobile eviction, bug #8).

import { db } from './firebase-config.js';
import {
  ref, set, get, onValue, onDisconnect, remove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// --- DOM helpers ---
function showConfig() {
  document.getElementById('table-waiting').classList.add('hidden');
  document.getElementById('table-config').classList.remove('hidden');
}
function showWaiting() {
  document.getElementById('table-config').classList.add('hidden');
  document.getElementById('table-waiting').classList.remove('hidden');
}

// --- Random 6-char game code (no O/0/1/I) ---
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// --- Random 32-bit game seed for AI RNG ---
function generateSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}

function getPlayerDefs() {
  const raw = sessionStorage.getItem('player_defs');
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  return [{ name: '', isHuman: true }, { name: '', isHuman: true }];
}

function allHumanSlotsFilled(slotsData) {
  for (const key of Object.keys(slotsData)) {
    const slot = slotsData[key];
    if (slot.isHuman && !slot.name) return false;
  }
  return true;
}

function renderSlotList(slotsData, numPlayers) {
  const el = document.getElementById('waiting-slot-list');
  if (!el) return;
  let html = '';
  for (let i = 0; i < numPlayers; i++) {
    const slot = slotsData[i] || {};
    const label = i === 0 ? 'Player 1 (Host)' : `Player ${i + 1}`;
    let status;
    if (!slot.isHuman) {
      status = '<span class="slot-status ai">AI</span>';
    } else if (slot.name) {
      status = `<span class="slot-status filled">&#10003; ${slot.name}</span>`;
    } else {
      status = '<span class="slot-status waiting">Waiting&#8230;</span>';
    }
    html += `<div class="lobby-slot"><span class="lobby-slot-label">${label}</span>${status}</div>`;
  }
  el.innerHTML = html;
}

// --- State ---
let gameRef = null;
let unsubscribe = null;
let currentCode = null;
let myName = '';

function cleanup() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

// --- Create the game and enter the waiting room (called from gamesetup) ---
async function startHosting() {
  const defs = getPlayerDefs();
  myName = (sessionStorage.getItem('mp_name') || defs[0].name || 'Cowboy');
  defs[0].name = myName;

  let gameCode = generateCode();
  gameRef = ref(db, `games/${gameCode}`);
  const snap = await get(gameRef);
  if (snap.exists()) {
    gameCode = generateCode();
    gameRef = ref(db, `games/${gameCode}`);
  }
  currentCode = gameCode;

  const numPlayers = defs.length;
  const gameSeed = generateSeed();
  const slots = {};
  defs.forEach((d, i) => { slots[i] = { name: d.name || '', isHuman: d.isHuman, personality: d.personality || null }; });
  const hiddenHerdMode = sessionStorage.getItem('hidden_herd_mode') === '1';

  await set(gameRef, { status: 'waiting', numPlayers, gameSeed, slots, hiddenHerdMode, createdAt: Date.now() });

  onDisconnect(gameRef).remove();

  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_slot', '0');
  sessionStorage.setItem('mp_name', myName);
  sessionStorage.removeItem('player_defs');

  document.getElementById('display-code').textContent = gameCode;
  const base = location.origin + location.pathname.replace('gamesetup.html', '');
  document.getElementById('btn-share-invite').dataset.link = `${base}lobby.html?join=${gameCode}`;
  const spectateEl = document.getElementById('spectate-link');
  if (spectateEl) {
    spectateEl.dataset.link = `${base}spectate.html?code=${gameCode}`;
    spectateEl.textContent = 'Copy spectator link';
  }
  renderSlotList(slots, numPlayers);

  showWaiting();

  unsubscribe = onValue(gameRef, async (snap) => {
    const data = snap.val();
    if (!data) return;
    renderSlotList(data.slots, data.numPlayers);
    if (allHumanSlotsFilled(data.slots)) {
      cleanup();
      await onDisconnect(gameRef).cancel();
      // Carry identity in the URL so reopening the tab from history resumes
      // without depending on sessionStorage (mobile eviction wipes it).
      window.location.href = `playgame.html?mp=1&code=${gameCode}&slot=0&name=${encodeURIComponent(myName)}`;
    }
  });
}

// --- Cancel: tear down the game node, return to config state ---
async function cancelHost() {
  cleanup();
  if (gameRef) {
    await onDisconnect(gameRef).cancel();
    await remove(gameRef);
  }
  gameRef = null;
  showConfig();
}

// --- Share invite link (native share sheet on mobile, clipboard fallback) ---
window.shareInvite = async function () {
  const el = document.getElementById('btn-share-invite');
  const link = el.dataset.link;
  if (!link) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Cards For Cowboys', text: 'Join my game of Cards For Cowboys!', url: link });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    flashButton(el, '✓ Link copied!');
  } catch (err) {
    flashButton(el, link);
  }
};

function flashButton(el, msg) {
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = prev; }, 2000);
}

window.copySpectateLink = function () {
  const el = document.getElementById('spectate-link');
  if (!el || !el.dataset.link) return;
  navigator.clipboard.writeText(el.dataset.link).then(() => {
    const prev = el.textContent;
    el.textContent = '✓ Spectator link copied!';
    setTimeout(() => { el.textContent = prev; }, 2000);
  });
};

// --- Expose entry point + wire waiting-room buttons ---
window.CFC_startHosting = startHosting;
document.getElementById('btn-cancel-host').addEventListener('click', cancelHost);
