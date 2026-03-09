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

// --- State ---
let myName = '';
let myRole = ''; // 'host' or 'guest'
let gameCode = '';
let gameRef = null;
let unsubscribe = null;

// --- Name validation ---
function getName() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { alert('Please enter your name first.'); return null; }
  return val;
}

// --- Create Game (host) ---
async function createGame() {
  myName = getName();
  if (!myName) return;

  gameCode = generateCode();
  myRole = 'host';
  gameRef = ref(db, `games/${gameCode}`);

  // Check code isn't already in use (very unlikely but safe)
  const snap = await get(gameRef);
  if (snap.exists()) {
    gameCode = generateCode(); // try once more
    gameRef = ref(db, `games/${gameCode}`);
  }

  const gameData = {
    status: 'waiting',
    hostName: myName,
    guestName: null,
    createdAt: Date.now(),
  };

  await set(gameRef, gameData);

  // Clean up if host disconnects while waiting
  onDisconnect(gameRef).remove();

  // Show waiting screen
  document.getElementById('display-code').textContent = gameCode;
  const link = `${location.origin}${location.pathname.replace('lobby.html', '')}lobby.html?join=${gameCode}`;
  document.getElementById('share-link').dataset.link = link;
  document.getElementById('share-link').textContent = link;

  hide('screen-name');
  show('screen-waiting');

  // Listen for guest joining
  unsubscribe = onValue(gameRef, (snap) => {
    const data = snap.val();
    if (!data) return; // removed
    if (data.status === 'ready' && data.guestName) {
      cleanup();
      // Cancel the waiting-phase onDisconnect before navigating
      // (otherwise page unload triggers it and deletes the game)
      onDisconnect(gameRef).cancel();
      sessionStorage.setItem('mp_code', gameCode);
      sessionStorage.setItem('mp_role', 'host');
      sessionStorage.setItem('mp_name', myName);
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

  myRole = 'guest';
  gameRef = ref(db, `games/${gameCode}`);

  hide('screen-name');
  show('screen-joining');
  document.getElementById('join-status').innerHTML = 'Joining game<span class="waiting-dots"></span>';

  const snap = await get(gameRef);
  if (!snap.exists()) { showError('Game not found. Check the code and try again.'); return; }

  const data = snap.val();
  if (data.status !== 'waiting') { showError('That game is already in progress or has ended.'); return; }

  // Join as guest
  await update(gameRef, {
    guestName: myName,
    status: 'ready',
  });

  // Cancel disconnect cleanup set by host (we're good now)
  onDisconnect(gameRef).cancel();

  cleanup();
  sessionStorage.setItem('mp_code', gameCode);
  sessionStorage.setItem('mp_role', 'guest');
  sessionStorage.setItem('mp_name', myName);
  window.location.href = 'play.html?mp=1';
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
    document.getElementById('share-link').textContent = '✓ Copied!';
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
  }
}

// --- Wire up buttons ---
document.getElementById('btn-create').addEventListener('click', createGame);
document.getElementById('btn-join').addEventListener('click', () => joinGame(null));
document.getElementById('btn-cancel-host').addEventListener('click', cancelHost);
document.getElementById('btn-cancel-join').addEventListener('click', cancelJoin);
document.getElementById('btn-error-back').addEventListener('click', () => {
  hide('screen-error');
  show('screen-name');
});

// Allow pressing Enter in code input to join
document.getElementById('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame(null);
});
document.getElementById('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});

checkUrlCode();
