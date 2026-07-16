const CACHE = 'investor-control-loader-v0.3.1';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './chunks/00',
  './chunks/01',
  './chunks/02',
  './chunks/03',
  './chunks/04',
  './chunks/05a',
  './chunks/05b',
  './chunks/05c',
  './chunks/05d',
  './chunks/05e',
  './chunks/06'
];
const EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCAL_ASSETS);
    for (const url of EXTERNAL_ASSETS) {
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) await cache.put(url, response.clone());
      } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE);
        await cache.put('./index.html', response.clone());
        return response;
      } catch (_) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      return Response.error();
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow('./');
  })());
});
