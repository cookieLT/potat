/* Po Tat Tracker service worker — makes the app open instantly and work with no signal. */
var CACHE = "potat-v1";
var FILES = ["./", "./index.html", "./manifest.webmanifest",
             "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(FILES); }).then(function(){
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ if(k!==CACHE) return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  if(e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function(hit){
      if(hit){
        // serve cached copy immediately, refresh it in the background
        fetch(e.request).then(function(res){
          if(res && res.ok) caches.open(CACHE).then(function(c){ c.put(e.request, res.clone()); });
        }).catch(function(){});
        return hit;
      }
      return fetch(e.request).catch(function(){ return caches.match("./index.html"); });
    })
  );
});
