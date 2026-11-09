// My own freelance work: jobs where another studio or photographer hires me.
import { state, save, uid } from '../db.js';
import { ICONS, formSheet, confirmSheet, toast } from '../ui.js';
import {
  esc, rs, num, fmtDate, fmtTime, todayISO, ROLES, FUNCTIONS, METHODS, SHIFTS, shiftOf, shiftFromTime, shiftLabel,
  GIG_STATUSES, getGig, gigTotals, gigsSummary, gigClashes,
} from '../util.js';
import { pageHead, dateBox, payBadge } from './parts.js';
import { go, rerender } from '../app.js';

const FILTERS = ['All', 'Pending', 'Upcoming', 'Paid'];
let filter = 'All';

function matches(g, f) {
  const t = gigTotals(g);
  if (f === 'Pending') return t.pending > 0;
  if (f === 'Upcoming') return g.status !== 'Cancelled' && (g.date || '') >= todayISO();
  if (f === 'Paid') return t.payStatus === 'Paid';
  return true;
}

export function gigRow(g) {
  const t = gigTotals(g);
  return `<a class="row" href="#/gig/${encodeURIComponent(g.id)}">
    ${dateBox(g.date)}
    <div class="main">
      <div class="title">${esc(g.hiredBy)}</div>
      <div class="sub">${esc([g.type, g.role, shiftLabel(g)].filter(Boolean).join(' · '))}</div>
      <div class="badges">${g.status === 'Cancelled' ? '<span class="badge bad">Cancelled</span>' : payBadge(t.payStatus)}${g.status === 'Done' ? '<span class="badge ok">Done</span>' : ''}</div>
    </div>
    <div class="end">${t.pending > 0 ? `<strong>${rs(t.pending)}</strong><small>pending</small>` : `<strong>${rs(t.fee)}</strong><small>fee</small>`}</div>
  </a>`;
}

export function renderGigs(view) {
  const gigs = state.gigs || [];
  const sum = gigsSummary();
  const counts = Object.fromEntries(FILTERS.map((f) => [f, gigs.filter((g) => matches(g, f)).length]));
  const list = gigs.filter((g) => matches(g, filter)).sort((a, b) => {
    // pending and upcoming first, then newest
    return (b.date || '').localeCompare(a.date || '');
  });
  view.innerHTML = `
    ${pageHead('My freelance', { backTo: '#/more' })}
    <p class="muted small" style="margin:0 2px 12px">Jobs where another studio or photographer hires you.</p>
    <div class="stats">
      <div class="stat accent wide"><small>Owed to me</small><strong>${rs(sum.pending)}</strong></div>
      <div class="stat"><small>Total earned</small><strong>${rs(sum.earned)}</strong></div>
      <div class="stat"><small>Received</small><strong>${rs(sum.received)}</strong></div>
    </div>
    <div class="chips" role="group" aria-label="Filter">
      ${FILTERS.map((f) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === filter}">${f}<span class="count">${counts[f]}</span></button>`).join('')}
    </div>
    <div class="list mt">${list.length ? list.map(gigRow).join('')
      : `<div class="empty">${gigs.length ? 'No jobs match.' : 'No freelance jobs yet. Tap + when someone hires you.'}</div>`}</div>
    <button type="button" class="fab" data-add aria-label="Add freelance job">${ICONS.plus}</button>
  `;
  view.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; renderGigs(view); });
  view.querySelector('[data-add]').onclick = async () => {
    const g = await editGig();
    if (g) go('#/gig/' + encodeURIComponent(g.id));
  };
}

// Earlier jobs from the same studio, to suggest their usual fee.
function lastFeeFrom(name, excludeId) {
  const key = String(name || '').trim().toLowerCase();
  if (key.length < 2) return null;
  return (state.gigs || []).filter((g) => g.id !== excludeId && String(g.hiredBy || '').trim().toLowerCase() === key)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null;
}

export async function editGig(existing) {
  const g = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit freelance job' : 'New freelance job',
    danger: existing ? 'Delete job' : null,
    fields: [
      { name: 'hiredBy', label: 'Hired by (studio or photographer)', required: true, value: g.hiredBy },
      { name: 'contact', label: 'Their contact no.', type: 'tel', value: g.contact, placeholder: '03xx xxxxxxx' },
      { type: 'html', html: '<p class="hint" data-lastfee style="margin:-4px 0 0"></p>' },
      { name: 'type', label: 'Event', type: 'select', options: FUNCTIONS, value: g.type || 'Barat' },
      { name: 'role', label: 'My role', type: 'select', options: ROLES, value: g.role || 'Photographer' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: g.date || '' },
      { name: 'time', label: 'Reporting time', type: 'time', value: g.time || '' },
      { name: 'shift', label: 'Shift', type: 'select', value: existing ? shiftOf(g) : 'Day',
        options: Object.entries(SHIFTS).map(([value, s]) => ({ value, label: s.label })) },
      { name: 'customStart', label: 'Custom start time', type: 'time', value: g.customStart || '', showIf: { name: 'shift', is: 'Custom' } },
      { name: 'customEnd', label: 'Custom end time', type: 'time', value: g.customEnd || '', showIf: { name: 'shift', is: 'Custom' } },
      { type: 'html', html: '<div class="banner warn" data-gigclash style="margin:0" hidden></div>' },
      { name: 'venue', label: 'Venue', value: g.venue },
      { name: 'fee', label: 'My fee', type: 'money', required: true, value: g.fee ?? '' },
      { name: 'status', label: 'Status', type: 'select', options: GIG_STATUSES, value: g.status || 'Booked' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: g.remarks, placeholder: 'Payment promised by…, gear to bring…' },
    ],
    onMount(form) {
      const el = form.elements;
      let touched = !!existing;
      el.shift.addEventListener('change', () => { touched = true; });
      const clashBox = form.querySelector('[data-gigclash]');
      const feeHint = form.querySelector('[data-lastfee]');
      const checkClash = () => {
        const c = gigClashes({ date: el.date.value, time: el.time.value, shift: el.shift.value, customStart: el.customStart.value, customEnd: el.customEnd.value });
        clashBox.hidden = !c.length;
        clashBox.innerHTML = c.length ? `${ICONS.warn}<div>You have your own booking in this shift: ${c.map(({ booking, fn }) => esc(`${fn.type}, ${booking.clientName}`)).join('; ')}.</div>` : '';
      };
      el.time.addEventListener('change', () => {
        if (!touched) { el.shift.value = shiftFromTime(el.time.value); el.shift.dispatchEvent(new Event('change', { bubbles: true })); touched = false; }
        checkClash();
      });
      ['date', 'shift', 'customStart', 'customEnd'].forEach((n) => el[n].addEventListener('change', checkClash));
      el.hiredBy.addEventListener('input', () => {
        const last = lastFeeFrom(el.hiredBy.value, g.id);
        feeHint.textContent = last ? `Last job with them: ${last.type}, ${fmtDate(last.date)}, fee ${rs(last.fee)}` : '';
        if (last && !existing && !el.contact.value && last.contact) el.contact.value = last.contact;
      });
      checkClash();
    },
  });
  if (!v) return null;
  if (v.__danger) {
    if (!(await confirmSheet({ title: 'Delete this job?', message: `Delete the ${existing.type} job for ${existing.hiredBy} with its payments? This cannot be undone.` }))) return null;
    state.gigs = state.gigs.filter((x) => x.id !== existing.id);
    await save('gigs');
    toast('Job deleted');
    go('#/gigs');
    return null;
  }
  v.fee = num(v.fee);
  if (v.shift !== 'Custom') { v.customStart = ''; v.customEnd = ''; }
  state.gigs ||= [];
  if (existing) {
    Object.assign(existing, v);
    await save('gigs');
    toast('Job saved');
    rerender();
    return existing;
  }
  const ng = { id: uid(), ...v, payments: [] };
  state.gigs.push(ng);
  await save('gigs');
  toast('Freelance job added');
  return ng;
}

export function renderGig(view, id) {
  const g = getGig(id);
  if (!g) {
    view.innerHTML = `${pageHead('Not found', { backTo: '#/gigs' })}<div class="empty">This job does not exist anymore.</div>`;
    return;
  }
  g.payments ||= [];
  const t = gigTotals(g);
  const clashes = gigClashes(g);
  view.innerHTML = `
    ${pageHead(g.hiredBy, { backTo: '#/gigs', actions: `<button type="button" class="icon-btn" data-edit aria-label="Edit job">${ICONS.edit}</button>` })}
    <div class="card pad">
      <div class="detail-top">
        <div class="who">
          <div class="badges" style="margin-top:0">${g.status === 'Cancelled' ? '<span class="badge bad">Cancelled</span>' : payBadge(t.payStatus)}<span class="badge">${esc(g.status || 'Booked')}</span></div>
          <p>${esc([g.type, g.role].filter(Boolean).join(' · '))}</p>
        </div>
        ${g.contact ? `<a class="call" href="tel:${esc(g.contact.replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(g.contact)}</a>` : ''}
      </div>
      <dl class="kv mt">
        <dt>Date</dt><dd>${esc(fmtDate(g.date))}</dd>
        <dt>Shift</dt><dd>${esc(shiftLabel(g))}</dd>
        ${g.time ? `<dt>Reporting</dt><dd>${esc(fmtTime(g.time))}</dd>` : ''}
        ${g.venue ? `<dt>Venue</dt><dd>${esc(g.venue)}</dd>` : ''}
      </dl>
      ${g.remarks ? `<div class="remarks">${esc(g.remarks)}</div>` : ''}
    </div>
    ${clashes.length ? `<div class="banner warn">${ICONS.warn}<div>You also have your own booking in this shift: ${clashes.map(({ booking, fn }) => esc(`${fn.type}, ${booking.clientName}`)).join('; ')}.</div></div>` : ''}

    <div class="stats mt">
      <div class="stat"><small>My fee</small><strong>${rs(t.fee)}</strong></div>
      <div class="stat"><small>Received</small><strong>${rs(t.received)}</strong></div>
      <div class="stat ${t.pending > 0 ? 'accent' : ''} wide"><small>Pending</small><strong>${rs(t.pending)}</strong></div>
    </div>
    ${t.pending > 0 ? `<button type="button" class="btn primary block mt" data-paid>Mark fully paid (${rs(t.pending)})</button>` : ''}

    <section class="section">
      <div class="section-head"><h2>Payments received</h2><button type="button" class="add-btn" data-add-pay>${ICONS.plus}Add</button></div>
      <div class="list">${g.payments.length ? g.payments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((p) => `
        <button type="button" class="row" data-pay="${p.id}">
          <div class="main"><div class="title">${esc(p.method || 'Payment')}</div><div class="sub">${esc(fmtDate(p.date))}${p.remarks ? ' · ' + esc(p.remarks) : ''}</div></div>
          <div class="end"><strong>${rs(p.amount)}</strong></div>
        </button>`).join('') : `<div class="empty">Nothing received yet.</div>`}</div>
    </section>
  `;
  const $ = (s) => view.querySelector(s);
  $('[data-edit]').onclick = () => editGig(g);
  $('[data-add-pay]').onclick = () => editGigPayment(g);
  view.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => editGigPayment(g, g.payments.find((p) => p.id === b.dataset.pay)));
  const paid = $('[data-paid]');
  if (paid) paid.onclick = async () => {
    g.payments.push({ id: uid(), amount: t.pending, date: todayISO(), method: 'Cash', remarks: 'Marked fully paid' });
    if (g.status === 'Booked' && (g.date || '') <= todayISO()) g.status = 'Done';
    await save('gigs');
    toast(`${g.hiredBy} paid in full`);
    rerender();
  };
}

async function editGigPayment(g, existing) {
  const p = existing || {};
  const t = gigTotals(g);
  const v = await formSheet({
    title: existing ? 'Edit payment' : 'Payment received',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, value: p.amount ?? '', hint: !existing && t.pending > 0 ? `Pending: ${rs(t.pending)}` : '' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: p.date || todayISO() },
      { name: 'method', label: 'Method', type: 'select', options: METHODS, value: p.method || 'Cash' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: p.remarks },
    ],
  });
  if (!v) return;
  if (v.__danger) {
    if (!(await confirmSheet({ title: 'Delete payment?', message: `Delete payment of ${rs(existing.amount)} on ${fmtDate(existing.date)}?` }))) return;
    g.payments = g.payments.filter((x) => x.id !== existing.id);
    await save('gigs'); toast('Payment deleted'); rerender();
    return;
  }
  v.amount = num(v.amount);
  if (v.amount <= 0) { toast('Amount must be more than 0', 'bad'); return; }
  if (existing) Object.assign(existing, v);
  else g.payments.push({ id: uid(), ...v });
  await save('gigs');
  toast(existing ? 'Payment saved' : 'Payment added');
  rerender();
}
