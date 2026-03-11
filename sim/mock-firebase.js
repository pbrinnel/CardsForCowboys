// ============================================================
// mock-firebase.js — In-memory Firebase Realtime Database mock
//
// Semantics mirror the Firebase JS SDK v10 subset used by the MP layer:
//   ref(path)               → MockRef
//   set(ref, value)         → Promise (synchronous write + notify)
//   update(ref, updates)    → Promise (each key treated as sub-path)
//   get(ref)                → Promise<{val()}>
//   onValue(ref, cb)        → unsubscribe fn (fires immediately, then on every write)
//
// All writes are synchronous; returned Promises resolve in the same tick.
// "Nested" semantics: each path is stored flat. Listeners are keyed by exact path.
// update() with keys like 'drawDone/0' computes fullPath = base + '/' + key.
// ============================================================

'use strict';

class MockFirebaseDb {
  constructor() {
    this._store     = {};  // path → value
    this._listeners = {};  // path → Set<fn>
    this._history   = [];  // [{op, path, value}] for debugging
  }

  // Create a ref object for a path
  ref(path) {
    return { _db: this, _path: path || '' };
  }

  // Overwrite path; fire listeners
  set(ref, value) {
    this._write(ref._path, value);
    return Promise.resolve();
  }

  // Merge-write: each key in updates is treated as a child path under ref
  update(ref, updates) {
    const base = ref._path;
    for (const [k, v] of Object.entries(updates)) {
      const fullPath = base ? `${base}/${k}` : k;
      this._write(fullPath, v);
    }
    return Promise.resolve();
  }

  // One-time read
  get(ref) {
    const v = this._read(ref._path);
    return Promise.resolve({ val: () => v });
  }

  // Attach persistent listener; fires immediately with current value
  onValue(ref, cb) {
    const path = ref._path;
    if (!this._listeners[path]) this._listeners[path] = new Set();
    this._listeners[path].add(cb);
    cb({ val: () => this._read(path) });  // immediate fire
    return () => {
      if (this._listeners[path]) this._listeners[path].delete(cb);
    };
  }

  // Inspect current value at a path (for test assertions)
  peek(path) {
    return this._read(path);
  }

  // All stored paths and values (for debugging)
  dump() {
    return { ...this._store };
  }

  // Write history (op, path, value) for auditing
  getHistory() {
    return [...this._history];
  }

  // ---- private ----

  _write(path, value) {
    this._history.push({ op: value === null ? 'delete' : 'set', path, value });
    if (value === null || value === undefined) {
      delete this._store[path];
    } else {
      // Deep-clone to prevent mutation surprises
      this._store[path] = JSON.parse(JSON.stringify(value));
    }
    this._fire(path);
  }

  _read(path) {
    return Object.prototype.hasOwnProperty.call(this._store, path)
      ? this._store[path]
      : null;
  }

  _fire(path) {
    const listeners = this._listeners[path];
    if (!listeners || listeners.size === 0) return;
    const snap = { val: () => this._read(path) };
    for (const cb of [...listeners]) cb(snap);  // spread: safe against unsub-during-fire
  }
}

// Factory: returns a db and a gameRef(path) helper pre-scoped to games/{code}
function createMockDb(gameCode) {
  const db = new MockFirebaseDb();
  function gameRef(path) {
    return db.ref(path ? `games/${gameCode}/${path}` : `games/${gameCode}`);
  }
  return { db, gameRef };
}

module.exports = { MockFirebaseDb, createMockDb };
