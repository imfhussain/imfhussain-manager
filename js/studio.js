// Studio workflow: the journey of one event from first inquiry to closed,
// terms & conditions, team ratings and money breakdowns used by the reports.
import { state } from './db.js';
import { num, todayISO, bookingTotals, dayTeamStatus, needsBooking, getFreelancer, freelancerWork } from './util.js';

// ---------- Terms & conditions (Pakistani wedding studio defaults, editable in Settings) ----------
export const DEFAULT_TERMS = `1. The booking is confirmed only after the advance payment is received. The advance is not refundable.
2. The remaining balance is to be paid on or before the last event day. Final photos, videos and the album are handed over after full payment.
3. The team reports at the agreed time for each function. Time beyond the agreed shift is charged as overtime.
4. Travel outside the city is charged per km. For outstation events, travel, stay and meals of the team are arranged by the client.
5. Date changes depend on availability. If the event is cancelled, the advance is not refunded.
6. Delivery: highlights within 3–4 weeks, edited photos within 6–8 weeks, album printing after the client selects the photos.
7. Raw (unedited) data is not given unless agreed in writing. Data is kept for 3 months after delivery.
8. For ladies-only areas, a female photographer can be arranged on request. The studio is not responsible for limits set by the venue or family.
9. Lights, drone, LED screen and other equipment are as listed in the booking. Anything extra is charged separately.
10. Some photos may be used for the studio portfolio unless the client asks for privacy.`;

export const terms = () => (state.settings.terms || DEFAULT_TERMS).trim();
export const advancePct = () => num(state.settings.advancePct) || 30;

// ---------- Money ----------
// Equipment/production billed to the client on top of the package (added in bookingTotals).
export const isExtraForClient = (e) => e.billing === 'Client pays';

// ---------- Event dates ----------
const sortedDays = (b) => (b.functions || []).slice().sort((x, y) => ((x.date || '') + (x.time || '')).localeCompare((y.date || '') + (y.time || '')));
export const distinctDates = (b) => [...new Set((b.functions || []).map((f) => f.date).filter(Boolean))];
export const lastDate = (b) => sortedDays(b).map((f) => f.date).filter(Boolean).pop() || '';
export const eventDone = (b) => !!lastDate(b) && lastDate(b) < todayISO();
// "3 functions · 2 days" when two functions share a day (e.g. Nikkah afternoon + Barat night).
export function daysLabel(fns) {
  const n = fns.length;
  const d = new Set(fns.map((f) => f.date).filter(Boolean)).size || n;
  if (n === d) return `${n} day${n === 1 ? '' : 's'}`;
  return `${n} functions · ${d} day${d === 1 ? '' : 's'}`;
}

// ---------- Team rating ----------
export const pastJob = (b, a) => {
  const fn = (b.functions || []).find((f) => f.id === a.functionId);
  const d = fn ? fn.date : lastDate(b);
  return !!d && d < todayISO();
};
export function freelancerRating(fid) {
  const rated = freelancerWork(fid).map((w) => num(w.assignment.rating)).filter((r) => r > 0);
  if (!rated.length) return null;
  return { avg: rated.reduce((s, r) => s + r, 0) / rated.length, count: rated.length };
}
export const stars = (r) => '★★★★★'.slice(0, Math.round(r)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r));
export const ratingText = (fid) => { const r = freelancerRating(fid); return r ? `★ ${r.avg.toFixed(1)} (${r.count})` : ''; };
export const unratedJobs = (b) => (b.team || []).filter((a) => pastJob(b, a) && !num(a.rating) && getFreelancer(a.freelancerId));

// ---------- Journey: inquiry → closed ----------
// Each step is worked out from the data; only "terms" and "delivered" are ticked by hand.
export function journey(b) {
  const t = bookingTotals(b);
  const fns = b.functions || [];
  const team = fns.length && fns.every((f) => dayTeamStatus(b, f).ok);
  const steps = [
    { key: 'days', label: 'Days, times and venues added', done: fns.length > 0 && fns.every((f) => f.date && f.venue), hint: 'Add each function with date, shift and venue.' },
    { key: 'price', label: 'Price agreed', done: t.total > 0, hint: 'Set the final amount in Edit.' },
    // Events that were already over before terms were tracked do not need them any more.
    { key: 'terms', label: 'Terms & conditions sent', done: !!b.termsSentAt || eventDone(b), hint: 'Send terms on WhatsApp.' },
    { key: 'advance', label: `Advance received (${advancePct()}%)`, done: t.total > 0 && t.received >= Math.round((t.total * advancePct()) / 100), hint: 'Add the advance under Client payments.' },
    { key: 'team', label: 'Team complete for every day', done: !!team, hint: 'Assign the team needed on each day.' },
    { key: 'production', label: 'Equipment & production booked', done: !(b.expenses || []).some(needsBooking), hint: 'Book lights, props, studio and mark them Booked.' },
    { key: 'shoot', label: 'Event days done', done: eventDone(b), hint: 'Happens after the last function.' },
    { key: 'delivered', label: 'Photos & videos delivered', done: b.status === 'Delivered', hint: 'Mark delivered when handed over.' },
    { key: 'paid', label: 'Client paid in full', done: t.total > 0 && t.due <= 0, hint: 'Collect the balance.' },
    { key: 'teamPaid', label: 'Team paid', done: (b.team || []).length > 0 && t.teamPending <= 0, hint: 'Pay the team under Team.' },
    { key: 'rated', label: 'Team rated', done: (b.team || []).length > 0 && eventDone(b) && !unratedJobs(b).length, hint: 'Rate each person after the event.' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) || null;
  return { steps, doneCount, total: steps.length, next, closed: !next };
}
