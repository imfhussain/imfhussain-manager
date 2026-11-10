import { esc, fmtDate, fmtTime, rs, bookingTotals, firstDate, parseDate, teamForFunction, dayTeamStatus, itemOnDay, needsBooking, shiftLabel, clientHistory } from '../util.js';
import { ICONS } from '../ui.js';
import { daysLabel, journey } from '../studio.js';

const STATUS_CLASS = { Inquiry: '', Booked: 'accent', Completed: 'ok', Editing: 'warn', Delivered: 'ok', Cancelled: 'bad' };
const PAY_CLASS = { Paid: 'ok', Partial: 'warn', Unpaid: 'bad' };

export const statusBadge = (s) => `<span class="badge ${STATUS_CLASS[s] ?? ''}">${esc(s)}</span>`;
export const payBadge = (s) => `<span class="badge ${PAY_CLASS[s]}">${esc(s)}</span>`;

export function pageHead(title, { backTo, actions = '' } = {}) {
  return `<header class="page-head">
    ${backTo ? `<a class="icon-btn back" href="${backTo}" aria-label="Back">${ICONS.back}</a>` : ''}
    <h1>${esc(title)}</h1>${actions}
  </header>`;
}

export function dateBox(iso) {
  const d = parseDate(iso);
  if (!d) return `<div class="datebox"><b>–</b><i>TBD</i></div>`;
  const m = d.toLocaleString('en-US', { month: 'short' });
  return `<div class="datebox"><b>${d.getDate()}</b><i>${m}</i></div>`;
}

export function bookingRow(b) {
  const t = bookingTotals(b);
  const d = firstDate(b);
  const fnNames = (b.functions || []).map((f) => f.type).join(', ');
  return `<a class="row" href="#/booking/${encodeURIComponent(b.id)}">
    ${dateBox(d)}
    <div class="main">
      <div class="title">${esc(b.clientName)}</div>
      <div class="sub">${esc([b.city, fnNames || 'No functions yet'].filter(Boolean).join(' · '))}</div>
      <div class="badges">${statusBadge(b.status)}${b.status !== 'Inquiry' && b.status !== 'Cancelled' ? payBadge(t.payStatus) : ''}${clientHistory(b, b.id).length ? '<span class="badge accent">Repeat client</span>' : ''}</div>
    </div>
    <div class="end">${!t.total ? '<small>No price yet</small>' : t.due > 0 && b.status !== 'Cancelled' ? `<strong>${rs(t.due)}</strong><small>due</small>` : `<strong>${rs(t.total)}</strong><small>total</small>`}</div>
  </a>`;
}

export function functionRow({ booking: b, fn }, { showDate = true } = {}) {
  const team = teamForFunction(b, fn.id);
  const parts = [shiftLabel(fn), fmtTime(fn.time) && `Report ${fmtTime(fn.time)}`, fn.venue].filter(Boolean).join(' · ');
  return `<a class="row" href="#/booking/${encodeURIComponent(b.id)}">
    ${showDate ? dateBox(fn.date) : ''}
    <div class="main">
      <div class="title">${esc(fn.type)} · ${esc(b.clientName)}</div>
      <div class="sub">${esc(parts || 'Venue and time not set')}</div>
      <div class="sub">${team.length ? 'Team: ' + esc(team.join(', ')) : ''}</div>
      <div class="badges">${teamBadge([dayTeamStatus(b, fn)])}<span class="day-st ${dayTeamStatus(b, fn).ok ? 'ok' : 'bad'}">${esc(dayTeamStatus(b, fn).label)}</span></div>
    </div>
    <span class="chev">${ICONS.chevron}</span>
  </a>`;
}

// "Team ready" only when every day has the people it needs.
function teamBadge(statuses) {
  const short = statuses.filter((x) => !x.ok).length;
  return short ? `<span class="badge bad">Team incomplete</span>` : `<span class="badge ok">Team ready ✓</span>`;
}

export function fullDate(iso) { return fmtDate(iso); }

// Earlier bookings of the same client: package, price and deliverables, so the next quote is right.
export function historyHTML(list, { title = 'Returning client' } = {}) {
  if (!list.length) return '';
  return `<div class="history">
    <div class="history-head">${ICONS.book}<b>${esc(title)}</b><span>${list.length} earlier booking${list.length > 1 ? 's' : ''}</span></div>
    ${list.map((b) => {
      const t = bookingTotals(b);
      const fns = (b.functions || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
      const deliverables = fns.filter((f) => f.deliverables).map((f) => `${f.type}: ${f.deliverables}`);
      return `<a class="history-item" href="#/booking/${encodeURIComponent(b.id)}">
        <div class="history-top"><strong>${esc(fmtDate(firstDate(b)))}</strong>${statusBadge(b.status)}</div>
        <div><b>${esc(b.package || 'No package')}</b> · ${rs(t.total)}${Number(b.discount) ? ` <span class="muted">(discount ${rs(b.discount)})</span>` : ''}</div>
        ${fns.length ? `<div class="muted">${esc(fns.map((f) => f.type).join(', '))}</div>` : ''}
        ${deliverables.length ? `<div>Deliverables: ${esc(deliverables.join(' · '))}</div>` : `<div class="muted">No deliverables noted</div>`}
        ${b.remarks ? `<div class="muted">Note: ${esc(b.remarks)}</div>` : ''}
      </a>`;
    }).join('')}
  </div>`;
}

// One collapsible card per client event (all its days together).
// Closed: name, "3 days" and Team ready / incomplete. Open: every day with its team and status.
export const openEvents = new Set(); // stays open while the app is open
document.addEventListener('toggle', (e) => {
  const id = e.target?.dataset?.event;
  if (id) { if (e.target.open) openEvents.add(id); else openEvents.delete(id); }
}, true);
export function eventRow(b, days) {
  const st = days.map((fn) => ({ fn, team: teamForFunction(b, fn.id), ...dayTeamStatus(b, fn) }));
  const open = openEvents.has(b.id);
  const items = b.expenses || [];
  const toBook = items.filter(needsBooking);
  // Per day: production items (lights, props, studio, equipment) and anything still to book.
  const isProduction = (e) => /Lights|Props|Studio|Equipment/i.test(e.category || '');
  const itemsFor = (fn) => items.filter((e) => itemOnDay(e, fn.id) && (isProduction(e) || needsBooking(e)));
  return `<details class="event-card"${open ? ' open' : ''} data-event="${esc(b.id)}">
    <summary class="row" data-booking-row="${esc(b.id)}">
      ${dateBox(days[0].date)}
      <div class="main">
        <div class="title">${esc(b.clientName)}</div>
        <div class="badges"><span class="days-tag">${esc(daysLabel(days))}</span>${teamBadge(st)}${toBook.length ? `<span class="badge warn">${toBook.length} to book</span>` : ''}</div>
        ${(() => { const nx = journey(b).next; return nx ? `<div class="sub next-step">Next: ${esc(nx.label)}</div>` : ''; })()}
      </div>
      <span class="chev toggle">${ICONS.chevron}</span>
    </summary>
    <div class="event-days">
      ${st.map((x) => `<div class="event-day">
        <div class="event-day-top"><b>${esc(x.fn.type)}</b><span class="muted small">${esc(fmtDate(x.fn.date))} · ${esc(shiftLabel(x.fn))}</span>
          <button type="button" class="day-st ${x.ok ? 'ok' : 'bad'}" data-need="${esc(x.fn.id)}" data-need-booking="${esc(b.id)}">${esc(x.label)}${x.ok ? ' ✓' : ''} ✎</button></div>
        <div class="sub">${x.team.length ? 'Team: ' + esc(x.team.join(', ')) : '<span class="shortage">No team yet</span>'}</div>
        ${itemsFor(x.fn).length ? `<div class="sub">Production: ${itemsFor(x.fn).map((e) => needsBooking(e) ? `<span class="shortage">${esc(e.category)} (to book)</span>` : `${esc(e.category)} ✓`).join(', ')}</div>` : ''}
      </div>`).join('')}
      <a class="btn outline block small" href="#/booking/${encodeURIComponent(b.id)}">Open event</a>
    </div>
  </details>`;
}
