// WhatsApp: open a chat with a ready-made message. You still check it and tap Send in WhatsApp.
// The app cannot read WhatsApp contacts or chats; it only opens a chat.
import { openSheet } from './ui.js';
import { state } from './db.js';
import {
  esc, rs, num, fmtDate, fmtTime, shiftLabel, getFreelancer, bookingTotals, freelancerTotals, freelancerWork, gigTotals, jobIsDue,
} from './util.js';

// Pakistani numbers: 0300 1234567 / +92 300 1234567 / 0092… → 923001234567
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = '92' + d.slice(1);
  else if (d.length === 10 && d.startsWith('3')) d = '92' + d;
  return d.length >= 10 ? d : '';
}

export const waLink = (phone, text) => {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : '';
};

const WA_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.3z"/></svg>';

// Green "WhatsApp" button for a page header.
export const waButton = (phone) => (waNumber(phone)
  ? `<button type="button" class="wa-btn" data-wa>${WA_ICON}<span>WhatsApp</span></button>` : '');

// Sheet of message choices. Each choice is a real link, so iPhone opens WhatsApp straight away.
export function waSheet(title, phone, messages) {
  const items = [...messages.filter((m) => m && m.text), { label: 'Just open the chat', hint: 'No message typed', text: '' }];
  return openSheet({
    title,
    body: `<p class="muted small" style="margin:0 0 10px">Opens WhatsApp with the message typed. Check it, then tap Send.</p>
      <div class="action-list">${items.map((m, i) => `
        <a class="action-item wa-item" data-i="${i}" target="_blank" rel="noopener" href="${esc(waLink(phone, m.text))}">
          <b>${esc(m.label)}</b>${m.text ? `<span class="wa-preview">${esc(m.text)}</span>` : `<span class="wa-preview">${esc(m.hint)}</span>`}
        </a>`).join('')}</div>`,
    onMount(sheet, close) {
      sheet.querySelectorAll('[data-i]').forEach((a) => a.addEventListener('click', () => setTimeout(() => close(true), 300)));
    },
  });
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const line = (label, v) => (v ? `${label}: ${v}` : '');
const GAP = '\n'; // an empty line between sections
const join = (parts) => parts.filter((x) => x !== '' && x != null && x !== false).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const SIGN = '— imfhussain | Wedding Photography & Films';

function fnLines(fn) {
  return join([
    `*${fn.type}* · ${fmtDate(fn.date)}`,
    `${shiftLabel(fn)}${fn.time ? ` · Report ${fmtTime(fn.time)}` : ''}`,
    fn.venue ? `Venue: ${fn.venue}` : '',
  ]);
}

// ---------- Freelancer ----------
export function freelancerJobMessage(b, a) {
  const f = getFreelancer(a.freelancerId);
  const fns = a.functionId ? b.functions.filter((x) => x.id === a.functionId) : b.functions.slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const instr = fns.map((fn) => fn.instructions && (fns.length > 1 ? `${fn.type}: ${fn.instructions}` : fn.instructions)).filter(Boolean);
  return join([
    `Assalam o Alaikum ${firstName(f?.name)},`,
    `You are booked with imfhussain for *${b.clientName}*.`,
    GAP,
    fns.map(fnLines).join('\n\n'),
    GAP,
    line('Role', f?.role),
    num(a.agreed) ? `Fee: ${rs(a.agreed)}` : '',
    instr.length ? `\nInstructions:\n${instr.join('\n')}` : '',
    GAP,
    'Please confirm. JazakAllah.',
    SIGN,
  ]);
}

export function freelancerPaymentMessage(f) {
  const t = freelancerTotals(f.id);
  const unpaid = freelancerWork(f.id).filter((w) => num(w.assignment.agreed) - num(w.assignment.paid) > 0);
  const due = unpaid.filter((w) => jobIsDue(w.booking, w.assignment));
  const later = unpaid.filter((w) => !jobIsDue(w.booking, w.assignment));
  const item = (w) => `• ${w.booking.clientName}, ${w.fn ? w.fn.type : 'Whole booking'} (${fmtDate(w.date)}): ${rs(num(w.assignment.agreed) - num(w.assignment.paid))}`;
  return join([
    `Assalam o Alaikum ${firstName(f.name)},`,
    'Your payment details with imfhussain:',
    GAP,
    `Total work: ${rs(t.agreed)}`,
    `Paid: ${rs(t.paid)}`,
    `*Due now: ${rs(t.dueNow)}*`,
    due.length ? '\n' + due.map(item).join('\n') : '',
    later.length ? `\nAssigned for upcoming events (paid after the event): ${rs(t.later)}\n` + later.map(item).join('\n') : '',
    GAP,
    SIGN,
  ]);
}

export function freelancerPaidMessage(f, b, a, amount) {
  const left = num(a.agreed) - num(a.paid);
  const fn = b.functions.find((x) => x.id === a.functionId);
  return join([
    `Assalam o Alaikum ${firstName(f.name)},`,
    `Paid ${rs(amount)} for ${b.clientName}, ${fn ? fn.type : 'whole booking'}.`,
    left > 0 ? `Balance for this job: ${rs(left)}.` : 'This job is fully paid. ✓',
    GAP,
    SIGN,
  ]);
}

// ---------- Client ----------
export function clientConfirmMessage(b) {
  const t = bookingTotals(b);
  const fns = (b.functions || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  return join([
    `Assalam o Alaikum ${b.clientName},`,
    'Thank you for booking *imfhussain*. Your booking is confirmed:',
    GAP,
    fns.length ? fns.map(fnLines).join('\n\n') : '',
    GAP,
    productionLines(b),
    GAP,
    b.package && b.package !== 'Custom' ? line('Package', b.package) : '',
    t.total ? `Total: ${rs(t.total)}` : '',
    t.received ? `Received: ${rs(t.received)}` : '',
    t.total ? `Balance: ${rs(t.due)}` : '',
    GAP,
    SIGN,
  ]);
}

// Equipment / production lines for the client: what is included and what is charged extra.
function productionLines(b) {
  const items = (b.expenses || []).filter((e) => /Lights|Props|Studio|Equipment|Drone|LED|Generator/i.test(e.category || '') || e.billing === 'Client pays');
  if (!items.length) return '';
  const fns = b.functions || [];
  const days = (e) => (e.functionIds && e.functionIds.length ? fns.filter((f) => e.functionIds.includes(f.id)).map((f) => f.type).join(', ') : 'all days');
  return 'Equipment & production:\n' + items.map((e) => `• ${e.category} (${days(e)})${e.billing === 'Client pays' ? ` — ${rs(e.chargeClient ?? e.amount)} extra` : ' — included'}`).join('\n');
}

// Terms & conditions with the booking summary; the couple replies "Agreed".
export function clientTermsMessage(b, termsText, advancePct) {
  const t = bookingTotals(b);
  const fns = (b.functions || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const adv = Math.round((t.total * advancePct) / 100);
  return join([
    `Assalam o Alaikum ${b.clientName},`,
    'Thank you for choosing *imfhussain*. Here are your booking details and our terms.',
    GAP,
    fns.length ? fns.map(fnLines).join('\n\n') : '',
    GAP,
    productionLines(b),
    GAP,
    t.total ? `Total: ${rs(t.total)}${t.extras ? ` (package ${rs(t.packageAmount)} + equipment ${rs(t.extras)})` : ''}` : '',
    t.total && t.received < adv ? `Advance to confirm (${advancePct}%): ${rs(adv)}` : '',
    t.received ? `Received so far: ${rs(t.received)}` : '',
    GAP,
    '*Terms & conditions*',
    termsText,
    GAP,
    'Please reply *Agreed* to confirm. JazakAllah.',
    SIGN,
  ]);
}

export function clientReminderMessage(b) {
  const t = bookingTotals(b);
  return join([
    `Assalam o Alaikum ${b.clientName},`,
    'A gentle reminder about the payment for your booking with imfhussain.',
    GAP,
    `Total: ${rs(t.total)}`,
    `Received: ${rs(t.received)}`,
    `*Balance due: ${rs(t.due)}*`,
    GAP,
    'Thank you. JazakAllah.',
    SIGN,
  ]);
}

export function clientReceiptMessage(b) {
  const t = bookingTotals(b);
  const p = (b.payments || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || '')).pop();
  if (!p) return '';
  return join([
    `Assalam o Alaikum ${b.clientName},`,
    `Received with thanks: *${rs(p.amount)}* on ${fmtDate(p.date)}${p.method ? ` (${p.method})` : ''}.`,
    `Total received: ${rs(t.received)} of ${rs(t.total)}.`,
    t.due > 0 ? `Balance: ${rs(t.due)}.` : 'Fully paid. ✓ JazakAllah.',
    GAP,
    SIGN,
  ]);
}

// ---------- My freelance (studio that hired me) ----------
export function gigReminderMessage(g) {
  const t = gigTotals(g);
  return join([
    'Assalam o Alaikum,',
    `Reminder for my payment: ${g.type || 'event'}, ${fmtDate(g.date)}${g.role ? ` (${g.role})` : ''}.`,
    GAP,
    `Fee: ${rs(t.fee)}`,
    `Received: ${rs(t.received)}`,
    `*Pending: ${rs(t.pending)}*`,
    GAP,
    'JazakAllah. — imfhussain',
  ]);
}

export function gigConfirmMessage(g) {
  return join([
    'Assalam o Alaikum,',
    `Confirmed for ${g.type || 'the event'} on ${fmtDate(g.date)} (${shiftLabel(g)})${g.venue ? ` at ${g.venue}` : ''}.`,
    g.role ? `Role: ${g.role}` : '',
    g.fee ? `Fee: ${rs(g.fee)}` : '',
    GAP,
    '— imfhussain',
  ]);
}

