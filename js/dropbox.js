// Dropbox sync: after every save, rewrites an Excel record and a full backup in your Dropbox.
// Uses Dropbox's "App folder" so the app can only touch its own folder: Dropbox/Apps/<your app name>/
// Login tokens stay on this phone only (they are never put in backups).

import { state, save, exportJSON, onSaved } from './db.js';
import { buildXlsx } from './xlsx.js';
import {
  num, fmtDate, fmtTime, bookingTotals, freelancerTotals, getFreelancer, teamStatus, teamPayState, shiftLabel, firstDate, lastEvents, gigTotals,
} from './util.js';

export const XLSX_PATH = '/imfhussain-manager.xlsx';
export const JSON_PATH = '/imfhussain-backup.json';

const dbx = () => (state.meta.dropbox ||= {});
export const isConnected = () => !!dbx().refreshToken;

let listeners = [];
export function onStatus(fn) { listeners.push(fn); }
const notify = () => listeners.forEach((fn) => { try { fn(); } catch {} });

async function saveMeta() { await save('meta'); notify(); }

// ---------- Login (PKCE, code is pasted back into the app) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Build the Dropbox sign-in link ahead of time, so a tap can open it at once
// (iPhone blocks new windows that open after a delay).
export async function prepareLogin(appKey) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const key = appKey.trim();
  const url = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
    client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
  });
  return { appKey: key, verifier, url };
}

// Remember which sign-in is in progress (call when the link is tapped).
export async function rememberLogin(prep) {
  const d = dbx();
  d.appKey = prep.appKey;
  d.verifier = prep.verifier;
  await saveMeta();
}

export async function startLogin(appKey) {
  const prep = await prepareLogin(appKey);
  await rememberLogin(prep);
  window.open(prep.url, '_blank');
  return prep.url;
}

export async function finishLogin(code) {
  const d = dbx();
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ code: code.trim(), grant_type: 'authorization_code', client_id: d.appKey, code_verifier: d.verifier }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.refresh_token) throw new Error(j.error_description || 'Dropbox did not accept this code. Try Connect again.');
  d.refreshToken = j.refresh_token;
  d.accessToken = j.access_token;
  d.expiresAt = Date.now() + (j.expires_in - 120) * 1000;
  delete d.verifier;
  d.lastError = '';
  await saveMeta();
  await syncNow();
}

export async function disconnect() {
  const d = dbx();
  try {
    if (d.accessToken) await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + d.accessToken } });
  } catch {}
  state.meta.dropbox = { appKey: d.appKey };
  await saveMeta();
}

async function accessToken() {
  const d = dbx();
  if (d.accessToken && Date.now() < (d.expiresAt || 0)) return d.accessToken;
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.refreshToken, client_id: d.appKey }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const e = new Error(res.status === 400 || res.status === 401 ? 'Dropbox login expired. Please connect again.' : 'Could not reach Dropbox.');
    e.auth = res.status === 400 || res.status === 401;
    throw e;
  }
  d.accessToken = j.access_token;
  d.expiresAt = Date.now() + (j.expires_in - 120) * 1000;
  return d.accessToken;
}

// Dropbox-API-Arg must be plain ASCII.
const apiArg = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

async function upload(path, blob) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + await accessToken(),
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({ path, mode: 'overwrite', mute: true, autorename: false }),
    },
    body: blob,
  });
  if (!res.ok) throw new Error('Upload failed (' + res.status + '). ' + (await res.text().catch(() => '')).slice(0, 120));
}

export async function downloadBackup() {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Dropbox-API-Arg': apiArg({ path: JSON_PATH }) },
  });
  if (res.status === 409) throw new Error('No backup found in Dropbox yet.');
  if (!res.ok) throw new Error('Could not download the backup from Dropbox.');
  return res.text();
}

// ---------- Sync ----------
let timer = null;
let running = false;
let again = false;

export function scheduleSync(delay = 4000) {
  if (!isConnected()) return;
  dbx().pending = true;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  if (!isConnected()) return false;
  const d = dbx();
  if (!navigator.onLine) { d.pending = true; d.lastError = 'Offline. Will upload when internet is back.'; await saveMeta(); return false; }
  if (running) { again = true; return false; }
  running = true;
  d.syncing = true; notify();
  try {
    await upload(XLSX_PATH, buildXlsx(workbook()));
    await upload(JSON_PATH, new Blob([exportJSON()], { type: 'application/json' }));
    d.pending = false;
    d.lastSync = new Date().toISOString();
    d.lastError = '';
    state.meta.lastBackup = d.lastSync; // a Dropbox upload is a full backup
    return true;
  } catch (e) {
    d.pending = true;
    d.lastError = e.message || 'Upload failed.';
    if (e.auth) { d.refreshToken = ''; d.accessToken = ''; }
    return false;
  } finally {
    running = false;
    d.syncing = false;
    await saveMeta();
    if (again) { again = false; scheduleSync(1000); }
  }
}

export function initDropboxSync() {
  onSaved(() => scheduleSync());
  window.addEventListener('online', () => { if (dbx().pending) scheduleSync(1500); });
  if (isConnected() && dbx().pending) scheduleSync(3000);
}

// ---------- Excel content ----------
export function workbook() {
  const B = state.bookings;
  const fname = (id) => getFreelancer(id)?.name || 'Deleted';
  const fnOf = (b, id) => (b.functions || []).find((f) => f.id === id);
  return [
    {
      name: 'Events',
      columns: [['Client', 24], ['Contact', 15], ['City', 12], ['Package', 14], ['Status', 11], ['First date', 16], ['Functions', 30],
        ['Total', 12], ['Received', 12], ['Due', 12], ['Team cost', 12], ['Expenses', 12], ['Profit', 12], ['Payment', 10], ['Discount', 11], ['Remarks', 30]]
        .map(([header, width]) => ({ header, width })),
      rows: B.map((b) => {
        const t = bookingTotals(b);
        return [b.clientName, b.contact, b.city, b.package, b.status, fmtDate(firstDate(b)), (b.functions || []).map((f) => f.type).join(', '),
          t.total, t.received, t.due, t.teamCost, t.expenses, t.profit, t.payStatus, num(b.discount), b.remarks];
      }),
    },
    {
      name: 'Functions',
      columns: [['Client', 24], ['Function', 16], ['Date', 16], ['Shift', 12], ['Reporting', 10], ['Venue', 20], ['Team needed', 12], ['Team', 30], ['Instructions', 40], ['Deliverables', 30]]
        .map(([header, width]) => ({ header, width })),
      rows: B.flatMap((b) => (b.functions || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || '')).map((f) => [
        b.clientName, f.type, fmtDate(f.date), shiftLabel(f), fmtTime(f.time), f.venue, f.teamNeeded === '' || f.teamNeeded == null ? '' : num(f.teamNeeded),
        (b.team || []).filter((a) => a.functionId === f.id || !a.functionId).map((a) => fname(a.freelancerId)).join(', '),
        f.instructions, f.deliverables,
      ])),
    },
    {
      name: 'Client payments',
      columns: [['Client', 24], ['Date', 16], ['Amount', 12], ['Method', 14], ['Remarks', 30]].map(([header, width]) => ({ header, width })),
      rows: B.flatMap((b) => (b.payments || []).map((p) => [b.clientName, fmtDate(p.date), num(p.amount), p.method, p.remarks])),
    },
    {
      name: 'Team payments',
      columns: [['Freelancer', 20], ['Role', 14], ['Client', 24], ['Function', 16], ['Date', 16], ['Shift', 12], ['Agreed', 12], ['Paid', 12], ['Pending', 12], ['Status', 12], ['Paid date', 16], ['Remarks', 24]]
        .map(([header, width]) => ({ header, width })),
      rows: B.flatMap((b) => (b.team || []).map((a) => {
        const f = getFreelancer(a.freelancerId);
        const fn = fnOf(b, a.functionId);
        return [fname(a.freelancerId), f?.role, b.clientName, fn ? fn.type : 'Whole booking', fn ? fmtDate(fn.date) : '', fn ? shiftLabel(fn) : '',
          num(a.agreed), num(a.paid), Math.max(0, num(a.agreed) - num(a.paid)), ({ Cleared: 'Paid', Due: 'Due', Later: 'Assigned' })[teamPayState(b, a)], a.paidDate ? fmtDate(a.paidDate) : '', a.remarks];
      })),
    },
    {
      name: 'Expenses',
      columns: [['Client', 24], ['Category', 18], ['For days', 22], ['Status', 14], ['Date', 16], ['Amount', 12], ['Remarks', 30]].map(([header, width]) => ({ header, width })),
      rows: B.flatMap((b) => (b.expenses || []).map((e) => [b.clientName, e.category,
        e.functionIds?.length ? (b.functions || []).filter((f) => e.functionIds.includes(f.id)).map((f) => f.type).join(', ') : 'All days',
        e.status || 'Booked', fmtDate(e.date), num(e.amount), e.remarks])),
    },
    {
      name: 'My freelance',
      columns: [['Hired by', 22], ['Contact', 15], ['Event', 14], ['My role', 14], ['Date', 16], ['Shift', 12], ['Venue', 18], ['Status', 10],
        ['Fee', 12], ['Received', 12], ['Pending', 12], ['Payment', 10], ['Remarks', 28]].map(([header, width]) => ({ header, width })),
      rows: (state.gigs || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((g) => {
        const t = gigTotals(g);
        return [g.hiredBy, g.contact, g.type, g.role, fmtDate(g.date), shiftLabel(g), g.venue, g.status, t.fee, t.received, t.pending, t.payStatus, g.remarks];
      }),
    },
    {
      name: 'Freelancers',
      columns: [['Name', 20], ['Role', 14], ['Contact', 15], ['Rate per day', 12], ['Agreed total', 12], ['Paid', 12], ['Due now', 12], ['Assigned (after event)', 14], ['Last 2 events', 50], ['Remarks', 24]]
        .map(([header, width]) => ({ header, width })),
      rows: state.freelancers.map((f) => {
        const t = freelancerTotals(f.id);
        return [f.name, f.role, f.contact, num(f.rate), t.agreed, t.paid, t.dueNow, t.later,
          lastEvents(f.id, 2).map((x) => `${x.fn.type}, ${x.booking.clientName}, ${fmtDate(x.fn.date)}`).join(' | '), f.remarks];
      }),
    },
  ];
}
