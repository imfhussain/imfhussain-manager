import { state, save, uid } from '../db.js';
import { ICONS, formSheet, confirmSheet, actionSheet, toast } from '../ui.js';
import {
  esc, rs, num, fmtDate, fmtTime, todayISO, bookingTotals, teamStatus, getBooking, getFreelancer, firstDate,
  PACKAGES_FIXED, STATUSES, FUNCTIONS, METHODS, EXPENSE_CATS,
  SHIFTS, shiftOf, shiftFromTime, shiftLabel, busyConflicts, allTeamClashes, clashText, assignmentSlots, clientHistory,
} from '../util.js';
import { openFunction } from './moodboard.js';
import { pageHead, bookingRow, statusBadge, payBadge, historyHTML } from './parts.js';
import { go, rerender } from '../app.js';
import { editFreelancer, importButtonsHTML, bindImport } from './team.js';
import { waButton, waSheet, waNumber, clientConfirmMessage, clientReminderMessage, clientReceiptMessage, freelancerJobMessage } from '../whatsapp.js';

// ================= List =================
const FILTERS = ['All', 'Dues', 'Booked', 'Editing', 'Delivered', 'Inquiry'];
let filter = 'All';
let query = '';

function matchesFilter(b, f) {
  if (f === 'All') return true;
  if (f === 'Dues') return b.status !== 'Cancelled' && b.status !== 'Inquiry' && bookingTotals(b).due > 0;
  return b.status === f;
}

function matchesQuery(b, q) {
  if (!q) return true;
  const hay = [b.clientName, b.contact, b.city, b.package, b.remarks, ...(b.functions || []).flatMap((f) => [f.type, f.venue])]
    .join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function sortBookings(list) {
  const today = todayISO();
  const key = (b) => {
    const d = firstDate(b);
    if (!d) return [2, ''];
    // upcoming (any function today or later) first, soonest first; then past, newest first
    const next = (b.functions || []).map((f) => f.date).filter((x) => x && x >= today).sort()[0];
    return next ? [0, next] : [1, d];
  };
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[0] === 1 ? kb[1].localeCompare(ka[1]) : ka[1].localeCompare(kb[1]);
  });
}

export function renderBookings(view) {
  const counts = Object.fromEntries(FILTERS.map((f) => [f, state.bookings.filter((b) => matchesFilter(b, f)).length]));
  view.innerHTML = `
    ${pageHead('Bookings')}
    <label class="search">${ICONS.search}<span class="sr-only">Search bookings</span>
      <input type="search" placeholder="Search name, phone, city, venue" value="${esc(query)}" data-q></label>
    <div class="chips" role="group" aria-label="Filter">
      ${FILTERS.map((f) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === filter}">${f}<span class="count">${counts[f]}</span></button>`).join('')}
    </div>
    <div class="list mt" data-list></div>
    <button type="button" class="fab" data-add aria-label="Add booking">${ICONS.plus}</button>
  `;
  const listEl = view.querySelector('[data-list]');
  const draw = () => {
    const items = sortBookings(state.bookings.filter((b) => matchesFilter(b, filter) && matchesQuery(b, query)));
    listEl.innerHTML = items.length ? items.map(bookingRow).join('')
      : `<div class="empty">${state.bookings.length ? 'No bookings match.' : 'No bookings yet. Tap + to add your first booking.'}</div>`;
  };
  draw();
  view.querySelector('[data-q]').addEventListener('input', (e) => { query = e.target.value; draw(); });
  view.querySelectorAll('[data-f]').forEach((btn) => btn.addEventListener('click', () => {
    filter = btn.dataset.f;
    view.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    draw();
  }));
  view.querySelector('[data-add]').addEventListener('click', async () => {
    const b = await editBooking();
    if (b) go('#/booking/' + encodeURIComponent(b.id));
  });
}

// ================= Booking form =================
export async function editBooking(existing) {
  const b = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit booking' : 'New booking',
    danger: existing ? 'Delete booking' : null,
    fields: [
      ...(existing ? [] : [{ type: 'html', html: importButtonsHTML() }]),
      { name: 'clientName', label: 'Client name', required: true, value: b.clientName },
      { name: 'contact', label: 'Contact no.', type: 'tel', value: b.contact, placeholder: '03xx xxxxxxx' },
      { type: 'html', html: `<div data-history>${historyHTML(clientHistory(b, b.id))}</div>` },
      { name: 'city', label: 'City', value: b.city },
      { name: 'package', label: 'Package', type: 'select', options: PACKAGES_FIXED, value: b.package || 'The Classic' },
      { name: 'status', label: 'Status', type: 'select', options: STATUSES, value: b.status || 'Booked' },
      { name: 'finalAmount', label: 'Final amount', type: 'money', value: b.finalAmount ?? '', hint: 'What the client will pay in total' },
      { name: 'discount', label: 'Discount given', type: 'money', value: b.discount ?? '' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: b.remarks },
    ],
    onMount(form) {
      if (!existing) bindImport(form, { nameField: 'clientName' });
      // Show the client's earlier bookings while typing the name or number.
      const box = form.querySelector('[data-history]');
      let t;
      const update = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const list = clientHistory({ clientName: form.elements.clientName.value, contact: form.elements.contact.value }, b.id);
          box.innerHTML = historyHTML(list);
          box.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
        }, 250);
      };
      form.elements.clientName.addEventListener('input', update);
      form.elements.contact.addEventListener('input', update);
      box.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
    },
  });
  if (!v) return null;
  if (v.__danger) {
    if (await deleteBooking(existing)) go('#/bookings');
    return null;
  }
  v.finalAmount = num(v.finalAmount);
  v.discount = num(v.discount);
  if (existing) {
    Object.assign(existing, v, { updatedAt: new Date().toISOString() });
    await save('bookings');
    toast('Booking saved');
    rerender();
    return existing;
  }
  const nb = { id: uid(), ...v, functions: [], payments: [], team: [], expenses: [], createdAt: new Date().toISOString() };
  state.bookings.push(nb);
  await save('bookings');
  toast('Booking added');
  return nb;
}

async function deleteBooking(b) {
  const ok = await confirmSheet({
    title: 'Delete booking?',
    message: `This will delete ${b.clientName}'s booking with all its functions, payments, team and expenses. This cannot be undone.`,
  });
  if (!ok) return false;
  state.bookings = state.bookings.filter((x) => x.id !== b.id);
  await save('bookings');
  toast('Booking deleted');
  return true;
}

// ================= Detail =================
export function renderBooking(view, id) {
  const b = getBooking(id);
  if (!b) {
    view.innerHTML = `${pageHead('Not found', { backTo: '#/bookings' })}<div class="empty">This booking does not exist anymore.</div>`;
    return;
  }
  b.functions ||= []; b.payments ||= []; b.team ||= []; b.expenses ||= [];
  const t = bookingTotals(b);
  const fns = b.functions.slice().sort((x, y) => ((x.date || '') + (x.time || '')).localeCompare((y.date || '') + (y.time || '')));

  view.innerHTML = `
    ${pageHead(b.clientName, { backTo: '#/bookings', actions: `<button type="button" class="icon-btn" data-edit aria-label="Edit booking">${ICONS.edit}</button>` })}

    <div class="card pad">
      <div class="detail-top">
        <div class="who">
          <div class="badges" style="margin-top:0">${statusBadge(b.status)}${payBadge(t.payStatus)}</div>
          <p>${esc([b.package, b.city].filter(Boolean).join(' · '))}</p>
        </div>
        ${b.contact ? `<div class="contact-btns"><a class="call" href="tel:${esc(b.contact.replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(b.contact)}</a>${waButton(b.contact)}</div>` : ''}
      </div>
      ${b.remarks ? `<div class="remarks">${esc(b.remarks)}</div>` : ''}
    </div>

    <div class="stats mt">
      <div class="stat"><small>Total</small><strong>${rs(t.total)}</strong></div>
      <div class="stat"><small>Received</small><strong>${rs(t.received)}</strong></div>
      <div class="stat"><small>Due</small><strong class="${t.due > 0 ? 'neg' : ''}">${rs(t.due)}</strong></div>
      <div class="stat"><small>Team cost</small><strong>${rs(t.teamCost)}</strong></div>
      <div class="stat"><small>Expenses</small><strong>${rs(t.expenses)}</strong></div>
      <div class="stat"><small>Profit</small><strong class="${t.profit >= 0 ? 'pos' : 'neg'}">${rs(t.profit)}</strong></div>
    </div>
    ${num(b.discount) ? `<p class="muted small" style="margin:8px 2px 0">Discount given: ${rs(b.discount)}</p>` : ''}

    ${(() => { const h = clientHistory(b, b.id); return h.length ? `<section class="section">${historyHTML(h, { title: 'Client history' })}</section>` : ''; })()}
    ${bookingClashes(b).map((c) => `<div class="banner bad">${ICONS.warn}<div>${esc(clashText(c))}</div></div>`).join('')}

    <section class="section">
      <div class="section-head"><h2>Functions</h2><button type="button" class="add-btn" data-add-fn>${ICONS.plus}Add</button></div>
      <div class="list">${fns.length ? fns.map((f) => fnRow(b, f)).join('') : `<div class="empty">No functions yet. Add Mehndi, Barat, Walima and others.</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Client payments</h2><button type="button" class="add-btn" data-add-pay>${ICONS.plus}Add</button></div>
      <div class="list">${b.payments.length ? b.payments.slice().sort((x, y) => (y.date || '').localeCompare(x.date || '')).map((p) => `
        <button type="button" class="row" data-pay="${p.id}">
          <div class="main"><div class="title">${esc(p.method || 'Payment')}</div><div class="sub">${esc(fmtDate(p.date))}${p.remarks ? ' · ' + esc(p.remarks) : ''}</div></div>
          <div class="end"><strong>${rs(p.amount)}</strong></div>
        </button>`).join('') : `<div class="empty">No payments received yet.</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Team</h2><button type="button" class="add-btn" data-add-team>${ICONS.plus}Assign</button></div>
      <div class="list">${b.team.length ? b.team.map((a) => teamRow(b, a)).join('') : `<div class="empty">No team assigned yet.</div>`}</div>
      ${b.team.length ? `<p class="muted small" style="margin:8px 2px 0">Paid ${rs(t.teamPaid)} of ${rs(t.teamCost)} · Pending ${rs(t.teamPending)}</p>` : ''}
    </section>

    <section class="section">
      <div class="section-head"><h2>Expenses</h2><button type="button" class="add-btn" data-add-exp>${ICONS.plus}Add</button></div>
      <div class="list">${b.expenses.length ? b.expenses.slice().sort((x, y) => (y.date || '').localeCompare(x.date || '')).map((e) => `
        <button type="button" class="row" data-exp="${e.id}">
          <div class="main"><div class="title">${esc(e.category)}</div><div class="sub">${esc(fmtDate(e.date))}${e.remarks ? ' · ' + esc(e.remarks) : ''}</div></div>
          <div class="end"><strong>${rs(e.amount)}</strong></div>
        </button>`).join('') : `<div class="empty">No expenses yet.</div>`}</div>
    </section>

    <div class="section"><button type="button" class="btn danger-ghost block" data-del>Delete booking</button></div>
  `;

  const $ = (s) => view.querySelector(s);
  $('[data-edit]').onclick = () => editBooking(b);
  $('[data-del]').onclick = async () => { if (await deleteBooking(b)) go('#/bookings'); };
  $('[data-add-fn]').onclick = () => editFunction(b);
  $('[data-add-pay]').onclick = () => editPayment(b);
  $('[data-add-team]').onclick = () => editAssignment(b);
  $('[data-add-exp]').onclick = () => editExpense(b);
  view.querySelectorAll('[data-fn]').forEach((el) => el.onclick = () => openFunction(b, b.functions.find((x) => x.id === el.dataset.fn)));
  view.querySelectorAll('[data-pay]').forEach((el) => el.onclick = () => editPayment(b, b.payments.find((x) => x.id === el.dataset.pay)));
  view.querySelectorAll('[data-exp]').forEach((el) => el.onclick = () => editExpense(b, b.expenses.find((x) => x.id === el.dataset.exp)));
  const wa = view.querySelector('[data-wa]');
  if (wa) wa.onclick = () => waSheet(`WhatsApp ${b.clientName}`, b.contact, [
    { label: 'Booking confirmation', text: clientConfirmMessage(b) },
    t.due > 0 && t.total > 0 ? { label: `Payment reminder (${rs(t.due)} due)`, text: clientReminderMessage(b) } : null,
    (b.payments || []).length ? { label: 'Receipt for last payment', text: clientReceiptMessage(b) } : null,
  ]);
  view.querySelectorAll('[data-team]').forEach((el) => el.onclick = () => teamActions(b, b.team.find((x) => x.id === el.dataset.team)));
}

function assignedCount(b, fnId) {
  return b.team.filter((a) => a.functionId === fnId || !a.functionId).length;
}

function fnRow(b, f) {
  const needed = num(f.teamNeeded);
  const have = assignedCount(b, f.id);
  const names = b.team.filter((a) => a.functionId === f.id || !a.functionId).map((a) => getFreelancer(a.freelancerId)?.name || 'Unknown');
  const sub = [shiftLabel(f), fmtTime(f.time) && 'Report ' + fmtTime(f.time), f.venue].filter(Boolean).join(' · ');
  const extras = [f.instructions && 'Instructions', (f.moodImages || []).length && `${f.moodImages.length} mood photo${f.moodImages.length > 1 ? 's' : ''}`, f.pinterest && 'Pinterest board'].filter(Boolean);
  let teamLine;
  if (needed && have < needed) teamLine = `<span class="shortage">Team ${have} of ${needed} · ${needed - have} missing</span>`;
  else if (names.length) teamLine = `Team: ${esc(names.join(', '))}${needed ? ` (${have}/${needed})` : ''}`;
  else teamLine = `<span class="shortage">No team assigned</span>`;
  return `<button type="button" class="row" data-fn="${f.id}">
    <div class="main">
      <div class="title">${esc(f.type)} <span class="muted" style="font-weight:400">· ${esc(fmtDate(f.date))}</span></div>
      <div class="sub">${esc(sub || 'Venue and time not set')}</div>
      <div class="sub">${teamLine}</div>
      ${f.deliverables ? `<div class="sub">Deliverables: ${esc(f.deliverables)}</div>` : ''}
      ${extras.length ? `<div class="badges">${extras.map((x) => `<span class="badge accent">${esc(x)}</span>`).join('')}</div>` : ''}
    </div>
    <span class="chev">${ICONS.chevron}</span>
  </button>`;
}

function teamRow(b, a) {
  const f = getFreelancer(a.freelancerId);
  const fn = b.functions.find((x) => x.id === a.functionId);
  const st = teamStatus(a);
  return `<button type="button" class="row" data-team="${a.id}">
    <div class="main">
      <div class="title">${esc(f ? f.name : 'Deleted freelancer')}</div>
      <div class="sub">${esc([f?.role, fn ? fn.type : 'Whole booking'].filter(Boolean).join(' · '))}</div>
      <div class="sub">Paid ${rs(a.paid)} of ${rs(a.agreed)}${a.paidDate ? ' · ' + esc(fmtDate(a.paidDate)) : ''}</div>
    </div>
    <div class="end"><span class="badge ${st === 'Cleared' ? 'ok' : 'warn'}">${st}</span></div>
  </button>`;
}

// ================= Sub-forms =================
async function editFunction(b, existing) {
  const f = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit function' : 'Add function',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'type', label: 'Function', type: 'select', options: FUNCTIONS, value: f.type || 'Mehndi' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: f.date || '' },
      { name: 'time', label: 'Reporting time', type: 'time', value: f.time || '' },
      { name: 'shift', label: 'Shift (shoot time included)', type: 'select', value: existing ? shiftOf(f) : 'Day',
        options: Object.entries(SHIFTS).map(([value, s]) => ({ value, label: s.label })),
        hint: 'Set from the reporting time. The same freelancer cannot be in two places in the same shift.' },
      { name: 'customStart', label: 'Custom start time', type: 'time', value: f.customStart || f.time || '', showIf: { name: 'shift', is: 'Custom' } },
      { name: 'customEnd', label: 'Custom end time', type: 'time', value: f.customEnd || '', showIf: { name: 'shift', is: 'Custom' } },
      { name: 'venue', label: 'Venue', value: f.venue },
      { name: 'teamNeeded', label: 'Team needed (people)', type: 'number', value: f.teamNeeded ?? '', hint: 'How many photographers and videographers the client wants. Leave empty if not sure.' },
      { name: 'deliverables', label: 'Deliverables note', type: 'textarea', value: f.deliverables },
      { name: 'instructions', label: 'Instructions for the team', type: 'textarea', value: f.instructions, placeholder: 'Dress code, must-have shots, family names, timings…' },
      { name: 'pinterest', label: 'Pinterest mood board link', type: 'url', value: f.pinterest, placeholder: 'https://pinterest.com/…/board-name/' },
    ],
    onMount(form) {
      // Follow the reporting time until the shift is picked by hand.
      let touched = !!existing;
      form.elements.shift.addEventListener('change', () => { touched = true; });
      form.elements.time.addEventListener('change', () => {
        if (touched) return;
        form.elements.shift.value = shiftFromTime(form.elements.time.value);
        form.elements.shift.dispatchEvent(new Event('change', { bubbles: true }));
        touched = false;
      });
    },
  });
  if (!v) return;
  if (v.__danger) {
    const linked = b.team.filter((a) => a.functionId === existing.id).length;
    const ok = await confirmSheet({
      title: 'Delete function?',
      message: `Delete ${existing.type} on ${fmtDate(existing.date)}?${linked ? ` ${linked} team assignment(s) for it will be moved to "Whole booking".` : ''}`,
    });
    if (!ok) return;
    b.functions = b.functions.filter((x) => x.id !== existing.id);
    b.team.forEach((a) => { if (a.functionId === existing.id) a.functionId = ''; });
    await save('bookings'); toast('Function deleted'); rerender();
    return;
  }
  v.teamNeeded = v.teamNeeded === '' ? '' : Math.max(0, Math.round(num(v.teamNeeded)));
  if (v.shift !== 'Custom') { v.customStart = ''; v.customEnd = ''; }
  let fnObj = existing;
  if (existing) Object.assign(existing, v);
  else { fnObj = { id: uid(), ...v, moodImages: [] }; b.functions.push(fnObj); }
  await save('bookings');
  const clash = allTeamClashes().find((c) => c.a.fn === fnObj || c.b.fn === fnObj);
  if (clash) toast('Team clash: ' + clash.freelancer.name + ' is booked at 2 places', 'bad');
  else toast(existing ? 'Function saved' : 'Function added');
  rerender();
}

export { editFunction };

function bookingClashes(b) {
  return allTeamClashes().filter((c) => c.a.booking === b || c.b.booking === b);
}

async function editPayment(b, existing) {
  const p = existing || {};
  const due = bookingTotals(b).due;
  const v = await formSheet({
    title: existing ? 'Edit payment' : 'Add client payment',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'amount', label: 'Amount', type: 'money', required: true, value: p.amount ?? '', hint: !existing && due > 0 ? `Due now: ${rs(due)}` : '' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: p.date || todayISO() },
      { name: 'method', label: 'Method', type: 'select', options: METHODS, value: p.method || 'Cash' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: p.remarks, placeholder: 'Advance, second payment…' },
    ],
  });
  if (!v) return;
  if (v.__danger) {
    if (!(await confirmSheet({ title: 'Delete payment?', message: `Delete payment of ${rs(existing.amount)} on ${fmtDate(existing.date)}?` }))) return;
    b.payments = b.payments.filter((x) => x.id !== existing.id);
    await save('bookings'); toast('Payment deleted'); rerender();
    return;
  }
  v.amount = num(v.amount);
  if (v.amount <= 0) { toast('Amount must be more than 0', 'bad'); return; }
  if (existing) Object.assign(existing, v);
  else b.payments.push({ id: uid(), ...v });
  await save('bookings');
  toast(existing ? 'Payment saved' : 'Payment added');
  rerender();
}

async function editExpense(b, existing) {
  const e = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit expense' : 'Add expense',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATS, value: e.category || 'Album Printing' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, value: e.amount ?? '' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: e.date || todayISO() },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: e.remarks },
    ],
  });
  if (!v) return;
  if (v.__danger) {
    if (!(await confirmSheet({ title: 'Delete expense?', message: `Delete ${existing.category} expense of ${rs(existing.amount)}?` }))) return;
    b.expenses = b.expenses.filter((x) => x.id !== existing.id);
    await save('bookings'); toast('Expense deleted'); rerender();
    return;
  }
  v.amount = num(v.amount);
  if (existing) Object.assign(existing, v);
  else b.expenses.push({ id: uid(), ...v });
  await save('bookings');
  toast(existing ? 'Expense saved' : 'Expense added');
  rerender();
}

async function teamActions(b, a) {
  const pending = num(a.agreed) - num(a.paid);
  const name = getFreelancer(a.freelancerId)?.name || 'freelancer';
  const choice = await actionSheet(name, [
    ...(pending > 0 ? [{ label: `Mark fully paid (${rs(pending)} left)`, value: 'pay' }] : []),
    { label: 'Edit assignment', value: 'edit' },
    ...(waNumber(getFreelancer(a.freelancerId)?.contact) ? [{ label: 'WhatsApp job details', value: 'wa' }] : []),
    ...(a.freelancerId && getFreelancer(a.freelancerId) ? [{ label: 'Open freelancer', value: 'open' }] : []),
  ]);
  if (choice === 'wa') {
    const f = getFreelancer(a.freelancerId);
    waSheet(`WhatsApp ${f.name}`, f.contact, [{ label: `Job details: ${b.clientName}`, text: freelancerJobMessage(b, a) }]);
    return;
  }
  if (choice === 'pay') {
    a.paid = num(a.agreed); a.paidDate = todayISO();
    await save('bookings'); toast(`${name} marked as paid`); rerender();
  } else if (choice === 'edit') editAssignment(b, a);
  else if (choice === 'open') go('#/freelancer/' + encodeURIComponent(a.freelancerId));
}

export async function editAssignment(b, existing) {
  if (!state.freelancers.length) {
    const ok = await confirmSheet({ title: 'No freelancers yet', message: 'Add a freelancer to your team first, then assign them here.', ok: 'Add freelancer', danger: false });
    if (!ok) return;
    const f = await editFreelancer();
    if (!f) return;
  }
  const a = existing || {};
  const sorted = state.freelancers.slice().sort((x, y) => x.name.localeCompare(y.name));
  const fnOpts = [
    ...b.functions.slice().sort((x, y) => (x.date || '').localeCompare(y.date || '')).map((f) => ({ value: f.id, label: `${f.type} · ${fmtDate(f.date)} · ${shiftLabel(f)}` })),
    { value: '', label: 'Whole booking (all functions)' },
  ];
  const targetsFor = (fnId) => assignmentSlots(b, { functionId: fnId });
  const conflictsFor = (fid, fnId) => busyConflicts(fid, targetsFor(fnId), { skipAssignmentId: a.id });
  const startFn = existing ? (a.functionId || '') : fnOpts[0].value;
  const firstF = getFreelancer(a.freelancerId) || sorted.find((f) => !conflictsFor(f.id, startFn).length) || sorted[0];
  const optLabel = (f, fnId) => {
    const c = conflictsFor(f.id, fnId);
    const tag = !c.length ? '✓ Free' : c.every((x) => x.same) ? '• Already here' : '✗ Busy';
    return `${tag} · ${f.name} · ${f.role}`;
  };
  const busyHTML = (fid, fnId) => {
    const c = conflictsFor(fid, fnId);
    if (!c.length) return '';
    return `${ICONS.warn}<div>${c.map((x) => esc(x.same
      ? `Already assigned to ${x.fn.type} for ${x.booking.clientName}.`
      : `Busy on ${fmtDate(x.fn.date)}: ${x.fn.type}, ${x.booking.clientName} (${shiftLabel(x.fn)}).`)).join('<br>')}</div>`;
  };
  const v = await formSheet({
    title: existing ? 'Edit team assignment' : 'Assign team',
    danger: existing ? 'Remove' : null,
    fields: [
      { name: 'functionId', label: 'Function', type: 'select', options: fnOpts, value: startFn },
      { name: 'freelancerId', label: 'Freelancer', type: 'select', options: sorted.map((f) => ({ value: f.id, label: optLabel(f, startFn) })), value: firstF.id },
      { type: 'html', html: `<div class="banner bad" data-busy style="margin:0"${busyHTML(firstF.id, startFn) ? '' : ' hidden'}>${busyHTML(firstF.id, startFn)}</div>` },
      { name: 'agreed', label: 'Agreed amount', type: 'money', required: true, value: a.agreed ?? firstF.rate ?? '', hint: existing ? '' : "Filled with the freelancer's usual day rate" },
      { name: 'paid', label: 'Paid so far', type: 'money', value: a.paid ?? 0 },
      { name: 'paidDate', label: 'Paid date', type: 'date', value: a.paidDate || '' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: a.remarks },
    ],
    onMount(form) {
      const el = form.elements;
      const busyEl = form.querySelector('[data-busy]');
      const refresh = () => {
        [...el.freelancerId.options].forEach((o) => { const f = getFreelancer(o.value); if (f) o.textContent = optLabel(f, el.functionId.value); });
        const h = busyHTML(el.freelancerId.value, el.functionId.value);
        busyEl.innerHTML = h; busyEl.hidden = !h;
      };
      el.functionId.addEventListener('change', refresh);
      el.freelancerId.addEventListener('change', () => {
        refresh();
        if (existing) return;
        const f = getFreelancer(el.freelancerId.value);
        if (f) el.agreed.value = num(f.rate) ? num(f.rate).toLocaleString('en-US') : '';
      });
    },
  });
  if (!v) return;
  if (v.__danger) {
    if (!(await confirmSheet({ title: 'Remove from team?', message: `Remove ${firstF.name} from this booking? Their payment record for it will be deleted too.`, ok: 'Remove' }))) return;
    b.team = b.team.filter((x) => x.id !== existing.id);
    await save('bookings'); toast('Removed from team'); rerender();
    return;
  }
  // Stop double booking: same freelancer, same date, same shift.
  const clash = conflictsFor(v.freelancerId, v.functionId);
  if (clash.length) {
    const who = getFreelancer(v.freelancerId).name;
    const c = clash[0];
    const ok = await confirmSheet({
      title: `${who} is busy`,
      message: c.same
        ? `${who} is already assigned to ${c.fn.type} for ${c.booking.clientName}. Assign again anyway?`
        : `${who} is already booked on ${fmtDate(c.fn.date)} for ${c.fn.type}, ${c.booking.clientName} (${shiftLabel(c.fn)}). One person cannot be at two places in the same shift.${clash.length > 1 ? ` (${clash.length} clashes in total.)` : ''}`,
      ok: 'Assign anyway',
    });
    if (!ok) return;
  }
  v.agreed = num(v.agreed);
  v.paid = num(v.paid);
  if (v.paid > 0 && !v.paidDate) v.paidDate = todayISO();
  if (existing) Object.assign(existing, v);
  else b.team.push({ id: uid(), ...v });
  await save('bookings');
  toast(clash.length ? 'Assigned, but there is a team clash' : existing ? 'Assignment saved' : 'Team member assigned', clash.length ? 'bad' : 'ok');
  rerender();
}
