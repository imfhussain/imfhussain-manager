// "Install this app" card.
// iPhone: Apple does not allow automatic install, so the card shows the exact taps (Share → Add to Home Screen).
// Android / Chrome: a real one-tap Install button.

const DISMISS_KEY = 'imfm:installDismissed';
let deferredPrompt = null;
let onChange = () => {};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  onChange();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; onChange(); });

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'ios-other' : 'ios-safari';
  if (deferredPrompt) return 'prompt';
  return 'none';
}

function dismissed() { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } }
function setDismissed(v) { try { v ? localStorage.setItem(DISMISS_KEY, '1') : localStorage.removeItem(DISMISS_KEY); } catch {} }

const SHARE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

export function canShowInstall() {
  return !isStandalone() && platform() !== 'none';
}

function cardHTML({ force = false } = {}) {
  if (isStandalone()) return '';
  if (!force && dismissed()) return '';
  const p = platform();
  const close = force ? '' : `<button type="button" class="icon-btn install-x" data-install-close aria-label="Hide">✕</button>`;
  if (p === 'ios-safari') {
    return `<div class="install-card" data-install>
      ${close}
      <div class="install-head"><img src="icons/apple-touch-icon.png" alt="" width="44" height="44"><div><b>Install imfhussain</b><span>Put the app on your Home Screen</span></div></div>
      <ol class="install-steps">
        <li><span class="ico">${SHARE_ICON}</span><span>Tap the <b>Share</b> button in Safari's bar</span></li>
        <li><span class="ico">${ADD_ICON}</span><span>Scroll down, tap <b>Add to Home Screen</b></span></li>
        <li><span class="ico"><b>Add</b></span><span>Tap <b>Add</b>, then open the app from the new icon</span></li>
      </ol>
      <p class="install-note">Add your events in the installed app. Data typed here in Safari stays in Safari.</p>
    </div>`;
  }
  if (p === 'ios-other') {
    return `<div class="install-card" data-install>
      ${close}
      <div class="install-head"><img src="icons/apple-touch-icon.png" alt="" width="44" height="44"><div><b>Open in Safari to install</b><span>iPhone only installs apps from Safari</span></div></div>
      <button type="button" class="btn primary block" data-install-copy>Copy link</button>
      <p class="install-note">Then open Safari, paste the link, and follow the steps there.</p>
    </div>`;
  }
  if (p === 'prompt') {
    return `<div class="install-card" data-install>
      ${close}
      <div class="install-head"><img src="icons/icon-192.png" alt="" width="44" height="44"><div><b>Install imfhussain</b><span>Open it like any app, even offline</span></div></div>
      <button type="button" class="btn primary block" data-install-go>Install app</button>
    </div>`;
  }
  return '';
}

// Put the card at the top of `slot` and keep it up to date.
export function mountInstall(slot, opts = {}) {
  const draw = () => {
    slot.innerHTML = cardHTML(opts);
    const card = slot.querySelector('[data-install]');
    if (!card) return;
    card.querySelector('[data-install-close]')?.addEventListener('click', () => { setDismissed(true); draw(); });
    card.querySelector('[data-install-go]')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      draw();
    });
    card.querySelector('[data-install-copy]')?.addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(location.href.split('#')[0]); e.target.textContent = 'Link copied'; } catch { e.target.textContent = location.href.split('#')[0]; }
    });
  };
  onChange = draw;
  draw();
}

export function showInstallAgain() { setDismissed(false); }
