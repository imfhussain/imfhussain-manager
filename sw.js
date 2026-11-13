// Offline cache for imfhussain Manager.
// Change VERSION whenever you upload new files, so phones pick up the update.
const VERSION = 'v32';
const CACHE = 'imfm-' + VERSION;
const FONT_CACHE = 'imfm-fonts';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/util.js',
  './js/views/parts.js',
  './js/views/home.js',
  './js/views/calendar.js',
  './js/views/bookings.js',
  './js/views/team.js',
  './js/views/more.js',
  './js/views/calc.js',
  './js/views/moodboard.js',
  './js/views/guide.js',
  './js/views/dropboxView.js',
  './js/views/gigs.js',
  './js/images.js',
  './js/pinterest.js',
  './js/xlsx.js',
  './js/dropbox.js',
  './js/install.js',
  './js/whatsapp.js',
  './js/merge.js',
  './js/assign.js',
  './js/longpress.js',
  './js/studio.js', './js/privacy.js', './js/rules.js',
  './js/views/journey.js',
  './js/views/reports.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's short-term HTTP cache, so a new version never stores old files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: serve from cache, refresh in background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // App files: cache first, fall back to network, and to the app shell for page loads.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
