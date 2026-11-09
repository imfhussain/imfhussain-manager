import { state } from '../db.js';
import { ICONS, formSheet, confirmSheet, toast } from '../ui.js';
import { esc, fmtDate, isoDate, fmtTime } from '../util.js';
import { pageHead } from './parts.js';
import { rerender } from '../app.js';
import { isConnected, startLogin, prepareLogin, rememberLogin, finishLogin, disconnect, syncNow, downloadBackup, onStatus, XLSX_PATH, JSON_PATH } from '../dropbox.js';
import { restoreFromText } from './more.js';

// Your own Dropbox app (imfhussain-manager, App folder access). Not a password: it only names the app.
const BUILT_IN_KEY = '743q0oxl8zy4kpj';

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
        <ol class="steps small">
          <li>Tap <b>Connect Dropbox</b> below.</li>
          <li>Dropbox opens. Sign in if asked, then tap <b>Allow</b>.</li>
          <li>Dropbox shows a code. Copy it, come back here and paste it.</li>
        </ol>
      </div>
      <a class="btn primary block mt" data-connect target="_blank" rel="noopener" href="#/dropbox" aria-disabled="true">Connect Dropbox</a>
      ${d.verifier ? `<button type="button" class="btn outline block mt" data-code>I have the code</button>` : ''}
      <p class="center mt"><button type="button" class="link small" data-otherkey style="background:none;border:0;color:var(--muted);text-decoration:underline">Use a different Dropbox app key</button></p>
    `}
  `;
  const $ = (s) => view.querySelector(s);
  const askCode = async () => {
    const v = await formSheet({ title: 'Paste Dropbox code', submitLabel: 'Finish', fields: [{ name: 'code', label: 'Code from Dropbox', required: true, hint: 'After you tap Allow, Dropbox shows a code. Copy it and paste it here.' }] });
    if (!v) return;
    try { toast('Connecting…'); await finishLogin(v.code); toast('Dropbox connected'); } catch (e) { toast(e.message, 'bad'); }
    rerender();
  };
  const connect = async (key) => { await startLogin(key); rerender(); askCode(); };
  const link = $('[data-connect]');
  if (link) {
    // Prepare the sign-in link now; the tap then opens Dropbox straight away.
    prepareLogin(BUILT_IN_KEY).then((prep) => {
      link.href = prep.url;
      link.removeAttribute('aria-disabled');
      link.onclick = () => { rememberLogin(prep).then(() => { rerender(); setTimeout(askCode, 600); }); };
    });
  }
  if ($('[data-otherkey]')) $('[data-otherkey]').onclick = async () => {
    const v = await formSheet({ title: 'Different app key', submitLabel: 'Open Dropbox', fields: [{ name: 'appKey', label: 'App key', required: true, value: d.appKey && d.appKey !== BUILT_IN_KEY ? d.appKey : '', hint: 'Only if you made another Dropbox app. From its Settings tab.' }] });
    if (v) connect(v.appKey);
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
