// ============================================================
// Cards For Cowboys - Join Game (Guest flow)
// ============================================================

import { db } from './firebase-config.js';
import {
  ref, get, onValue, onDisconnect, runTransaction
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

  // Atomically claim the first open human slot. A plain read-then-write races:
  // two guests joining at once can both see slot 1 empty, both write their
  // name, clobber one another, and both navigate in as slot 1. We instead run
  // a transaction on each candidate slot's `name` node: an empty/null name is
  // the "open → claim" case (return myName), a non-empty name means already
  // taken (return undefined → abort, try the next slot). Transacting on the
  // name node — where null is the claim case, not an abort case — sidesteps
  // the Firebase gotcha that returning undefined on an uncached null value
  // aborts the whole transaction before server data is ever consulted.
  const numPlayers = data.numPlayers;
  let claimedSlot = -1;
  for (let i = 1; i < numPlayers; i++) {
    const s = data.slots[i];
    if (!s || !s.isHuman || s.name) continue; // skip AI/already-filled per the snapshot
    const res = await runTransaction(ref(db, `games/${gameCode}/slots/${i}/name`), (cur) => {
      if (cur) return;   // someone else claimed it first — abort, try next slot
      return myName;     // claim atomically
    });
    if (res.committed && res.snapshot.val() === myName) { claimedSlot = i; break; }
  }

  if (claimedSlot === -1) { showError('No open slots in this game.'); return; }

  onDisconnect(gameRef).cancel();

  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_slot', String(claimedSlot));
  sessionStorage.setItem('mp_name', myName);

  document.getElementById('join-status').textContent = 'Waiting for other players\u2026';

  unsubscribe = onValue(gameRef, (snap) => {
    const d = snap.val();
    if (!d) { showError('The host cancelled the game.'); return; }
    renderSlotList(d.slots, d.numPlayers, 'joining-slot-list');
    if (allHumanSlotsFilled(d.slots)) {
      cleanup();
      // Carry identity in the URL so reopening the tab from history resumes
      // without depending on sessionStorage (which mobile eviction wipes).
      window.location.href = `playgame.html?mp=1&code=${gameCode}&slot=${claimedSlot}&name=${encodeURIComponent(myName)}`;
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

// --- Rejoin flow: ?rejoin=CODE (triggered from index.html localStorage banner) ---
async function checkRejoinUrl() {
  const params = new URLSearchParams(location.search);
  const rejoinCode = params.get('rejoin');
  if (!rejoinCode) return;

  hide('screen-name');
  show('screen-joining');
  document.getElementById('join-status').textContent = 'Reconnecting to game\u2026';

  gameRef = ref(db, `games/${rejoinCode}`);
  let snap;
  try { snap = await get(gameRef); } catch (e) { showError('Could not reach the server. Please check your connection.'); return; }

  if (!snap.exists()) {
    showError('Game not found or has already ended.');
    return;
  }

  const data = snap.val();

  // Determine which slot this player held (stored in localStorage by play.js)
  let savedSlot = null;
  try {
    const saved = JSON.parse(localStorage.getItem('cfc_rejoin') || 'null');
    if (saved && saved.code === rejoinCode) savedSlot = saved.slot;
  } catch (e) {}

  if (savedSlot === null) {
    showError('Could not identify your slot in this game.');
    return;
  }

  const slot = data.slots && data.slots[savedSlot];
  if (!slot || !slot.isHuman) {
    showError('Your slot in this game is no longer available.');
    return;
  }

  // Restore sessionStorage for play.js
  sessionStorage.setItem('mp_code', rejoinCode);
  sessionStorage.setItem('mp_slot', String(savedSlot));
  sessionStorage.setItem('mp_name', slot.name || 'Player');

  window.location.href = `playgame.html?mp=1&rejoin=1&code=${rejoinCode}&slot=${savedSlot}&name=${encodeURIComponent(slot.name || 'Player')}`;
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
checkRejoinUrl();
