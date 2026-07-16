const CACHE = 'investor-control-v0.6.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './app-part1.js',
  './app-part2.js',
  './app-part3.js',
  './app-part4.js',
  './app-part5.js',
  './app-part6.js',
  './app-run.js',
  './automation.js',
  './live-feed.js',
  './currency-fix.js',
  './market-data.json',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const asset of ASSETS) {
      try {
        const response = await fetch(asset, { cache: 'reload' });
        if (response.ok) await cache.put(asset, response.clone());
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

  event.respondWith((async () => {
    const url = new URL(event.request.url);
    const isLocal = url.origin === self.location.origin;
    const isMarketFeed = isLocal && url.pathname.endsWith('/market-data.json');
    const isCodeAsset = isLocal && /\/(index\.html|app\.js|app-part\d+\.js|app-run\.js|automation\.js|live-feed\.js|currency-fix\.js|styles\.css)$/.test(url.pathname);

    try {
      const response = await fetch(event.request, {
        cache: (isMarketFeed || isCodeAsset || event.request.mode === 'navigate') ? 'reload' : 'default'
      });
      if (response && response.ok && isLocal) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
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
