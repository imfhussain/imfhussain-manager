// Assign one freelancer to an event from the Team page:
// 1) pick the event (booking), 2) tick the days, with one base fee that every day can change.
import { state, save, uid } from './db.js';
import { formSheet, confirmSheet, actionSheet, toast } from './ui.js';
import { rs, num, fmtDate, todayISO, shiftLabel, isActive, busyConflicts } from './util.js';
import { combinedLabel } from './merge.js';

const byDate = (x, y) => (x.date || '').localeCompare(y.date || '');
const days = (b) => (b.functions || []).slice().sort(byDate);

// Events that still have a day today or later (or no date yet), soonest first.
function upcomingEvents() {
  const today = todayISO();
  return state.bookings
    .filter((b) => isActive(b) && (b.functions || []).length)
    .map((b) => ({ b, next: days(b).find((f) => !f.date || f.date >= today) }))
    .filter((x) => x.next)
    .sort((x, y) => (x.next.date || '9').localeCompare(y.next.date || '9'))
    .map((x) => x.b);
}

// Is this freelancer already on this day of this booking (own day or "whole booking")?
const alreadyOn = (b, fid, fnId) => (b.team || []).some((a) => a.freelancerId === fid && (!a.functionId || a.functionId === fnId));

export async function assignToEvent(f) {
  const events = upcomingEvents();
  if (!events.length) { toast('No upcoming events', 'bad'); return false; }
  const b = await actionSheet(`Assign ${f.name} to…`, events.map((e) => ({
    label: `${e.clientName} · ${combinedLabel(e)} · ${fmtDate(days(e)[0].date)}`, value: e,
  })));
  if (!b) return false;
  return pickDays(f, b);
}

async function pickDays(f, b) {
  const list = days(b);
  const base = num(f.rate);
  const status = (fn) => {
    if (alreadyOn(b, f.id, fn.id)) return 'already assigned';
    const c = busyConflicts(f.id, [fn]).filter((x) => x.booking !== b);
    return c.length ? `✗ busy: ${c[0].booking.clientName}` : '✓ free';
  };
  const open = list.filter((fn) => !alreadyOn(b, f.id, fn.id));
  if (!open.length) { toast(`${f.name} is already on every day`); return false; }

  const v = await formSheet({
    title: b.clientName,
    submitLabel: 'Assign',
    fields: [
      { type: 'note', label: `${f.name} · ${f.role}. Tick the days, then change any day's fee if needed.` },
      { name: 'base', label: 'Base fee per day', type: 'money', value: base || '' },
      { name: 'all', label: 'All dates of this event', type: 'checkbox', value: true },
      ...list.flatMap((fn) => [
        { name: 'd_' + fn.id, type: 'checkbox', value: !alreadyOn(b, f.id, fn.id), label: `${fn.type} · ${fmtDate(fn.date)} · ${shiftLabel(fn)} — ${status(fn)}` },
        { name: 'fee_' + fn.id, label: `Fee for ${fn.type}`, type: 'money', value: base || '' },
      ]),
    ],
    onMount(form) {
      const el = form.elements;
      const edited = new Set(); // days whose fee was typed by hand keep their own value
      const sync = () => {
        for (const fn of list) {
          const box = el['d_' + fn.id];
          const fee = el['fee_' + fn.id].closest('.field');
          if (alreadyOn(b, f.id, fn.id)) { box.checked = false; box.disabled = true; fee.hidden = true; continue; }
          fee.hidden = !box.checked;
        }
        el.all.checked = open.every((fn) => el['d_' + fn.id].checked);
      };
      el.all.addEventListener('change', () => {
        open.forEach((fn) => { el['d_' + fn.id].checked = el.all.checked; });
        sync();
      });
      open.forEach((fn) => {
        el['d_' + fn.id].addEventListener('change', sync);
        el['fee_' + fn.id].addEventListener('input', () => edited.add(fn.id));
      });
      el.base.addEventListener('input', () => {
        open.forEach((fn) => { if (!edited.has(fn.id)) el['fee_' + fn.id].value = el.base.value; });
      });
      sync();
    },
  });
  if (!v) return false;
  const chosen = open.filter((fn) => v['d_' + fn.id]);
  if (!chosen.length) { toast('No day selected', 'bad'); return false; }

  const clashes = chosen.flatMap((fn) => busyConflicts(f.id, [fn]).filter((x) => x.booking !== b));
  if (clashes.length) {
    const c = clashes[0];
    const ok = await confirmSheet({
      title: `${f.name} is busy`,
      message: `Already booked on ${fmtDate(c.fn.date)} for ${c.fn.type}, ${c.booking.clientName} (${shiftLabel(c.fn)}).${clashes.length > 1 ? ` (${clashes.length} clashes.)` : ''} Assign anyway?`,
      ok: 'Assign anyway', danger: false,
    });
    if (!ok) return false;
  }
  b.team ||= [];
  for (const fn of chosen) {
    b.team.push({ id: uid(), freelancerId: f.id, functionId: fn.id, agreed: num(v['fee_' + fn.id]), paid: 0, paidDate: '', remarks: '' });
  }
  b.updatedAt = new Date().toISOString();
  await save('bookings');
  const total = chosen.reduce((s, fn) => s + num(v['fee_' + fn.id]), 0);
  toast(`${f.name}: ${chosen.length} day${chosen.length === 1 ? '' : 's'} · ${rs(total)}`);
  return true;
}
