// ============================================================
// Firebase Configuration - Cards For Cowboys
// ============================================================

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyBegwDX84rtHfrYwuMVZcQkcLvaJ9MUOiQ",
  authDomain: "cards-for-cowboys.firebaseapp.com",
  databaseURL: "https://cards-for-cowboys-default-rtdb.firebaseio.com",
  projectId: "cards-for-cowboys",
  storageBucket: "cards-for-cowboys.firebasestorage.app",
  messagingSenderId: "795777888512",
  appId: "1:795777888512:web:560d415f8d34def96dc3e5"
};

// Guarded: playgame.html loads this (via src/signup.js) alongside src/play.js,
// which initializes the same default app on its own. Whichever runs first wins;
// a second unguarded initializeApp would throw app/duplicate-app.
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);
