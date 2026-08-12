// Minimal service worker: no offline caching. This file exists only to
// satisfy Chrome/Android's installability requirement (a fetch handler must
// be registered for the "Add to Home Screen" prompt to appear
// automatically). It intentionally does not call event.respondWith(), so
// every request just falls through to the network exactly as if no service
// worker were installed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
