#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Cards For Cowboys — Email Signup Retrieval
//
// Usage:
//   1. Get your Firebase Database Secret:
//      Firebase Console → Project Settings → Service Accounts
//      → Database Secrets → Show (or create one)
//   2. Run:
//        FIREBASE_SECRET=your_secret node retrieve-emails.js
//      or paste the secret directly into the variable below.
// ─────────────────────────────────────────────────────────────

const https  = require('https');
const SECRET = process.env.FIREBASE_SECRET || 'PASTE_YOUR_SECRET_HERE';
const DB_URL = `https://cards-for-cowboys-default-rtdb.firebaseio.com/emailSignups.json?auth=${SECRET}`;

if (SECRET === 'PASTE_YOUR_SECRET_HERE') {
  console.error('\nNo secret provided. Set FIREBASE_SECRET env var or paste it into the script.\n');
  process.exit(1);
}

https.get(DB_URL, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(data); } catch {
      console.error('Failed to parse response:', data);
      process.exit(1);
    }
    if (!parsed || parsed.error) {
      console.error('\nFirebase error:', parsed?.error || 'null response (no signups yet, or bad secret)');
      process.exit(1);
    }
    const entries = Object.values(parsed).sort((a, b) => a.ts - b.ts);
    console.log(`\n${entries.length} signup(s):\n`);
    entries.forEach(e => {
      const date = new Date(e.ts).toLocaleString();
      console.log(`  ${e.email.padEnd(40)} ${date}`);
    });
    console.log('');
  });
}).on('error', err => {
  console.error('Request failed:', err.message);
});
