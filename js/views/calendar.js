import { ICONS } from '../ui.js';
import { esc, fmtDate, isoDate, todayISO, parseDate, allFunctions, MONTHS_LONG, allTeamClashes, clashText } from '../util.js';
import { functionRow, pageHead } from './parts.js';
import { gigRow } from './gigs.js';
import { state } from '../db.js';

let month = null; // Date at 1st of shown month
let selected = null; // ISO date

export function renderCalendar(view, dateParam) {
  if (dateParam && parseDate(dateParam)) {
    selected = dateParam;
    const d = parseDate(dateParam);
    month = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  if (!month) {
    const n = new Date();
    month = new Date(n.getFullYear(), n.getMonth(), 1);
  }
  if (!selected) selected = todayISO();

  const byDate = {};
  for (const x of allFunctions()) {
    if (!x.fn.date) continue;
    (byDate[x.fn.date] ||= []).push(x);
  }

  const gigsByDate = {};
  for (const g of state.gigs || []) {
    if (!g.date || g.status === 'Cancelled') continue;
    (gigsByDate[g.date] ||= []).push(g);
  }

  const clashList = allTeamClashes();
  const clashOn = new Set(clashList.map((c) => c.date));
  const today = todayISO();
  const startDow = month.getDay();
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - startDow);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    if (i >= 35 && d.getMonth() !== month.getMonth()) break;
    const iso = isoDate(d);
    const n = (byDate[iso] || []).length;
    const cls = ['cal-day', d.getMonth() !== month.getMonth() ? 'out' : '', iso === today ? 'today' : '', clashOn.has(iso) ? 'clash' : ''].filter(Boolean).join(' ');
    const gn = (gigsByDate[iso] || []).length;
    const label = `${fmtDate(iso)}${n ? `, ${n} function${n > 1 ? 's' : ''}` : ''}${gn ? `, ${gn} freelance job${gn > 1 ? 's' : ''}` : ''}${clashOn.has(iso) ? ', team clash' : ''}`;
    cells.push(`<button type="button" class="${cls}" data-date="${iso}" aria-pressed="${iso === selected}" aria-label="${esc(label)}">
      <span class="n">${d.getDate()}</span><span class="dots">${'<i></i>'.repeat(Math.min(n, 3))}${'<i class="gig"></i>'.repeat(Math.min(gn, 2))}</span></button>`);
  }

  // Month summary
  const mk = isoDate(month).slice(0, 7);
  const monthDates = Object.keys(byDate).filter((d) => d.startsWith(mk));
  const monthCount = monthDates.reduce((s, d) => s + byDate[d].length, 0);
  const monthClashes = monthDates.filter((d) => clashOn.has(d)).length;

  const dayList = byDate[selected] || [];
  const dayGigs = gigsByDate[selected] || [];

  view.innerHTML = `
    ${pageHead('Calendar', { actions: `<button type="button" class="btn ghost small" data-today>Today</button>` })}
    <div class="cal-head">
      <button type="button" class="icon-btn" data-prev aria-label="Previous month">${ICONS.left}</button>
      <h2>${MONTHS_LONG[month.getMonth()]} ${month.getFullYear()}</h2>
      <button type="button" class="icon-btn" data-next aria-label="Next month">${ICONS.right}</button>
    </div>
    <div class="cal">
      <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="cal-dow" aria-hidden="true">${d}</div>`).join('')}${cells.join('')}</div>
    </div>
    <div class="cal-legend"><span><i></i>Function</span><span class="g"><i></i>My freelance</span><span class="c"><i></i>Clash</span><span style="margin-left:auto">${monthCount} this month${monthClashes ? `, ${monthClashes} clash day${monthClashes > 1 ? 's' : ''}` : ''}</span></div>

    <section class="section">
      <div class="section-head"><h2>${esc(fmtDate(selected))}</h2></div>
      ${clashList.filter((c) => c.date === selected).map((c) => `<div class="banner bad" style="margin:0 0 10px">${ICONS.warn}<div>${esc(clashText(c))}</div></div>`).join('')}
      <div class="list">${dayList.length ? dayList.map((x) => functionRow(x, { showDate: false })).join('') : `<div class="empty">${dayGigs.length ? 'No functions of your own.' : 'Free day. No functions.'}</div>`}</div>
      ${dayGigs.length ? `<div class="section-head mt"><h2 style="font-size:19px">My freelance</h2></div><div class="list">${dayGigs.map(gigRow).join('')}</div>` : ''}
    </section>
  `;

  view.querySelector('[data-prev]').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(view); };
  view.querySelector('[data-next]').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(view); };
  view.querySelector('[data-today]').onclick = () => {
    const n = new Date(); month = new Date(n.getFullYear(), n.getMonth(), 1); selected = todayISO(); renderCalendar(view);
  };
  view.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => {
    selected = b.dataset.date;
    const d = parseDate(selected);
    if (d.getMonth() !== month.getMonth()) month = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCalendar(view);
  }));
}
