/* IndexedDB: sorular (resim dahil) ve kitaplar (sayfa dizini + isteğe bağlı PDF) cihazda saklanır. */
(function (global) {
  const NAME = 'soru-tekrar', VER = 2;
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('questions')) db.createObjectStore('questions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('bookfiles')) db.createObjectStore('bookfiles', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('İşlem iptal edildi'));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = (name) => ({
    all: () => tx(name, 'readonly', st => reqP(st.getAll())),
    get: (id) => tx(name, 'readonly', st => reqP(st.get(id))),
    put: (v) => tx(name, 'readwrite', st => { st.put(v); }),
    putMany: (vs) => tx(name, 'readwrite', st => { vs.forEach(v => st.put(v)); }),
    del: (id) => tx(name, 'readwrite', st => { st.delete(id); }),
    clear: () => tx(name, 'readwrite', st => { st.clear(); })
  });

  global.DB = Object.assign(store('questions'), { books: store('books'), bookfiles: store('bookfiles') });
})(window);
