// App-shell cache only. API responses are NEVER cached (availability must be live).
const V = 'mh-shell-v9';
const SHELL = ['/', '/styles.css', '/js/app.js', '/js/api.js', '/js/util.js', '/js/scanner.js', '/js/views-core.js', '/js/views-advisor.js', '/js/views-admin.js', '/js/views-review.js', '/js/views-feedback.js', '/js/views-backup.js', '/js/leave-guard.js', '/js/images.js', '/js/discovery.js', '/js/taxonomy.js', '/js/icons.js', '/js/picker.js', '/icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
