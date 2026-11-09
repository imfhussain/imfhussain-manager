import { save, uid } from '../db.js';
import { ICONS, openSheet, confirmSheet, toast } from '../ui.js';
import { esc, num, fmtDate, fmtTime, shiftLabel, getFreelancer } from '../util.js';
import { compressImage } from '../images.js';
import { boardHTML, buildBoards } from '../pinterest.js';
import { rerender } from '../app.js';

// ---------- Photo gallery (used by function mood boards and the posing guide) ----------
export function galleryHTML(images, { canAdd = true, addLabel = 'Add photos' } = {}) {
  return `<div class="gallery">
    ${images.map((im) => `<div class="thumb">
      <button type="button" class="thumb-img" data-view="${im.id}" aria-label="View photo${im.caption ? ': ' + esc(im.caption) : ''}"><img src="${im.src}" alt="" loading="lazy"></button>
      <button type="button" class="thumb-x" data-del-img="${im.id}" aria-label="Delete photo">${ICONS.x}</button>
    </div>`).join('')}
    ${canAdd ? `<label class="thumb add">${ICONS.image}<span>${esc(addLabel)}</span><input type="file" accept="image/*" multiple hidden data-add-img></label>` : ''}
  </div>`;
}

// Wire up a gallery. `list` is the array to change; `onChange` saves and redraws.
export function bindGallery(root, list, onChange) {
  root.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => {
    const im = list.find((x) => x.id === b.dataset.view);
    if (im) lightbox(im.src);
  });
  root.querySelectorAll('[data-del-img]').forEach((b) => b.onclick = async () => {
    if (!(await confirmSheet({ title: 'Delete photo?', message: 'This photo will be removed.' }))) return;
    const i = list.findIndex((x) => x.id === b.dataset.delImg);
    if (i >= 0) list.splice(i, 1);
    await onChange('Photo deleted');
  });
  const input = root.querySelector('[data-add-img]');
  if (input) input.onchange = async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    toast(files.length > 1 ? `Adding ${files.length} photos…` : 'Adding photo…');
    let added = 0;
    for (const f of files) {
      try { list.push({ id: uid(), src: await compressImage(f, 1100, 0.75) }); added++; } catch {}
    }
    await onChange(added ? `${added} photo${added > 1 ? 's' : ''} added` : 'Could not add the photo');
  };
}

export function lightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${src}" alt=""><button type="button" class="icon-btn" aria-label="Close">${ICONS.x}</button>`;
  el.onclick = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 200); };
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
}

// ---------- Function detail sheet ----------
export function openFunction(b, fn) {
  if (!fn) return;
  fn.moodImages ||= [];
  const teamNames = () => (b.team || []).filter((a) => a.functionId === fn.id || !a.functionId)
    .map((a) => { const f = getFreelancer(a.freelancerId); return f ? `${f.name} (${f.role})` : 'Unknown'; });

  const draw = (body) => {
    const team = teamNames();
    body.innerHTML = `
      <dl class="kv">
        <dt>Client</dt><dd>${esc(b.clientName)}</dd>
        <dt>Date</dt><dd>${esc(fmtDate(fn.date))}</dd>
        <dt>Shift</dt><dd>${esc(shiftLabel(fn))}</dd>
        ${fn.time ? `<dt>Reporting</dt><dd>${esc(fmtTime(fn.time))}</dd>` : ''}
        ${fn.venue ? `<dt>Venue</dt><dd>${esc(fn.venue)}</dd>` : ''}
        <dt>Team</dt><dd>${team.length ? esc(team.join(', ')) : '<span class="shortage">No team assigned</span>'}${num(fn.teamNeeded) ? ` (${team.length}/${num(fn.teamNeeded)})` : ''}</dd>
      </dl>
      ${fn.deliverables ? `<h3 class="form-heading mt">Deliverables</h3><p class="prewrap">${esc(fn.deliverables)}</p>` : ''}
      <h3 class="form-heading mt">Instructions</h3>
      ${fn.instructions ? `<p class="prewrap">${esc(fn.instructions)}</p>` : `<p class="muted small">No instructions yet. Tap Edit to add them.</p>`}
      <h3 class="form-heading mt">Mood board</h3>
      ${galleryHTML(fn.moodImages)}
      ${fn.pinterest ? `<h3 class="form-heading mt">Pinterest board</h3>${boardHTML(fn.pinterest)}` : ''}
      <div class="form-actions">
        <button type="button" class="btn ghost" data-share>Send to team</button>
        <button type="button" class="btn primary" data-edit-fn>Edit</button>
      </div>`;
    bindGallery(body, fn.moodImages, async (msg) => { await save('bookings'); toast(msg); draw(body); rerender(); });
    body.querySelector('[data-edit-fn]').onclick = async () => {
      closeSheet();
      const { editFunction } = await import('./bookings.js');
      editFunction(b, fn);
    };
    body.querySelector('[data-share]').onclick = () => shareBrief(b, fn, team);
    buildBoards(body);
  };

  let closeSheet = () => {};
  openSheet({
    title: `${fn.type}`,
    body: '<div data-fn-body></div>',
    onMount(sheet, close) {
      closeSheet = close;
      draw(sheet.querySelector('[data-fn-body]'));
    },
  });
}

// Share the brief as text (WhatsApp, Messages…). Photos are not included.
async function shareBrief(b, fn, team) {
  const lines = [
    `*${fn.type} · ${b.clientName}*`,
    `Date: ${fmtDate(fn.date)} (${shiftLabel(fn)})`,
    fn.time && `Reporting: ${fmtTime(fn.time)}`,
    fn.venue && `Venue: ${fn.venue}`,
    team.length && `Team: ${team.join(', ')}`,
    fn.instructions && `\nInstructions:\n${fn.instructions}`,
    fn.deliverables && `\nDeliverables: ${fn.deliverables}`,
    fn.pinterest && `\nMood board: ${fn.pinterest}`,
  ].filter(Boolean).join('\n');
  try {
    if (navigator.share) await navigator.share({ text: lines });
    else { await navigator.clipboard.writeText(lines); toast('Copied. Paste it in WhatsApp.'); }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('Could not share', 'bad');
  }
}
