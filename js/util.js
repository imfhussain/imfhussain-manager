import { state } from './db.js';

export const PACKAGES_FIXED = ['The Intimate', 'Serene', 'The Classic', 'The Deluxe', 'Custom'];
export const STATUSES = ['Inquiry', 'Booked', 'Completed', 'Editing', 'Delivered', 'Cancelled'];
export const FUNCTIONS = ['Dholki', 'Mayun', 'Mehndi', 'Nikkah', 'Barat', 'Rukhsati', 'Walima', 'Engagement',
  'Bridal Shoot', 'Pre Wedding Shoot', 'Post Wedding Shoot', 'Qawwali Night', 'Other'];
export const METHODS = ['Cash', 'Bank Transfer', 'JazzCash', 'Easypaisa', 'Cheque'];
export const EXPENSE_CATS = ['Album Printing', 'Fuel and Travel', 'Food', 'Accommodation', 'Equipment Rent',
  'Hard Drive', 'Editing Outsource', 'Other'];
export const ROLES = ['Photographer', 'Videographer', 'Cinematographer', 'Drone Operator', 'Editor', 'Assistant'];

// ---------- Formatting ----------
export function num(v) {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function rs(v) {
  const n = Math.round(num(v));
  const s = Math.abs(n).toLocaleString('en-US');
  return (n < 0 ? '-' : '') + 'Rs. ' + s;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function isoDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayISO() { return isoDate(new Date()); }

export function fmtDate(iso) {
  const d = parseDate(iso);
  if (!d) return 'No date';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

export function daysAgo(isoString) {
  if (!isoString) return Infinity;
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Lookups ----------
export const getBooking = (id) => state.bookings.find((b) => b.id === id);
export const getFreelancer = (id) => state.freelancers.find((f) => f.id === id);

export function functionLabel(b, fnId) {
  const f = (b.functions || []).find((x) => x.id === fnId);
  return f ? f.type : 'Whole booking';
}

// ---------- Calculations ----------
export function bookingTotals(b) {
  const total = num(b.finalAmount);
  const received = (b.payments || []).reduce((s, p) => s + num(p.amount), 0);
  const teamCost = (b.team || []).reduce((s, t) => s + num(t.agreed), 0);
  const teamPaid = (b.team || []).reduce((s, t) => s + Math.min(num(t.paid), num(t.agreed)), 0);
  const expenses = (b.expenses || []).reduce((s, e) => s + num(e.amount), 0);
  const due = Math.max(0, total - received);
  const profit = total - teamCost - expenses;
  let payStatus = 'Unpaid';
  if (total > 0 && received >= total) payStatus = 'Paid';
  else if (received > 0) payStatus = 'Partial';
  return { total, received, due, teamCost, teamPaid, teamPending: teamCost - teamPaid, expenses, profit, payStatus };
}

export function teamStatus(t) {
  return num(t.paid) >= num(t.agreed) && num(t.agreed) >= 0 ? 'Cleared' : 'Pending';
}

// The day a team job is finished: its function's date, or the last function for "whole booking".
export function jobDate(b, a) {
  const fns = b.functions || [];
  if (a.functionId) return fns.find((x) => x.id === a.functionId)?.date || '';
  return fns.map((x) => x.date).filter(Boolean).sort().pop() || '';
}

// A freelancer's fee is due only once the event has happened (today counts). No date → due.
export function jobIsDue(b, a, today = todayISO()) {
  const d = jobDate(b, a);
  return !d || d <= today;
}

// 'Cleared' | 'Due' (event done, money left) | 'Later' (event still to come)
export function teamPayState(b, a) {
  if (teamStatus(a) === 'Cleared') return 'Cleared';
  return jobIsDue(b, a) ? 'Due' : 'Later';
}

export function isActive(b) { return b.status !== 'Cancelled'; }

// All team assignments for a freelancer across all bookings.
export function freelancerWork(fid) {
  const rows = [];
  for (const b of state.bookings) {
    for (const t of b.team || []) {
      if (t.freelancerId !== fid) continue;
      const fn = (b.functions || []).find((x) => x.id === t.functionId);
      rows.push({ booking: b, assignment: t, fn, date: fn ? fn.date : (b.functions?.[0]?.date || '') });
    }
  }
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rows;
}

export function freelancerTotals(fid) {
  let agreed = 0, paid = 0, dueNow = 0, later = 0;
  const today = todayISO();
  for (const r of freelancerWork(fid)) {
    const a = r.assignment;
    const p = Math.min(num(a.paid), num(a.agreed));
    agreed += num(a.agreed);
    paid += p;
    const left = num(a.agreed) - p;
    if (left > 0) { if (jobIsDue(r.booking, a, today)) dueNow += left; else later += left; }
  }
  // pending = everything still unpaid; dueNow = for events already done; later = for upcoming events
  return { agreed, paid, pending: agreed - paid, dueNow, later };
}

// All functions across active bookings, flattened.
export function allFunctions({ includeCancelled = false } = {}) {
  const out = [];
  for (const b of state.bookings) {
    if (!includeCancelled && !isActive(b)) continue;
    for (const f of b.functions || []) out.push({ booking: b, fn: f });
  }
  out.sort((a, b) => ((a.fn.date || '') + (a.fn.time || '')).localeCompare((b.fn.date || '') + (b.fn.time || '')));
  return out;
}

// Team status of one day: people on it vs "Team needed" set on the function.
// No requirement set → ready once at least one person is on it.
export function dayTeamStatus(b, fn) {
  const have = teamForFunction(b, fn.id).length;
  const needed = num(fn.teamNeeded);
  const ok = needed ? have >= needed : have > 0;
  const label = needed ? `${have}/${needed}` : have ? `${have} ${have === 1 ? 'person' : 'people'}` : 'no team';
  return { have, needed, ok, label, missing: Math.max(0, needed - have) };
}

export function teamForFunction(b, fnId) {
  return (b.team || []).filter((t) => t.functionId === fnId || !t.functionId).map((t) => {
    const f = getFreelancer(t.freelancerId);
    return f ? f.name : 'Unknown';
  });
}

export function firstDate(b) {
  const ds = (b.functions || []).map((f) => f.date).filter(Boolean).sort();
  return ds[0] || '';
}

// ---------- Shifts and team clashes ----------
// Shoot time is included in each shift. Times are minutes from midnight.
export const SHIFTS = {
  'Day': { label: 'Day (11 AM – 6 PM)', start: 11 * 60, end: 18 * 60 },
  'Evening': { label: 'Evening (6 PM – 11 PM)', start: 18 * 60, end: 23 * 60 },
  'Full day': { label: 'Full day (11 AM – 11 PM)', start: 11 * 60, end: 23 * 60 },
  'Custom': { label: 'Custom time' },
};

const toMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

// Shift suggested from the reporting time: before 6 PM is Day, 6 PM or later is Evening.
export function shiftFromTime(time) {
  const m = toMin(time);
  return m !== null && m >= 18 * 60 ? 'Evening' : 'Day';
}

export function shiftOf(fn) {
  return SHIFTS[fn.shift] ? fn.shift : shiftFromTime(fn.time);
}

export function fnInterval(fn) {
  const s = shiftOf(fn);
  if (s === 'Custom') {
    const start = toMin(fn.customStart) ?? toMin(fn.time) ?? 11 * 60;
    let end = toMin(fn.customEnd) ?? start + 5 * 60;
    if (end <= start) end += 24 * 60; // goes past midnight
    return { start, end };
  }
  return { start: SHIFTS[s].start, end: SHIFTS[s].end };
}

export function shiftLabel(fn) {
  const s = shiftOf(fn);
  if (s === 'Custom') return `${fmtTime(fn.customStart) || '?'} – ${fmtTime(fn.customEnd) || '?'}`;
  return s;
}

// Two functions clash if they are on the same date and their times overlap.
// The venue does not matter.
export function fnsOverlap(a, b) {
  if (!a.date || a.date !== b.date) return false;
  const x = fnInterval(a), y = fnInterval(b);
  return x.start < y.end && y.start < x.end;
}

// Every (booking, function) a team assignment covers. "Whole booking" covers all its functions.
export function assignmentSlots(b, a) {
  const fns = b.functions || [];
  return a.functionId ? fns.filter((f) => f.id === a.functionId) : fns;
}

// All slots where a freelancer is working, across active bookings.
export function freelancerSlots(fid, { skipAssignmentId } = {}) {
  const out = [];
  for (const b of state.bookings) {
    if (!isActive(b)) continue;
    for (const a of b.team || []) {
      if (a.freelancerId !== fid || a.id === skipAssignmentId) continue;
      for (const fn of assignmentSlots(b, a)) out.push({ booking: b, fn, assignment: a });
    }
  }
  return out;
}

// Would assigning freelancer `fid` to these functions clash with their other work?
export function busyConflicts(fid, targetFns, { skipAssignmentId } = {}) {
  const mine = freelancerSlots(fid, { skipAssignmentId });
  const out = [];
  for (const t of targetFns) {
    for (const s of mine) {
      if (s.fn.id === t.id) out.push({ ...s, target: t, same: true });
      else if (fnsOverlap(s.fn, t)) out.push({ ...s, target: t });
    }
  }
  return out;
}

// Every place where one freelancer is booked at two places at the same time.
export function allTeamClashes() {
  const clashes = [];
  for (const f of state.freelancers) {
    const slots = freelancerSlots(f.id);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const x = slots[i], y = slots[j];
        if (x.fn.id === y.fn.id || fnsOverlap(x.fn, y.fn)) {
          clashes.push({ freelancer: f, date: x.fn.date, a: x, b: y });
        }
      }
    }
  }
  clashes.sort((p, q) => (p.date || '').localeCompare(q.date || ''));
  return clashes;
}

export function clashText(c) {
  const where = (s) => `${s.fn.type}, ${s.booking.clientName} (${shiftLabel(s.fn)})`;
  return `${c.freelancer.name} is booked at 2 places on ${fmtDate(c.date)}: ${where(c.a)} and ${where(c.b)}`;
}

// Last N events a freelancer worked (today or earlier), newest first.
export function lastEvents(fid, n = 2) {
  const today = todayISO();
  return freelancerSlots(fid)
    .filter((s) => s.fn.date && s.fn.date <= today)
    .sort((a, b) => b.fn.date.localeCompare(a.fn.date))
    .slice(0, n);
}

export function nextEvent(fid) {
  const today = todayISO();
  return freelancerSlots(fid)
    .filter((s) => s.fn.date && s.fn.date > today)
    .sort((a, b) => a.fn.date.localeCompare(b.fn.date))[0];
}

// ---------- Repeat clients ----------
// Same client = same phone number (last 10 digits) or the same name.
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const nameKey = (n) => String(n || '').toLowerCase().replace(/\band\b/g, '&').replace(/\s+/g, ' ').trim();

export function clientHistory({ clientName, contact }, excludeId) {
  const ph = phoneKey(contact);
  const nm = nameKey(clientName);
  if (ph.length < 7 && nm.length < 3) return [];
  return state.bookings
    .filter((b) => b.id !== excludeId)
    .filter((b) => (ph.length >= 7 && phoneKey(b.contact) === ph) || (nm.length >= 3 && nameKey(b.clientName) === nm))
    .sort((a, b) => (firstDate(b) || '').localeCompare(firstDate(a) || ''));
}

// ---------- My own freelance work ----------
export const GIG_STATUSES = ['Booked', 'Done', 'Cancelled'];
export const getGig = (id) => (state.gigs || []).find((g) => g.id === id);

export function gigTotals(g) {
  const fee = num(g.fee);
  const received = (g.payments || []).reduce((s, p) => s + num(p.amount), 0);
  const pending = g.status === 'Cancelled' ? 0 : Math.max(0, fee - received);
  let payStatus = 'Unpaid';
  if (fee > 0 && received >= fee) payStatus = 'Paid';
  else if (received > 0) payStatus = 'Partial';
  return { fee, received, pending, payStatus };
}

export function gigsSummary() {
  let earned = 0, received = 0, pending = 0;
  for (const g of state.gigs || []) {
    if (g.status === 'Cancelled') continue;
    const t = gigTotals(g);
    earned += t.fee; received += t.received; pending += t.pending;
  }
  return { earned, received, pending };
}

// My own bookings' functions in the same date and shift as a freelance job.
export function gigClashes(g) {
  if (!g.date) return [];
  return allFunctions().filter(({ fn }) => fnsOverlap(fn, g));
}
