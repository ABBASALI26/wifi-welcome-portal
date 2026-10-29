// Bump this number whenever you change any cached file.
const CACHE_NAME = "islamic-portal-v2";

const ASSETS = [
  "/",
  "/index.html",
  "/salah.html",
  "/surahs.html",
  "/styles.css",
  "/app.js",
  "/data/prayer-times.json",
  "/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        // "reload" skips the browser's HTTP cache so we store fresh copies.
        ASSETS.map(url =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Network first (always the newest files when online), cache as offline backup.
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Leave other websites (e.g. the prayer-time API) and private pages alone.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/visitors" || url.pathname === "/health") return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === "navigate") return caches.match("/");
          return new Response("Offline and resource not cached.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        })
      )
  );
});
