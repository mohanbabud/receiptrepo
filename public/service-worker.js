/* Kill-switch service worker to remove any previously installed SW and clear caches */
/* version: 2025-08-13T1 */
self.addEventListener('install', (event) => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // Unregister this service worker (and any previous one at this scope)
      await self.registration.unregister();
    } catch (_) {}
    try {
      // Clear all caches
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      // Take control and reload open clients to fetch fresh assets
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => {
        try { client.navigate(client.url); } catch (_) {}
      });
    } catch (_) {}
  })());
});
