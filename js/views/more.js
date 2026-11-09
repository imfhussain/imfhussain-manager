import {
  state, save, exportJSON, parseBackup, importData, markBackedUp, wipeAll, isPersisted, requestPersist, storageKind, DEFAULT_SETTINGS,
} from '../db.js';
import { ICONS, openSheet, confirmSheet, toast, attachMoney } from '../ui.js';
import { esc, num, fmtDate, isoDate, daysAgo, todayISO } from '../util.js';
import { pageHead } from './parts.js';
import { applyTheme, rerender } from '../app.js';
import { mountInstall } from '../install.js';
import { gigsSummary, rs } from '../util.js';
const rsSafe = () => rs(gigsSummary().pending);

export function renderMore(view) {
  const last = state.meta.lastBackup;
  view.innerHTML = `
    ${pageHead('More')}
    <div data-install-slot style="margin-bottom:12px"></div>
    <div class="list">
      <a class="row" href="#/backup"><div class="main"><div class="title">Backup and restore</div>
        <div class="sub">${last ? `Last backup ${esc(fmtDate(isoDate(new Date(last))))}` : 'No backup yet'}</div></div><span class="chev">${ICONS.chevron}</span></a>
      <a class="row" href="#/gigs"><div class="main"><div class="title">My freelance</div>
        <div class="sub">Jobs where others hire you · ${rsSafe()} owed to you</div></div><span class="chev">${ICONS.chevron}</span></a>
      <a class="row" href="#/dropbox"><div class="main"><div class="title">Dropbox sync</div>
        <div class="sub">${state.meta.dropbox?.refreshToken ? (state.meta.dropbox.lastError ? 'Problem: ' + esc(state.meta.dropbox.lastError) : 'On · Excel record and backup after every save') : 'Off · Keep an Excel record in Dropbox'}</div></div><span class="chev">${ICONS.chevron}</span></a>
      <a class="row" href="#/guide"><div class="main"><div class="title">Posing guide</div><div class="sub">Pinterest boards and saved poses</div></div><span class="chev">${ICONS.chevron}</span></a>
      <a class="row" href="#/calc"><div class="main"><div class="title">Rate calculator</div><div class="sub">Quote, profit, discounts and negotiation ladder</div></div><span class="chev">${ICONS.chevron}</span></a>
      <a class="row" href="#/settings"><div class="main"><div class="title">Settings</div><div class="sub">Theme, package rates, add-on prices</div></div><span class="chev">${ICONS.chevron}</span></a>
    </div>
    <div class="section center muted small">
      <p style="font-family:var(--serif);font-size:20px;color:var(--ink);margin:0">imfhussain Manager</p>
      <p style="margin:4px 0 0">${state.bookings.length} bookings · ${state.freelancers.length} freelancers</p>
      <p style="margin:4px 0 0">All data is saved only on this phone.</p>
    </div>
  `;
  mountInstall(view.querySelector('[data-install-slot]'), { force: true });
}

// ================= Backup =================
function backupFileName() { return `imfhussain-backup-${todayISO()}.json`; }

export async function renderBackup(view) {
  const last = state.meta.lastBackup;
  const age = daysAgo(last);
  const persisted = await isPersisted();
  view.innerHTML = `
    ${pageHead('Backup', { backTo: '#/more' })}
    ${!last ? `<div class="banner warn">${ICONS.warn}<div>You have not made a backup yet. Your data lives only on this phone.</div></div>`
      : age > 7 ? `<div class="banner warn">${ICONS.warn}<div>Last backup was ${age} days ago (${esc(fmtDate(isoDate(new Date(last))))}).</div></div>`
      : `<div class="banner ok"><div>Last backup: ${esc(fmtDate(isoDate(new Date(last))))}</div></div>`}

    <section class="section">
      <div class="section-head"><h2>Make a backup</h2></div>
      <div class="card pad">
        <p class="muted small" style="margin:0 0 12px">Save the file to iCloud Drive or Files, or send it to yourself on WhatsApp or email.</p>
        <div class="btn-row">
          <button type="button" class="btn primary" data-export>Save backup file</button>
          <button type="button" class="btn ghost" data-copy>Copy to clipboard</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Restore</h2></div>
      <div class="card pad">
        <p class="muted small" style="margin:0 0 12px">Restoring replaces all data on this phone with the backup.</p>
        <div class="btn-row">
          <label class="btn outline" style="position:relative;overflow:hidden">Choose backup file
            <input type="file" accept=".json,application/json,text/plain" data-file style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
          <button type="button" class="btn ghost" data-paste>Paste backup text</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Storage</h2></div>
      <div class="card pad small">
        <dl class="kv">
          <dt>Saved in</dt><dd>${storageKind === 'indexeddb' ? 'Phone database' : storageKind === 'localstorage' ? 'Browser storage' : 'Memory only'}</dd>
          <dt>Protected storage</dt><dd>${persisted ? 'Yes' : 'Not yet'}</dd>
        </dl>
        ${persisted ? '' : `<p class="muted" style="margin:10px 0 0">For best safety, open this app from the Home Screen icon and make backups often.</p>
          <button type="button" class="btn ghost small mt" data-persist>Ask for protected storage</button>`}
      </div>
    </section>
  `;

  const $ = (s) => view.querySelector(s);
  $('[data-export]').onclick = async () => {
    const json = exportJSON();
    const name = backupFileName();
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'imfhussain backup' });
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      await markBackedUp();
      toast('Backup saved');
      rerender();
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the share sheet
      toast('Could not save the file. Try Copy instead.', 'bad');
    }
  };
  $('[data-copy]').onclick = async () => {
    const text = exportJSON();
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Older fallback: copy through a hidden text box.
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy failed');
      }
      await markBackedUp();
      toast('Backup copied. Paste it in Notes or WhatsApp.');
      rerender();
    } catch {
      toast('Copy failed. Use Save backup file instead.', 'bad');
    }
  };
  $('[data-file]').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    restoreFromText(await file.text());
  };
  $('[data-paste]').onclick = () => {
    openSheet({
      title: 'Paste backup',
      body: `<div class="form"><label class="field"><span>Backup text</span><textarea class="paste" data-text placeholder='{"app":"imfhussain-manager", …}'></textarea></label>
        <div class="form-actions"><button type="button" class="btn primary" data-go>Restore</button></div></div>`,
      onMount(sheet, close) {
        sheet.querySelector('[data-go]').onclick = () => close(sheet.querySelector('[data-text]').value);
      },
    }).then((text) => { if (text && text.trim()) restoreFromText(text.trim()); });
  };
  const p = $('[data-persist]');
  if (p) p.onclick = async () => {
    const ok = await requestPersist();
    toast(ok ? 'Storage is now protected' : 'The phone did not allow it yet. Keep making backups.', ok ? 'ok' : 'bad');
    rerender();
  };
}

export async function restoreFromText(text) {
  let data;
  try { data = parseBackup(text); } catch (e) { toast(e.message, 'bad'); return; }
  const ok = await confirmSheet({
    title: 'Replace all data?',
    message: `This backup has ${data.bookings.length} bookings and ${data.freelancers.length} freelancers. All data now on this phone (${state.bookings.length} bookings, ${state.freelancers.length} freelancers) will be replaced.`,
    ok: 'Replace and restore',
  });
  if (!ok) return;
  await importData(data);
  applyTheme();
  toast('Backup restored');
  rerender();
}

// ================= Settings =================
export function renderSettings(view) {
  const s = state.settings;
  const money = (name, label, value, hint = '') => `<label class="field"><span>${esc(label)}</span><div class="money"><em>Rs.</em><input name="${name}" inputmode="numeric" data-money value="${num(value).toLocaleString('en-US')}"></div>${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</label>`;
  view.innerHTML = `
    ${pageHead('Settings', { backTo: '#/more' })}
    <form class="form" data-form>
      <div class="card pad">
        <h3 class="form-heading" style="margin:0 0 10px">Appearance</h3>
        <label class="field"><span>Theme</span><select name="theme">
          ${[['system', 'Same as phone'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${s.theme === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>

      <div class="card pad">
        <h3 class="form-heading" style="margin:0 0 10px">Package rates per day</h3>
        <div class="form" data-pkgs>
          ${s.packages.map((p, i) => `<div class="grid2">
            <label class="field"><span>Name</span><input name="pkgName${i}" value="${esc(p.name)}"></label>
            ${money('pkgRate' + i, 'Rate', p.rate)}
          </div>`).join('')}
        </div>
      </div>

      <div class="card pad">
        <h3 class="form-heading" style="margin:0 0 10px">Multi day discount</h3>
        <div class="grid2">${money('multiDay3', '3 days', s.multiDay3)}${money('multiDay4', '4 or more days', s.multiDay4)}</div>
      </div>

      <div class="card pad">
        <h3 class="form-heading" style="margin:0 0 10px">Add on prices</h3>
        <div class="form">
          <div class="grid2">${money('addAlbum', 'Extra 10 page album', s.addAlbum)}${money('addHighlights', 'Highlights film', s.addHighlights)}</div>
          <div class="grid2">${money('addOvertime', 'Overtime per hour', s.addOvertime)}${money('addLocation', 'Location change', s.addLocation)}</div>
          <div class="grid2">${money('addTravelPerKm', 'Travel per km', s.addTravelPerKm)}
            <label class="field"><span>Free km</span><input name="freeKm" inputmode="numeric" value="${num(s.freeKm)}"></label></div>
          <label class="field"><span>My minimum margin (%)</span><input name="minMargin" inputmode="decimal" value="${num(s.minMargin)}"></label>
        </div>
      </div>

      <div class="form-actions"><button type="button" class="btn ghost" data-reset>Reset rates</button><button type="submit" class="btn primary">Save settings</button></div>
    </form>

    <section class="section">
      <div class="section-head"><h2>Danger zone</h2></div>
      <button type="button" class="btn danger-ghost block" data-wipe>Delete all bookings and team</button>
    </section>
  `;
  const form = view.querySelector('[data-form]');
  form.querySelectorAll('[data-money]').forEach(attachMoney);
  form.elements.theme.onchange = () => { s.theme = form.elements.theme.value; applyTheme(); save('settings'); toast('Theme changed'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const el = form.elements;
    s.theme = el.theme.value;
    s.packages = s.packages.map((p, i) => ({ name: el['pkgName' + i].value.trim() || p.name, rate: num(el['pkgRate' + i].value) }));
    for (const k of ['multiDay3', 'multiDay4', 'addAlbum', 'addHighlights', 'addOvertime', 'addLocation', 'addTravelPerKm', 'freeKm', 'minMargin']) s[k] = num(el[k].value);
    await save('settings');
    applyTheme();
    toast('Settings saved');
  };
  view.querySelector('[data-reset]').onclick = async () => {
    if (!(await confirmSheet({ title: 'Reset rates?', message: 'Put all package rates, discounts and add-on prices back to the original values?', ok: 'Reset', danger: false }))) return;
    const theme = s.theme;
    state.settings = { ...structuredClone(DEFAULT_SETTINGS), theme };
    await save('settings');
    toast('Rates reset');
    rerender();
  };
  view.querySelector('[data-wipe]').onclick = async () => {
    if (!(await confirmSheet({ title: 'Delete everything?', message: `This deletes all ${state.bookings.length} bookings and ${state.freelancers.length} freelancers from this phone. Make a backup first. This cannot be undone.`, ok: 'Delete everything' }))) return;
    await wipeAll();
    toast('All data deleted');
    rerender();
  };
}

