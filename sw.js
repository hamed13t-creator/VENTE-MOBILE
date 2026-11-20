// Service worker : l'application s'ouvre instantanément, même sans réseau.
// Les fichiers sont servis depuis le cache de la version installée (tous de la même version).
// ⚠ Après chaque mise à jour des fichiers, augmenter le numéro de version ci-dessous :
//    les téléphones téléchargent alors la nouvelle version et affichent « Nouvelle version — Recharger ».
const CACHE = 'ventemobile-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'fb.js', 'util.js', 'ui.js', 'print.js', 'export.js',
  'config.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' : on ignore le cache HTTP pour être sûr d'avoir les nouveaux fichiers
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => { if (!r.ok) throw new Error(u); return c.put(u, r); }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const cacheFirst = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }));
  if (url.hostname === 'www.gstatic.com') return e.respondWith(cacheFirst());
  if (url.origin === self.location.origin) {
    if (e.request.mode === 'navigate') return e.respondWith(caches.match('index.html').then(r => r || fetch(e.request)));
    e.respondWith(cacheFirst());
  }
});
