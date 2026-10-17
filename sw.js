// Caches the app's own files so it opens instantly and works with no signal.
// Firebase keeps your data offline itself; this only covers the app shell.
// Bump VERSION whenever you change any file so phones pick up the update.
const VERSION = 'carlog-v39';
const SHELL = [
  './', 'index.html',
  'manifest.webmanifest', 'icons/banner.jpg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for the app's files (so updates show straight away), cache when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const ours = url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'www.gstatic.com'
    || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!ours) return;
  // The app's own files are re-checked with GitHub every time (GitHub otherwise lets
  // phones reuse a copy for up to 10 minutes), so updates show on the next open.
  const req = url.origin === location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
