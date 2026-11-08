// Offline shell. Same-origin files: network first (so deploys arrive), cache fallback.
// Firebase SDK (versioned URLs): cache first. Everything else (Firestore, rate APIs): untouched.
const CACHE = 'vp-shell-0.1.0';
const SHELL = [
  './', 'index.html', 'manifest.json', 'version.json', 'css/styles.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/firebase.js', 'js/store.js', 'js/rates.js', 'js/calc.js', 'js/wallet.js', 'js/data.js', 'js/ui.js', 'js/util.js', 'js/version.js',
  'js/views/home.js', 'js/views/vacation.js', 'js/views/plan.js', 'js/views/entry.js', 'js/views/wallet.js', 'js/views/compare.js', 'js/views/settings.js',
];
const SDK = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => `https://www.gstatic.com/firebasejs/10.14.1/${f}`);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled([...SHELL, ...SDK].map((u) => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/version.json')) return; // always live
    e.respondWith((async () => {
      try {
        const res = await fetch(req.url, { cache: 'no-cache' });
        if (res.ok) { const c = await caches.open(CACHE); c.put(req.url.split('?')[0], res.clone()); }
        return res;
      } catch {
        const hit = await caches.match(req.url.split('?')[0]);
        if (hit) return hit;
        if (req.mode === 'navigate') return (await caches.match('index.html')) || (await caches.match('./'));
        throw new Error('offline');
      }
    })());
    return;
  }
  if (url.host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
