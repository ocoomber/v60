const ROOT = new URL('./', self.location.href);
const PREFIX = 'coffeescale-' + ROOT.pathname + '-';
const CACHE = PREFIX + '42a9e95cfb68';
const FILES = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map(p => new URL(p, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // The worker never intercepts or caches readings or commands to the scale.
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const shell = event.request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.href === FILES[0]);
  if (!shell && !FILES.includes(url.href)) return;
  // Each worker serves its complete installed version; updates activate on next launch.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(shell ? FILES[0] : event.request);
    return cached || fetch(event.request);
  }));
});
