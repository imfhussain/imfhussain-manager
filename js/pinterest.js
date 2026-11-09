// Shows a public Pinterest board inside the app, without opening Pinterest.
// Uses the same public board feed that Pinterest's official board widget uses.
// Needs internet. Secret boards and short pin.it links cannot be shown.

import { esc } from './util.js';
import { lightbox } from './views/moodboard.js';

const cache = new Map(); // board url -> Promise<data>

// Turn any board link into https://www.pinterest.com/user/board/
export function normalizeBoardUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw.trim().startsWith('http') ? raw.trim() : 'https://' + raw.trim()); } catch { return null; }
  if (u.hostname === 'pin.it') return { short: true, url: u.href };
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] === 'pin') return null;
  return { short: false, user: parts[0], board: parts[1], url: `https://www.pinterest.com/${parts[0]}/${parts[1]}/` };
}

function fetchBoard(n) {
  if (cache.has(n.url)) return cache.get(n.url);
  const p = new Promise((resolve, reject) => {
    const cb = '__pinboard_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const done = (fn) => { clearTimeout(timer); delete window[cb]; s.remove(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), 12000);
    window[cb] = (d) => done(() => (d && d.status === 'success' && d.data ? resolve(d.data) : reject(new Error('not found'))));
    s.onerror = () => done(() => reject(new Error('offline')));
    s.src = `https://widgets.pinterest.com/v3/pidgets/boards/${encodeURIComponent(n.user)}/${encodeURIComponent(n.board)}/pins/?callback=${cb}`;
    document.head.appendChild(s);
  });
  p.catch(() => cache.delete(n.url)); // allow retry later
  cache.set(n.url, p);
  return p;
}

export function boardHTML(raw) {
  const n = normalizeBoardUrl(raw);
  if (!n) return `<p class="muted small">This does not look like a Pinterest board link.</p>`;
  if (n.short) {
    return `<p class="muted small">Short pin.it links cannot be shown inside the app. Open the board in Pinterest, tap Share → Copy link, and paste the full pinterest.com link.</p>
      <a class="btn ghost small" href="${esc(n.url)}" target="_blank" rel="noopener">Open board</a>`;
  }
  return `<div class="pin-board" data-pin-board="${esc(n.url)}"><p class="muted small" data-pin-status>Loading board…</p></div>
    <a class="small" href="${esc(n.url)}" target="_blank" rel="noopener" style="color:var(--accent);display:inline-block;padding:10px 0;min-height:44px">Open in Pinterest</a>`;
}

// Call after boardHTML is in the page.
export function buildBoards(container) {
  container.querySelectorAll('[data-pin-board]').forEach(async (wrap) => {
    const status = (msg) => { wrap.innerHTML = `<p class="muted small" data-pin-status>${esc(msg)}</p>`; };
    if (!navigator.onLine) { status('You are offline. Pinterest boards need internet. Saved photos still work.'); return; }
    const n = normalizeBoardUrl(wrap.dataset.pinBoard);
    try {
      const d = await fetchBoard(n);
      const pins = (d.pins || []).filter((p) => p.images && (p.images['236x'] || p.images['237x']));
      if (!pins.length) { status('This board has no pins yet.'); return; }
      wrap.innerHTML = `
        <p class="small muted" style="margin:0 0 8px">${esc(d.board?.name || n.board)} · ${d.board?.pin_count ?? pins.length} pins${pins.length < (d.board?.pin_count || 0) ? ` (showing ${pins.length})` : ''}</p>
        <div class="pin-grid">${pins.map((p, i) => {
          const t = p.images['236x'] || p.images['237x'];
          return `<button type="button" class="pin" data-pin="${i}" aria-label="${esc((p.description || 'Pin').slice(0, 80))}">
            <img src="${esc(t.url)}" width="${t.width}" height="${t.height}" alt="" loading="lazy" style="background:${esc(p.dominant_color || 'var(--card-2)')}"></button>`;
        }).join('')}</div>`;
      wrap.querySelectorAll('[data-pin]').forEach((b) => b.onclick = () => {
        const p = pins[Number(b.dataset.pin)];
        lightbox((p.images['564x'] || p.images['236x'] || p.images['237x']).url);
      });
    } catch (e) {
      status(e.message === 'not found'
        ? 'Board not found. Make sure the board is public and the link is right.'
        : 'Could not load Pinterest. Check the internet and try again.');
    }
  });
}
