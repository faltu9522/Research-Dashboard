"""Build RD SK for the web (docs/app/, served by GitHub Pages) from the Android app's own files.

The same index.html and scripts run in the browser; web/web.js stands in for the phone's native bridge (Google
sign-in, file picker). The web copy starts empty (no papers baked in): your data loads after you sign in.
It is installable on computers (manifest + service worker) and works offline after the first visit.

Usage: python3 tools/build_web.py
"""
import json
import os
import re
import shutil
import datetime

from PIL import Image

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC, OUT = "android/app/src/main/assets", "docs/app"
version = re.search(r'const APP_VERSION="([^"]+)"', open(SRC + "/index.html", encoding="utf-8").read()).group(1)

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
for name in os.listdir(SRC):
    if name in ("seed.js",):
        continue
    shutil.copy(os.path.join(SRC, name), os.path.join(OUT, name))
shutil.copy("web/web.js", OUT + "/web.js")

# a blank start: nothing of yours is published on the website
seed = {"version": 1, "settings": {"chaseDays": 90, "lastUpdated": datetime.date.today().isoformat()}, "papers": [], "subs": [],
        "portals": {}, "abdc": {}}
open(OUT + "/seed.js", "w", encoding="utf-8").write("window.RD_SEED = " + json.dumps(seed) + ";\n")

html = open(OUT + "/index.html", encoding="utf-8").read()
html = html.replace('<title>RD SK</title>', '''<title>RD SK</title>
<meta name="description" content="RD SK: track research paper, book and article submissions, synced with your own Google Sheet.">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#2f5d8a">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">''', 1)
assert '<script src="fx.js"></script>' in html
html = html.replace('<script src="fx.js"></script>', '<script src="fx.js"></script>\n<script src="web.js"></script>', 1)
open(OUT + "/index.html", "w", encoding="utf-8").write(html)

# icons for installing on a computer or phone home screen
icon = Image.open(SRC + "/icon.webp").convert("RGBA")
for px in (192, 512):
    icon.resize((px, px), Image.LANCZOS).save("%s/icon-%d.png" % (OUT, px))
    pad = Image.new("RGBA", (px, px), (47, 93, 138, 255))  # maskable: icon inside the safe zone
    inner = int(px * 0.8)
    pad.alpha_composite(icon.resize((inner, inner), Image.LANCZOS), ((px - inner) // 2, (px - inner) // 2))
    pad.save("%s/icon-%d-maskable.png" % (OUT, px))

json.dump({
    "name": "RD SK – Research Dashboard", "short_name": "RD SK", "id": "./", "start_url": "./", "scope": "./",
    "display": "standalone", "background_color": "#f7f6f2", "theme_color": "#2f5d8a",
    "description": "Track research paper, book and article submissions, synced with your own Google Sheet.",
    "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
              {"src": "icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
              {"src": "icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]
}, open(OUT + "/manifest.webmanifest", "w", encoding="utf-8"), indent=1)

files = sorted(os.listdir(OUT))
open(OUT + "/sw.js", "w", encoding="utf-8").write('''// RD SK offline cache: the newest version when online (network first), the saved copy when offline.
const CACHE = "rdsk-web-%s";
const FILES = %s;
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;           // Google, Gemini, Crossref: always live
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
''' % (version, json.dumps(["./"] + [f for f in files if f != "sw.js"])))
print("web app", version, "->", OUT, "(%d files)" % len(os.listdir(OUT)))
