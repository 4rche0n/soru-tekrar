/* Küçük ZIP (sıkıştırmasız "store") yazıcı/okuyucu. Yedekler için: dev bir JSON metni yerine
   data.json + ayrı resim dosyaları. Okurken dosyanın tamamı belleğe alınmaz, parça parça okunur. */
(function (global) {
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder(), dec = new TextDecoder();

  // entries: [{ name, data: Uint8Array | Blob | string }]
  async function write(entries, onProgress) {
    const parts = [], central = []; let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      // Blob ise sadece CRC için okunur; ZIP'e Blob'un kendisi konur (bellekte kopya tutulmaz)
      const isBlob = e.data instanceof Blob;
      let data = typeof e.data === 'string' ? enc.encode(e.data) : isBlob ? new Uint8Array(await e.data.arrayBuffer()) : e.data;
      const name = enc.encode(e.name), crc = crc32(data), size = data.length;
      if (isBlob) data = e.data;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + size;
      if (onProgress && i % 50 === 0) { onProgress(i, entries.length); await new Promise(r => setTimeout(r, 0)); }
    }
    const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...central, eocd.buffer], { type: 'application/zip' });
  }

  // file: Blob/File → { names, has(name), blob(name), text(name) }
  async function read(file) {
    const tailLen = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let p = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
    if (p < 0) throw new Error('Geçerli bir yedek dosyası değil');
    const count = tail.getUint16(p + 10, true), cdSize = tail.getUint32(p + 12, true), cdOff = tail.getUint32(p + 16, true);
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const map = new Map(); let o = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(o, true) !== 0x02014b50) throw new Error('Yedek dosyası bozuk');
      const method = cd.getUint16(o + 10, true), size = cd.getUint32(o + 20, true), nl = cd.getUint16(o + 28, true), xl = cd.getUint16(o + 30, true), cl = cd.getUint16(o + 32, true), lho = cd.getUint32(o + 42, true);
      const crc = cd.getUint32(o + 16, true);
      const name = dec.decode(new Uint8Array(cd.buffer, o + 46, nl));
      map.set(name, { method, size, lho, crc });
      o += 46 + nl + xl + cl;
    }
    async function blob(name) {
      const e = map.get(name); if (!e) return null;
      if (e.method !== 0) throw new Error('Desteklenmeyen sıkıştırma');
      const lh = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
      const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      return file.slice(start, start + e.size);
    }
    async function bytes(name, verify = true) {
      const b = await blob(name); if (!b) return null;
      const u8 = new Uint8Array(await b.arrayBuffer());
      if (verify && crc32(u8) !== map.get(name).crc) throw new Error(`Yedekte bozuk dosya: ${name}`);
      return u8;
    }
    return { names: [...map.keys()], has: (n) => map.has(n), blob, bytes, text: async (n) => { const u = await bytes(n); return u ? dec.decode(u) : null; } };
  }

  global.Zip = { write, read, crc32 };
})(window);
