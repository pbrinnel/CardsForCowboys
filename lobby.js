// ============================================================
// Cards For Cowboys - Lobby (Online Matchmaking)
// ============================================================

import { db } from './firebase-config.js';
import {
  ref, set, get, update, onValue, remove, onDisconnect
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// --- UI helpers ---
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  hide('screen-name');
  hide('screen-waiting');
  hide('screen-joining');
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

// --- State ---
let myName = '';
let mySlot = -1;  // slot index (0 = host)
let gameCode = '';
let gameRef = null;
let unsubscribe = null;

// --- Read player_defs from sessionStorage ---
// Returns array of { name, isHuman } for each slot.
// Falls back to 2P human game if not set (index.html path).
function getPlayerDefs() {
  const raw = sessionStorage.getItem('player_defs');
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  return [{ name: '', isHuman: true }, { name: '', isHuman: true }];
}

// --- Name validation ---
function getName() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { alert('Please enter your name first.'); return null; }
  return val;
}

// --- Check if all human slots are filled ---
function allHumanSlotsFilled(slotsData) {
  for (const key of Object.keys(slotsData)) {
    const slot = slotsData[key];
    if (slot.isHuman && !slot.name) return false;
  }
  return true;
}

// --- Render slot list in a waiting/joining screen ---
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

// --- Create Game (host) ---
async function createGame() {
  myName = getName();
  if (!myName) return;

  const defs = getPlayerDefs();
  defs[0].name = myName;  // host fills slot 0

  gameCode = generateCode();
  mySlot = 0;
  gameRef = ref(db, `games/${gameCode}`);

  // Check code isn't already in use
  const snap = await get(gameRef);
  if (snap.exists()) {
    gameCode = generateCode();
    gameRef = ref(db, `games/${gameCode}`);
  }

  const numPlayers = defs.length;
  const gameSeed = generateSeed();

  const slots = {};
  defs.forEach((d, i) => { slots[i] = { name: d.name || '', isHuman: d.isHuman, personality: d.personality || null }; });

  await set(gameRef, {
    status: 'waiting',
    numPlayers,
    gameSeed,
    slots,
    createdAt: Date.now(),
  });

  // Remove game if host disconnects while waiting
  onDisconnect(gameRef).remove();

  // Save session info before watching (so it's set even if navigation happens fast)
  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_slot', '0');
  sessionStorage.setItem('mp_name', myName);
  sessionStorage.removeItem('player_defs');

  // Show waiting screen
  document.getElementById('display-code').textContent = gameCode;
  const link = `${location.origin}${location.pathname.replace('lobby.html', '')}lobby.html?join=${gameCode}`;
  document.getElementById('share-link').dataset.link = link;
  document.getElementById('share-link').textContent = link;
  renderSlotList(slots, numPlayers, 'waiting-slot-list');

  hide('screen-name');
  show('screen-waiting');

  // Watch for all human slots to be filled
  unsubscribe = onValue(gameRef, (snap) => {
    const data = snap.val();
    if (!data) return;
    renderSlotList(data.slots, data.numPlayers, 'waiting-slot-list');
    if (allHumanSlotsFilled(data.slots)) {
      cleanup();
      onDisconnect(gameRef).cancel();
      window.location.href = 'play.html?mp=1';
    }
  });
}

// --- Join Game (guest) ---
async function joinGame(codeOverride) {
  myName = getName();
  if (!myName) return;

  gameCode = (codeOverride || document.getElementById('code-input').value.trim().toUpperCase());
  if (gameCode.length !== 6) { showError('Please enter a valid 6-character game code.'); return; }

  gameRef = ref(db, `games/${gameCode}`);

  hide('screen-name');
  show('screen-joining');
  document.getElementById('join-status').innerHTML = 'Joining game<span class="waiting-dots"></span>';

  const snap = await get(gameRef);
  if (!snap.exists()) { showError('Game not found. Check the code and try again.'); return; }

  const data = snap.val();
  if (data.status !== 'waiting') { showError('That game is already in progress or has ended.'); return; }

  // Find first unclaimed human slot (index > 0, isHuman=true, name empty)
  let claimedSlot = -1;
  for (let i = 1; i < data.numPlayers; i++) {
    const s = data.slots[i];
    if (s && s.isHuman && !s.name) {
      claimedSlot = i;
      break;
    }
  }
  if (claimedSlot === -1) {
    showError('No open slots in this game.');
    return;
  }

  mySlot = claimedSlot;

  // Claim the slot
  await update(ref(db, `games/${gameCode}/slots/${claimedSlot}`), { name: myName });

  // Cancel the host's disconnect-cleanup now that we've joined
  onDisconnect(gameRef).cancel();

  // Save session info
  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_slot', String(mySlot));
  sessionStorage.setItem('mp_name', myName);

  document.getElementById('join-status').textContent = 'Waiting for other players\u2026';

  // Watch for all human slots to be filled
  unsubscribe = onValue(gameRef, (snap) => {
    const d = snap.val();
    if (!d) return;
    renderSlotList(d.slots, d.numPlayers, 'joining-slot-list');
    if (allHumanSlotsFilled(d.slots)) {
      cleanup();
      window.location.href = 'play.html?mp=1';
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

function cancelJoin() {
  cleanup();
  hide('screen-joining');
  show('screen-name');
}

function cleanup() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

// --- Copy invite link ---
window.copyShareLink = function() {
  const link = document.getElementById('share-link').dataset.link;
  navigator.clipboard.writeText(link).then(() => {
    document.getElementById('share-link').textContent = '\u2713 Copied!';
    setTimeout(() => {
      document.getElementById('share-link').textContent = link;
    }, 2000);
  });
};

// --- Auto-fill code from URL ?join=XXXXXX ---
function checkUrlCode() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    document.getElementById('code-input').value = joinCode.toUpperCase();
    // Switch to invite mode: hide create/join UI, show a single focused join prompt
    document.getElementById('name-label').textContent = "You've been invited — enter your name:";
    document.getElementById('create-join-section').classList.add('hidden');
    document.getElementById('btn-join-invite').classList.remove('hidden');
    document.getElementById('name-input').focus();
  }
}

// --- Wire up buttons ---
document.getElementById('btn-create').addEventListener('click', createGame);
document.getElementById('btn-join').addEventListener('click', () => joinGame(null));
document.getElementById('btn-join-invite').addEventListener('click', () => joinGame(null));
document.getElementById('btn-cancel-host').addEventListener('click', cancelHost);
document.getElementById('btn-cancel-join').addEventListener('click', cancelJoin);
document.getElementById('btn-error-back').addEventListener('click', () => {
  hide('screen-error');
  show('screen-name');
});

document.getElementById('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame(null);
});
document.getElementById('name-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const inviteMode = !document.getElementById('btn-join-invite').classList.contains('hidden');
  if (inviteMode) joinGame(null);
  else document.getElementById('btn-create').click();
});

checkUrlCode();
