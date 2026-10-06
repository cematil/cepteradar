// Cepte Radar servis çalışanı: tüm dosyaları önce ağdan dener (güncellemeler hemen
// görünsün diye), ağ yoksa önbellekteki son sürümü kullanır.
const VERSION = 'cepteradar-v16';
const SHELL = [
  './', './index.html', './app.html', './main.html', './gizlilik.html', './manifest.json',
  './css/app.css', './css/mobil.css', './js/mobil.js', './js/app.js', './js/veri.js', './js/yol.js', './js/surus.js', './js/topluluk.js', './js/firebase-ayar.js', './js/iller.js', './js/koruma.js',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './vendor/esri-leaflet.js',
  './assets/logo.svg', './assets/logo-work.svg', './assets/icon-192.png', './assets/icon-512.png',
  './iller_kucuk/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // harita döşemeleri, API'ler: doğrudan ağ

  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
