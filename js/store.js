// In-memory mirror of the user's Firestore data (users/{uid}/<collection>/<doc>).
// Writes are fire-and-forget: with offline persistence they apply locally at once
// and sync whenever the device is online. Never await them in the UI.
import { db, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from './firebase.js';

export const COLS = ['vacations', 'plans', 'entries', 'tx', 'rates', 'meta'];
export const state = { uid: null, ready: false };
COLS.forEach((c) => { state[c] = new Map(); });

let ver = 0;
export const version = () => ver;

const subs = new Set();
let notifyTimer = null;
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; subs.forEach((f) => f()); }, 30);
}

let errorHandler = (e) => console.error(e);
export function setErrorHandler(fn) { errorHandler = fn; }

let unsubs = [];
export function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
  COLS.forEach((c) => { state[c] = new Map(); });
  state.uid = null;
  state.ready = false;
}

/** Subscribe to every collection; resolves once each has delivered its first snapshot. */
export function start(uid) {
  stop();
  state.uid = uid;
  const loaded = new Set();
  return new Promise((resolve) => {
    const markLoaded = (c) => {
      if (loaded.has(c)) return;
      loaded.add(c);
      if (loaded.size === COLS.length) { state.ready = true; resolve(); }
    };
    for (const c of COLS) {
      unsubs.push(onSnapshot(collection(db, 'users', uid, c), (snap) => {
        const m = new Map();
        snap.forEach((d) => m.set(d.id, { id: d.id, ...d.data() }));
        state[c] = m;
        ver++;
        markLoaded(c);
        notify();
      }, (err) => { errorHandler(err); markLoaded(c); }));
    }
  });
}

const ref = (c, id) => doc(db, 'users', state.uid, c, id);
export const newId = (c) => doc(collection(db, 'users', state.uid, c)).id;

const strip = ({ id, ...rest }) => rest;

export function put(c, id, data) { setDoc(ref(c, id), strip(data)).catch(errorHandler); }
export function merge(c, id, data) { setDoc(ref(c, id), strip(data), { merge: true }).catch(errorHandler); }
export function remove(c, id) { deleteDoc(ref(c, id)).catch(errorHandler); }

/** ops: [{op:'put'|'merge'|'remove', c, id, data}] — committed in chunks of 400. */
export function batch(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    for (const o of ops.slice(i, i + 400)) {
      if (o.op === 'remove') b.delete(ref(o.c, o.id));
      else if (o.op === 'merge') b.set(ref(o.c, o.id), strip(o.data), { merge: true });
      else b.set(ref(o.c, o.id), strip(o.data));
    }
    b.commit().catch(errorHandler);
  }
}
