// Storage: IndexedDB with localStorage fallback.
// All data is kept in memory (state) and written through on every change.

const DB_NAME = 'imfhussain-manager';
const STORE = 'kv';
const KEYS = ['bookings', 'freelancers', 'settings', 'meta', 'guide', 'gigs'];
const LS_PREFIX = 'imfm:';

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  packages: [
    { name: 'The Intimate', rate: 30000 },
    { name: 'Serene', rate: 80000 },
    { name: 'The Classic', rate: 100000 },
    { name: 'The Deluxe', rate: 150000 },
  ],
  multiDay3: 20000,
  multiDay4: 30000,
  addAlbum: 13000,
  addHighlights: 13000,
  addOvertime: 10000,
  addTravelPerKm: 70,
  freeKm: 20,
  addLocation: 20000,
  minMargin: 30,
};

export const state = {
  bookings: [],
  freelancers: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  meta: { lastBackup: null },
  guide: null, // posing guide: [{ id, title, boards: [url], images: [{ id, src }] }]
  gigs: [], // my own freelance work for other studios: [{ id, hiredBy, contact, type, date, shift, time, venue, role, fee, payments: [], status, remarks }]
};

// Things to run after every save (used by Dropbox sync).
const saveListeners = [];
export function onSaved(fn) { saveListeners.push(fn); }

let idb = null;
export let storageKind = 'memory';

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAll() {
  try {
    idb = await openIDB();
    storageKind = 'indexeddb';
    for (const k of KEYS) {
      const v = await idbGet(k);
      if (v !== undefined) assign(k, v);
    }
  } catch {
    idb = null;
    try {
      for (const k of KEYS) {
        const raw = localStorage.getItem(LS_PREFIX + k);
        if (raw) assign(k, JSON.parse(raw));
      }
      storageKind = 'localstorage';
    } catch {
      storageKind = 'memory';
    }
  }
}

function assign(k, v) {
  if (k === 'settings') state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...v };
  else if (k === 'meta') state.meta = { lastBackup: null, ...v };
  else if (k === 'guide') state.guide = Array.isArray(v) ? v : null;
  else if (k === 'gigs') state.gigs = Array.isArray(v) ? v : [];
  else state[k] = Array.isArray(v) ? v : [];
}

export async function save(key) {
  const keys = key ? [key] : KEYS;
  for (const k of keys) {
    const value = JSON.parse(JSON.stringify(state[k]));
    if (idb) {
      await idbPut(k, value);
    } else if (storageKind === 'localstorage') {
      localStorage.setItem(LS_PREFIX + k, JSON.stringify(value));
    }
  }
  if (!key || key !== 'meta') saveListeners.forEach((fn) => { try { fn(); } catch {} });
}

export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

export async function isPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted();
  } catch {}
  return false;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Backup ----------
export function exportJSON() {
  return JSON.stringify({
    app: 'imfhussain-manager',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      bookings: state.bookings,
      freelancers: state.freelancers,
      settings: state.settings,
      guide: state.guide,
      gigs: state.gigs,
    },
  }, null, 2);
}

export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('This is not a valid backup. The text could not be read.'); }
  const data = obj && obj.data ? obj.data : obj;
  if (!data || !Array.isArray(data.bookings) || !Array.isArray(data.freelancers)) {
    throw new Error('This file is not an imfhussain Manager backup.');
  }
  return data;
}

export async function importData(data) {
  state.bookings = data.bookings;
  state.freelancers = data.freelancers;
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(data.settings || {}) };
  state.guide = Array.isArray(data.guide) ? data.guide : state.guide;
  state.gigs = Array.isArray(data.gigs) ? data.gigs : [];
  await save();
}

export async function markBackedUp() {
  state.meta.lastBackup = new Date().toISOString();
  await save('meta');
}

export async function wipeAll() {
  state.bookings = [];
  state.freelancers = [];
  state.gigs = [];
  await save();
}
