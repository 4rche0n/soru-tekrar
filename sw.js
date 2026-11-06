/* Çevrimdışı çalışma ve tutarlı güncelleme.
   - Uygulama dosyaları (kabuk) sürüm adıyla tek bir önbellekte tutulur ve HEP o önbellekten verilir:
     ekrandaki bütün dosyalar aynı sürüme aittir (yeni index.html + eski pad.js gibi karışım olmaz).
   - Yeni sürüm arka planda TAMAMEN ve taze (?v=SÜRÜM) indirilir; bir dosya bile eksikse kurulum iptal olur, eski sürüm sürer.
   - Yeni sürüm bekler; kullanıcı "Güncelle"ye dokunduğunda ya da uygulamaya yarım iş yokken geri döndüğünde devreye girer.
   VERSION, surum-guncelle.ps1 ile dosyaların içeriğinden otomatik üretilir; elle değiştirme. */
const VERSION = '238add7cc5db';
// önbellek adı kurulumun adresini (scope) de içerir: aynı sitedeki başka bir kurulumun önbelleğine dokunulmaz
const PREFIX = 'soru-tekrar:' + self.registration.scope + ':';
const CACHE = PREFIX + VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'catalog.js', 'zip.js', 'pad.js', 'detect.js', 'manifest.webmanifest',
  'vendor/pdfjs4.min.js', 'vendor/pdfjs4.worker.min.js', 'vendor/perfect-freehand.js', 'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  // Her dosya sürüme özel adresle (?v=SÜRÜM) istenir: tarayıcı ve dağıtım ağı (CDN) önbelleğindeki eski kopyalar
  // gelemez. Önce HEPSİ indirilir; biri bile başarısız olursa hiçbiri yazılmaz ve kurulum iptal olur (eski sürüm sürer).
  e.waitUntil((async () => {
    const got = await Promise.all(SHELL.map(async u => {
      const res = await fetch(new Request(u + (u.includes('?') ? '&' : '?') + 'v=' + VERSION, { cache: 'reload' }));
      if (!res.ok) throw new Error('İndirilemedi: ' + u);
      return [u, res];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(got.map(([u, res]) => cache.put(new Request(u), res)));
  })().catch(async err => { await caches.delete(CACHE); throw err; }));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith(PREFIX) && k !== CACHE) || /^soru-tekrar-/.test(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // sayfa açılışı → bu sürümün index.html'i
    if (req.mode === 'navigate') return (await cache.match('index.html')) || fetch(req);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // kabukta olmayan bir dosya (beklenmez): ağdan getir
    return fetch(req);
  })());
});
