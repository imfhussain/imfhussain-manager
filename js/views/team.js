import { state, save, uid } from '../db.js';
import { ICONS, formSheet, confirmSheet, toast, openSheet } from '../ui.js';
import { esc, rs, num, fmtDate, todayISO, getFreelancer, freelancerTotals, freelancerWork, jobIsDue, ROLES, lastEvents, nextEvent, shiftLabel, allTeamClashes, clashText, bookedDates } from '../util.js';
import { compressAvatar } from '../images.js';
import { pageHead } from './parts.js';
import { go, rerender } from '../app.js';
import { assignToEvent } from '../assign.js';
import { ratingText, freelancerRating, stars } from '../studio.js';
import { waButton, waSheet, freelancerJobMessage, freelancerPaymentMessage } from '../whatsapp.js';

export function avatarHTML(f, cls = '') {
  if (f.photo) return `<div class="avatar ${cls}"><img src="${f.photo}" alt=""></div>`;
  const initials = (f.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<div class="avatar ${cls}" aria-hidden="true">${esc(initials)}</div>`;
}

// Money for one person, shown the same way everywhere: Total work, Paid, Due now + a bar.
// "Due now" counts only events that have already happened; upcoming events show as "later".
export function moneyLine(t) {
  const pct = t.agreed > 0 ? Math.round((t.paid / t.agreed) * 100) : 0;
  return `<div class="money-line">
      <span><small>Total work</small><b>${rs(t.agreed)}</b></span>
      <span><small>Paid</small><b class="ok">${rs(t.paid)}</b></span>
      <span><small>Due now</small><b class="${t.dueNow > 0 ? 'bad' : 'ok'}">${rs(t.dueNow)}</b></span>
    </div>
    <div class="bar" role="img" aria-label="${pct}% paid"><i style="width:${pct}%"></i></div>
    ${t.later > 0 ? `<p class="later-note">+ ${rs(t.later)} assigned for upcoming events (due after the event)</p>` : ''}`;
}

// Who is free today — shown in the "tap to assign" list.
function todayNote(f) {
  const today = todayISO();
  const job = freelancerWork(f.id).find((w) => w.date === today && w.booking.status !== 'Cancelled');
  return job ? `Busy today: ${job.booking.clientName}` : 'Free today';
}

// "3 dates booked · next 14 Nov" for the team lists.
function datesNote(f) {
  const d = bookedDates(f.id);
  if (!d.upcoming.length) return 'No dates booked';
  return `${d.upcoming.length} date${d.upcoming.length === 1 ? '' : 's'} booked · next ${fmtDate(d.next.date)}`;
}

function assignRow(f) {
  return `<button type="button" class="row assign-row" data-assign="${esc(f.id)}">
    ${avatarHTML(f)}
    <div class="main"><div class="title">${esc(f.name)}</div>
      <div class="sub">${esc(f.role)}${num(f.rate) ? ' · ' + rs(f.rate) + '/day' : ''} · ${esc(todayNote(f))}</div>
      <div class="sub dates-note">${esc(datesNote(f))}</div>
      ${ratingText(f.id) ? `<div class="sub stars">${esc(ratingText(f.id))}</div>` : ''}</div>
    <span class="assign-btn">Assign</span>
  </button>`;
}

function personRow({ f, t, jobs }) {
  return `<a class="row person" href="#/freelancer/${encodeURIComponent(f.id)}">
    ${avatarHTML(f)}
    <div class="main">
      <div class="person-top">
        <div><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.role)} · ${esc(datesNote(f))}</div></div>
        ${t.dueNow > 0 ? `<span class="due-tag">Due ${rs(t.dueNow)}</span>`
          : t.later > 0 ? `<span class="later-tag">Assigned ${rs(t.later)}</span>`
          : jobs ? `<span class="badge ok">All paid ✓</span>` : `<span class="badge">No jobs</span>`}
      </div>
      ${jobs ? moneyLine(t) : ''}
    </div>
  </a>`;
}

// Top card: what is due now, and what comes later.
function oweCard(t, who, jobsCount) {
  const state = t.dueNow > 0 ? '' : 'clear';
  const title = t.dueNow > 0 ? `Due now to ${who}` : t.later > 0 ? 'Nothing due right now' : jobsCount ? 'Fully paid ✓' : 'No jobs yet';
  return `<div class="owe-card ${state}">
      <small>${esc(title)}</small>
      <strong>${rs(t.dueNow)}</strong>
      <div class="bar"><i style="width:${t.agreed > 0 ? Math.round((t.paid / t.agreed) * 100) : 0}%"></i></div>
      <p>Paid ${rs(t.paid)} of ${rs(t.agreed)} total work${jobsCount != null ? ` · ${jobsCount} job${jobsCount === 1 ? '' : 's'}` : ''}</p>
      ${t.later > 0 ? `<p class="later-line">+ <b>${rs(t.later)}</b> assigned for upcoming events — due after each event</p>` : ''}
    </div>`;
}

// Team category filter (by role). Remembered while the app is open.
let roleFilter = 'All';
const roleShort = (r) => (r === 'Drone Operator' ? 'Drone' : r);

export function renderTeam(view) {
  const list = state.freelancers.map((f) => ({ f, t: freelancerTotals(f.id), jobs: freelancerWork(f.id).length }));
  const sum = list.reduce((s, x) => ({
    agreed: s.agreed + x.t.agreed, paid: s.paid + x.t.paid, pending: s.pending + x.t.pending, dueNow: s.dueNow + x.t.dueNow, later: s.later + x.t.later,
  }), { agreed: 0, paid: 0, pending: 0, dueNow: 0, later: 0 });
  const toPay = list.filter((x) => x.t.dueNow > 0).sort((a, b) => b.t.dueNow - a.t.dueNow);
  const laterList = list.filter((x) => x.t.dueNow <= 0 && x.t.later > 0).sort((a, b) => b.t.later - a.t.later);
  const cleared = list.filter((x) => x.t.pending <= 0).sort((a, b) => a.f.name.localeCompare(b.f.name));

  view.innerHTML = `
    ${pageHead('Team')}
    ${list.length ? oweCard(sum, 'your team') : ''}

    ${list.length ? `<section class="section">
      <div class="section-head"><h2>Freelancers</h2><span class="muted small">Tap to assign to an event</span></div>
      <div class="chips" role="group" aria-label="Team category">
        ${['All', ...ROLES].map((r) => `<button type="button" class="chip" data-role="${esc(r)}" aria-pressed="${r === roleFilter}">${esc(roleShort(r))}<span class="count">${r === 'All' ? list.length : list.filter((x) => x.f.role === r).length}</span></button>`).join('')}
      </div>
      <div class="list mt" data-assign-list></div>
    </section>` : ''}

    ${toPay.length ? `<section class="section">
      <div class="section-head"><h2>Pay now</h2><span class="muted small">${toPay.length} ${toPay.length === 1 ? 'person' : 'people'}</span></div>
      <div class="list">${toPay.map(personRow).join('')}</div>
    </section>` : ''}

    ${laterList.length ? `<section class="section">
      <div class="section-head"><h2>Assigned (event not done yet)</h2><span class="muted small">${laterList.length} ${laterList.length === 1 ? 'person' : 'people'}</span></div>
      <div class="list">${laterList.map(personRow).join('')}</div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>${toPay.length || laterList.length ? 'All paid' : 'Team'}</h2></div>
      <div class="list">${cleared.length ? cleared.map(personRow).join('')
        : list.length ? `<div class="empty">Nobody is fully paid yet.</div>`
        : `<div class="empty">No freelancers yet. Tap + to add your photographers, videographers, drone operators and editors.</div>`}</div>
    </section>
    <button type="button" class="fab" data-add aria-label="Add freelancer">${ICONS.plus}</button>
  `;
  view.querySelector('[data-add]').onclick = async () => { const f = await editFreelancer(); if (f) rerender(); };
  const listEl = view.querySelector('[data-assign-list]');
  const drawPeople = () => {
    if (!listEl) return;
    const people = list.map((x) => x.f).filter((f) => roleFilter === 'All' || f.role === roleFilter).sort((a, b) => a.name.localeCompare(b.name));
    listEl.innerHTML = people.length ? people.map(assignRow).join('')
      : `<div class="empty">No ${esc(roleFilter)} in your team yet.<br><button type="button" class="btn outline mt" data-add-role>Add ${esc(roleFilter)}</button></div>`;
    listEl.querySelectorAll('[data-assign]').forEach((el) => {
      el.onclick = async () => { if (await assignToEvent(getFreelancer(el.dataset.assign))) rerender(); };
    });
    const addRole = listEl.querySelector('[data-add-role]');
    if (addRole) addRole.onclick = async () => { if (await editFreelancer(null, { role: roleFilter })) rerender(); };
  };
  view.querySelectorAll('[data-role]').forEach((c) => {
    c.onclick = () => {
      roleFilter = c.dataset.role;
      view.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      drawPeople();
    };
  });
  drawPeople();
}

export async function editFreelancer(existing, preset = {}) {
  const f = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit freelancer' : 'New freelancer',
    danger: existing ? 'Delete freelancer' : null,
    fields: [
      { type: 'html', html: importButtonsHTML() },
      { name: 'photo', label: 'Photo (optional)', type: 'photo', value: f.photo || '' },
      { name: 'name', label: 'Name', required: true, value: f.name },
      { name: 'role', label: 'Role', type: 'select', options: ROLES, value: f.role || preset.role || 'Photographer' },
      { name: 'contact', label: 'Contact no.', type: 'tel', value: f.contact, placeholder: '03xx xxxxxxx' },
      { name: 'rate', label: 'Usual rate per day', type: 'money', value: f.rate ?? '' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', value: f.remarks },
    ],
    onMount: (form) => bindImport(form),
  });
  if (!v) return null;
  if (v.__danger) {
    const jobs = freelancerWork(existing.id).length;
    const ok = await confirmSheet({
      title: 'Delete freelancer?',
      message: jobs
        ? `${existing.name} is assigned to ${jobs} job(s). Deleting will also remove those team assignments and their payment records. This cannot be undone.`
        : `Delete ${existing.name}? This cannot be undone.`,
    });
    if (!ok) return null;
    state.freelancers = state.freelancers.filter((x) => x.id !== existing.id);
    for (const b of state.bookings) b.team = (b.team || []).filter((a) => a.freelancerId !== existing.id);
    await save();
    toast('Freelancer deleted');
    go('#/team');
    return null;
  }
  v.rate = num(v.rate);
  if (existing) {
    Object.assign(existing, v);
    await save('freelancers');
    toast('Freelancer saved');
    rerender();
    return existing;
  }
  const nf = { id: uid(), ...v };
  state.freelancers.push(nf);
  await save('freelancers');
  toast('Freelancer added');
  return nf;
}

function jobSection(title, note, jobs, f, cls) {
  if (!jobs.length) return '';
  return `<section class="section">
      <div class="section-head"><h2>${title}</h2><span class="muted small">${jobs.length} job${jobs.length === 1 ? '' : 's'} · ${note}</span></div>
      <div class="list">${jobs.map(({ booking: b, assignment: a, fn, date }) => {
        const left = num(a.agreed) - num(a.paid);
        return `<div class="row">
          <a class="main" href="#/booking/${encodeURIComponent(b.id)}">
            <div class="title">${esc(b.clientName)}</div>
            <div class="sub">${esc(fn ? fn.type : 'Whole booking')} · ${esc(fmtDate(date))}</div>
            <div class="sub">Total ${rs(a.agreed)}${num(a.paid) ? ` · Paid ${rs(a.paid)}` : ''} · ${cls === 'later' ? `<b class="later">Due after ${esc(fmtDate(date))}</b>` : `<b class="bad">Due ${rs(left)}</b>`}</div>
          </a>
          <div class="end job-btns"><button type="button" class="btn ${cls === 'later' ? 'outline' : 'primary'} small" data-pay="${b.id}|${a.id}" aria-label="Pay ${esc(f.name)} for ${esc(b.clientName)}">${cls === 'later' ? 'Pay early' : 'Pay'}</button>
            <button type="button" class="btn ghost small" data-edit-job="${b.id}|${a.id}" aria-label="Edit job">Edit</button></div>
        </div>`;
      }).join('')}</div>
    </section>`;
}

export function renderFreelancer(view, id) {
  const f = getFreelancer(id);
  if (!f) {
    view.innerHTML = `${pageHead('Not found', { backTo: '#/team' })}<div class="empty">This freelancer does not exist anymore.</div>`;
    return;
  }
  const t = freelancerTotals(f.id);
  const work = freelancerWork(f.id);
  const last = lastEvents(f.id, 2);
  const next = nextEvent(f.id);
  const clashes = allTeamClashes().filter((c) => c.freelancer.id === f.id);
  const unpaid = work.filter((w) => num(w.assignment.agreed) - num(w.assignment.paid) > 0);
  const dueJobs = unpaid.filter((w) => jobIsDue(w.booking, w.assignment));
  const laterJobs = unpaid.filter((w) => !jobIsDue(w.booking, w.assignment)).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const paidJobs = work.filter((w) => !(num(w.assignment.agreed) - num(w.assignment.paid) > 0));

  view.innerHTML = `
    ${pageHead(f.name, { backTo: '#/team', actions: `<button type="button" class="icon-btn" data-edit aria-label="Edit freelancer">${ICONS.edit}</button>` })}
    <div class="card pad">
      <div class="detail-top">
        ${avatarHTML(f, 'lg')}
        <div class="who" style="flex:1"><span class="badge accent">${esc(f.role)}</span>${freelancerRating(f.id) ? ` <span class="stars" title="Average rating">${stars(freelancerRating(f.id).avg)} ${freelancerRating(f.id).avg.toFixed(1)}</span> <small class="muted">(${freelancerRating(f.id).count} rated)</small>` : ''}<p>${num(f.rate) ? 'Usual rate ' + rs(f.rate) + ' per day' : 'No usual rate set'}</p></div>
        ${f.contact ? `<div class="contact-btns"><a class="call" href="tel:${esc(f.contact.replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(f.contact)}</a>${waButton(f.contact)}</div>` : ''}
      </div>
      ${f.remarks ? `<div class="remarks">${esc(f.remarks)}</div>` : ''}
    </div>
    <div class="mt">${oweCard(t, esc(f.name.split(' ')[0]), work.length)}</div>
    <button type="button" class="btn block mt" data-assign-event>Assign to an event</button>
    ${t.dueNow > 0 && dueJobs.length > 1
      ? `<button type="button" class="btn outline block mt" data-pay-all>Pay all due now (${rs(t.dueNow)})</button>` : ''}

    ${clashes.map((c) => `<div class="banner bad">${ICONS.warn}<div>${esc(clashText(c))}</div></div>`).join('')}


    ${(() => {
      const d = bookedDates(f.id);
      const months = new Map();
      for (const x of d.upcoming) { const k = x.date.slice(0, 7); months.set(k, [...(months.get(k) || []), x]); }
      const monthName = (k) => new Date(k + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      return `<section class="section">
        <div class="section-head"><h2>Booked dates</h2></div>
        <div class="date-stats card pad">
          <div><b>${d.upcoming.length}</b><span>Upcoming</span></div>
          <div><b>${d.thisMonth}</b><span>This month</span></div>
          <div><b>${d.done}</b><span>Done</span></div>
        </div>
        ${d.upcoming.length ? [...months].map(([k, list]) => `
          <div class="muted small month-label">${esc(monthName(k))} · ${list.length} date${list.length === 1 ? '' : 's'}</div>
          <div class="list">${list.map((x) => `<a class="row" href="#/booking/${encodeURIComponent(x.items[0].booking.id)}">
            <div class="cal-date"><b>${new Date(x.date + 'T00:00').getDate()}</b><small>${new Date(x.date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</small></div>
            <div class="main"><div class="title">${esc([...new Set(x.items.map((i) => i.booking.clientName))].join(' + '))}</div>
              <div class="sub">${x.items.map((i) => `${esc(i.fn.type)} · ${esc(shiftLabel(i.fn))}`).join(' / ')}</div></div>
            <span class="chev">${ICONS.chevron}</span></a>`).join('')}</div>`).join('')
        : '<div class="empty">No upcoming dates. Tap "Assign to an event" to book this person.</div>'}
      </section>`;
    })()}
    <section class="section">
      <div class="section-head"><h2>Last 2 events</h2></div>
      <div class="list">${last.length ? last.map((x) => `
        <a class="row" href="#/booking/${encodeURIComponent(x.booking.id)}">
          <div class="main"><div class="title">${esc(x.booking.clientName)}</div>
            <div class="sub">${esc(x.fn.type)} · ${esc(fmtDate(x.fn.date))} · ${esc(shiftLabel(x.fn))}</div></div>
          <span class="chev">${ICONS.chevron}</span>
        </a>`).join('') : `<div class="empty">No past events yet.${next ? ` Next: ${esc(next.fn.type)}, ${esc(next.booking.clientName)} on ${esc(fmtDate(next.fn.date))}.` : ''}</div>`}</div>
    </section>

    ${(() => {
      const rated = work.filter((w) => num(w.assignment.rating)).sort((x, y) => (y.date || '').localeCompare(x.date || '')).slice(0, 6);
      return rated.length ? `<section class="section">
        <div class="section-head"><h2>Performance</h2><span class="muted small">Your ratings after events</span></div>
        <div class="list">${rated.map((w) => `<a class="row" href="#/booking/${encodeURIComponent(w.booking.id)}"><div class="main">
          <div class="title"><span class="stars">${stars(num(w.assignment.rating))}</span> ${esc(w.booking.clientName)}</div>
          <div class="sub">${esc(w.fn ? w.fn.type : 'Whole booking')} · ${esc(fmtDate(w.date))}${w.assignment.ratingNote ? ' · ' + esc(w.assignment.ratingNote) : ''}</div></div></a>`).join('')}</div>
      </section>` : '';
    })()}

    ${jobSection('Due now', 'Event done', dueJobs, f, 'bad')}
    ${jobSection('Assigned', 'Due after the event', laterJobs, f, 'later')}

    <section class="section">
      <div class="section-head"><h2>Paid jobs</h2><span class="muted small">${paidJobs.length} job${paidJobs.length === 1 ? '' : 's'}</span></div>
      <div class="list">${paidJobs.length ? paidJobs.map(({ booking: b, assignment: a, fn, date }) => `
        <a class="row" href="#/booking/${encodeURIComponent(b.id)}">
          <div class="main">
            <div class="title">${esc(b.clientName)}</div>
            <div class="sub">${esc(fn ? fn.type : 'Whole booking')} · ${esc(fmtDate(date))}</div>
            <div class="sub">Paid ${rs(a.paid)}${a.paidDate ? ' on ' + esc(fmtDate(a.paidDate)) : ''}</div>
          </div>
          <span class="badge ok">Paid ✓</span>
        </a>`).join('') : `<div class="empty">${work.length ? 'Nothing fully paid yet.' : "Not assigned to any booking yet. Assign from a booking's Team section."}</div>`}</div>
    </section>
  `;

  view.querySelector('[data-edit]').onclick = () => editFreelancer(f);
  view.querySelectorAll('[data-edit-job]').forEach((el) => el.onclick = async () => {
    const [bid, aid] = el.dataset.editJob.split('|');
    const b = state.bookings.find((x) => x.id === bid);
    const a = b && b.team.find((x) => x.id === aid);
    if (!a) return;
    const { editAssignment } = await import('./bookings.js');
    editAssignment(b, a);
  });
  view.querySelector('[data-assign-event]').onclick = async () => { if (await assignToEvent(f)) rerender(); };
  const wa = view.querySelector('[data-wa]');
  if (wa) wa.onclick = () => {
    const today = todayISO();
    const upcoming = work.filter((w) => w.date >= today).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    waSheet(`WhatsApp ${f.name}`, f.contact, [
      ...upcoming.slice(0, 3).map((w) => ({ label: `Job details: ${w.booking.clientName}, ${w.fn ? w.fn.type : 'whole booking'} (${fmtDate(w.date)})`, text: freelancerJobMessage(w.booking, w.assignment) })),
      work.length ? { label: t.dueNow > 0 ? `Payment details (${rs(t.dueNow)} due now)` : t.later > 0 ? `Payment details (${rs(t.later)} assigned)` : 'Payment details (all paid)', text: freelancerPaymentMessage(f) } : null,
    ]);
  };
  view.querySelectorAll('[data-pay]').forEach((btn) => btn.onclick = async () => {
    const [bid, aid] = btn.dataset.pay.split('|');
    const b = state.bookings.find((x) => x.id === bid);
    const a = b?.team.find((x) => x.id === aid);
    if (!a) return;
    const left = num(a.agreed) - num(a.paid);
    const v = await formSheet({
      title: `Pay ${f.name}`,
      submitLabel: 'Save payment',
      fields: [
        { type: 'note', label: `${b.clientName} · Total ${rs(a.agreed)} · Paid so far ${rs(a.paid)} · Due ${rs(left)}` },
        { name: 'amount', label: 'Amount paying now', type: 'money', value: left, required: true },
        { name: 'date', label: 'Date', type: 'date', value: todayISO() },
      ],
    });
    if (!v) return;
    const amt = Math.min(num(v.amount), left);
    if (amt <= 0) return;
    a.paid = num(a.paid) + amt;
    a.paidDate = v.date || todayISO();
    await save('bookings');
    toast(amt < left ? `Paid ${rs(amt)}. ${rs(left - amt)} still due` : `${f.name} fully paid for ${b.clientName}`);
    rerender();
  });
  const payAll = view.querySelector('[data-pay-all]');
  if (payAll) payAll.onclick = async () => {
    const ok = await confirmSheet({ title: 'Pay all due now?', message: `Mark ${f.name}'s finished jobs as paid today (${rs(t.dueNow)})? Upcoming jobs stay unpaid.`, ok: 'Mark all paid', danger: false });
    if (!ok) return;
    for (const { assignment: a } of dueJobs) { a.paid = num(a.agreed); a.paidDate = todayISO(); }
    await save('bookings');
    toast('All marked as paid');
    rerender();
  };
}

// ---------- Import from Contacts ----------
const hasPicker = () => 'contacts' in navigator && 'ContactsManager' in window;

export function importButtonsHTML() {
  return `<div class="import-box">
    <div class="btn-row">
      ${hasPicker() ? `<button type="button" class="btn outline small" data-pick-contact>${ICONS.contacts} Import from Contacts</button>` : ''}
      <label class="btn ghost small">Import contact card (.vcf)<input type="file" accept=".vcf,text/vcard,text/x-vcard" hidden data-vcf></label>
    </div>
    ${hasPicker() ? '' : `<p class="hint" style="margin:8px 0 0">To pick straight from your Contacts, turn on: iPhone Settings → Apps → Safari → Advanced → Feature Flags → <b>Contact Picker API</b>. Or in Contacts, open the person → Share Contact → Save to Files, then use "Import contact card".</p>`}
  </div>`;
}

// Fills a form from a picked contact. nameField: the form's name box ('name' for freelancers, 'clientName' for clients).
export function bindImport(form, { nameField = 'name' } = {}) {
  const fill = async ({ name, tel, photo }) => {
    const set = (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); };
    if (name && nameField && form.elements[nameField]) set(form.elements[nameField], name);
    if (tel && form.elements.contact) set(form.elements.contact, cleanPhone(tel));
    if (photo && form.querySelector('[data-photo]')) {
      try { form.querySelector('[data-photo]').setPhoto(await compressAvatar(photo)); } catch {}
    }
    toast(name ? `Imported ${name}` : 'Contact imported');
  };
  const fromContacts = async () => {
    try {
      // Only name and number. Asking for the photo made iPhone's "review" step hang
      // for contacts that came from WhatsApp, so the photo is added by hand instead.
      const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (!c) return;
      await fill({ name: c.name?.[0], tel: c.tel?.[0] });
    } catch (e) {
      if (e && e.name !== 'AbortError' && e.name !== 'InvalidStateError') toast('Could not open Contacts', 'bad');
    }
  };
  const fromFile = async (file) => {
    if (!file) return;
    const c = parseVCard(await file.text());
    if (!c.name && !c.tel) { toast('No contact found in this file', 'bad'); return; }
    await fill(c);
  };
  const pick = form.querySelector('[data-pick-contact]');
  if (pick) pick.onclick = fromContacts;

  // Contacts icon inside the phone number box.
  const tel = form.elements.contact;
  // A number pasted from WhatsApp (+92 300 1234567, with odd spaces) is tidied to 0300 1234567.
  if (tel) {
    const tidy = () => { const c = cleanPhone(tel.value); if (/^03\d{2} \d{7}$/.test(c) && c !== tel.value) tel.value = c; };
    tel.addEventListener('paste', () => setTimeout(tidy, 0));
    tel.addEventListener('blur', tidy);
  }
  if (tel && !tel.parentNode.classList.contains('tel-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'tel-wrap';
    tel.replaceWith(wrap);
    wrap.append(tel);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tel-pick';
    btn.setAttribute('aria-label', 'Pick from Contacts');
    btn.innerHTML = ICONS.contacts;
    wrap.append(btn);
    btn.onclick = (e) => {
      e.preventDefault();
      if (hasPicker()) { fromContacts(); return; }
      // Without the Safari setting, explain it and offer the contact-card file instead.
      openSheet({
        title: 'Pick from Contacts',
        body: `<p class="confirm-msg">To open your iPhone Contacts here, turn on once: Settings → Apps → Safari → Advanced → Feature Flags → <b>Contact Picker API</b>, then reopen this app.</p>
          <p class="muted small">Or in Contacts: open the person → Share Contact → Save to Files, then choose the file below.</p>
          <p class="muted small">Number only in WhatsApp? Open the chat → tap the name → hold the number → Copy, then paste it in the box. It is tidied to 03xx format by itself.</p>
          <label class="btn block mt">Choose contact card (.vcf)<input type="file" accept=".vcf,text/vcard,text/x-vcard" hidden data-sheet-vcf></label>`,
        onMount(sheet, close) {
          const inp = sheet.querySelector('[data-sheet-vcf]');
          inp.onchange = async () => { const file = inp.files[0]; close(); await fromFile(file); };
        },
      });
    };
  }
  const vcf = form.querySelector('[data-vcf]');
  if (vcf) vcf.onchange = async () => { const file = vcf.files[0]; vcf.value = ''; await fromFile(file); };
}

export function cleanPhone(t) {
  let d = String(t).replace(/[^\d+]/g, '');
  if (d.startsWith('+92')) d = '0' + d.slice(3);
  else if (d.startsWith('0092')) d = '0' + d.slice(4);
  if (/^03\d{9}$/.test(d)) return d.slice(0, 4) + ' ' + d.slice(4);
  return d;
}

// Reads the first contact in a vCard (.vcf) file: name, first phone number and photo.
export function parseVCard(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = { name: '', tel: '', photo: null };
  let nField = '';
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).toUpperCase();
    const val = line.slice(i + 1).trim();
    const base = key.split(';')[0].replace(/^ITEM\d+\./, '');
    if (base === 'END' && val.toUpperCase() === 'VCARD' && (out.name || out.tel)) break;
    if (base === 'FN' && !out.name) out.name = val.replace(/\\,/g, ',');
    else if (base === 'N' && !nField) nField = val;
    else if (base === 'TEL' && !out.tel) out.tel = val;
    else if (base === 'PHOTO' && !out.photo) {
      if (val.startsWith('data:')) out.photo = val;
      else if (/ENCODING=(B|BASE64)/.test(key) || /^[A-Za-z0-9+/=]{40,}$/.test(val)) {
        const type = (key.match(/TYPE=([A-Z]+)/) || [, 'JPEG'])[1].toLowerCase();
        out.photo = `data:image/${type === 'png' ? 'png' : 'jpeg'};base64,${val}`;
      }
    }
  }
  if (!out.name && nField) {
    const [last, first] = nField.split(';');
    out.name = [first, last].filter(Boolean).join(' ').trim();
  }
  return out;
}

// Long-press on a team member: every booked date, upcoming first, then history.
// Tap a date → open that event, or remove this person from that function.
export async function personDatesSheet(fid) {
  const f = getFreelancer(fid);
  if (!f) return;
  const { openSheet, actionSheet } = await import('../ui.js');
  const d = bookedDates(fid);
  const past = d.all.filter((x) => !d.upcoming.includes(x)).reverse();
  const row = (x, i, kind) => `<button type="button" class="row date-pick" data-k="${kind}" data-i="${i}">
      <div class="cal-date"><b>${new Date(x.date + 'T00:00').getDate()}</b><small>${new Date(x.date + 'T00:00').toLocaleDateString('en-GB', { month: 'short' })}</small></div>
      <div class="main"><div class="title">${esc([...new Set(x.items.map((it) => it.booking.clientName))].join(' + '))}</div>
        <div class="sub">${x.items.map((it) => `${esc(it.fn.type)} · ${esc(shiftLabel(it.fn))}`).join(' / ')}</div></div>
      <span class="chev">${ICONS.chevron}</span></button>`;
  const pick = await openSheet({
    title: f.name,
    body: `<div class="date-stats card pad"><div><b>${d.upcoming.length}</b><span>Upcoming</span></div><div><b>${d.thisMonth}</b><span>This month</span></div><div><b>${d.done}</b><span>Done</span></div></div>
      <div class="muted small month-label">Upcoming dates</div>
      <div class="list">${d.upcoming.length ? d.upcoming.map((x, i) => row(x, i, 'u')).join('') : '<div class="empty">No upcoming dates.</div>'}</div>
      <div class="muted small month-label">History</div>
      <div class="list">${past.length ? past.map((x, i) => row(x, i, 'p')).join('') : '<div class="empty">No past events yet.</div>'}</div>`,
    onMount(sheet, close) {
      sheet.querySelectorAll('.date-pick').forEach((btn) => btn.addEventListener('click', () => close((btn.dataset.k === 'u' ? d.upcoming : past)[+btn.dataset.i])));
    },
  });
  if (!pick) return;
  const upcoming = d.upcoming.includes(pick);
  const choice = await actionSheet(`${f.name} · ${fmtDate(pick.date)}`, [
    ...[...new Set(pick.items.map((it) => it.booking))].map((b) => ({ label: `Open event: ${b.clientName}`, value: { open: b } })),
    ...(upcoming ? pick.items.map((it) => ({ label: `Remove from ${it.fn.type} (${it.booking.clientName})`, value: { remove: it }, danger: true })) : []),
  ]);
  if (!choice) return;
  if (choice.open) { location.hash = '#/booking/' + encodeURIComponent(choice.open.id); return; }
  const { removeFromDay } = await import('./bookings.js');
  const { rerender } = await import('../app.js');
  if (await removeFromDay(choice.remove.booking, fid, choice.remove.fn.id)) rerender();
}
