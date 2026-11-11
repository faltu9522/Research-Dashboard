// RD SK offline cache: the newest version when online (network first), the saved copy when offline.
const CACHE = "rdsk-web-4.7";
const FILES = ["./", "abdc.js", "aiassist.js", "emailparse.js", "extract.js", "fx.js", "gscript.js", "gsheets.js", "icon-192-maskable.png", "icon-192.png", "icon-512-maskable.png", "icon-512.png", "icon.webp", "index.html", "insights.js", "jsQR.min.js", "manifest.webmanifest", "master-template.xlsx", "nav.js", "portals.js", "seed.js", "suggest.js", "watchlist.js", "web.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;           // Google, Gemini, Crossref: always live
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
