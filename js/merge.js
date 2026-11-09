// Combine bookings of the same wedding (e.g. Mehndi, Barat and Walima entered separately)
// into one booking. Nothing is lost: every function, payment, expense and team member moves over,
// and each team member stays on their own day.
import { state, save } from './db.js';
import { num, clientHistory, firstDate, isActive } from './util.js';

const DAY = 86400000;
const toTime = (iso) => (iso ? new Date(iso + 'T00:00:00').getTime() : NaN);

// Other bookings of the same client (same phone or name) with a function within `days` of this one.
export function sameEventCandidates(b, days = 14) {
  if (!isActive(b)) return [];
  const mine = (b.functions || []).map((f) => toTime(f.date)).filter((x) => !Number.isNaN(x));
  return clientHistory(b, b.id).filter((o) => {
    if (!isActive(o)) return false;
    const theirs = (o.functions || []).map((f) => toTime(f.date)).filter((x) => !Number.isNaN(x));
    if (!mine.length || !theirs.length) return false;
    return mine.some((x) => theirs.some((y) => Math.abs(x - y) <= days * DAY));
  });
}

// "Whole booking" team members of a one-day booking belong to that day; pin them so that,
// after combining, they don't suddenly cover the other days too.
function pinWholeBooking(b) {
  const fns = b.functions || [];
  for (const a of b.team || []) {
    if (a.functionId) continue;
    if (fns.length === 1) a.functionId = fns[0].id;
    else if (fns.length > 1) a.remarks = [a.remarks, `Was on all of: ${fns.map((f) => f.type).join(', ')}`].filter(Boolean).join(' · ');
  }
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// Move everything from `others` into `target`. Totals and discounts are added up.
export async function combineBookings(target, others) {
  if (!others.length) return target;
  // Keep a copy so the combine can be undone.
  state.meta.lastCombine = {
    at: new Date().toISOString(),
    targetId: target.id,
    before: JSON.parse(JSON.stringify([target, ...others])),
  };
  const all = [target, ...others];
  all.forEach(pinWholeBooking);
  for (const o of others) {
    target.functions = [...(target.functions || []), ...(o.functions || [])];
    target.payments = [...(target.payments || []), ...(o.payments || [])];
    target.expenses = [...(target.expenses || []), ...(o.expenses || [])];
    target.team = [...(target.team || []), ...(o.team || [])];
  }
  target.finalAmount = all.reduce((s, x) => s + num(x.finalAmount), 0);
  target.discount = all.reduce((s, x) => s + num(x.discount), 0);
  target.contact ||= others.find((o) => o.contact)?.contact || '';
  target.city ||= others.find((o) => o.city)?.city || '';
  const packages = uniq(all.map((x) => x.package));
  if (packages.length > 1) target.package = packages[0];
  const notes = uniq(all.map((x) => x.remarks));
  const extra = packages.length > 1 ? `Packages before combining: ${packages.join(', ')}` : '';
  target.remarks = uniq([...notes, extra]).join('\n');
  target.updatedAt = new Date().toISOString();
  const ids = new Set(others.map((o) => o.id));
  state.bookings = state.bookings.filter((x) => !ids.has(x.id));
  state.meta.lastCombine.after = JSON.stringify(target);
  await save('meta');
  await save('bookings');
  return target;
}

// Undo is offered only while the combined booking is untouched, so it can never wipe later changes.
export const canUndoCombine = (b) => state.meta.lastCombine?.targetId === b.id && state.meta.lastCombine.after === JSON.stringify(b);

// Put the bookings back exactly as they were before the last combine.
export async function undoCombine() {
  const lc = state.meta.lastCombine;
  const target = state.bookings.find((x) => x.id === lc?.targetId);
  if (!lc || !target || !canUndoCombine(target)) return false;
  const restored = lc.before;
  const ids = new Set(restored.map((x) => x.id));
  state.bookings = [...state.bookings.filter((x) => !ids.has(x.id)), ...restored];
  delete state.meta.lastCombine;
  await save('meta');
  await save('bookings');
  return true;
}

export const combinedLabel = (b) => (b.functions || []).slice()
  .sort((x, y) => (x.date || '').localeCompare(y.date || ''))
  .map((f) => f.type).join(', ') || firstDate(b);
