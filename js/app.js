import { loadAll, requestPersist, state } from './db.js';
import { ICONS, scrollLocked, setLockedScroll } from './ui.js';
import { initLongPress } from './longpress.js';
import { renderHome } from './views/home.js';
import { renderCalendar } from './views/calendar.js';
import { renderBookings, renderBooking } from './views/bookings.js';
import { renderTeam, renderFreelancer } from './views/team.js';
import { renderMore, renderSettings, renderBackup } from './views/more.js';
import { renderCalc } from './views/calc.js';
import { renderGuide, renderPose } from './views/guide.js';
import { renderDropbox } from './views/dropboxView.js';
import { initDropboxSync } from './dropbox.js';
import { renderGigs, renderGig } from './views/gigs.js';

const routes = {
  home: { tab: 'home', render: renderHome },
  calendar: { tab: 'calendar', render: renderCalendar },
  bookings: { tab: 'bookings', render: renderBookings },
  booking: { tab: 'bookings', render: renderBooking },
  team: { tab: 'team', render: renderTeam },
  freelancer: { tab: 'team', render: renderFreelancer },
  more: { tab: 'more', render: renderMore },
  settings: { tab: 'more', render: renderSettings },
  backup: { tab: 'more', render: renderBackup },
  calc: { tab: 'more', render: renderCalc },
  guide: { tab: 'more', render: renderGuide },
  pose: { tab: 'more', render: renderPose },
  dropbox: { tab: 'more', render: renderDropbox },
  gigs: { tab: 'more', render: renderGigs },
  gig: { tab: 'more', render: renderGig },
};

let lastHash = '';

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}


// Re-render the current screen, keeping scroll position.
export function rerender() {
  if (scrollLocked()) { render(true); return; } // page is pinned behind a sheet; it is restored on close
  const y = window.scrollY;
  render(true);
  window.scrollTo(0, y);
}

function render(keepScroll = false) {
  const [name, id] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  const route = routes[name] || routes.home;
  const view = document.getElementById('view');
  route.render(view, id ? decodeURIComponent(id) : undefined);
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === route.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (!keepScroll && location.hash !== lastHash) { if (scrollLocked()) setLockedScroll(0); else window.scrollTo(0, 0); }
  lastHash = location.hash;
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

async function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon]; });
  await loadAll();
  applyTheme();
  window.addEventListener('hashchange', () => render());
  render();
  initLongPress(document.getElementById('view'));
  initDropboxSync();
  requestPersist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // iPhone keeps Home Screen apps paused in memory, so check for a new version whenever the app comes back.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    // When a new version takes over, reload once so the new screens are used straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
}

init();
