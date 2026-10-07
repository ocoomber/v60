// Retire the mistakenly nested app. Never touch V60 storage or other caches.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const prefix = 'coffeescale-/v60/coffee-scale/-';
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
