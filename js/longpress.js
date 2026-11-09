// Long-press on any event row (Home upcoming, Bookings list, Calendar) → Edit details / Delete.
// Both need a confirmation, so nothing changes by accident.
import { actionSheet } from './ui.js';
import { state } from './db.js';

const HOLD_MS = 550;
const ROW = 'a.row[href^="#/booking/"]';

export function initLongPress(root) {
  let timer = null, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };

  root.addEventListener('pointerdown', (e) => {
    const row = e.target.closest(ROW);
    if (!row || e.button > 0) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    cancel();
    timer = setTimeout(() => { fired = true; timer = null; openMenu(row); }, HOLD_MS);
  });
  root.addEventListener('pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => root.addEventListener(t, cancel));
  window.addEventListener('scroll', cancel, { passive: true });
  // The finger lifting after a long-press must not also open the booking.
  root.addEventListener('click', (e) => {
    if (fired && e.target.closest(ROW)) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }, true);
  // Right-click on a computer opens the same menu; on iPhone this stops the link preview.
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest(ROW);
    if (!row) return;
    e.preventDefault();
    if (!fired) { cancel(); fired = false; openMenu(row); }
  });
}

async function openMenu(row) {
  const id = decodeURIComponent(row.getAttribute('href').replace('#/booking/', ''));
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  navigator.vibrate?.(10);
  const pick = await actionSheet(b.clientName, [
    { label: 'Edit details', value: 'edit' },
    { label: 'Delete event', value: 'delete', danger: true },
  ]);
  const { editBooking, deleteBooking } = await import('./views/bookings.js');
  const { rerender } = await import('./app.js');
  if (pick === 'edit') await editBooking(b, { confirmSave: true });
  else if (pick === 'delete' && (await deleteBooking(b))) rerender();
}

