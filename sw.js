// Service worker : met l'application en cache pour qu'elle s'ouvre sans Internet.
// Les données (Firestore) ont leur propre cache hors ligne.
// ⚠ Après chaque mise à jour des fichiers, augmenter le numéro de version ci-dessous.
const CACHE = 'ventemobile-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'fb.js', 'util.js', 'ui.js', 'print.js', 'export.js',
  'config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Bibliothèques Firebase : cache d'abord
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  // Fichiers de l'application : réseau d'abord (mises à jour), cache si hors ligne
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
