/* Service Worker — App de Boda (PWA) */
const CACHE = 'boda-v7';
const MEDIA_CACHE = 'boda-media-v1';
const MEDIA_MAX = 600; // máximo de miniaturas/vistas guardadas en el dispositivo

const SHELL = [
  '/',
  '/app',
  '/css/style.css',
  '/js/landing.js',
  '/js/app.js',
  '/js/petals.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Miniaturas y vistas: caché primero (no cambian nunca para un mismo archivo)
async function mediaCacheFirst(req) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.status === 200) {
    cache.put(req, res.clone());
    trimMediaCache(cache); // sin await: limpia en segundo plano
  }
  return res;
}

async function trimMediaCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MEDIA_MAX) {
      // borra las más antiguas (las primeras en la lista)
      for (const k of keys.slice(0, keys.length - MEDIA_MAX)) await cache.delete(k);
    }
  } catch (_) {}
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Miniaturas y vistas del visor: caché primero (revisitas instantáneas)
  if (url.pathname.startsWith('/media/') &&
      (url.pathname.endsWith('/thumb') || url.pathname.endsWith('/view'))) {
    e.respondWith(mediaCacheFirst(req));
    return;
  }

  // No cachear API ni originales (siempre frescos)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
    return; // deja pasar a la red
  }

  // App shell: cache-first con actualización en segundo plano
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
