import { esc } from './util.js';
import { compressAvatar } from './images.js';

// ---------- Toast ----------
let toastTimer = null;
export function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2200);
}

// ---------- Bottom sheet ----------
// openSheet({ title, body (html string), onMount(sheetEl, close) }) -> Promise resolved by close(value)
// iPhone ignores overflow:hidden on <body>, so the page behind a sheet kept scrolling and
// jumped. Pin the page with position:fixed and put it back at the same place on close.
let lockedY = null;
export const scrollLocked = () => lockedY !== null;
export function setLockedScroll(y) { if (lockedY !== null) lockedY = y; }
function lockScroll() {
  if (lockedY !== null) return;
  lockedY = window.scrollY;
  const st = document.body.style;
  st.position = 'fixed'; st.top = `-${lockedY}px`; st.left = '0'; st.right = '0';
  document.body.classList.add('no-scroll');
}
function unlockScroll() {
  if (lockedY === null) return;
  const y = lockedY; lockedY = null;
  const st = document.body.style;
  st.position = ''; st.top = ''; st.left = ''; st.right = '';
  document.body.classList.remove('no-scroll');
  window.scrollTo(0, y);
}

export function openSheet({ title, body, onMount, wide = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.innerHTML = `
      <div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip" aria-hidden="true"></div>
        <div class="sheet-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn sheet-x" aria-label="Close">${ICONS.x}</button>
        </div>
        <div class="sheet-body">${body}</div>
      </div>`;
    document.body.appendChild(overlay);
    lockScroll();
    const sheet = overlay.querySelector('.sheet');
    requestAnimationFrame(() => overlay.classList.add('open'));

    let done = false;
    const close = (value = null) => {
      if (done) return;
      done = true;
      overlay.classList.remove('open');
      setTimeout(() => {
        overlay.remove();
        if (!document.querySelector('.sheet-overlay')) unlockScroll();
      }, 220);
      resolve(value);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('.sheet-x').addEventListener('click', () => close(null));
    if (onMount) onMount(sheet, close);
  });
}

// ---------- Form sheet ----------
// fields: [{ name, label, type, options, required, value, placeholder, hint }]
export function formSheet({ title, fields, submitLabel = 'Save', danger, onMount: onFormMount }) {
  const body = `
    <form class="form" novalidate>
      ${fields.map(wrapField).join('')}
      <div class="form-error" hidden></div>
      <div class="form-actions">
        ${danger ? `<button type="button" class="btn danger-ghost" data-danger>${esc(danger)}</button>` : ''}
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;
  return openSheet({
    title, body,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      sheet.querySelectorAll('[data-money]').forEach(attachMoney);
      sheet.querySelectorAll('[data-photo]').forEach(attachPhoto);
      setupShowIf(form);
      const dangerBtn = sheet.querySelector('[data-danger]');
      if (dangerBtn) dangerBtn.addEventListener('click', () => close({ __danger: true }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const values = {};
        const missing = [];
        for (const f of fields) {
          if (f.type === 'heading' || f.type === 'note' || f.type === 'html') continue;
          const el = form.elements[f.name];
          let v;
          if (f.type === 'checkbox') v = el.checked;
          else if (f.type === 'money' || f.type === 'number') v = el.value === '' ? '' : Number(el.value.replace(/[^\d.-]/g, ''));
          else v = el.value.trim();
          if (f.required && (v === '' || v === null)) missing.push(f.label);
          else if (f.min != null && v !== '' && v < f.min) missing.push(`${f.label} (at least ${f.min})`);
          values[f.name] = v;
        }
        const err = form.querySelector('.form-error');
        if (missing.length) {
          err.textContent = 'Please fill in: ' + missing.join(', ');
          err.hidden = false;
          return;
        }
        close(values);
      });
      if (onFormMount) onFormMount(form, close);
    },
  });
}

// A field can be shown only when another field has a value: showIf: { name: 'shift', is: 'Custom' }
function wrapField(f) {
  const html = fieldHTML(f);
  if (!f.showIf) return html;
  return `<div data-showif="${esc(f.showIf.name)}" data-showif-is="${esc(f.showIf.is)}">${html}</div>`;
}

export function setupShowIf(form) {
  const update = () => form.querySelectorAll('[data-showif]').forEach((w) => {
    const el = form.elements[w.dataset.showif];
    w.hidden = !el || el.value !== w.dataset.showifIs;
  });
  form.addEventListener('change', update);
  form.addEventListener('input', update);
  update();
}

function fieldHTML(f) {
  const id = 'f_' + f.name;
  const v = f.value ?? '';
  const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  if (f.type === 'html') return f.html;
  if (f.type === 'photo') {
    return `<div class="field photo-field" data-photo>
      <span>${esc(f.label)}</span>
      <div class="photo-row">
        <div class="avatar lg" data-preview>${v ? `<img src="${esc(v)}" alt="">` : ICONS.person}</div>
        <label class="btn ghost small">${v ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" hidden data-file></label>
        <button type="button" class="btn danger-ghost small" data-remove${v ? '' : ' hidden'}>Remove</button>
      </div>
      <input type="hidden" name="${f.name}" value="${esc(v)}">
      ${hint}
    </div>`;
  }
  if (f.type === 'heading') return `<h3 class="form-heading">${esc(f.label)}</h3>`;
  if (f.type === 'note') return `<p class="form-note">${esc(f.label)}</p>`;
  if (f.type === 'select') {
    const opts = f.options.map((o) => {
      const val = typeof o === 'object' ? o.value : o;
      const lab = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`;
    }).join('');
    return `<label class="field" for="${id}"><span>${esc(f.label)}${req}</span><select id="${id}" name="${f.name}">${opts}</select>${hint}</label>`;
  }
  if (f.type === 'textarea') {
    return `<label class="field" for="${id}"><span>${esc(f.label)}${req}</span><textarea id="${id}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>${hint}</label>`;
  }
  if (f.type === 'checkbox') {
    return `<label class="field check" for="${id}"><input type="checkbox" id="${id}" name="${f.name}"${v ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
  }
  if (f.type === 'money') {
    const shown = v === '' ? '' : Number(v).toLocaleString('en-US');
    return `<label class="field" for="${id}"><span>${esc(f.label)}${req}</span><div class="money"><em>Rs.</em><input id="${id}" name="${f.name}" inputmode="numeric" autocomplete="off" data-money value="${esc(shown)}" placeholder="${esc(f.placeholder || '0')}"></div>${hint}</label>`;
  }
  const type = f.type === 'number' ? 'text' : (f.type || 'text');
  const extra = f.type === 'number' ? ' inputmode="decimal"' : f.type === 'tel' ? ' inputmode="tel"' : '';
  return `<label class="field" for="${id}"><span>${esc(f.label)}${req}</span><input id="${id}" name="${f.name}" type="${type}"${extra} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">${hint}</label>`;
}

// Photo picker: shrinks the photo to a small square before keeping it.
export function attachPhoto(wrap) {
  const hidden = wrap.querySelector('input[type=hidden]');
  const preview = wrap.querySelector('[data-preview]');
  const remove = wrap.querySelector('[data-remove]');
  const pickLabel = wrap.querySelector('label.btn');
  const set = (dataUrl) => {
    hidden.value = dataUrl || '';
    preview.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : ICONS.person;
    remove.hidden = !dataUrl;
    pickLabel.firstChild.textContent = dataUrl ? 'Change photo' : 'Add photo';
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  };
  wrap.querySelector('[data-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { set(await compressAvatar(file)); } catch (err) { toast(err.message, 'bad'); }
  });
  remove.addEventListener('click', () => set(''));
  wrap.setPhoto = set;
}

// Format money inputs with commas as the user types.
export function attachMoney(input) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[^\d]/g, '');
    input.value = digits ? Number(digits).toLocaleString('en-US') : '';
  });
}

// ---------- Confirm ----------
export function confirmSheet({ title, message, ok = 'Delete', danger = true, info = false }) {
  return openSheet({
    title,
    body: `<p class="confirm-msg">${esc(message)}</p>
      <div class="form-actions">
        ${info ? '' : '<button type="button" class="btn ghost" data-no>Cancel</button>'}
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button>
      </div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-no]')?.addEventListener('click', () => close(false));
      sheet.querySelector('[data-yes]').addEventListener('click', () => close(true));
    },
  }).then((v) => v === true);
}

// ---------- Action menu ----------
export function actionSheet(title, actions) {
  return openSheet({
    title,
    body: `<div class="action-list">${actions.map((a, i) =>
      `<button type="button" class="action-item${a.danger ? ' danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`,
    onMount(sheet, close) {
      sheet.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => close(actions[+b.dataset.i].value)));
    },
  });
}

// ---------- Icons ----------
const svg = (p) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const ICONS = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  calendar: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
  bookings: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.6 3.2-5.5 6.5-5.5s6 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.7.2 4.6 1.9 5 5.4"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>'),
  warn: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>'),
  person: svg('<circle cx="12" cy="8.5" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>'),
  contacts: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7.5 17.5c.8-2 2.5-3 4.5-3s3.7 1 4.5 3"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  cloud: svg('<path d="M7 18a5 5 0 1 1 .8-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>'),
  book: svg('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M4 20.5A1.5 1.5 0 0 0 5.5 22H20"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
};
