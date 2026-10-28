/**
 * Sonora Music — Service Worker
 * Offline caching for PWA functionality
 */

const CACHE_NAME = 'sonora-7.11.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/themes.css',
  '/css/main.css',
  '/css/player.css',
  '/css/video-player.css',
  '/css/animations.css',
  '/css/responsive.css',
  '/js/store.js',
  '/js/i18n.js',
  '/js/router.js',
  '/js/db.js',
  '/js/api.js',
  '/js/themes.js',
  '/js/player.js',
  '/js/visualizer.js',
  '/js/video-player.js',
  '/js/download.js',
  '/js/notifications.js',
  '/js/home.js',
  '/js/search.js',
  '/js/library.js',
  '/js/discover.js',
  '/js/playlists.js',
  '/js/profile.js',
  '/js/settings.js',
  '/js/app.js'
];

// Install — cache all static assets
self.addEventListener('install', function (event) {
  console.log('[SW] Installing Sonora Music v7.11...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS).catch(function (err) {
        console.warn('[SW] Some assets failed to cache:', err);
        // Cache what we can individually
        return Promise.all(STATIC_ASSETS.map(function (url) {
          return cache.add(url).catch(function () {
            console.warn('[SW] Failed to cache:', url);
          });
        }));
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate — clean old caches
self.addEventListener('activate', function (event) {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch — cache-first for static assets, network-first for API
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Stream requests — network only (audio files).
  // Debe ir ANTES del bloque /api/ para no guardar el audio en caché.
  if (url.pathname.startsWith('/api/stream/')) {
    return; // Let browser handle normally
  }

  // API requests — network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then(function (response) {
        // Cache successful API responses
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  // Static assets — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response.ok && url.origin === self.location.origin) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        // Fallback to index.html for navigation requests (SPA)
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Handle messages from the main app
self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
