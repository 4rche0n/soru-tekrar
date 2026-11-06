/* IndexedDB katmanı.
   Depolar: questions (soru bilgisi + geçmiş, resimsiz), images (soru resmi, Blob),
   books (kitap sayfa dizini), bookfiles (kitap PDF'i), meta (ayarlar, favoriler, yedek tarihi).
   Sürüm 3: resimler sorulardan ayrıldı (bellek ve hız için); eski kayıtlar otomatik taşınır. */
(function (global) {
  const NAME = 'soru-tekrar', VER = 3;
  let dbp = null;

  function dataURLToBlob(u) {
    const [head, b64] = u.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: mime });
  }
  const INTERVALS_V1 = [0, 1, 3, 7, 14, 30, 60];

  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = (ev) => {
        const db = r.result, tx = r.transaction;
        for (const [n, key] of [['questions', 'id'], ['books', 'id'], ['bookfiles', 'id'], ['images', 'id'], ['meta', 'key']])
          if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: key });
        if (ev.oldVersion > 0 && ev.oldVersion < 3) {
          // v1/v2 → v3: resmi ayrı depoya taşı, tekrar verisini yeni modele çevir
          const qs = tx.objectStore('questions'), im = tx.objectStore('images');
          qs.openCursor().onsuccess = (e) => {
            const c = e.target.result; if (!c) return;
            const q = c.value;
            if (typeof q.img === 'string' && q.img.startsWith('data:')) { im.put({ id: q.id, blob: dataURLToBlob(q.img) }); q.hasImg = true; }
            delete q.img;
            if (q.ivl == null) { q.ivl = INTERVALS_V1[q.box || 0] || 0; q.ease = 2.3; q.lapses = (q.history || []).filter(h => !h.ok).length; }
            q.updated = q.updated || q.created || Date.now();
            c.update(q); c.continue();
          };
        }
      };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); location.reload(); }; res(db); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Uygulama başka bir sekmede açık. Diğer sekmeleri kapatıp yeniden dene.'));
    });
    return dbp;
  }
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then(v => { out = v; }, err => { try { t.abort(); } catch (e) {} rej(err); });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Kayıt iptal edildi'));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = (name) => ({
    all: () => tx(name, 'readonly', t => reqP(t.objectStore(name).getAll())),
    get: (id) => tx(name, 'readonly', t => reqP(t.objectStore(name).get(id))),
    keys: () => tx(name, 'readonly', t => reqP(t.objectStore(name).getAllKeys())),
    put: (v) => tx(name, 'readwrite', t => { t.objectStore(name).put(v); }),
    putMany: (vs) => tx(name, 'readwrite', t => { const s = t.objectStore(name); vs.forEach(v => s.put(v)); }),
    del: (id) => tx(name, 'readwrite', t => { t.objectStore(name).delete(id); }),
    clear: () => tx(name, 'readwrite', t => { t.objectStore(name).clear(); })
  });

  const meta = store('meta');
  global.DB = Object.assign(store('questions'), {
    books: store('books'), bookfiles: store('bookfiles'), images: store('images'), meta,
    getMeta: async (key, def) => { const r = await meta.get(key); return r ? r.value : def; },
    setMeta: (key, value) => meta.put({ key, value }),
    // soru + resim tek işlemde (yarım kayıt kalmaz)
    saveQuestions: (items) => tx(['questions', 'images'], 'readwrite', t => {
      const qs = t.objectStore('questions'), im = t.objectStore('images');
      for (const { q, blob } of items) { qs.put(q); if (blob) im.put({ id: q.id, blob }); }
    }),
    deleteQuestionHard: (id) => tx(['questions', 'images'], 'readwrite', t => { t.objectStore('questions').delete(id); t.objectStore('images').delete(id); }),
    clearAll: () => tx(['questions', 'images', 'books', 'bookfiles', 'meta'], 'readwrite', t => { for (const n of ['questions', 'images', 'books', 'bookfiles', 'meta']) t.objectStore(n).clear(); }),
    dataURLToBlob
  });
})(window);
