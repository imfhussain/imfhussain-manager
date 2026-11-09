import { state, save, uid } from '../db.js';
import { ICONS, formSheet, confirmSheet, toast } from '../ui.js';
import { esc, rs, num, fmtDate, todayISO, getFreelancer, freelancerTotals, freelancerWork, ROLES, lastEvents, nextEvent, shiftLabel, allTeamClashes, clashText } from '../util.js';
import { compressAvatar } from '../images.js';
import { pageHead } from './parts.js';
import { go, rerender } from '../app.js';

export function avatarHTML(f, cls = '') {
  if (f.photo) return `<div class="avatar ${cls}"><img src="${f.photo}" alt=""></div>`;
  const initials = (f.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<div class="avatar ${cls}" aria-hidden="true">${esc(initials)}</div>`;
}

// Money for one person, shown the same way everywhere: Total work, Paid, Due + a bar.
export function moneyLine(t) {
  const pct = t.agreed > 0 ? Math.round((t.paid / t.agreed) * 100) : 0;
  return `<div class="money-line">
      <span><small>Total work</small><b>${rs(t.agreed)}</b></span>
      <span><small>Paid</small><b class="ok">${rs(t.paid)}</b></span>
      <span><small>Due</small><b class="${t.pending > 0 ? 'bad' : 'ok'}">${rs(t.pending)}</b></span>
    </div>
    <div class="bar" role="img" aria-label="${pct}% paid"><i style="width:${pct}%"></i></div>`;
}

function personRow({ f, t, jobs }) {
  return `<a class="row person" href="#/freelancer/${encodeURIComponent(f.id)}">
    ${avatarHTML(f)}
    <div class="main">
      <div class="person-top">
        <div><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.role)} · ${jobs} job${jobs === 1 ? '' : 's'}</div></div>
        ${t.pending > 0 ? `<span class="due-tag">Due ${rs(t.pending)}</span>`
          : jobs ? `<span class="badge ok">All paid ✓</span>` : `<span class="badge">No jobs</span>`}
      </div>
      ${jobs ? moneyLine(t) : ''}
    </div>
  </a>`;
}

export function renderTeam(view) {
  const list = state.freelancers.map((f) => ({ f, t: freelancerTotals(f.id), jobs: freelancerWork(f.id).length }));
  const sum = list.reduce((s, x) => ({ agreed: s.agreed + x.t.agreed, paid: s.paid + x.t.paid, pending: s.pending + x.t.pending }), { agreed: 0, paid: 0, pending: 0 });
  const toPay = list.filter((x) => x.t.pending > 0).sort((a, b) => b.t.pending - a.t.pending);
  const cleared = list.filter((x) => x.t.pending <= 0).sort((a, b) => a.f.name.localeCompare(b.f.name));
  const pct = sum.agreed > 0 ? Math.round((sum.paid / sum.agreed) * 100) : 0;

  view.innerHTML = `
    ${pageHead('Team')}
    ${list.length ? `<div class="owe-card ${sum.pending > 0 ? '' : 'clear'}">
      <small>${sum.pending > 0 ? `You still owe your team` : 'Team is fully paid'}</small>
      <strong>${rs(sum.pending)}</strong>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p>Paid ${rs(sum.paid)} of ${rs(sum.agreed)} total work</p>
    </div>` : ''}

    ${toPay.length ? `<section class="section">
      <div class="section-head"><h2>To pay</h2><span class="muted small">${toPay.length} ${toPay.length === 1 ? 'person' : 'people'}</span></div>
      <div class="list">${toPay.map(personRow).join('')}</div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>${toPay.length ? 'All paid' : 'Team'}</h2></div>
      <div class="list">${cleared.length ? cleared.map(personRow).join('')
        : list.length ? `<div class="empty">Nobody is fully paid yet.</div>`
        : `<div class="empty">No freelancers yet. Tap + to add your photographers, videographers and editors.</div>`}</div>
    </section>
    <button type="button" class="fab" data-add aria-label="Add freelancer">${ICONS.plus}</button>
  `;
  view.querySelector('[data-add]').onclick = async () => { const f = await editFreelancer(); if (f) rerender(); };
}

export async function editFreelancer(existing) {
  const f = existing || {};
  const v = await formSheet({
    title: existing ? 'Edit freelancer' : 'New freelancer',
    danger: existing ? 'Delete freelancer' : null,
    fields: [
      { type: 'html', html: importButtonsHTML() },
      { name: 'photo', label: 'Photo (optional)', type: 'photo', value: f.photo || '' },
      { name: 'name', label: 'Name', required: true, value: f.name },
      { name: 'role', label: 'Role', type: 'select', options: ROLES, value: f.role || 'Photographer' },
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
  const dueJobs = work.filter((w) => num(w.assignment.agreed) - num(w.assignment.paid) > 0);
  const paidJobs = work.filter((w) => !(num(w.assignment.agreed) - num(w.assignment.paid) > 0));

  view.innerHTML = `
    ${pageHead(f.name, { backTo: '#/team', actions: `<button type="button" class="icon-btn" data-edit aria-label="Edit freelancer">${ICONS.edit}</button>` })}
    <div class="card pad">
      <div class="detail-top">
        ${avatarHTML(f, 'lg')}
        <div class="who" style="flex:1"><span class="badge accent">${esc(f.role)}</span><p>${num(f.rate) ? 'Usual rate ' + rs(f.rate) + ' per day' : 'No usual rate set'}</p></div>
        ${f.contact ? `<a class="call" href="tel:${esc(f.contact.replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(f.contact)}</a>` : ''}
      </div>
      ${f.remarks ? `<div class="remarks">${esc(f.remarks)}</div>` : ''}
    </div>
    <div class="owe-card mt ${t.pending > 0 ? '' : 'clear'}">
      <small>${t.pending > 0 ? `You still owe ${esc(f.name.split(' ')[0])}` : work.length ? 'Fully paid ✓' : 'No jobs yet'}</small>
      <strong>${rs(t.pending)}</strong>
      <div class="bar"><i style="width:${t.agreed > 0 ? Math.round((t.paid / t.agreed) * 100) : 0}%"></i></div>
      <p>Paid ${rs(t.paid)} of ${rs(t.agreed)} · ${work.length} job${work.length === 1 ? '' : 's'}</p>
    </div>
    ${t.pending > 0 && dueJobs.length > 1
      ? `<button type="button" class="btn outline block mt" data-pay-all>Pay all due (${rs(t.pending)})</button>` : ''}

    ${clashes.map((c) => `<div class="banner bad">${ICONS.warn}<div>${esc(clashText(c))}</div></div>`).join('')}

    <section class="section">
      <div class="section-head"><h2>Last 2 events</h2></div>
      <div class="list">${last.length ? last.map((x) => `
        <a class="row" href="#/booking/${encodeURIComponent(x.booking.id)}">
          <div class="main"><div class="title">${esc(x.booking.clientName)}</div>
            <div class="sub">${esc(x.fn.type)} · ${esc(fmtDate(x.fn.date))} · ${esc(shiftLabel(x.fn))}</div></div>
          <span class="chev">${ICONS.chevron}</span>
        </a>`).join('') : `<div class="empty">No past events yet.${next ? ` Next: ${esc(next.fn.type)}, ${esc(next.booking.clientName)} on ${esc(fmtDate(next.fn.date))}.` : ''}</div>`}</div>
    </section>

    ${dueJobs.length ? `<section class="section">
      <div class="section-head"><h2>Still to pay</h2><span class="muted small">${dueJobs.length} job${dueJobs.length === 1 ? '' : 's'}</span></div>
      <div class="list">${dueJobs.map(({ booking: b, assignment: a, fn, date }) => {
        const left = num(a.agreed) - num(a.paid);
        return `<div class="row">
          <a class="main" href="#/booking/${encodeURIComponent(b.id)}">
            <div class="title">${esc(b.clientName)}</div>
            <div class="sub">${esc(fn ? fn.type : 'Whole booking')} · ${esc(fmtDate(date))}</div>
            <div class="sub">Total ${rs(a.agreed)}${num(a.paid) ? ` · Paid ${rs(a.paid)}` : ''} · <b class="bad">Due ${rs(left)}</b></div>
          </a>
          <div class="end"><button type="button" class="btn primary small" data-pay="${b.id}|${a.id}" aria-label="Pay ${esc(f.name)} for ${esc(b.clientName)}">Pay</button></div>
        </div>`;
      }).join('')}</div>
    </section>` : ''}

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
    const ok = await confirmSheet({ title: 'Pay all due?', message: `Mark all ${f.name}'s due jobs as paid today (${rs(t.pending)})?`, ok: 'Mark all paid', danger: false });
    if (!ok) return;
    for (const { assignment: a } of dueJobs) { a.paid = num(a.agreed); a.paidDate = todayISO(); }
    await save('bookings');
    toast('All marked as paid');
    rerender();
  };
}

// ---------- Import from Contacts ----------
const hasPicker = () => 'contacts' in navigator && 'ContactsManager' in window;

function importButtonsHTML() {
  return `<div class="import-box">
    <div class="btn-row">
      ${hasPicker() ? `<button type="button" class="btn outline small" data-pick-contact>${ICONS.contacts} Import from Contacts</button>` : ''}
      <label class="btn ghost small">Import contact card (.vcf)<input type="file" accept=".vcf,text/vcard,text/x-vcard" hidden data-vcf></label>
    </div>
    ${hasPicker() ? '' : `<p class="hint" style="margin:8px 0 0">To pick straight from your Contacts, turn on: iPhone Settings → Apps → Safari → Advanced → Feature Flags → <b>Contact Picker API</b>. Or in Contacts, open the person → Share Contact → Save to Files, then use "Import contact card".</p>`}
  </div>`;
}

function bindImport(form) {
  const fill = async ({ name, tel, photo }) => {
    if (name) form.elements.name.value = name;
    if (tel) form.elements.contact.value = cleanPhone(tel);
    if (photo) {
      try { form.querySelector('[data-photo]').setPhoto(await compressAvatar(photo)); } catch {}
    }
    toast(name ? `Imported ${name}` : 'Contact imported');
  };
  const pick = form.querySelector('[data-pick-contact]');
  if (pick) pick.onclick = async () => {
    try {
      const props = ['name', 'tel'];
      const supported = await navigator.contacts.getProperties?.() || [];
      if (supported.includes('icon')) props.push('icon');
      const [c] = await navigator.contacts.select(props, { multiple: false });
      if (!c) return;
      await fill({ name: c.name?.[0], tel: c.tel?.[0], photo: c.icon?.[0] });
    } catch (e) {
      if (e && e.name !== 'AbortError' && e.name !== 'InvalidStateError') toast('Could not open Contacts', 'bad');
    }
  };
  const vcf = form.querySelector('[data-vcf]');
  vcf.onchange = async () => {
    const file = vcf.files[0];
    vcf.value = '';
    if (!file) return;
    const c = parseVCard(await file.text());
    if (!c.name && !c.tel) { toast('No contact found in this file', 'bad'); return; }
    await fill(c);
  };
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
