// Keeps the whole app, including the videos, on the laptop so the demo runs with no internet.
// Change VERSION whenever the videos are replaced so laptops fetch the new ones.
const VERSION = 'v1';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'media/far-end-1.webm',
  'media/far-end-2.webm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Video elements ask for byte ranges; answer those from the cached full file.
async function ranged(request, cached) {
  const match = /bytes=(\d+)-(\d*)/.exec(request.headers.get('range'));
  if (!match) return cached;
  const blob = await cached.blob();
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : blob.size - 1;
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'video/webm',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (request.headers.has('range')) return cached ? ranged(request, cached) : fetch(request);

    // Use the saved copy straight away and refresh it in the background when online.
    const update = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => cached);
    return cached || update;
  })());
});
