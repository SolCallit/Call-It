// Callit service worker: network first for pages, cached shell when offline.
const CACHE = 'callit-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
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
  e.respondWith(
    fetch(req)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then((r) => r || caches.match('/')))
  );
});

// Push alerts: show even when Callit is closed; tapping opens (or focuses) Callit on the right page.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Callit', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Callit', {
    body: d.body || '', icon: d.icon || '/icon-192.png', badge: '/icon-192.png', tag: d.tag, renotify: !!d.tag,
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
