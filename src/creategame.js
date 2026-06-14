// ============================================================
// Cards For Cowboys - Create Game (Host flow)
// ============================================================

import { db } from './firebase-config.js';
import {
  ref, set, get, onValue, onDisconnect, remove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// --- UI helpers ---
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  hide('screen-name');
  hide('screen-waiting');
  show('screen-error');
}

// --- Generate a random 6-char game code ---
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/1/I
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// --- Generate a random 32-bit game seed for AI RNG ---
function generateSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}

// --- Read player_defs from sessionStorage (set by gamesetup.html) ---
function getPlayerDefs() {
  const raw = sessionStorage.getItem('player_defs');
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  return [{ name: '', isHuman: true }, { name: '', isHuman: true }];
}

function getName() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { alert('Please enter your name first.'); return null; }
  return val;
}

function allHumanSlotsFilled(slotsData) {
  for (const key of Object.keys(slotsData)) {
    const slot = slotsData[key];
    if (slot.isHuman && !slot.name) return false;
  }
  return true;
}

function renderSlotList(slotsData, numPlayers, containerId) {
  const el = document.getElementById(containerId);
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

// --- Create Game ---
async function createGame() {
  const myName = getName();
  if (!myName) return;

  const defs = getPlayerDefs();
  defs[0].name = myName;

  let gameCode = generateCode();
  gameRef = ref(db, `games/${gameCode}`);

  const snap = await get(gameRef);
  if (snap.exists()) {
    gameCode = generateCode();
    gameRef = ref(db, `games/${gameCode}`);
  }

  const numPlayers = defs.length;
  const gameSeed = generateSeed();
  const slots = {};
  defs.forEach((d, i) => { slots[i] = { name: d.name || '', isHuman: d.isHuman, personality: d.personality || null }; });
  const quickStartMode = sessionStorage.getItem('quick_start_mode') === '1';
  const hiddenHerdMode = sessionStorage.getItem('hidden_herd_mode') === '1';

  await set(gameRef, { status: 'waiting', numPlayers, gameSeed, slots, quickStartMode, hiddenHerdMode, createdAt: Date.now() });

  onDisconnect(gameRef).remove();

  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_slot', '0');
  sessionStorage.setItem('mp_name', myName);
  sessionStorage.removeItem('player_defs');

  document.getElementById('display-code').textContent = gameCode;
  // Invite link points to lobby.html (join page)
  const base = location.origin + location.pathname.replace('creategame.html', '');
  const link = `${base}lobby.html?join=${gameCode}`;
  document.getElementById('btn-share-invite').dataset.link = link;
  // Spectator link
  const spectateLink = `${base}spectate.html?code=${gameCode}`;
  const spectateEl = document.getElementById('spectate-link');
  if (spectateEl) {
    spectateEl.dataset.link = spectateLink;
    spectateEl.textContent = 'Copy spectator link';
  }
  renderSlotList(slots, numPlayers, 'waiting-slot-list');

  hide('screen-name');
  show('screen-waiting');

  unsubscribe = onValue(gameRef, async (snap) => {
    const data = snap.val();
    if (!data) return;
    renderSlotList(data.slots, data.numPlayers, 'waiting-slot-list');
    if (allHumanSlotsFilled(data.slots)) {
      cleanup();
      await onDisconnect(gameRef).cancel();
      // Carry identity in the URL so reopening the tab from history resumes
      // without depending on sessionStorage (which mobile eviction wipes).
      window.location.href = `playgame.html?mp=1&code=${gameCode}&slot=0&name=${encodeURIComponent(myName)}`;
    }
  });
}

// --- Cancel ---
async function cancelHost() {
  cleanup();
  if (gameRef) await remove(gameRef);
  hide('screen-waiting');
  show('screen-name');
}

function cleanup() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

// --- Share invite link (native share sheet on mobile, clipboard fallback) ---
window.shareInvite = async function() {
  const el = document.getElementById('btn-share-invite');
  const link = el.dataset.link;
  if (!link) return;
  // Native share sheet (mobile) \u2014 best UX where available
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Cards For Cowboys',
        text: 'Join my game of Cards For Cowboys!',
        url: link,
      });
      return;
    } catch (err) {
      // User cancelled the share sheet \u2014 do nothing
      if (err && err.name === 'AbortError') return;
      // Otherwise fall through to clipboard copy
    }
  }
  // Clipboard fallback
  try {
    await navigator.clipboard.writeText(link);
    flashShareButton(el, '\u2713 Link copied!');
  } catch (err) {
    flashShareButton(el, link);
  }
};

function flashShareButton(el, msg) {
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = prev; }, 2000);
}

// --- Copy spectator link ---
window.copySpectateLink = function() {
  const el = document.getElementById('spectate-link');
  if (!el || !el.dataset.link) return;
  navigator.clipboard.writeText(el.dataset.link).then(() => {
    const prev = el.textContent;
    el.textContent = '\u2713 Spectator link copied!';
    setTimeout(() => { el.textContent = prev; }, 2000);
  });
};

// --- Wire up ---
// Skip name screen if name was already entered on gamesetup page
const _savedName = sessionStorage.getItem('mp_name');
if (_savedName) {
  hide('screen-name');
  document.getElementById('name-input').value = _savedName;
  createGame();
}

document.getElementById('btn-create').addEventListener('click', createGame);
document.getElementById('btn-cancel-host').addEventListener('click', cancelHost);
document.getElementById('btn-error-back').addEventListener('click', () => {
  hide('screen-error');
  show('screen-name');
});
document.getElementById('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createGame();
});
