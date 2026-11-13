// Booking page pieces for the studio workflow: the event journey card, sending terms, rating the team.
import { save } from '../db.js';
import { formSheet, confirmSheet, toast } from '../ui.js';
import { esc, num, getFreelancer, fmtDate } from '../util.js';
import { journey, terms, advancePct, unratedJobs, stars } from '../studio.js';
import { waSheet, waOf, clientTermsMessage } from '../whatsapp.js';
import { rerender } from '../app.js';

export function journeyCard(b) {
  const j = journey(b);
  const pct = Math.round((j.doneCount / j.total) * 100);
  return `<details class="journey card">
    <summary>
      <div class="journey-top"><b>${j.closed ? 'Event closed ✓' : 'Event journey'}</b><span class="muted small">${j.doneCount} of ${j.total} done</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${j.next ? `<div class="journey-next">Next: <b>${esc(j.next.label)}</b></div>` : '<div class="journey-next">Everything is done for this event.</div>'}
    </summary>
    <ol class="journey-steps">
      ${j.steps.map((s) => `<li class="${s.done ? 'done' : ''}${j.next && s.key === j.next.key ? ' next' : ''}">
        <span class="tick">${s.done ? '✓' : ''}</span>
        <div><div>${esc(s.label)}${s.key === 'terms' && b.termsAgreedAt ? ' · <span class="ok-text">client agreed</span>' : ''}</div>
          ${s.done ? '' : `<small class="muted">${esc(s.hint)}</small>`}</div>
        ${stepButton(b, s)}
      </li>`).join('')}
    </ol>
  </details>`;
}

const STEP_BUTTONS = {
  days: 'Add', price: 'Set', terms: 'Send', advance: 'Add', team: 'Assign', production: 'Open',
  delivered: 'Mark', paid: 'Add', teamPaid: 'Open', rated: 'Rate',
};
function stepButton(b, s) {
  if (s.key === 'terms' && s.done && !b.termsAgreedAt) return '<button type="button" class="step-btn" data-step="termsAgreed">Agreed?</button>';
  if (s.done || !STEP_BUTTONS[s.key]) return '';
  if (s.key === 'rated' && !unratedJobs(b).length) return '';
  return `<button type="button" class="step-btn" data-step="${s.key}">${STEP_BUTTONS[s.key]}</button>`;
}

// Opens WhatsApp with booking summary + terms. Marked as sent once a chat is opened.
export async function sendTerms(b) {
  const opened = await waSheet(`Terms for ${b.clientName}`, waOf(b), [
    { label: 'Booking details + terms & conditions', text: clientTermsMessage(b, terms(), advancePct()) },
  ]);
  if (opened) {
    b.termsSentAt = new Date().toISOString();
    await save('bookings');
    toast('Terms marked as sent');
    rerender();
  }
}

export async function markTermsAgreed(b) {
  if (!(await confirmSheet({ title: 'Client agreed?', message: `Did ${b.clientName} reply "Agreed" to the terms?`, ok: 'Yes, agreed', danger: false }))) return;
  b.termsAgreedAt = new Date().toISOString();
  await save('bookings'); toast('Terms agreed ✓'); rerender();
}

export async function markDelivered(b) {
  if (!(await confirmSheet({ title: 'Mark delivered?', message: `Have all photos, videos and the album been handed over to ${b.clientName}?`, ok: 'Yes, delivered', danger: false }))) return;
  b.status = 'Delivered';
  b.deliveredAt = new Date().toISOString();
  await save('bookings'); toast('Marked delivered ✓'); rerender();
}

// ---------- Team rating (1–5) after the event ----------
export const RATING_OPTIONS = [
  { value: '', label: 'Not rated' },
  { value: '5', label: '★★★★★  Excellent' },
  { value: '4', label: '★★★★  Good' },
  { value: '3', label: '★★★  Okay' },
  { value: '2', label: '★★  Poor' },
  { value: '1', label: '★  Bad — avoid' },
];

export async function rateTeam(b, only) {
  const jobs = only ? [only] : unratedJobs(b);
  if (!jobs.length) { toast('Everyone is rated'); return; }
  const fnName = (a) => (b.functions || []).find((f) => f.id === a.functionId);
  const v = await formSheet({
    title: only ? 'Rate performance' : `Rate team · ${b.clientName}`,
    submitLabel: 'Save ratings',
    fields: [
      { type: 'note', label: 'Rate on time, work quality and behaviour with the family. Ratings help you pick the best team next time.' },
      ...jobs.flatMap((a) => {
        const f = getFreelancer(a.freelancerId);
        const fn = fnName(a);
        return [
          { name: 'r_' + a.id, label: `${f ? f.name : 'Freelancer'} · ${fn ? `${fn.type} ${fmtDate(fn.date)}` : 'All days'}`, type: 'select', options: RATING_OPTIONS, value: a.rating ? String(a.rating) : '' },
          { name: 'n_' + a.id, label: 'Note (optional)', value: a.ratingNote || '', placeholder: 'Late, great candids, rude to guests…' },
        ];
      }),
    ],
  });
  if (!v) return;
  let n = 0;
  for (const a of jobs) {
    const r = num(v['r_' + a.id]);
    if (r) { a.rating = r; n++; } else delete a.rating;
    a.ratingNote = v['n_' + a.id] || '';
  }
  await save('bookings');
  toast(n ? `${n} rating${n > 1 ? 's' : ''} saved` : 'Saved');
  rerender();
}

export const ratingBadge = (a) => (num(a.rating) ? `<span class="stars" title="${num(a.rating)} of 5">${stars(num(a.rating))}</span>` : '');

// Quick "how many people does this day need?" editor with − / + buttons.
// Opened by tapping any team-count chip (e.g. "1/3") for a day.
export function editTeamNeeded(b, fn) {
  return new Promise((resolve) => {
    import('../ui.js').then(({ openSheet }) => openSheet({
      title: `Team needed · ${fn.type}`,
      body: `<p class="muted small" style="margin:0 0 12px">${esc(fmtDate(fn.date))} · how many people (photo, video, drone…) this function needs.</p>
        <div class="stepper"><button type="button" class="btn ghost" data-minus aria-label="One less">−</button>
          <output data-n>${Math.max(1, num(fn.teamNeeded) || 1)}</output>
          <button type="button" class="btn ghost" data-plus aria-label="One more">+</button></div>
        <div class="form-actions"><button type="button" class="btn primary block" data-ok>Save</button></div>`,
      onMount(sheet, close) {
        const out = sheet.querySelector('[data-n]');
        const set = (n) => { out.textContent = Math.min(30, Math.max(1, n)); };
        sheet.querySelector('[data-minus]').onclick = () => set(+out.textContent - 1);
        sheet.querySelector('[data-plus]').onclick = () => set(+out.textContent + 1);
        sheet.querySelector('[data-ok]').onclick = async () => {
          fn.teamNeeded = +out.textContent;
          await save('bookings');
          toast(`${fn.type}: ${fn.teamNeeded} people needed`);
          close(true); rerender(); resolve(true);
        };
      },
    }).then(() => resolve(false)));
  });
}
