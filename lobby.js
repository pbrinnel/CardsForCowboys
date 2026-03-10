// ============================================================
// Cards For Cowboys - Join Game (Guest flow)
// ============================================================

import { db } from './firebase-config.js';
import {
  ref, get, update, onValue, onDisconnect
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// --- UI helpers ---
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  hide('screen-name');
  hide('screen-joining');
  show('screen-error');
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

// --- Join Game ---
async function joinGame(codeOverride) {
  const myName = getName();
  if (!myName) return;

  const gameCode = (codeOverride || document.getElementById('code-input').value.trim().toUpperCase());
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
    if (s && s.isHuman && !s.name) { claimedSlot = i; break; }
  }
  if (claimedSlot === -1) { showError('No open slots in this game.'); return; }

  await update(ref(db, `games/${gameCode}/slots/${claimedSlot}`), { name: myName });

  onDisconnect(gameRef).cancel();

  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_slot', String(claimedSlot));
  sessionStorage.setItem('mp_name', myName);

  document.getElementById('join-status').textContent = 'Waiting for other players\u2026';

  unsubscribe = onValue(gameRef, (snap) => {
    const d = snap.val();
    if (!d) return;
    renderSlotList(d.slots, d.numPlayers, 'joining-slot-list');
    if (allHumanSlotsFilled(d.slots)) {
      cleanup();
      window.location.href = 'playgame.html?mp=1';
    }
  });
}

function cancelJoin() {
  cleanup();
  hide('screen-joining');
  show('screen-name');
}

function cleanup() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

// --- Auto-fill code from URL ?join=XXXXXX (invite link) ---
function checkUrlCode() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    document.getElementById('code-input').value = joinCode.toUpperCase();
    document.getElementById('name-label').textContent = "You've been invited — enter your name:";
    document.getElementById('code-section').classList.add('hidden');
    document.getElementById('btn-join-invite').classList.remove('hidden');
    document.getElementById('name-input').focus();
  }
}

// --- Wire up ---
document.getElementById('btn-join').addEventListener('click', () => joinGame(null));
document.getElementById('btn-join-invite').addEventListener('click', () => joinGame(null));
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
  else document.getElementById('btn-join').click();
});

checkUrlCode();
