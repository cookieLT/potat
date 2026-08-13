/* Po Tat Tracker service worker — instant opening, works with no signal.

   The page itself is fetched network-first so an update uploaded to GitHub
   shows up the very next time the app is opened, not the time after that.
   Icons and the manifest stay cache-first; they rarely change. */
var CACHE = "potat-v3";
var FILES = ["./", "./index.html", "./manifest.webmanifest",
             "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES); })
    .then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ if(k!==CACHE) return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  if(e.request.method !== "GET") return;
  var isPage = e.request.mode === "navigate" || e.request.destination === "document";

  if(isPage){                                  // network first, cache as the safety net
    e.respondWith(
      fetch(e.request).then(function(res){
        if(res && res.ok){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put("./index.html", copy); });
        }
        return res;
      }).catch(function(){
        return caches.match("./index.html").then(function(hit){ return hit || caches.match("./"); });
      })
    );
    return;
  }

  e.respondWith(                               // everything else: cache first, refresh behind
    caches.match(e.request).then(function(hit){
      if(hit){
        fetch(e.request).then(function(res){
          if(res && res.ok) caches.open(CACHE).then(function(c){ c.put(e.request, res.clone()); });
        }).catch(function(){});
        return hit;
      }
      return fetch(e.request).catch(function(){ return caches.match("./index.html"); });
    })
  );
});