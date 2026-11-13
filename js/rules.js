// Data rules, like a database's "foreign keys": every link must point to something real.
// checkData() runs when the app opens (and after a restore). It only repairs broken links;
// it never deletes money records.
import { state, save } from './db.js';
import { num, getFreelancer } from './util.js';

export function checkData() {
  const fixes = [];
  for (const b of state.bookings) {
    const fnIds = new Set((b.functions || []).map((f) => f.id));
    for (const f of b.functions || []) {
      // Every day needs a shift and at least 1 person.
      if (!f.shift) { f.shift = 'Day'; fixes.push(`${b.clientName}: ${f.type} shift set to Day`); }
      if (!(num(f.teamNeeded) >= 1)) { f.teamNeeded = 1; fixes.push(`${b.clientName}: ${f.type} team needed set to 1`); }
    }
    for (const a of b.team || []) {
      // A team job pointing to a deleted day moves to "whole event", so it is never lost.
      if (a.functionId && !fnIds.has(a.functionId)) { a.functionId = ''; fixes.push(`${b.clientName}: a team job for a deleted day moved to whole event`); }
      // Team paid more than agreed: the fee is raised to what was really paid.
      if (num(a.paid) > num(a.agreed)) { a.agreed = num(a.paid); fixes.push(`${b.clientName}: ${getFreelancer(a.freelancerId)?.name || 'team'} fee raised to the amount paid`); }
    }
    for (const e of b.expenses || []) {
      // Production items linked to a deleted day keep only the days that still exist.
      if ((e.functionIds || []).some((id) => !fnIds.has(id))) { e.functionIds = e.functionIds.filter((id) => fnIds.has(id)); fixes.push(`${b.clientName}: ${e.category} unlinked from a deleted day`); }
    }
  }
  return fixes;
}

export async function runDataCheck() {
  const fixes = checkData();
  if (fixes.length) { await save(); console.info('Data check fixed:', fixes); }
  return fixes;
}

// Jobs this freelancer still has to be paid for (cancelled events left out).
export function unpaidJobs(fid) {
  const out = [];
  for (const b of state.bookings) {
    if (b.status === 'Cancelled') continue;
    for (const a of b.team || []) if (a.freelancerId === fid && num(a.agreed) - num(a.paid) > 0) out.push({ b, a, left: num(a.agreed) - num(a.paid) });
  }
  return out;
}
