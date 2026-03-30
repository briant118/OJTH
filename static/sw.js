/* OJT Hours — minimal service worker for PWA install + same-origin scope. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  /* Network-first for pages; static assets follow normal browser cache. */
});
