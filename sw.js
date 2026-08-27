const CACHE_VERSION = 'finance-me-v4';
const STATIC_ASSETS = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json', '/logo.png'];

// Install: cache core static assets immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting(); // Activate new SW immediately, don't wait for old tabs to close
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

// Fetch: Network-first for navigation & API; cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always go straight to network for API calls and Supabase — never cache these
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for HTML navigation (ensures fresh index.html on update)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, fonts, images) — fast load
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        return res;
      });
      return cached || networkFetch;
    })
  );
});
