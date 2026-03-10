// Service Worker for Sharp PC-1403 Emulator
const CACHE_NAME = 'pc1403-v1';
const ASSETS = [
  './',
  './index.html',
  './js/sc61860.js',
  './js/hardware.js',
  './js/basic.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
