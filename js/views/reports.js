// Reports: one event in full (#/report/<id>) and the whole studio by month (#/reports).
import { state } from '../db.js';
import {
  esc, rs, num, fmtDate, todayISO, bookingTotals, getBooking, getFreelancer, shiftLabel, dayTeamStatus, itemDays, needsBooking,
  freelancerWork, MONTHS_LONG,
} from '../util.js';
import { journey, freelancerRating, stars, daysLabel, isExtraForClient } from '../studio.js';
import { pageHead, statusBadge } from './parts.js';

const byDate = (x, y) => ((x.date || '') + (x.time || '')).localeCompare((y.date || '') + (y.time || ''));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const waShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

// ================= One event =================
export function renderReport(view, id) {
  const b = getBooking(id);
  if (!b) { view.innerHTML = `${pageHead('Not found', { backTo: '#/bookings' })}<div class="empty">This event does not exist anymore.</div>`; return; }
  const t = bookingTotals(b);
  const fns = (b.functions || []).slice().sort(byDate);
  const j = journey(b);
  const costs = t.teamCost + t.expenses;
  const margin = pct(t.profit, t.total);
  const teamRows = (b.team || []).map((a) => ({ a, f: getFreelancer(a.freelancerId), fn: fns.find((x) => x.id === a.functionId) }));

  view.innerHTML = `
    ${pageHead('Event report', { backTo: '#/booking/' + encodeURIComponent(b.id) })}
    <div class="report">
      <div class="card pad">
        <div class="report-title"><h2>${esc(b.clientName)}</h2>${statusBadge(b.status)}</div>
        <p class="muted small" style="margin:4px 0 0">${esc([b.contact, b.city, daysLabel(fns), fns.length ? `${fmtDate(fns[0].date)} – ${fmtDate(fns[fns.length - 1].date)}` : ''].filter(Boolean).join(' · '))}</p>
        <p class="small" style="margin:8px 0 0">Journey: <b>${j.doneCount} of ${j.total}</b> done${j.next ? ` · next: ${esc(j.next.label)}` : ' · closed ✓'}</p>
      </div>

      <section class="section">
        <div class="section-head"><h2>Money</h2></div>
        <div class="card pad"><dl class="kv">
          <dt>Package price</dt><dd>${rs(t.packageAmount)}</dd>
          ${t.extras ? `<dt>Equipment billed to client</dt><dd>${rs(t.extras)}</dd>` : ''}
          ${num(b.discount) ? `<dt>Discount given</dt><dd>${rs(b.discount)}</dd>` : ''}
          <dt><b>Client total</b></dt><dd><b>${rs(t.total)}</b></dd>
          <dt>Received</dt><dd class="pos">${rs(t.received)}</dd>
          <dt>Client still owes</dt><dd class="${t.due > 0 ? 'neg' : ''}">${rs(t.due)}</dd>
          <dt>Team cost</dt><dd>${rs(t.teamCost)} <small class="muted">(paid ${rs(t.teamPaid)})</small></dd>
          <dt>Expenses &amp; production</dt><dd>${rs(t.expenses)}</dd>
          <dt><b>Profit</b></dt><dd class="${t.profit >= 0 ? 'pos' : 'neg'}"><b>${rs(t.profit)}</b> <small class="muted">(${margin}% margin)</small></dd>
        </dl>
        <div class="bar mt" title="Costs vs income"><i style="width:${Math.min(100, pct(costs, t.total))}%;background:var(--bad)"></i></div>
        <p class="muted small" style="margin:6px 0 0">Costs are ${pct(costs, t.total)}% of the client total.</p></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Days &amp; team</h2></div>
        ${fns.map((fn) => {
          const st = dayTeamStatus(b, fn);
          const rows = teamRows.filter((x) => x.a.functionId === fn.id || !x.a.functionId);
          return `<div class="card pad report-day">
            <div class="event-day-top"><b>${esc(fn.type)}</b><span class="muted small">${esc(fmtDate(fn.date))} · ${esc(shiftLabel(fn))}</span><span class="day-st ${st.ok ? 'ok' : 'bad'}">${esc(st.label)}</span></div>
            ${fn.venue ? `<div class="sub muted">${esc(fn.venue)}</div>` : ''}
            <table class="rtable"><tbody>${rows.length ? rows.map((x) => `<tr><td>${esc(x.f ? x.f.name : 'Deleted')}<small class="muted"> ${esc(x.f ? x.f.role : '')}</small>${num(x.a.rating) ? ` <span class="stars">${stars(num(x.a.rating))}</span>` : ''}</td>
              <td class="num">${rs(x.a.agreed)}</td><td class="num ${num(x.a.paid) >= num(x.a.agreed) ? 'pos' : 'neg'}">${num(x.a.paid) >= num(x.a.agreed) ? 'paid' : rs(num(x.a.agreed) - num(x.a.paid)) + ' due'}</td></tr>`).join('')
              : '<tr><td class="shortage" colspan="3">No team</td></tr>'}</tbody></table>
          </div>`;
        }).join('')}
      </section>

      ${(b.expenses || []).length ? `<section class="section">
        <div class="section-head"><h2>Expenses &amp; production</h2></div>
        <div class="card pad"><table class="rtable"><tbody>${(b.expenses || []).map((e) => `<tr>
          <td>${esc(e.category)}<small class="muted"> ${esc(fns.length > 1 ? (e.functionIds?.length ? itemDays(b, e).map((d) => d.type).join(', ') : 'all days') : '')}</small>
            ${needsBooking(e) ? '<span class="badge warn">to book</span>' : ''}${isExtraForClient(e) ? `<span class="badge accent">client pays ${rs(e.chargeClient ?? e.amount)}</span>` : ''}</td>
          <td class="num">${rs(e.amount)}</td></tr>`).join('')}</tbody></table></div>
      </section>` : ''}

      <section class="section">
        <div class="section-head"><h2>Client payments</h2></div>
        <div class="card pad"><table class="rtable"><tbody>${(b.payments || []).length ? (b.payments || []).slice().sort(byDate).map((p) => `<tr><td>${esc(fmtDate(p.date))}<small class="muted"> ${esc(p.method || '')}</small></td><td class="num">${rs(p.amount)}</td></tr>`).join('')
          : '<tr><td class="muted">No payments yet</td></tr>'}</tbody></table></div>
      </section>

      <div class="form-actions no-print">
        <a class="btn ghost" target="_blank" rel="noopener" href="${esc(waShare(eventSummaryText(b)))}">Share on WhatsApp</a>
        <button type="button" class="btn primary" data-print>Save PDF / Print</button>
      </div>
    </div>`;
  view.querySelector('[data-print]').onclick = () => window.print();
}

// Short text version for WhatsApp (to a partner, accountant or your own notes).
export function eventSummaryText(b) {
  const t = bookingTotals(b);
  const fns = (b.functions || []).slice().sort(byDate);
  const team = (fn) => (b.team || []).filter((a) => a.functionId === fn.id || !a.functionId).map((a) => getFreelancer(a.freelancerId)?.name).filter(Boolean);
  return [
    `*Event report: ${b.clientName}*`,
    ...fns.map((fn) => `• ${fn.type} ${fmtDate(fn.date)} (${shiftLabel(fn)}): ${team(fn).join(', ') || 'no team'}`),
    '',
    `Total ${rs(t.total)} · Received ${rs(t.received)} · Due ${rs(t.due)}`,
    `Team ${rs(t.teamCost)} · Expenses ${rs(t.expenses)}`,
    `*Profit ${rs(t.profit)}* (${pct(t.profit, t.total)}%)`,
  ].join('\n');
}

// ================= Whole studio =================
const monthKey = (iso) => (iso || '').slice(0, 7);
const firstDay = (b) => (b.functions || []).map((f) => f.date).filter(Boolean).sort()[0] || '';

export function renderReports(view) {
  const active = state.bookings.filter((b) => b.status !== 'Cancelled');
  const now = new Date();
  const months = [];
  for (let i = -5; i <= 3; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const rows = months.map((m) => {
    const evs = active.filter((b) => monthKey(firstDay(b)) === m);
    const tt = evs.map(bookingTotals);
    const received = state.bookings.flatMap((b) => b.payments || []).filter((p) => monthKey(p.date) === m).reduce((s, p) => s + num(p.amount), 0);
    return {
      m, events: evs.length, functions: evs.reduce((s, b) => s + (b.functions || []).length, 0),
      booked: tt.reduce((s, x) => s + x.total, 0), received, costs: tt.reduce((s, x) => s + x.teamCost + x.expenses, 0), profit: tt.reduce((s, x) => s + x.profit, 0),
    };
  });
  const all = active.map(bookingTotals);
  const clientsOwe = all.reduce((s, x) => s + x.due, 0);
  const teamOwe = all.reduce((s, x) => s + x.teamPending, 0);
  const counts = ['Inquiry', 'Booked', 'Completed', 'Editing', 'Delivered'].map((st) => [st, active.filter((b) => b.status === st).length]);
  const today = todayISO();
  const needAttention = active.filter((b) => firstDay(b) >= today || b.status !== 'Delivered').map((b) => ({ b, j: journey(b) })).filter((x) => x.j.next).sort((x, y) => firstDay(x.b).localeCompare(firstDay(y.b))).slice(0, 8);
  const team = state.freelancers.map((f) => ({ f, jobs: freelancerWork(f.id).length, r: freelancerRating(f.id) })).filter((x) => x.jobs)
    .sort((x, y) => (y.r?.avg || 0) - (x.r?.avg || 0) || y.jobs - x.jobs);
  const label = (m) => { const [y, mm] = m.split('-'); return `${MONTHS_LONG[+mm - 1]} ${y}`; };
  const thisM = monthKey(today);

  view.innerHTML = `
    ${pageHead('Studio report', { backTo: '#/more' })}
    <div class="stats">
      <div class="stat"><small>Clients owe you</small><strong class="${clientsOwe ? 'neg' : ''}">${rs(clientsOwe)}</strong></div>
      <div class="stat"><small>Team still to be paid</small><strong>${rs(teamOwe)}</strong></div>
    </div>
    <div class="badges mt">${counts.map(([s, n]) => `<span class="badge">${esc(s)} ${n}</span>`).join('')}</div>

    <section class="section">
      <div class="section-head"><h2>By month</h2><span class="muted small">by first event day</span></div>
      <div class="list">${rows.filter((r) => r.events || r.received || r.m === thisM).map((r) => `<div class="row month-row${r.m === thisM ? ' this-month' : ''}"><div class="main">
        <div class="title">${label(r.m)}${r.m === thisM ? ' <small class="muted">this month</small>' : ''} <span class="muted small">· ${r.events} event${r.events === 1 ? '' : 's'}${r.functions > r.events ? ` (${r.functions} functions)` : ''}</span></div>
        <div class="month-nums"><span><small>Booked</small>${rs(r.booked)}</span><span><small>Received</small>${rs(r.received)}</span><span><small>Profit</small><b class="${r.profit < 0 ? 'neg' : 'pos'}">${rs(r.profit)}</b></span></div>
      </div></div>`).join('') || '<div class="empty">No events yet.</div>'}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Needs attention</h2><span class="muted small">next step of each event</span></div>
      <div class="list">${needAttention.length ? needAttention.map(({ b, j }) => `<a class="row" href="#/booking/${encodeURIComponent(b.id)}"><div class="main">
        <div class="title">${esc(b.clientName)} <small class="muted">${esc(fmtDate(firstDay(b)))}</small></div>
        <div class="sub">${j.doneCount}/${j.total} · Next: ${esc(j.next.label)}</div></div><span class="chev">›</span></a>`).join('') : '<div class="empty">Everything is on track.</div>'}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Team performance</h2></div>
      <div class="list">${team.length ? team.map(({ f, jobs, r }) => `<a class="row" href="#/freelancer/${encodeURIComponent(f.id)}"><div class="main">
        <div class="title">${esc(f.name)} <small class="muted">${esc(f.role)}</small></div>
        <div class="sub">${jobs} job${jobs === 1 ? '' : 's'} · ${r ? `<span class="stars">${stars(r.avg)}</span> ${r.avg.toFixed(1)} (${r.count} rated)` : 'not rated yet'}</div></div></a>`).join('') : '<div class="empty">No team jobs yet.</div>'}</div>
    </section>`;
}
