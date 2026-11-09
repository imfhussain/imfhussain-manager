import { state } from '../db.js';
import { ICONS, formSheet, confirmSheet, toast } from '../ui.js';
import { esc, fmtDate, isoDate, fmtTime } from '../util.js';
import { pageHead } from './parts.js';
import { rerender } from '../app.js';
import { isConnected, startLogin, finishLogin, disconnect, syncNow, downloadBackup, onStatus, XLSX_PATH, JSON_PATH } from '../dropbox.js';
import { restoreFromText } from './more.js';

let hooked = false;

function when(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${fmtDate(isoDate(d))}, ${fmtTime(t)}`;
}

export function renderDropbox(view) {
  if (!hooked) { hooked = true; onStatus(() => { if (location.hash === '#/dropbox') rerender(); }); }
  const d = state.meta.dropbox || {};
  const on = isConnected();
  view.innerHTML = `
    ${pageHead('Dropbox sync', { backTo: '#/more' })}
    ${on ? `
      <div class="banner ${d.lastError ? 'warn' : 'ok'}" style="margin-top:0">${d.lastError ? ICONS.warn : ''}<div>
        ${d.syncing ? 'Uploading…' : d.lastError ? esc(d.lastError) : 'Connected. Every save updates your Dropbox.'}
      </div></div>
      <div class="card pad mt small">
        <dl class="kv">
          <dt>Last upload</dt><dd>${esc(when(d.lastSync))}</dd>
          <dt>Waiting to upload</dt><dd>${d.pending ? 'Yes' : 'No'}</dd>
          <dt>Excel record</dt><dd>${esc(XLSX_PATH.slice(1))}</dd>
          <dt>Full backup</dt><dd>${esc(JSON_PATH.slice(1))}</dd>
        </dl>
        <p class="muted" style="margin:10px 0 0">Find them in Dropbox → Apps → your app name.</p>
      </div>
      <div class="btn-row mt">
        <button type="button" class="btn primary" data-sync>Upload now</button>
        <button type="button" class="btn outline" data-restore>Restore from Dropbox</button>
      </div>
      <div class="section"><button type="button" class="btn danger-ghost block" data-off>Disconnect Dropbox</button></div>
    ` : `
      <div class="card pad">
        <p style="margin:0 0 10px">After every save, the app rewrites an <b>Excel file</b> with all your records and a <b>full backup</b> in your Dropbox. If the phone or app has a problem, your records are safe there.</p>
        <p class="muted small" style="margin:0">One-time setup (about 5 minutes):</p>
        <ol class="steps small">
          <li>On a computer, open <b>dropbox.com/developers/apps</b> and tap <b>Create app</b>.</li>
          <li>Choose <b>Scoped access</b> → <b>App folder</b>. Name it, for example <b>imfhussain-manager</b>.</li>
          <li>In the <b>Permissions</b> tab, tick <b>files.content.write</b> and <b>files.content.read</b>, then <b>Submit</b>.</li>
          <li>In the <b>Settings</b> tab, copy the <b>App key</b>.</li>
          <li>Tap <b>Connect</b> below and paste the App key.</li>
          <li>Dropbox opens. Tap <b>Allow</b>, copy the code it shows, come back here and paste it.</li>
        </ol>
      </div>
      <button type="button" class="btn primary block mt" data-connect>Connect Dropbox</button>
      ${d.verifier ? `<button type="button" class="btn outline block mt" data-code>I have the code</button>` : ''}
    `}
  `;
  const $ = (s) => view.querySelector(s);
  const askCode = async () => {
    const v = await formSheet({ title: 'Paste Dropbox code', submitLabel: 'Finish', fields: [{ name: 'code', label: 'Code from Dropbox', required: true, hint: 'After you tap Allow, Dropbox shows a code. Copy it and paste it here.' }] });
    if (!v) return;
    try { toast('Connecting…'); await finishLogin(v.code); toast('Dropbox connected'); } catch (e) { toast(e.message, 'bad'); }
    rerender();
  };
  if ($('[data-connect]')) $('[data-connect]').onclick = async () => {
    const v = await formSheet({ title: 'Connect Dropbox', submitLabel: 'Open Dropbox', fields: [{ name: 'appKey', label: 'App key', required: true, value: d.appKey || '', hint: 'From your Dropbox app Settings tab.' }] });
    if (!v) return;
    await startLogin(v.appKey);
    rerender();
    askCode();
  };
  if ($('[data-code]')) $('[data-code]').onclick = askCode;
  if ($('[data-sync]')) $('[data-sync]').onclick = async () => {
    toast('Uploading…');
    toast((await syncNow()) ? 'Uploaded to Dropbox' : 'Upload failed: ' + (state.meta.dropbox.lastError || ''), state.meta.dropbox.lastError ? 'bad' : 'ok');
    rerender();
  };
  if ($('[data-restore]')) $('[data-restore]').onclick = async () => {
    try { toast('Downloading…'); restoreFromText(await downloadBackup()); } catch (e) { toast(e.message, 'bad'); }
  };
  if ($('[data-off]')) $('[data-off]').onclick = async () => {
    if (!(await confirmSheet({ title: 'Disconnect Dropbox?', message: 'Uploads will stop. Files already in Dropbox stay there.', ok: 'Disconnect' }))) return;
    await disconnect();
    toast('Dropbox disconnected');
    rerender();
  };
}
