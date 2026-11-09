import { state } from '../db.js';
import { ICONS } from '../ui.js';
import {
  esc, rs, num, fmtDate, isoDate, allTeamClashes, clashText, gigsSummary, gigTotals, todayISO, daysAgo, bookingTotals, freelancerTotals, allFunctions, MONTHS_LONG,
} from '../util.js';
import { functionRow } from './parts.js';
import { mountInstall } from '../install.js';
import { gigRow } from './gigs.js';

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
    .filter((x) => x.t.pending > 0)
    .sort((a, b) => b.t.pending - a.t.pending);
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
  const toPayTotal = toPay.reduce((s, x) => s + x.t.pending, 0);
  let receivedMonth = 0;
  for (const b of state.bookings) for (const p of b.payments || []) if ((p.date || '').startsWith(monthKey)) receivedMonth += num(p.amount);

  const myPending = (state.gigs || []).filter((g) => gigTotals(g).pending > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const upcoming = allFunctions().filter((x) => x.fn.date && x.fn.date >= today).slice(0, 7);
  const clashes = allTeamClashes().filter((c) => c.date >= today);

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
      <div class="stat accent wide"><small>To receive from clients</small><strong>${rs(toReceive)}</strong></div>
      <div class="stat"><small>To pay team</small><strong>${rs(toPayTotal)}</strong></div>
      <div class="stat"><small>Received in ${MONTHS_LONG[now.getMonth()]}</small><strong>${rs(receivedMonth)}</strong></div>
      <a class="stat wide stat-link" href="#/gigs"><small>My freelance · owed to me</small><strong>${rs(gigsSummary().pending)}</strong><span class="chev">${ICONS.chevron}</span></a>
    </div>

    ${backupBanner}
    ${clashes.slice(0, 3).map((c) => `<div class="banner bad">${ICONS.warn}<div>Team clash: ${esc(clashText(c))}. <a class="link" href="#/calendar/${c.date}">Check</a></div></div>`).join('')}
    ${clashes.length > 3 ? `<p class="small" style="color:var(--bad);margin:6px 2px 0">and ${clashes.length - 3} more team clashes</p>` : ''}

    <section class="section">
      <div class="section-head"><h2>Upcoming functions</h2><a href="#/calendar">Calendar</a></div>
      <div class="list">${upcoming.length ? upcoming.map((x) => functionRow(x)).join('') : `<div class="empty">No upcoming functions.${!state.bookings.length ? `<br><a class="btn primary small" href="#/bookings">Add your first booking</a>` : ''}</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Clients with dues</h2>${dues.length > 5 ? `<a href="#/bookings">See all</a>` : ''}</div>
      <div class="list">${dues.length ? dues.slice(0, 5).map(({ b, t }) => `
        <a class="row" href="#/booking/${encodeURIComponent(b.id)}">
          <div class="main"><div class="title">${esc(b.clientName)}</div><div class="sub">Received ${rs(t.received)} of ${rs(t.total)}</div></div>
          <div class="end"><strong>${rs(t.due)}</strong><small>due</small></div>
        </a>`).join('') : `<div class="empty">No pending client payments.</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Team to pay</h2><a href="#/team">Team</a></div>
      <div class="list">${toPay.length ? toPay.slice(0, 5).map(({ f, t }) => `
        <a class="row" href="#/freelancer/${encodeURIComponent(f.id)}">
          <div class="main"><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.role || '')} · Paid ${rs(t.paid)} of ${rs(t.agreed)}</div></div>
          <div class="end"><strong>${rs(t.pending)}</strong><small>pending</small></div>
        </a>`).join('') : `<div class="empty">Nothing to pay right now.</div>`}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>My freelance pending</h2><a href="#/gigs">All jobs</a></div>
      <div class="list">${myPending.length ? myPending.slice(0, 5).map(gigRow).join('')
        : `<div class="empty">Nobody owes you for freelance work.${!(state.gigs || []).length ? `<br><a class="btn ghost small" href="#/gigs">Add a freelance job</a>` : ''}</div>`}</div>
    </section>

    <p class="muted small center mt">${last ? `Last backup: ${esc(fmtDate(isoDate(new Date(last))))}` : 'No backup yet'}</p>
  `;
  mountInstall(view.querySelector('[data-install-slot]'));
}

