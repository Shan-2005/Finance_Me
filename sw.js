// Finance Me PWA Service Worker
const CACHE_NAME = 'finance-me-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass through fetch for dynamic API requests and network-first navigation
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
