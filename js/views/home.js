import { state } from '../db.js';
import { ICONS } from '../ui.js';
import {
  esc, rs, num, fmtDate, isoDate, allTeamClashes, clashText, gigsSummary, gigTotals, todayISO, daysAgo, bookingTotals, freelancerTotals, allFunctions, MONTHS_LONG,
} from '../util.js';
import { eventRow } from './parts.js';
import { mountInstall } from '../install.js';
import { gigRow } from './gigs.js';
import { journey, eventDone, lastDate } from '../studio.js';

// Studio money (client dues, money received) stays hidden on Home until the eye is tapped,
// so it is not on screen when the phone is shown to a client or team. Hidden again on every app open.
let showMoney = false;
const hide = (v) => (showMoney ? rs(v) : 'Rs ••••');

export function owedByClients() {
  return state.bookings
    .filter((b) => b.status !== 'Cancelled' && b.status !== 'Inquiry')
    .map((b) => ({ b, t: bookingTotals(b) }))
    .filter((x) => x.t.due > 0)
    .sort((a, b) => b.t.due - a.t.due);
}

export function owedToFreelancers() {
  return state.freelancers
    .map((f) => ({ f, t: freelancerTotals(f.id) }))
    .filter((x) => x.t.dueNow > 0)
    .sort((a, b) => b.t.dueNow - a.t.dueNow);
}

export function clashDates(fromISO = '') {
  const count = {};
  for (const { fn } of allFunctions()) {
    if (!fn.date || fn.date < fromISO) continue;
    count[fn.date] = (count[fn.date] || 0) + 1;
  }
  return Object.keys(count).filter((d) => count[d] > 1).sort();
}

export function renderHome(view) {
  const today = todayISO();
  const now = new Date();
  const monthKey = today.slice(0, 7);

  const dues = owedByClients();
  const toReceive = dues.reduce((s, x) => s + x.t.due, 0);
  const toPay = owedToFreelancers();
  const toPayTotal = toPay.reduce((s, x) => s + x.t.dueNow, 0);
  let receivedMonth = 0;
  for (const b of state.bookings) for (const p of b.payments || []) if ((p.date || '').startsWith(monthKey)) receivedMonth += num(p.amount);

  const myPending = (state.gigs || []).filter((g) => gigTotals(g).pending > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  // Group days by client event: Mehndi, Barat and Walima of one booking show as one row.
  const byEvent = new Map();
  for (const x of allFunctions().filter((y) => y.fn.date && y.fn.date >= today)) {
    if (!byEvent.has(x.booking)) byEvent.set(x.booking, []);
    byEvent.get(x.booking).push(x.fn);
  }
  const upcoming = [...byEvent].slice(0, 7);
  const clashes = allTeamClashes().filter((c) => c.date >= today);
  // Finished events that are not closed yet: the studio's follow-up list.
  const afterEvents = state.bookings.filter((b) => b.status !== 'Cancelled' && eventDone(b))
    .map((b) => ({ b, j: journey(b) })).filter((x) => x.j.next)
    .sort((x, y) => lastDate(y.b).localeCompare(lastDate(x.b))).slice(0, 5);

  const hasData = state.bookings.length || state.freelancers.length;
  const last = state.meta.lastBackup;
  const age = daysAgo(last);
  let backupBanner = '';
  if (hasData && !last) {
    backupBanner = `<div class="banner warn">${ICONS.warn}<div>You have not made a backup yet. <a class="link" href="#/backup">Back up now</a></div></div>`;
  } else if (hasData && age > 7) {
    backupBanner = `<div class="banner warn">${ICONS.warn}<div>Last backup was ${age} days ago. <a class="link" href="#/backup">Back up now</a></div></div>`;
  }

  view.innerHTML = `
    <header class="brand">
      <h1>imfhussain</h1>
      <p>Wedding Photography &amp; Films</p>
    </header>
    <div data-install-slot></div>

    <div class="stats">
      <button type="button" class="stat accent wide money-toggle" data-money aria-label="${showMoney ? 'Hide' : 'Show'} studio money">
        <small>To receive from clients</small><strong>${hide(toReceive)}</strong>
        <span class="eye">${showMoney ? 'Hide' : 'Show'}</span></button>
      <div class="stat"><small>To pay team now</small><strong>${rs(toPayTotal)}</strong></div>
      <div class="stat"><small>Received in ${MONTHS_LONG[now.getMonth()]}</small><strong>${hide(receivedMonth)}</strong></div>
      <a class="stat wide stat-link" href="#/gigs"><small>My freelance · owed to me</small><strong>${rs(gigsSummary().pending)}</strong><span class="chev">${ICONS.chevron}</span></a>
    </div>

    ${backupBanner}
    ${clashes.slice(0, 3).map((c) => `<div class="banner bad">${ICONS.warn}<div>Team clash: ${esc(clashText(c))}. <a class="link" href="#/calendar/${c.date}">Check</a></div></div>`).join('')}
    ${clashes.length > 3 ? `<p class="small" style="color:var(--bad);margin:6px 2px 0">and ${clashes.length - 3} more team clashes</p>` : ''}

    <section class="section">
      <div class="section-head"><h2>Upcoming events</h2><a href="#/calendar">Calendar</a></div>
      <div class="list">${upcoming.length ? upcoming.map(([b, days]) => eventRow(b, days)).join('') : `<div class="empty">No upcoming events.${!state.bookings.length ? `<br><a class="btn primary small" href="#/bookings">Add your first booking</a>` : ''}</div>`}</div>
    </section>

    ${afterEvents.length ? `<section class="section">
      <div class="section-head"><h2>After the event</h2><span class="muted small">deliver, collect, pay, rate</span></div>
      <div class="list">${afterEvents.map(({ b, j }) => `<a class="row" href="#/booking/${encodeURIComponent(b.id)}">
        <div class="main"><div class="title">${esc(b.clientName)}</div>
          <div class="sub">${j.doneCount}/${j.total} done · Next: <b>${esc(j.next.label)}</b></div></div>
        <span class="chev">${ICONS.chevron}</span></a>`).join('')}</div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Clients with dues</h2>${dues.length > 5 ? `<a href="#/bookings">See all</a>` : ''}</div>
      <div class="list">${dues.length ? dues.slice(0, 5).map(({ b, t }) => `
        <a class="row" href="#/booking/${encodeURIComponent(b.id)}">
          <div class="main"><div class="title">${esc(b.clientName)}</div><div class="sub">${showMoney ? `Received ${rs(t.received)} of ${rs(t.total)}` : 'Payment pending'}</div></div>
          <div class="end"><strong>${hide(t.due)}</strong><small>due</small></div>
        </a>`).join('') : `<div class="empty">No pending client payments.</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Team to pay</h2><a href="#/team">Team</a></div>
      <div class="list">${toPay.length ? toPay.slice(0, 5).map(({ f, t }) => `
        <a class="row" href="#/freelancer/${encodeURIComponent(f.id)}">
          <div class="main"><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.role || '')} · Paid ${rs(t.paid)} of ${rs(t.agreed)}${t.later > 0 ? ` · ${rs(t.later)} assigned later` : ''}</div></div>
          <div class="end"><strong>${rs(t.dueNow)}</strong><small>due now</small></div>
        </a>`).join('') : `<div class="empty">Nothing due right now. Fees become due after each event.</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>My freelance pending</h2><a href="#/gigs">All jobs</a></div>
      <div class="list">${myPending.length ? myPending.slice(0, 5).map(gigRow).join('')
        : `<div class="empty">Nobody owes you for freelance work.${!(state.gigs || []).length ? `<br><a class="btn ghost small" href="#/gigs">Add a freelance job</a>` : ''}</div>`}</div>
    </section>

    <p class="muted small center mt">${last ? `Last backup: ${esc(fmtDate(isoDate(new Date(last))))}` : 'No backup yet'}</p>
  `;
  mountInstall(view.querySelector('[data-install-slot]'));
  view.querySelector('[data-money]').onclick = () => { showMoney = !showMoney; renderHome(view); };
  view.querySelectorAll('[data-need-booking]').forEach((el) => el.onclick = async (e) => {
    e.preventDefault();
    const b = state.bookings.find((x) => x.id === el.dataset.needBooking);
    const fn = b && b.functions.find((x) => x.id === el.dataset.need);
    if (fn) { const { editTeamNeeded } = await import('./journey.js'); editTeamNeeded(b, fn); }
  });
}

