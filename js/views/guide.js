import { state, save, uid } from '../db.js';
import { ICONS, formSheet, confirmSheet, toast } from '../ui.js';
import { esc } from '../util.js';
import { pageHead } from './parts.js';
import { galleryHTML, bindGallery } from './moodboard.js';
import { boardHTML, buildBoards, normalizeBoardUrl } from '../pinterest.js';
import { go, rerender } from '../app.js';

const STARTER = ['Bride', 'Groom', 'Couple', 'Family', 'Bridal party', 'Details and decor'];

function guide() {
  if (!state.guide) state.guide = STARTER.map((title) => ({ id: uid(), title, boards: [], images: [] }));
  return state.guide;
}

export function renderGuide(view) {
  const g = guide();
  view.innerHTML = `
    ${pageHead('Posing guide', { backTo: '#/more' })}
    <p class="muted small" style="margin:0 2px 12px">Keep your Pinterest boards and favourite poses here, sorted by type. Boards need internet; saved photos work offline.</p>
    <div class="list">${g.map((c) => `
      <a class="row" href="#/pose/${encodeURIComponent(c.id)}">
        <div class="pose-cover">${c.images[0] ? `<img src="${c.images[0].src}" alt="">` : ICONS.image}</div>
        <div class="main"><div class="title">${esc(c.title)}</div>
          <div class="sub">${c.boards.length} board${c.boards.length === 1 ? '' : 's'} · ${c.images.length} photo${c.images.length === 1 ? '' : 's'}</div></div>
        <span class="chev">${ICONS.chevron}</span>
      </a>`).join('') || `<div class="empty">No categories yet.</div>`}</div>
    <button type="button" class="fab" data-add aria-label="Add category">${ICONS.plus}</button>
  `;
  view.querySelector('[data-add]').onclick = async () => {
    const v = await formSheet({ title: 'New category', fields: [{ name: 'title', label: 'Name', required: true, placeholder: 'Mehndi poses, Rukhsati…' }] });
    if (!v) return;
    g.push({ id: uid(), title: v.title, boards: [], images: [] });
    await save('guide');
    toast('Category added');
    rerender();
  };
}

export function renderPose(view, id) {
  const g = guide();
  const c = g.find((x) => x.id === id);
  if (!c) {
    view.innerHTML = `${pageHead('Not found', { backTo: '#/guide' })}<div class="empty">This category does not exist anymore.</div>`;
    return;
  }
  view.innerHTML = `
    ${pageHead(c.title, { backTo: '#/guide', actions: `<button type="button" class="icon-btn" data-edit aria-label="Rename or delete">${ICONS.edit}</button>` })}
    <section class="section" style="margin-top:6px">
      <div class="section-head"><h2>Pinterest boards</h2><button type="button" class="add-btn" data-add-board>${ICONS.plus}Add</button></div>
      ${c.boards.length ? c.boards.map((url, i) => `
        <div class="card pad board-card">
          <div class="board-top"><span class="small muted">${esc(prettyBoard(url))}</span>
            <button type="button" class="icon-btn" data-del-board="${i}" aria-label="Remove board">${ICONS.x}</button></div>
          ${boardHTML(url)}
        </div>`).join('') : `<div class="card empty">No boards yet. Tap Add and paste a Pinterest board link.</div>`}
    </section>
    <section class="section">
      <div class="section-head"><h2>Saved poses</h2><span class="muted small">Work offline</span></div>
      <div class="card pad" data-gal>${galleryHTML(c.images, { addLabel: 'Add poses' })}</div>
    </section>
  `;
  bindGallery(view.querySelector('[data-gal]'), c.images, async (msg) => { await save('guide'); toast(msg); rerender(); });
  buildBoards(view);

  view.querySelector('[data-add-board]').onclick = async () => {
    const v = await formSheet({
      title: 'Add Pinterest board',
      submitLabel: 'Add board',
      fields: [{ name: 'url', label: 'Board link', type: 'url', required: true, placeholder: 'https://pinterest.com/name/board-name/',
        hint: 'In Pinterest, open the board → Share → Copy link. The board must be public.' }],
    });
    if (!v) return;
    const n = normalizeBoardUrl(v.url);
    if (!n) { toast('That is not a Pinterest board link', 'bad'); return; }
    c.boards.push(v.url.trim());
    await save('guide');
    toast(n.short ? 'Saved. Short links open in Pinterest only.' : 'Board added');
    rerender();
  };
  view.querySelectorAll('[data-del-board]').forEach((b) => b.onclick = async () => {
    if (!(await confirmSheet({ title: 'Remove board?', message: 'The board stays on Pinterest. It is only removed from this guide.', ok: 'Remove' }))) return;
    c.boards.splice(Number(b.dataset.delBoard), 1);
    await save('guide');
    toast('Board removed');
    rerender();
  });
  view.querySelector('[data-edit]').onclick = async () => {
    const v = await formSheet({ title: 'Edit category', danger: 'Delete category', fields: [{ name: 'title', label: 'Name', required: true, value: c.title }] });
    if (!v) return;
    if (v.__danger) {
      if (!(await confirmSheet({ title: 'Delete category?', message: `Delete "${c.title}" with its ${c.images.length} saved photos? This cannot be undone.` }))) return;
      state.guide = g.filter((x) => x !== c);
      await save('guide');
      toast('Category deleted');
      go('#/guide');
      return;
    }
    c.title = v.title;
    await save('guide');
    toast('Saved');
    rerender();
  };
}

function prettyBoard(url) {
  const n = normalizeBoardUrl(url);
  if (!n || n.short) return url;
  const [, user, board] = new URL(n.url).pathname.split('/');
  return `${decodeURIComponent(board).replace(/-/g, ' ')} · by ${user}`;
}
