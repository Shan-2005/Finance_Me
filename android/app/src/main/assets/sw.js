const CACHE_VERSION = 'finance-me-v5-network-first';
const STATIC_ASSETS = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json', '/logo.png'];

// Install: cache core static assets immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting(); // Activate new SW immediately
});

// Activate: delete ALL old caches so stale JS/CSS never gets served after an update
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // Take control of all open tabs immediately
  );
});

// Fetch: Network-First for ALL code & API assets to prevent stale JS caching on Android
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always go straight to network for API calls and Supabase — never cache these
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-First strategy for JS, CSS, and HTML navigation (ensures fresh app.js on update)
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache if completely offline
        return caches.match(event.request);
      })
  );
});
