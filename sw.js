// Offline support. Keeps a copy of the app's own files on the phone.
// Change CACHE_VERSION whenever any app file changes, or phones won't pick up the update.
const CACHE_VERSION = 'fitness-tracker-v5';

const APP_FILES = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/exercises.js',
  'js/foodApi.js',
  'js/nutrition.js',
  'js/workout.js',
  'js/workoutScreen.js',
  'lib/alpine.min.js',
  'lib/dexie.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(
    APP_FILES.map((file) => new Request(file, { cache: 'reload' })),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Only the app's own files are served from the copy. Food searches always go to the internet.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { cacheName: CACHE_VERSION, ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (error) {
      // Offline and opening a page that isn't saved: show the app rather than a browser error.
      const shell = request.mode === 'navigate' && await caches.match('index.html', { cacheName: CACHE_VERSION });
      if (shell) return shell;
      throw error;
    }
  })());
});
