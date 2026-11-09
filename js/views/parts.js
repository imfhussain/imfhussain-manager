import { esc, fmtDate, fmtTime, rs, bookingTotals, firstDate, parseDate, teamForFunction, shiftLabel, clientHistory } from '../util.js';
import { ICONS } from '../ui.js';

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
    <div class="end">${t.due > 0 && b.status !== 'Cancelled' ? `<strong>${rs(t.due)}</strong><small>due</small>` : `<strong>${rs(t.total)}</strong><small>total</small>`}</div>
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
      <div class="sub">${team.length ? 'Team: ' + esc(team.join(', ')) : '<span class="shortage">No team assigned</span>'}</div>
    </div>
    <span class="chev">${ICONS.chevron}</span>
  </a>`;
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

// One row per client event (all its days together), e.g. "Talha · 3 days".
// The date box shows the first day; days without a team are named so nothing is missed.
export function eventRow(b, days) {
  if (days.length === 1) return functionRow({ booking: b, fn: days[0] });
  const names = [...new Set(days.flatMap((fn) => teamForFunction(b, fn.id)))];
  const noTeam = days.filter((fn) => !teamForFunction(b, fn.id).length).map((fn) => fn.type);
  const first = parseDate(days[0].date), last = parseDate(days[days.length - 1].date);
  const range = first && last ? `${fmtDate(days[0].date).replace(/ \d{4}$/, '')} – ${fmtDate(days[days.length - 1].date).replace(/ \d{4}$/, '')}` : '';
  return `<a class="row" href="#/booking/${encodeURIComponent(b.id)}">
    ${dateBox(days[0].date)}
    <div class="main">
      <div class="title">${esc(b.clientName)} <span class="days-tag">${days.length} days</span></div>
      <div class="sub">${esc(days.map((fn) => fn.type).join(', '))}${range ? ' · ' + esc(range) : ''}</div>
      <div class="sub">${names.length ? 'Team: ' + esc(names.join(', ')) : ''}${noTeam.length ? `${names.length ? ' · ' : ''}<span class="shortage">No team: ${esc(noTeam.join(', '))}</span>` : ''}</div>
    </div>
    <span class="chev">${ICONS.chevron}</span>
  </a>`;
}
