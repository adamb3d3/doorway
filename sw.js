// The Doorway service worker (SPEC A12).
// - Same-origin html/js/jsx/json and navigations: network-first, cached copy when offline.
// - Fonts (googleapis/gstatic) and pinned CDN scripts (unpkg): cache-first.
// - /api/ is never cached or intercepted.
// - Network-first gives up after 3 s and serves the cached copy (a weak rural
//   signal shouldn't leave him staring at a blank screen); the network answer
//   still refreshes the cache when it arrives.
//
// VERSION comes from the ?v= this worker was registered with (index.html owns
// the one VERSION constant; bump it on every deploy). A new value installs a new
// worker, and old caches are deleted on activate.

var VERSION = (function () { try { return new URL(self.location.href).searchParams.get("v") || "dev"; } catch (e) { return "dev"; } })();
var CACHE = "doorway-" + VERSION;
var CDN_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"];
var NETWORK_TIMEOUT_MS = 3000;
var V = "?v=" + encodeURIComponent(VERSION);
var PRECACHE = ["/", "/index.html", "/cases.js" + V, "/engine.js" + V, "/app.jsx" + V, "/manifest.json"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Precache best effort: one missing file must not block install.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf("doorway-") === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCache(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("/index.html").then(function (h) { return h || caches.match("/"); });
    return null;
  });
}

// Network-first with a 3 s budget: if the network hasn't answered by then and a
// cached copy exists, serve the cache; otherwise keep waiting for the network.
function networkFirst(req) {
  var network = fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  });
  var timedOut = new Promise(function (resolve) {
    setTimeout(function () {
      fromCache(req).then(function (hit) { if (hit) resolve(hit); });
    }, NETWORK_TIMEOUT_MS);
  });
  var offline = network.catch(function () {
    return fromCache(req).then(function (hit) { return hit || Response.error(); });
  });
  return Promise.race([offline, timedOut]);
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      // Opaque (no-cors) font/CDN responses have status 0; cache those too.
      if (res && (res.ok || res.type === "opaque")) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf("/api/") === 0) return; // never cache the API
    if (req.mode === "navigate" || /\.(html|js|jsx|json)$/.test(url.pathname) || url.pathname === "/") {
      event.respondWith(networkFirst(req));
    }
    return; // icons etc.: browser default
  }

  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(req));
  }
});
