import { state, save, uid } from '../db.js';
import { ICONS, formSheet, confirmSheet, actionSheet, toast } from '../ui.js';
import {
  esc, rs, num, fmtDate, fmtTime, todayISO, isoDate, bookingTotals, teamStatus, teamPayState, jobIsDue, getBooking, getFreelancer, firstDate,
  PACKAGES_FIXED, STATUSES, FUNCTIONS, METHODS, EXPENSE_CATS,
  SHIFTS, shiftOf, shiftFromTime, shiftLabel, busyConflicts, allFunctions, fnsOverlap, dayTeamStatus, itemDays, itemOnDay, needsBooking, allTeamClashes, clashText, assignmentSlots, clientHistory,
} from '../util.js';
import { openFunction } from './moodboard.js';
import { pageHead, bookingRow, statusBadge, payBadge, historyHTML } from './parts.js';
import { go, rerender } from '../app.js';
import { editFreelancer, importButtonsHTML, bindImport } from './team.js';
import { sameEventCandidates, combineBookings, canUndoCombine, undoCombine, combinedLabel } from '../merge.js';
import { journeyCard, sendTerms, markTermsAgreed, markDelivered, rateTeam, ratingBadge, editTeamNeeded } from './journey.js';
import { terms, advancePct, pastJob, freelancerRating } from '../studio.js';
import { waOf, waLink, freelancerEventMessage, waButton, waSheet, waNumber, clientConfirmMessage, clientTermsMessage, clientReminderMessage, clientReceiptMessage, freelancerJobMessage } from '../whatsapp.js';

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
    if (!b) return;
    go('#/booking/' + encodeURIComponent(b.id));
    addDaysFlow(b);
  });
}

// ================= Booking form =================
export async function editBooking(existing, { confirmSave = false } = {}) {
  const b = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit booking' : 'New booking',
    danger: existing ? 'Delete booking' : null,
    fields: [
      ...(existing ? [] : [{ type: 'html', html: importButtonsHTML() }]),
      { name: 'clientName', label: 'Client name', required: true, value: b.clientName },
      { name: 'contact', label: 'Contact no.', type: 'tel', value: b.contact, placeholder: '03xx xxxxxxx' },
      { name: 'whatsapp', label: 'WhatsApp no. (if different)', type: 'tel', value: b.whatsapp, placeholder: 'Leave empty if same number' },
      { type: 'html', html: `<div data-history>${historyHTML(clientHistory(b, b.id))}</div>` },
      { name: 'city', label: 'City', value: b.city },
      { name: 'status', label: 'Status', type: 'select', options: STATUSES, value: b.status || 'Inquiry', hint: existing ? '' : 'Stays "Inquiry" until the advance comes. It changes to "Booked" by itself when you add the advance.' },
      { name: 'finalAmount', label: 'Agreed price (package)', type: 'money', value: b.finalAmount ?? '', hint: 'Equipment the client pays for separately is added from Expenses & production.' },
      { name: 'package', label: 'Package (optional)', type: 'select', options: PACKAGES_FIXED, value: b.package || 'Custom' },
      { name: 'discount', label: 'Discount given', type: 'money', value: b.discount ?? '' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: b.remarks },
    ],
    onMount(form) {
      bindImport(form, { nameField: existing ? null : 'clientName' }); // editing: only the phone number is filled
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
    if (confirmSave && !(await confirmSheet({ title: 'Save changes?', message: `Update ${v.clientName || existing.clientName}'s event details?`, ok: 'Save', danger: false }))) {
      toast('Changes not saved');
      return null;
    }
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

export async function deleteBooking(b) {
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

// ================= Combine bookings =================
async function askCombine(b, candidates, { pickAll = true } = {}) {
  const v = await formSheet({
    title: 'Combine bookings',
    submitLabel: 'Combine',
    fields: [
      { type: 'note', label: `These move into ${b.clientName} (${combinedLabel(b)}): functions, payments, expenses and team. Each team member stays on their own day. Totals are added up.` },
      ...candidates.map((o) => ({
        name: 'c_' + o.id, type: 'checkbox', value: pickAll,
        label: `${o.clientName}: ${combinedLabel(o)} · ${fmtDate(firstDate(o))} · ${rs(num(o.finalAmount))}`,
      })),
    ],
  });
  if (!v) return;
  const chosen = candidates.filter((o) => v['c_' + o.id]);
  if (!chosen.length) { toast('Nothing selected'); return; }
  const total = [b, ...chosen].reduce((s, x) => s + num(x.finalAmount), 0);
  const ok = await confirmSheet({
    title: `Combine ${chosen.length + 1} bookings?`,
    message: `New total: ${rs(total)}. All payments, expenses and team are kept. You can undo this right after.`,
    ok: 'Combine', danger: false,
  });
  if (!ok) return;
  await combineBookings(b, chosen);
  toast('Combined into one booking');
  rerender();
}

// ================= Detail =================
const eventTab = new Map();
export function showEventTab(b, k) { eventTab.set(b.id, k); }

export function renderBooking(view, id) {
  const b = getBooking(id);
  if (!b) {
    view.innerHTML = `${pageHead('Not found', { backTo: '#/bookings' })}<div class="empty">This booking does not exist anymore.</div>`;
    return;
  }
  b.functions ||= []; b.payments ||= []; b.team ||= []; b.expenses ||= [];
  const t = bookingTotals(b);
  const fns = b.functions.slice().sort((x, y) => ((x.date || '') + (x.time || '')).localeCompare((y.date || '') + (y.time || '')));
  const same = sameEventCandidates(b);
  // One event window with tabs. Team opens first; the chosen tab is kept while you work on this event.
  const tab = eventTab.get(b.id) || 'team';
  const teamOk = fns.length > 0 && fns.every((f) => dayTeamStatus(b, f).ok);
  const toBook = b.expenses.filter(needsBooking).length;
  const tabBadge = {
    team: fns.length ? (teamOk ? '<i class="tab-dot ok">✓</i>' : '<i class="tab-dot bad">Incomplete</i>') : '',
    days: fns.length ? `<i class="tab-dot">${fns.length}</i>` : '<i class="tab-dot bad">!</i>',
    pay: t.total > 0 && t.due > 0 ? '<i class="tab-dot warn">Due</i>' : t.total > 0 ? '<i class="tab-dot ok">✓</i>' : '',
    costs: toBook ? `<i class="tab-dot warn">${toBook} to book</i>` : '',
  };

  view.innerHTML = `
    ${pageHead(b.clientName, { backTo: '#/bookings', actions: `<button type="button" class="icon-btn" data-edit aria-label="Edit booking">${ICONS.edit}</button>` })}

    <div class="card pad">
      <div class="detail-top">
        <div class="who">
          <div class="badges" style="margin-top:0">${statusBadge(b.status)}${payBadge(t.payStatus)}</div>
          <p>${esc([b.package, b.city].filter(Boolean).join(' · '))}</p>
        </div>
        ${b.contact ? `<div class="contact-btns"><a class="call" href="tel:${esc(b.contact.replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(b.contact)}</a>${waButton(waOf(b))}</div>` : ''}
      </div>
      ${b.remarks ? `<div class="remarks">${esc(b.remarks)}</div>` : ''}
    </div>

    ${b.functions.length ? journeyCard(b) : ''}
    ${canUndoCombine(b) ? `<div class="banner ok">${ICONS.book}<div>Bookings combined. <button type="button" class="link" data-undo-combine>Undo</button></div></div>` : ''}
    ${same.length ? `<div class="combine-card">
      <b>Same wedding?</b>
      <p>${esc(b.clientName)} has ${same.length} other booking${same.length > 1 ? 's' : ''} close to these dates:</p>
      <ul>${same.map((o) => `<li><a href="#/booking/${encodeURIComponent(o.id)}">${esc(combinedLabel(o))}</a> · ${esc(fmtDate(firstDate(o)))} · ${rs(num(o.finalAmount))}</li>`).join('')}</ul>
      <p class="small">Combine them into one booking so payments, expenses and each day's team stay together.</p>
      <button type="button" class="btn primary block" data-combine>Combine into one booking</button>
    </div>` : ''}
    ${(() => { const ids = new Set(same.map((o) => o.id)); const h = clientHistory(b, b.id).filter((o) => !ids.has(o.id)); return h.length ? `<section class="section">${historyHTML(h, { title: 'Client history' })}</section>` : ''; })()}
    ${bookingClashes(b).map((c) => `<div class="banner bad">${ICONS.warn}<div>${esc(clashText(c))}</div></div>`).join('')}

    <div class="event-window card">
      <div class="tabs" role="tablist">
        ${[['team', 'Team', tabBadge.team], ['days', 'Days', tabBadge.days], ['pay', 'Payments', tabBadge.pay], ['costs', 'Costs', tabBadge.costs]]
          .map(([k, label, badge]) => `<button type="button" role="tab" class="tab${tab === k ? ' on' : ''}" data-tab="${k}" aria-selected="${tab === k}">${label}${badge}</button>`).join('')}
      </div>
      <div class="tab-pane" data-pane="team"${tab === 'team' ? '' : ' hidden'}>
    <section class="section">
      <div class="section-head"><h2>Team</h2><button type="button" class="add-btn" data-add-team>${ICONS.plus}Assign</button></div>
      ${b.team.length ? `<button type="button" class="btn wa-team block" data-msg-team>Message team on WhatsApp (${new Set(b.team.map((a) => a.freelancerId)).size})</button>` : ''}
      ${teamByDay(b, fns)}
      ${b.team.length ? (() => {
        const left = (a) => Math.max(0, num(a.agreed) - num(a.paid));
        const dueNow = b.team.filter((a) => jobIsDue(b, a)).reduce((s, a) => s + left(a), 0);
        const later = t.teamPending - dueNow;
        return `<p class="muted small" style="margin:8px 2px 0">Paid ${rs(t.teamPaid)} of ${rs(t.teamCost)} · Due now ${rs(dueNow)}${later > 0 ? ` · Assigned (after event) ${rs(later)}` : ''}</p>`;
      })() : ''}
    </section>

      </div>
      <div class="tab-pane" data-pane="days"${tab === 'days' ? '' : ' hidden'}>
    <section class="section">
      <div class="section-head"><h2>Days &amp; venues</h2><button type="button" class="add-btn" data-add-fn>${ICONS.plus}Add</button></div>
      <div class="list">${fns.length ? fns.map((f) => fnRow(b, f)).join('') : `<div class="empty">No functions yet. Add Mehndi, Barat, Walima and others.</div>`}</div>
    </section>

      </div>
      <div class="tab-pane" data-pane="pay"${tab === 'pay' ? '' : ' hidden'}>
    <div class="stats">
      <div class="stat"><small>Total${t.extras ? ' (incl. extras)' : ''}</small><strong>${rs(t.total)}</strong></div>
      <div class="stat"><small>Received</small><strong>${rs(t.received)}</strong></div>
      <div class="stat"><small>Due</small><strong class="${t.due > 0 ? 'neg' : ''}">${rs(t.due)}</strong></div>
      <div class="stat"><small>Team cost</small><strong>${rs(t.teamCost)}</strong></div>
      <div class="stat"><small>Expenses</small><strong>${rs(t.expenses)}</strong></div>
      <div class="stat"><small>Profit</small><strong class="${t.profit >= 0 ? 'pos' : 'neg'}">${rs(t.profit)}</strong></div>
    </div>
    ${t.extras || num(b.discount) ? `<p class="muted small" style="margin:8px 2px 0">${[t.extras ? `Package ${rs(t.packageAmount)} + equipment billed to client ${rs(t.extras)}` : '', num(b.discount) ? `Discount given: ${rs(b.discount)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}

    <section class="section">
      <div class="section-head"><h2>Client payments</h2><button type="button" class="add-btn" data-add-pay>${ICONS.plus}Add</button></div>
      <div class="list">${b.payments.length ? b.payments.slice().sort((x, y) => (y.date || '').localeCompare(x.date || '')).map((p) => `
        <button type="button" class="row" data-pay="${p.id}">
          <div class="main"><div class="title">${esc(p.method || 'Payment')}</div><div class="sub">${esc(fmtDate(p.date))}${p.remarks ? ' · ' + esc(p.remarks) : ''}</div></div>
          <div class="end"><strong>${rs(p.amount)}</strong></div>
        </button>`).join('') : `<div class="empty">No payments received yet.</div>`}</div>
    </section>

      </div>
      <div class="tab-pane" data-pane="costs"${tab === 'costs' ? '' : ' hidden'}>
    <section class="section">
      <div class="section-head"><h2>Expenses &amp; production</h2><button type="button" class="add-btn" data-add-exp>${ICONS.plus}Add</button></div>
      <div class="list">${b.expenses.length ? b.expenses.slice().sort((x, y) => (y.date || '').localeCompare(x.date || '')).map((e) => `
        <button type="button" class="row" data-exp="${e.id}">
          <div class="main"><div class="title">${esc(e.category)}</div>
            <div class="sub">${b.functions.length > 1 ? esc(e.functionIds?.length ? itemDays(b, e).map((d) => d.type).join(', ') : 'All days') + ' · ' : ''}${esc(fmtDate(e.date))}${e.remarks ? ' · ' + esc(e.remarks) : ''}</div>
            ${needsBooking(e) || e.billing === 'Client pays' ? `<div class="badges">${needsBooking(e) ? '<span class="badge warn">Need to book</span>' : ''}${e.billing === 'Client pays' ? `<span class="badge accent">Client pays ${rs(e.chargeClient ?? e.amount)}</span>` : ''}</div>` : ''}</div>
          <div class="end"><strong>${rs(e.amount)}</strong></div>
        </button>`).join('') : `<div class="empty">No expenses yet. Add lights, props, studio rental and other costs.</div>`}</div>
    </section>

      </div>
    </div>

    <div class="section"><a class="btn outline block" href="#/report/${encodeURIComponent(b.id)}">Event report (money, team, PDF)</a></div>
    <div class="section"><button type="button" class="btn danger-ghost block" data-del>Delete booking</button></div>
    <p class="center mt"><button type="button" class="link small" data-combine-other style="background:none;border:0;color:var(--muted);text-decoration:underline">Combine with another booking…</button></p>
  `;

  const $ = (s) => view.querySelector(s);
  const openTab = (k) => {
    eventTab.set(b.id, k);
    view.querySelectorAll('[data-tab]').forEach((x) => { const on = x.dataset.tab === k; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    view.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== k; });
  };
  view.querySelectorAll('[data-tab]').forEach((el) => el.onclick = () => openTab(el.dataset.tab));
  $('[data-edit]').onclick = () => editBooking(b);
  $('[data-del]').onclick = async () => { if (await deleteBooking(b)) go('#/bookings'); };
  $('[data-add-fn]').onclick = () => editFunction(b);
  $('[data-add-pay]').onclick = () => editPayment(b);
  $('[data-add-team]').onclick = () => editAssignment(b);
  if ($('[data-msg-team]')) $('[data-msg-team]').onclick = () => messageTeam(b);
  $('[data-add-exp]').onclick = () => editExpense(b);
  view.querySelectorAll('[data-fn]').forEach((el) => el.onclick = () => openFunction(b, b.functions.find((x) => x.id === el.dataset.fn)));
  view.querySelectorAll('[data-pay]').forEach((el) => el.onclick = () => editPayment(b, b.payments.find((x) => x.id === el.dataset.pay)));
  view.querySelectorAll('[data-exp]').forEach((el) => el.onclick = () => editExpense(b, b.expenses.find((x) => x.id === el.dataset.exp)));
  const combineBtn = view.querySelector('[data-combine]');
  if (combineBtn) combineBtn.onclick = () => askCombine(b, same);
  const moreBtn = view.querySelector('[data-combine-other]');
  if (moreBtn) moreBtn.onclick = () => {
    const others = state.bookings.filter((o) => o.id !== b.id && o.status !== 'Cancelled')
      .sort((x, y) => (firstDate(x) || '').localeCompare(firstDate(y) || ''));
    if (!others.length) { toast('No other bookings to combine with'); return; }
    askCombine(b, others, { pickAll: false });
  };
  const undoBtn = view.querySelector('[data-undo-combine]');
  if (undoBtn) undoBtn.onclick = async () => {
    if (!(await confirmSheet({ title: 'Undo combine?', message: 'The bookings go back to how they were before combining.', ok: 'Undo', danger: false }))) return;
    if (await undoCombine()) { toast('Bookings separated again'); rerender(); } else toast('Cannot undo: the booking was changed after combining', 'bad');
  };
  const wa = view.querySelector('[data-wa]');
  if (wa) wa.onclick = () => waSheet(`WhatsApp ${b.clientName}`, waOf(b), [
    { label: 'Booking confirmation', text: clientConfirmMessage(b) },
    { label: 'Booking details + terms & conditions', text: clientTermsMessage(b, terms(), advancePct()) },
    t.due > 0 && t.total > 0 ? { label: `Payment reminder (${rs(t.due)} due)`, text: clientReminderMessage(b) } : null,
    (b.payments || []).length ? { label: 'Receipt for last payment', text: clientReceiptMessage(b) } : null,
  ]);
  view.querySelectorAll('[data-team]').forEach((el) => el.onclick = () => teamActions(b, b.team.find((x) => x.id === el.dataset.team)));
  view.querySelectorAll('[data-add-day-team]').forEach((el) => el.onclick = () => editAssignment(b, null, { functionId: el.dataset.addDayTeam }));
  // Journey step buttons: each opens the form that finishes that step.
  view.querySelectorAll('[data-step]').forEach((el) => el.onclick = (e) => {
    e.preventDefault();
    const fnsByDate = b.functions.slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    const act = {
      days: () => { const f = fnsByDate.find((x) => !x.date || !x.venue); return f ? editFunction(b, f) : editFunction(b); },
      price: () => editBooking(b),
      terms: () => sendTerms(b),
      termsAgreed: () => markTermsAgreed(b),
      advance: () => editPayment(b),
      paid: () => editPayment(b),
      team: () => { const f = fnsByDate.find((x) => !dayTeamStatus(b, x).ok); return dayTeamStatus(b, f || {}).needed ? editAssignment(b, null, { functionId: f.id }) : editTeamNeeded(b, f); },
      production: () => editExpense(b, b.expenses.find(needsBooking)),
      delivered: () => markDelivered(b),
      teamPaid: () => { openTab('team'); view.querySelector('.event-window')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      rated: () => rateTeam(b),
    }[el.dataset.step];
    if (act) act();
  });
  view.querySelectorAll('[data-need]').forEach((el) => el.onclick = () => editTeamNeeded(b, b.functions.find((x) => x.id === el.dataset.need)));
}

// Team grouped by day: each day (Mehndi, Barat…) has its own people and its own "Add" button.
function teamByDay(b, fns) {
  const whole = b.team.filter((a) => !a.functionId || !fns.some((f) => f.id === a.functionId));
  const groups = fns.map((f) => {
    const rows = b.team.filter((a) => a.functionId === f.id);
    return `<div class="day-group">
      <div class="day-head"><b>${esc(f.type)}</b><span class="muted small">${esc(fmtDate(f.date))}</span>${(() => { const st = dayTeamStatus(b, f); return `<button type="button" class="day-st ${st.ok ? 'ok' : 'bad'}" data-need="${f.id}" aria-label="Change team needed for ${esc(f.type)}">${esc(st.label)}${st.ok ? ' ✓' : st.missing ? ` · ${st.missing} missing` : ''} ✎</button>`; })()}
        <button type="button" class="add-btn" data-add-day-team="${f.id}">${ICONS.plus}Add</button></div>
      <div class="list">${rows.length ? rows.map((a) => teamRow(b, a)).join('') : `<div class="empty small">No team for ${esc(f.type)} yet.</div>`}</div>
    </div>`;
  });
  if (whole.length) {
    groups.push(`<div class="day-group">
      <div class="day-head"><b>All days</b><span class="muted small">Whole booking</span></div>
      <div class="list">${whole.map((a) => teamRow(b, a)).join('')}</div>
    </div>`);
  }
  return groups.length ? groups.join('') : `<div class="list"><div class="empty">No team assigned yet.</div></div>`;
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
  if (!needed) teamLine = `${names.length ? `Team: ${esc(names.join(', '))} · ` : ''}<span class="shortage">Team needed not set</span>`;
  else if (have < needed) teamLine = `<span class="shortage">Team ${have} of ${needed} · ${needed - have} missing</span>`;
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
  const st = teamPayState(b, a);
  return `<button type="button" class="row" data-team="${a.id}">
    <div class="main">
      <div class="title">${esc(f ? f.name : 'Deleted freelancer')}</div>
      <div class="sub">${esc([f?.role, fn ? fn.type : 'Whole booking'].filter(Boolean).join(' · '))}</div>
      <div class="sub">Paid ${rs(a.paid)} of ${rs(a.agreed)}${a.paidDate ? ' · ' + esc(fmtDate(a.paidDate)) : ''}</div>
      ${num(a.rating) ? `<div class="sub">${ratingBadge(a)}${a.ratingNote ? ' ' + esc(a.ratingNote) : ''}</div>` : ''}
    </div>
    <div class="end"><span class="badge ${st === 'Cleared' ? 'ok' : st === 'Due' ? 'warn' : ''}">${st === 'Cleared' ? 'Paid ✓' : st === 'Due' ? 'Due' : 'Assigned'}</span></div>
  </button>`;
}

// ================= Sub-forms =================
async function editFunction(b, existing, preset = {}) {
  const f = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit function' : 'Add function',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'type', label: 'Function', type: 'select', options: FUNCTIONS, value: f.type || preset.type || 'Mehndi' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: f.date || preset.date || '' },
      { name: 'time', label: 'Reporting time', type: 'time', value: f.time || '' },
      { name: 'shift', label: 'Shift (shoot time included)', type: 'select', value: existing ? shiftOf(f) : 'Day',
        options: Object.entries(SHIFTS).map(([value, s]) => ({ value, label: s.label })),
        hint: 'Set from the reporting time. The same freelancer cannot be in two places in the same shift.' },
      { name: 'customStart', label: 'Custom start time', type: 'time', value: f.customStart || f.time || '', showIf: { name: 'shift', is: 'Custom' } },
      { name: 'customEnd', label: 'Custom end time', type: 'time', value: f.customEnd || '', showIf: { name: 'shift', is: 'Custom' } },
      { type: 'html', html: '<div class="banner sameday" data-sameday hidden></div>' },
      { name: 'venue', label: 'Venue', value: f.venue },
      { name: 'teamNeeded', label: 'Team needed (people)', type: 'number', required: true, min: 1, value: f.teamNeeded ?? '', hint: 'How many people (photographers, videographers, drone…) this day needs.' },
      { name: 'deliverables', label: 'Deliverables note', type: 'textarea', value: f.deliverables },
      { name: 'instructions', label: 'Instructions for the team', type: 'textarea', value: f.instructions, placeholder: 'Dress code, must-have shots, family names, timings…' },
      { name: 'pinterest', label: 'Pinterest mood board link', type: 'url', value: f.pinterest, placeholder: 'https://pinterest.com/…/board-name/' },
    ],
    onMount(form) {
      // Other events on the same date: the studio runs several weddings at once in season.
      const box = form.querySelector('[data-sameday]');
      const showSameDay = () => {
        const el = form.elements;
        const me = { date: el.date.value, shift: el.shift.value, time: el.time.value, customStart: el.customStart.value, customEnd: el.customEnd.value };
        const others = me.date ? allFunctions().filter((x) => x.fn.date === me.date && x.fn !== existing) : [];
        if (!others.length) { box.hidden = true; return; }
        const clash = others.filter((x) => fnsOverlap(x.fn, me));
        box.className = 'banner sameday ' + (clash.length ? 'bad' : 'warn');
        box.innerHTML = `${ICONS.calendar || ''}<div><b>Also on this day:</b> ${others.map((x) => `${esc(x.fn.type)} · ${esc(x.booking.clientName)} (${esc(shiftLabel(x.fn))})${clash.includes(x) ? ' — <b>same time</b>' : ''}`).join('; ')}${clash.length ? '<br>Same time means a separate team for each.' : ''}</div>`;
        box.hidden = false;
      };
      ['date', 'shift', 'time', 'customStart', 'customEnd'].forEach((n) => form.elements[n].addEventListener('change', showSameDay));
      showSameDay();
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
  v.teamNeeded = Math.max(1, Math.round(num(v.teamNeeded)));
  if (v.shift !== 'Custom') { v.customStart = ''; v.customEnd = ''; }
  let fnObj = existing;
  if (existing) Object.assign(existing, v);
  else { fnObj = { id: uid(), ...v, moodImages: [] }; b.functions.push(fnObj); }
  await save('bookings');
  const clash = allTeamClashes().find((c) => c.a.fn === fnObj || c.b.fn === fnObj);
  if (clash) toast('Team clash: ' + clash.freelancer.name + ' is booked at 2 places', 'bad');
  else toast(existing ? 'Function saved' : 'Function added');
  rerender();
  if (!existing) await offerTeamForNewDay(b, fnObj);
  return fnObj;
}

// New couple: straight after saving the booking, add the functions one by one.
// The next function and date are guessed from the usual order (Mayun → Mehndi → Nikkah → Barat → Walima).
const WEDDING_ORDER = ['Dholki', 'Mayun', 'Mehndi', 'Nikkah', 'Barat', 'Rukhsati', 'Walima'];
async function addDaysFlow(b) {
  let preset = {};
  for (let i = 0; i < 10; i++) {
    const fn = await editFunction(b, null, preset);
    if (!fn) return;
    const k = WEDDING_ORDER.indexOf(fn.type);
    const nextType = k >= 0 && k < WEDDING_ORDER.length - 1 ? WEDDING_ORDER[k + 1] : 'Walima';
    const next = new Date(fn.date + 'T00:00:00'); next.setDate(next.getDate() + 1);
    preset = { type: nextType, date: Number.isNaN(next.getTime()) ? '' : isoDate(next) };
    const more = await actionSheet(`${fn.type} added. Next?`, [
      { label: `Add another function (${nextType}?)`, value: 'more' },
      { label: 'Done — that is all the days', value: null },
    ]);
    if (more !== 'more') { toast('Next: send terms and take the advance'); return; }
  }
}

// A new day added to an event (e.g. a 4th function): offer the people already on the other days.
async function offerTeamForNewDay(b, fn) {
  const people = new Map(); // freelancerId -> their latest fee in this event
  for (const a of b.team || []) if (a.functionId && a.functionId !== fn.id && getFreelancer(a.freelancerId)) people.set(a.freelancerId, num(a.agreed));
  if (!people.size) return;
  const v = await formSheet({
    title: `Team for ${fn.type}`,
    submitLabel: 'Add to this day',
    fields: [
      { type: 'note', label: `Same team as the other days? Tick who also works on ${fn.type} (${fmtDate(fn.date)}). You can change fees later.` },
      ...[...people].map(([fid, fee]) => {
        const f = getFreelancer(fid);
        const busy = busyConflicts(fid, [fn]).some((c) => c.booking !== b);
        return { name: 'p_' + fid, type: 'checkbox', value: false, label: `${f.name} · ${f.role} · ${rs(fee)}${busy ? ' · ✗ busy that day' : ''}` };
      }),
    ],
  });
  if (!v) return;
  const chosen = [...people].filter(([fid]) => v['p_' + fid]);
  if (!chosen.length) return;
  for (const [fid, fee] of chosen) b.team.push({ id: uid(), freelancerId: fid, functionId: fn.id, agreed: fee, paid: 0, paidDate: '', remarks: '' });
  await save('bookings');
  toast(`${chosen.length} added to ${fn.type}`);
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
  // First money in: an inquiry becomes a confirmed booking.
  const promoted = !existing && b.status === 'Inquiry';
  if (promoted) b.status = 'Booked';
  await save('bookings');
  toast(promoted ? 'Advance received · marked Booked ✓' : existing ? 'Payment saved' : 'Payment added');
  rerender();
}

async function editExpense(b, existing) {
  const e = existing || {};
  const days = (b.functions || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const v = await formSheet({
    title: existing ? 'Edit expense' : 'Add expense / production item',
    danger: existing ? 'Delete' : null,
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATS, value: e.category || 'Production Lights' },
      { name: 'status', label: 'Status', type: 'select', options: ['Booked', 'Need to book'], value: e.status || (existing ? 'Booked' : 'Need to book'), hint: '"Need to book" shows on the event until you mark it Booked.' },
      { name: 'amount', label: 'Cost to studio', type: 'money', required: true, value: e.amount ?? '', hint: days.length > 1 ? 'Total for the days ticked below.' : 'What you pay the vendor.' },
      { name: 'billing', label: 'Who pays?', type: 'select', options: ['Included in package', 'Client pays'], value: e.billing || 'Included in package', hint: '"Client pays" adds it to the client total and to the confirmation message.' },
      { name: 'chargeClient', label: 'Charge to client', type: 'money', value: e.chargeClient ?? '', showIf: { name: 'billing', is: 'Client pays' }, hint: 'Leave empty to charge the same as the cost.' },
      ...(days.length > 1 ? [
        { type: 'heading', label: 'For which days?' },
        { name: 'allDays', label: 'All days of this event', type: 'checkbox', value: !e.functionIds || !e.functionIds.length },
        ...days.map((d) => ({ name: 'day_' + d.id, type: 'checkbox', label: `${d.type} · ${fmtDate(d.date)}`, value: itemOnDay(e, d.id) })),
      ] : []),
      { name: 'date', label: 'Date', type: 'date', required: true, value: e.date || todayISO() },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: e.remarks, placeholder: 'Vendor, what is included…' },
    ],
    onMount(form) {
      if (days.length < 2) return;
      const el = form.elements;
      const sync = () => { el.allDays.checked = days.every((d) => el['day_' + d.id].checked); };
      el.allDays.addEventListener('change', () => { days.forEach((d) => { el['day_' + d.id].checked = el.allDays.checked; }); });
      days.forEach((d) => el['day_' + d.id].addEventListener('change', sync));
    },
  });
  if (!v) return;
  if (v.__danger) {
    if (!(await confirmSheet({ title: 'Delete expense?', message: `Delete ${existing.category} expense of ${rs(existing.amount)}?` }))) return;
    b.expenses = b.expenses.filter((x) => x.id !== existing.id);
    await save('bookings'); toast('Expense deleted'); rerender();
    return;
  }
  v.amount = num(v.amount);
  if (v.billing === 'Client pays') v.chargeClient = v.chargeClient === '' ? v.amount : num(v.chargeClient);
  else v.chargeClient = undefined;
  // Which days: [] means all days of the event (also when every day is ticked).
  if (days.length > 1) {
    const picked = days.filter((d) => v['day_' + d.id]).map((d) => d.id);
    if (!picked.length) { toast('Tick at least one day', 'bad'); return; }
    v.functionIds = picked.length === days.length ? [] : picked;
    for (const k of Object.keys(v)) if (k.startsWith('day_') || k === 'allDays') delete v[k];
  } else v.functionIds = [];
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
    { label: a.functionId ? 'Remove from this day' : 'Remove from some days', value: 'remove', danger: true },
    ...(pastJob(b, a) ? [{ label: num(a.rating) ? 'Change rating' : 'Rate performance ★', value: 'rate' }] : []),
    ...(waNumber(waOf(getFreelancer(a.freelancerId))) ? [{ label: 'WhatsApp job details', value: 'wa' }] : []),
    ...(a.freelancerId && getFreelancer(a.freelancerId) ? [{ label: 'Open freelancer', value: 'open' }] : []),
  ]);
  if (choice === 'wa') {
    const f = getFreelancer(a.freelancerId);
    waSheet(`WhatsApp ${f.name}`, waOf(f), [{ label: `Job details: ${b.clientName}`, text: freelancerJobMessage(b, a) }]);
    return;
  }
  if (choice === 'pay') {
    a.paid = num(a.agreed); a.paidDate = todayISO();
    await save('bookings'); toast(`${name} marked as paid`); rerender();
  } else if (choice === 'remove') {
    const f = getFreelancer(a.freelancerId) || { name };
    if (a.functionId) { if (await removeFromDay(b, a.freelancerId, a.functionId)) rerender(); }
    else if ((b.functions || []).length > 1) await removeFromSomeDays(b, a, f);
    else if (await confirmSheet({ title: 'Remove from team?', message: `Remove ${f.name} from this booking? Their payment record for it will be deleted too.`, ok: 'Remove' })) {
      b.team = b.team.filter((x) => x.id !== a.id); await save('bookings'); toast('Removed from team'); rerender();
    }
  } else if (choice === 'edit') editAssignment(b, a);
  else if (choice === 'rate') rateTeam(b, a);
  else if (choice === 'open') go('#/freelancer/' + encodeURIComponent(a.freelancerId));
}

// Remove one freelancer from one function (used by the Team long-press menu).
// A whole-booking job is split so the other days stay. Returns true if something changed.
export async function removeFromDay(b, fid, fnId) {
  const f = getFreelancer(fid) || { name: 'Freelancer' };
  const fn = (b.functions || []).find((x) => x.id === fnId);
  const own = (b.team || []).find((a) => a.freelancerId === fid && a.functionId === fnId);
  if (own) {
    const paid = num(own.paid);
    const ok = await confirmSheet({
      title: `Remove ${f.name}?`,
      message: `Remove ${f.name} from ${fn ? `${fn.type}, ${fmtDate(fn.date)}` : 'this day'} of ${b.clientName}?${paid ? ` You already paid ${rs(paid)} for this day; that record will be deleted too.` : ''}`,
      ok: 'Remove',
    });
    if (!ok) return false;
    b.team = b.team.filter((x) => x.id !== own.id);
    b.updatedAt = new Date().toISOString();
    await save('bookings'); toast(`${f.name} removed from ${fn ? fn.type : 'the day'}`);
    return true;
  }
  const whole = (b.team || []).find((a) => a.freelancerId === fid && !a.functionId);
  if (!whole) return false;
  if ((b.functions || []).length <= 1) {
    if (!(await confirmSheet({ title: `Remove ${f.name}?`, message: `Remove ${f.name} from ${b.clientName}? Their payment record for it will be deleted too.`, ok: 'Remove' }))) return false;
    b.team = b.team.filter((x) => x.id !== whole.id);
    await save('bookings'); toast('Removed from team');
    return true;
  }
  const before = b.team.length;
  const ids = b.team.map((x) => x.id).join();
  await removeFromSomeDays(b, whole, f, fnId);
  return b.team.length !== before || b.team.map((x) => x.id).join() !== ids;
}

// Send each team member their own job message (their days, venue, fee, instructions).
// WhatsApp cannot send by itself: each tap opens that person's chat with the message typed,
// you tap Send there, come back and the next one is waiting. Sent ones get a tick.
async function messageTeam(b) {
  const { openSheet } = await import('../ui.js');
  const people = [...new Set(b.team.map((a) => a.freelancerId))].map(getFreelancer).filter(Boolean);
  const jobsOf = (f) => b.team.filter((a) => a.freelancerId === f.id);
  const days = (f) => { const j = jobsOf(f); return j.some((a) => !a.functionId) ? 'All days' : j.map((a) => b.functions.find((x) => x.id === a.functionId)?.type).filter(Boolean).join(', '); };
  const sentAt = (f) => jobsOf(f).map((a) => a.msgSentAt).filter(Boolean).sort().pop();
  const row = (f) => {
    const link = waLink(waOf(f), freelancerEventMessage(b, f.id));
    const s = sentAt(f);
    return link
      ? `<a class="row msg-row${s ? ' sent' : ''}" data-fid="${esc(f.id)}" href="${esc(link)}" target="_blank" rel="noopener">
          <div class="main"><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.role || '')} · ${esc(days(f))}</div></div>
          <span class="msg-st">${s ? 'Sent ✓' : 'Send'}</span></a>`
      : `<div class="row msg-row off"><div class="main"><div class="title">${esc(f.name)}</div><div class="sub">No WhatsApp number. Add it in Team.</div></div></div>`;
  };
  await openSheet({
    title: `Message team · ${b.clientName}`,
    body: `<p class="muted small" style="margin:0 0 10px">Tap a name: WhatsApp opens with their own job details typed. Tap Send there, then come back for the next one.</p>
      <div class="list">${people.map(row).join('')}</div>`,
    onMount(sheet) {
      sheet.querySelectorAll('a.msg-row').forEach((el) => el.addEventListener('click', () => {
        const now = new Date().toISOString();
        b.team.filter((a) => a.freelancerId === el.dataset.fid).forEach((a) => { a.msgSentAt = now; });
        save('bookings');
        el.classList.add('sent'); el.querySelector('.msg-st').textContent = 'Sent ✓';
      }));
    },
  });
  rerender();
}

// A "Whole booking" assignment covers every day. Removing it from one day splits it
// into one assignment per remaining day, so the other days (and money already paid) stay.
async function removeFromSomeDays(b, a, f, presetFnId) {
  const days = b.functions.slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const v = await formSheet({
    title: `Remove ${f.name} from…`,
    submitLabel: 'Remove',
    fields: [
      { type: 'note', label: `${f.name} is on all ${days.length} days. Tick the days to remove. The other days stay.` },
      ...days.map((d) => ({ name: 'd_' + d.id, type: 'checkbox', value: d.id === presetFnId, label: `${d.type} · ${fmtDate(d.date)}` })),
    ],
  });
  if (!v) return;
  const keep = days.filter((d) => !v['d_' + d.id]);
  if (keep.length === days.length) { toast('No day selected'); return; }
  if (!keep.length) {
    if (!(await confirmSheet({ title: 'Remove from all days?', message: `Remove ${f.name} from the whole booking? Their payment record for it will be deleted too.`, ok: 'Remove' }))) return;
    b.team = b.team.filter((x) => x.id !== a.id);
    await save('bookings'); toast('Removed from team'); rerender();
    return;
  }
  // Agreed fee is shared equally per day; money already paid stays with the remaining days.
  const per = Math.round(num(a.agreed) / days.length);
  let paidLeft = num(a.paid);
  const parts = keep.map((d, i) => {
    const agreed = i === keep.length - 1 ? num(a.agreed) - per * (days.length - 1) : per;
    const paid = i === keep.length - 1 ? paidLeft : Math.min(paidLeft, agreed);
    paidLeft -= paid;
    return { ...a, id: uid(), functionId: d.id, agreed, paid };
  });
  const ok = await confirmSheet({
    title: 'Remove these days?',
    message: `${f.name} stays on: ${keep.map((d) => d.type).join(', ')} (${rs(parts[0].agreed)} each day${num(a.paid) ? `, paid ${rs(num(a.paid))} kept` : ''}). You can edit each day's amount after.`,
    ok: 'Remove', danger: true,
  });
  if (!ok) return;
  const i = b.team.findIndex((x) => x.id === a.id);
  b.team.splice(i, 1, ...parts);
  await save('bookings'); toast('Removed from selected days'); rerender();
}

export async function editAssignment(b, existing, preset = {}) {
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
  const startFn = existing ? (a.functionId || '') : (preset.functionId ?? fnOpts[0].value);
  const firstF = getFreelancer(a.freelancerId) || sorted.find((f) => !conflictsFor(f.id, startFn).length) || sorted[0];
  const optLabel = (f, fnId) => {
    const c = conflictsFor(f.id, fnId);
    const tag = !c.length ? '✓ Free' : c.every((x) => x.same) ? '• Already here' : '✗ Busy';
    const r = freelancerRating(f.id);
    return `${tag} · ${f.name} · ${f.role}${r ? ` · ★${r.avg.toFixed(1)}` : ''}`;
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
    if (!existing.functionId && b.functions.length > 1) { await removeFromSomeDays(b, existing, firstF); return; }
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
  if (!existing && v.functionId && b.functions.length > 1) await afterAssignDay(b, v);
}

// After assigning someone to one day of a multi-day event: same person on all days,
// or move on to the next day (which can have a different team).
async function afterAssignDay(b, v) {
  const f = getFreelancer(v.freelancerId);
  const days = b.functions.slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const on = (fnId) => b.team.some((x) => x.freelancerId === v.freelancerId && (!x.functionId || x.functionId === fnId));
  const others = days.filter((d) => !on(d.id));
  const idx = days.findIndex((d) => d.id === v.functionId);
  const next = days.slice(idx + 1)[0];
  const choices = [];
  if (others.length) choices.push({ label: `Yes, ${f.name} on all days (${others.map((d) => d.type).join(', ')} too)`, value: 'all' });
  if (next) choices.push({ label: `No, assign team for ${next.type} next`, value: 'next' });
  if (!choices.length) return;
  choices.push({ label: 'Done for now', value: null });
  const pick = await actionSheet(`Add ${f.name} to all days?`, choices);
  if (pick === 'all') {
    const busy = others.filter((d) => busyConflicts(v.freelancerId, [d]).some((c) => c.booking !== b));
    for (const d of others) b.team.push({ id: uid(), freelancerId: v.freelancerId, functionId: d.id, agreed: v.agreed, paid: 0, paidDate: '', remarks: '' });
    await save('bookings');
    toast(busy.length ? `Added, but ${f.name} is busy on ${busy.map((d) => d.type).join(', ')}` : `${f.name} added to all days · ${rs(v.agreed)} each`, busy.length ? 'bad' : 'ok');
    rerender();
  } else if (pick === 'next') {
    await editAssignment(b, null, { functionId: next.id });
  }
}
