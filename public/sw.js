// Callit service worker.
// Pages: always the network, with the cache as the offline fallback only. Build files
// (/_next/static, hashed) and icons: cache first, since their URL changes when they change.
const CACHE = 'callit-v7';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/badge-96.png', '/boot.webp'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const save = (r) => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; };
  // Hashed build files never change: serve from cache, fetch once.
  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|webp|jpg|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(save)));
    return;
  }
  // Never serve a cached page just because the network is slow. A page from an earlier deploy
  // asks for build files that no longer exist, and the app dies with "This page couldn't load".
  // Only fall back to the cache when the network genuinely fails.
  e.respondWith(
    fetch(req).then(save).catch(() =>
      caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/') : undefined)),
    ),
  );
});

// Push alerts: show even when Callit is closed; tapping opens (or focuses) Callit on the right page.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Callit', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Callit', {
    body: d.body || '', icon: d.icon || '/icon-192.png', badge: '/badge-96.png', tag: d.tag, renotify: !!d.tag,
    data: { link: d.link || '#/notifications' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#/notifications';
  const url = new URL('/' + (link.startsWith('#') ? link : '#' + link), self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) { w.focus(); return w.navigate ? w.navigate(url) : w.postMessage({ go: link }); }
    return self.clients.openWindow(url);
  }));
});
