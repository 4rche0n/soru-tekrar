/* Soru tespiti: PDF sayfasını çizer, soru numaralarını ve cevap anahtarını metinden okur,
   pembe fosfor çerçeveleri (yanlış) ve kırmızı kalem işaretlerini (yıldız) piksel renginden bulur. */
(function (global) {
  const RENDER_WIDTH = 1400;

  // pdf.js ve worker'ı <script> ile yerelden yüklenir (vendor/). Worker global'i (pdfjsWorker)
  // mevcut olduğunda pdf.js ana iş parçacığında çalışır; file:// ve iPad'de sorunsuz.
  async function ensurePdfJs() {
    if (!global.pdfjsLib) throw new Error('pdf.js yüklenemedi (app/vendor klasörü eksik).');
    if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    return global.pdfjsLib;
  }

  async function loadPdf(arrayBuffer) {
    const lib = await ensurePdfJs();
    return lib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  }

  // width: tespit için 1400px yeterli; soru görselleri için daha yüksek çözünürlük kullanılır
  async function renderPage(pdf, pageNo, width = RENDER_WIDTH) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { page, viewport, canvas };
  }

  function fontNameOf(page, id) {
    try { const f = page.commonObjs.get(id); return (f && f.name) || ''; } catch (e) { return ''; }
  }

  async function readText(page, viewport) {
    const tc = await page.getTextContent();
    return tc.items
      // dikey/döndürülmüş yazıları (ör. kenardaki site adı) atla
      .filter(it => it.str && it.str.trim() && Math.abs(it.transform[1]) < 1e-3 && Math.abs(it.transform[2]) < 1e-3)
      .map(it => {
        const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const h = Math.hypot(it.transform[2], it.transform[3]) * viewport.scale;
        const fn = fontNameOf(page, it.fontName);
        // GoodNotes el yazısı tanıma metni (.SFUI fontları) kitabın metni değildir
        const hand = /SFUI|\.SF[A-Z]|SFPro/i.test(fn);
        return { s: it.str, x, y, h, w: (it.width || 0) * viewport.scale, bold: /bold|black|heavy/i.test(fn), hand };
      })
      .filter(it => !it.hand);
  }

  // Sayfa altındaki cevap anahtarı: "7. D  8. B ..."
  function parseKey(items, H) {
    const footer = items.filter(it => it.y > H * 0.86).sort((a, b) => a.x - b.x);
    if (!footer.length) return { key: {}, footerTop: H * 0.92 };
    // satırlara grupla, en çok eşleşen satırı al
    const rows = [];
    for (const it of footer) {
      let r = rows.find(r => Math.abs(r.y - it.y) < 8);
      if (!r) { r = { y: it.y, items: [] }; rows.push(r); }
      r.items.push(it);
    }
    let best = { key: {}, n: 0, top: H * 0.92 };
    for (const r of rows) {
      const txt = r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ');
      const key = {}; let n = 0; let m;
      const re = /(\d{1,3})\s*\.\s*([A-E])(?![a-zçğıöşü])/g;
      while ((m = re.exec(txt))) { key[+m[1]] = m[2]; n++; }
      if (n > best.n) best = { key, n, top: r.y - Math.max(...r.items.map(i => i.h)) - 12 };
    }
    return { key: best.key, footerTop: best.n ? best.top : H * 0.92 };
  }

  // Türkçe başlık biçimi: "TEMEL KAVRAMLAR" → "Temel Kavramlar"
  const SMALL = new Set(['ve', 'ile', 'veya', 'de', 'da']);
  function titleTR(s) {
    return s.toLocaleLowerCase('tr').split(/(\s+|-)/).map((w, i) =>
      (i > 0 && SMALL.has(w)) || !/\S/.test(w) || w === '-' ? w : w.charAt(0).toLocaleUpperCase('tr') + w.slice(1)).join('').replace(/\s+/g, ' ').trim();
  }

  // Sayfa başlığı: test numarası, konu adı, seviye (ÖĞRENİYORUM vb.)
  function parseHeader(items, H) {
    const head = items.filter(it => it.y < H * 0.16);
    let test = null;
    for (const it of head) {
      const s = it.s.trim();
      let m = s.match(/^TEST\s*[-–]?\s*(\d+)$/i);
      if (m) { test = +m[1]; break; }
      if (/^TEST\s*[-–]?$/i.test(s)) {
        const right = it.x + (it.w || s.length * it.h * 0.6);
        const nb = head.filter(o => o !== it && /^\d{1,3}$/.test(o.s.trim()) && Math.abs(o.y - it.y) < it.h * 0.4 &&
          o.x >= it.x && o.x - right < it.h * 2.5 && Math.abs(o.h - it.h) < it.h * 0.4).sort((a, b) => a.x - b.x)[0];
        if (nb) { test = +nb.s.trim(); break; }
      }
    }
    // Konu: seviye etiketiyle (ÖĞRENİYORUM vb.) aynı yazı boyutunda, en üstteki başlık satırındaki metin.
    // Bazı sayfalarda font harfleri tek tek verir; akış sırasıyla birleştirilir.
    const lvl = head.find(it => /YORUM$/i.test(fixI(it.s.trim())));
    const refH = lvl ? lvl.h : H * 0.0113;
    const band = head.filter(it => it.y < (lvl ? lvl.y - lvl.h * 0.8 : H * 0.11) && Math.abs(it.h - refH) < refH * 0.06);
    const STOP = /^(B|Ö|L|Ü|M|BÖLÜM|Ç|Z|MLER|ÇÖZÜMLER|TEST\s*[-–]?\s*\d*|@.*|\d+|TYT .*|AYT .*)$/i;
    let konu = band.map(it => fixI(it.s.trim())).filter(s => s && !STOP.test(s)).join('');
    if (!band.length || !konu) {
      // yedek: başlık bölgesindeki en uzun büyük harfli metin
      const words = head.filter(it => it.y < H * 0.12).map(it => fixI(it.s.trim()))
        .filter(s => s.length >= 4 && !STOP.test(s) && !/YORUM$/i.test(s) && !/[=+{}()!:]/.test(s) && s === s.toLocaleUpperCase('tr'));
      konu = words.sort((a, b) => b.length - a.length)[0] || '';
    }
    konu = konu.replace(/\b(\p{Lu}) (?=\p{Lu}\b)/gu, '$1').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
    return { test, konu: konu && konu.length >= 3 ? titleTR(konu) : null, seviye: lvl ? titleTR(fixI(lvl.s.trim())) : null };
  }
  // Bozuk "İ" glifleri küçük "i" olarak gelir: büyük harfli metinde düzelt
  function fixI(s) { return /[a-hj-zçğıöşü]/.test(s) ? s : s.replace(/i/g, 'İ'); }

  // Basılı sayfa numarası: alt bilgideki yalın sayı (sayfanın ortasına en yakın)
  function parsePrinted(items, W, H) {
    const c = items.filter(it => it.y > H * 0.88 && /^\d{1,3}$/.test(it.s.trim()))
      .sort((a, b) => Math.abs(a.x - W / 2) - Math.abs(b.x - W / 2))[0];
    return c ? +c.s.trim() : null;
  }
  const keyString = (key) => Object.keys(key).map(Number).sort((a, b) => a - b).map(n => n + key[n]).join(',');

  // Sadece metinden sayfa dizini (çizim yok → hızlı). Kitap kütüphanesi için.
  async function indexPage(pdf, pageNo) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
    const items = await readText(page, viewport);
    const W = viewport.width, H = viewport.height;
    const { key, footerTop } = parseKey(items, H);
    const hd = parseHeader(items, H);
    const nums = Object.keys(key).length ? findQuestionNumbers(items, W, H, key, footerTop).map(q => ({ n: q.n, x: Math.round(q.x), y: Math.round(q.y) })) : [];
    page.cleanup();
    return { p: pageNo, printed: parsePrinted(items, W, H), test: hd.test, konu: hd.konu, seviye: hd.seviye, key: keyString(key), nums };
  }

  // Soru numaraları: "7." biçimindeki, tercihen kalın, satır başındaki metinler
  function findQuestionNumbers(items, W, H, key, footerTop) {
    const body = items.filter(it => it.y > H * 0.08 && it.y < footerTop);
    const cands = [];
    for (let i = 0; i < body.length; i++) {
      const it = body[i];
      const s = it.s.trim();
      let m = s.match(/^(\d{1,3})\s*\.$/);
      if (!m) {
        const m2 = s.match(/^(\d{1,3})$/);
        const nx = body[i + 1];
        if (m2 && nx && nx.s.trim().startsWith('.') && Math.abs(nx.y - it.y) < 4) m = m2;
      }
      if (!m) continue;
      const n = +m[1];
      if (n < 1 || n > 200) continue;
      cands.push({ n, x: it.x, y: it.y, h: it.h, bold: it.bold });
    }
    // sütunlar: numaraların x konumlarını kümele (tek, iki ya da üç sütunlu düzenler)
    const cols = columnsFrom((cands.some(c => c.bold) ? cands.filter(c => c.bold) : cands).map(c => c.x), W);
    const colOf = (x) => { for (let i = cols.length - 1; i >= 0; i--) if (x >= cols[i].x0) return i; return 0; };
    cands.forEach(c => { c.col = colOf(c.x); });
    // satırının en solundaki olmalı (kendi sütunu içinde)
    const leftmost = cands.filter(c => !body.some(o => o !== c && Math.abs(o.y - c.y) < c.h * 0.6 &&
      colOf(o.x) === c.col && o.x < c.x - 4 && o.s.trim().length > 0));
    let pool = leftmost.length ? leftmost : cands;
    if (pool.some(c => c.bold)) pool = pool.filter(c => c.bold);
    const keyNums = Object.keys(key).map(Number);
    if (keyNums.length) {
      const inKey = pool.filter(c => keyNums.includes(c.n));
      if (inKey.length) pool = inKey;
    }
    // her numaradan bir tane (en soldaki)
    const byN = new Map();
    for (const c of pool) { const p = byN.get(c.n); if (!p || c.x < p.x) byN.set(c.n, c); }
    const nums = [...byN.values()].sort((a, b) => a.col - b.col || a.y - b.y);
    nums.cols = cols;
    return nums;
  }
  // x konumlarından sütun sınırları: aralarında sayfa genişliğinin %20'sinden fazla boşluk olan gruplar
  function columnsFrom(xs, W) {
    const s = [...xs].sort((a, b) => a - b);
    const starts = [];
    for (const x of s) if (!starts.length || x - starts[starts.length - 1].last > W * 0.2) starts.push({ first: x, last: x }); else starts[starts.length - 1].last = x;
    if (!starts.length) return [{ x0: 0, x1: W }];
    return starts.map((g, i) => ({ x0: i === 0 ? 0 : g.first - W * 0.06, x1: i < starts.length - 1 ? starts[i + 1].first - W * 0.06 : W, numX: g.first }));
  }

  // Renk sınıfları
  function isPink(r, g, b) {   // pembe/kırmızımsı pastel fosfor; sarı fosforun üstündeyse turuncumsu görünür
    if (r < 215) return false;
    if (g >= 165 && g <= 190 && b >= 88 && b <= 125) return true;                  // sarı + pembe
    // ton (hue) kırmızı-pembe aralığında, doygun ama açık renk
    const mx = r, mn = Math.min(g, b);
    if (mn < 115) return false;                           // kırmızı kalem (G,B düşük) fosfor değildir
    if (mx - mn < 40) return false;                       // gri/beyaz değil
    const l = (mx + mn) / 510;                            // açıklık
    if (l < 0.55 || l > 0.93) return false;               // koyu kırmızı kalem değil, çok soluk değil
    const hue = g >= b ? 60 * (g - b) / (mx - mn) : 360 - 60 * (b - g) / (mx - mn); // 0=kırmızı, 330=pembe
    return hue <= 18 || hue >= 320;
  }
  function isRedInk(r, g, b) { // kırmızı kalem
    return r > 170 && g < 110 && b < 110 && r - g > 90;
  }

  // Yatay pembe şeritler (çerçevenin üst/alt kenarları) → satır bazında, kolona orta noktasına göre atanır.
  // Kırmızı kalem pikselleri → 8px hücrelerde kümelenip bloblara ayrılır.
  function scanColors(canvas, cols) {
    const W = canvas.width, H = canvas.height;
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const minRun = W * 0.05, gap = 14;
    const pinkRows = cols.map(() => new Uint8Array(H));
    const colOf = (x) => { for (let i = cols.length - 1; i >= 0; i--) if (x >= cols[i].x0) return i; return 0; };
    const CS = 8, gw = Math.ceil(W / CS), gh = Math.ceil(H / CS);
    const redGrid = new Uint16Array(gw * gh);
    for (let y = 0; y < H; y++) {
      let o = y * W * 4, runStart = -1, lastPink = -100;
      const closeRun = (end) => {
        if (runStart >= 0 && end - runStart >= minRun) pinkRows[colOf((runStart + end) / 2)][y] = 1;
        runStart = -1;
      };
      for (let x = 0; x < W; x++, o += 4) {
        const r = data[o], g = data[o + 1], b = data[o + 2];
        if (isPink(r, g, b)) {
          if (runStart < 0 || x - lastPink > gap) { closeRun(lastPink); runStart = x; }
          lastPink = x;
        } else if (isRedInk(r, g, b)) {
          redGrid[((y / CS) | 0) * gw + ((x / CS) | 0)]++;
        }
      }
      closeRun(lastPink);
    }
    // kırmızı blobları bul (komşu dolu hücreler)
    const seen = new Uint8Array(gw * gh), blobs = [];
    for (let i = 0; i < redGrid.length; i++) {
      if (!redGrid[i] || seen[i]) continue;
      const stack = [i]; seen[i] = 1; let px = 0, sx = 0, sy = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      while (stack.length) {
        const k = stack.pop(), cx = k % gw, cy = (k / gw) | 0, n = redGrid[k];
        px += n; sx += (cx * CS + 4) * n; sy += (cy * CS + 4) * n;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx; if (redGrid[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      blobs.push({ px, x: sx / px, y: sy / px, w: (maxX - minX + 1) * CS, h: (maxY - minY + 1) * CS });
    }
    return { pinkRows, blobs };
  }
  const sumRange = (arr, a, b) => { let s = 0; a = Math.max(0, Math.floor(a)); b = Math.min(arr.length, Math.ceil(b)); for (let i = a; i < b; i++) s += arr[i]; return s; };

  async function analyzePage(pdf, pageNo) {
    const { page, viewport, canvas } = await renderPage(pdf, pageNo);
    const W = canvas.width, H = canvas.height;
    const items = await readText(page, viewport);
    const { key, footerTop } = parseKey(items, H);
    const hd = parseHeader(items, H);
    const test = hd.test;
    const printed = parsePrinted(items, W, H);
    const nums = findQuestionNumbers(items, W, H, key, footerTop);
    const cols = nums.cols;
    const { pinkRows, blobs } = scanColors(canvas, cols);
    const bandRows = Math.max(4, Math.round(H * 0.003)); // fosfor şeridi en az bu kadar satır
    const questions = [];
    cols.forEach((C, col) => {
      const qs = nums.filter(q => q.col === col);
      // kırpma: numaranın biraz solundan, bir sonraki sütunun numarasına kadar
      const x0 = Math.max(0, C.numX - W * 0.035);
      const x1 = cols[col + 1] ? cols[col + 1].numX - W * 0.02 : W * 0.97;
      qs.forEach((q, i) => {
        const prevY = i > 0 ? qs[i - 1].y : H * 0.08;
        const nextY = i < qs.length - 1 ? qs[i + 1].y : footerTop;
        const above = sumRange(pinkRows[col], prevY + q.h * 0.5, q.y - q.h * 0.3);
        const below = sumRange(pinkRows[col], q.y - q.h * 0.3, nextY - q.h * 0.5);
        const top = Math.max(0, q.y - q.h - H * 0.012);
        const bottom = i < qs.length - 1 ? qs[i + 1].y - qs[i + 1].h - H * 0.012 : footerTop;
        const wrong = above >= bandRows && below >= bandRows;
        questions.push({
          n: q.n, col, y: q.y, x: q.x,
          box: { x: x0, y: top, w: x1 - x0, h: bottom - top },
          answer: key[q.n] || null,
          wrong, star: false,
          // zayıf iz: iki tarafta da biraz pembe var ama şerit kadar değil → "kontrol et"
          suggest: !wrong && above >= 2 && below >= 2,
          debug: { above, below, bandRows }
        });
      });
    });
    // Kırmızı kalem blobları → en yakın soru köşesine (sol üst: numara, sağ üst: sütun kenarı)
    const minPx = W * H * 0.00002;
    for (const b of blobs) {
      if (b.px < minPx || Math.max(b.w, b.h) < W * 0.012) continue;
      let best = null, bestD = Infinity;
      for (const q of questions) {
        if (b.y < q.y - H * 0.07 || b.y > q.y + H * 0.035) continue;
        const rightX = cols[q.col].x1 - W * 0.02;
        const d = Math.min(Math.hypot(b.x - q.x, (b.y - q.y) * 1.5), Math.hypot(b.x - rightX, (b.y - q.y) * 1.5));
        if (d < bestD) { bestD = d; best = q; }
      }
      if (!best) continue;
      if (bestD < W * 0.12) { best.star = true; (best.debug.stars = best.debug.stars || []).push([Math.round(b.x), Math.round(b.y), b.px]); }
      else if (bestD < W * 0.2) best.suggest = true;
    }
    questions.forEach(q => { if (q.star || q.wrong) q.suggest = false; });
    // sayfada belirgin pembe işaret var ama hiçbir soruya bağlanamadıysa uyar
    const pinkTotal = pinkRows.reduce((s, a) => s + sumRange(a, H * 0.08, footerTop), 0);
    const pageWarn = pinkTotal >= bandRows * 2 && !questions.some(q => q.wrong);
    return { pageNo, test, konu: hd.konu, seviye: hd.seviye, printed, key, keyStr: keyString(key), canvas, questions, pageWarn, noNumbers: !nums.length };
  }

  // İşaretli sayfa için kitaptaki karşılığını bul. Puan: cevap anahtarı + basılı sayfa no + test + konu.
  function matchBookPage(r, bookPages) {
    let best = null, bestScore = 0;
    for (const bp of bookPages) {
      let s = 0;
      if (r.keyStr && bp.key === r.keyStr) s += 4;
      else if (r.keyStr && bp.key) {
        // kısmi anahtar eşleşmesi (el yazısı bazı harfleri bozmuş olabilir)
        const a = new Set(r.keyStr.split(',')), b = bp.key.split(',');
        const common = b.filter(x => a.has(x)).length;
        if (common >= Math.max(2, b.length * 0.6)) s += 2;
      }
      if (r.printed != null && bp.printed === r.printed) s += 3;
      if (r.test != null && bp.test === r.test) s += 1;
      if (r.konu && bp.konu === r.konu) s += 1;
      if (s > bestScore) { bestScore = s; best = bp; }
    }
    return bestScore >= 5 ? best : null; // en az anahtar+sayfa ya da anahtar+test+konu
  }

  // Kitap sayfasındaki soru numaralarıyla hizalama farkını (dx, dy) bul
  function alignOffset(marked, bookNums) {
    const dx = [], dy = [];
    for (const q of marked) { const b = bookNums.find(x => x.n === q.n); if (b) { dx.push(b.x - q.x); dy.push(b.y - q.y); } }
    const med = a => a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 0;
    return { dx: med(dx), dy: med(dy) };
  }

  function crop(canvas, box, maxW = 1800) {
    const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
    const w = Math.min(canvas.width - x, Math.round(box.w));
    let h = Math.min(canvas.height - y, Math.round(box.h));
    // alttaki boş alanı kırp: bir satırda genişliğin %1'inden fazla koyu piksel varsa içerik say
    // (sütun ayırıcı gibi ince dikey çizgiler eşiği geçmez)
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
    let last = 0;
    const minDark = Math.max(3, w * 0.01);
    for (let r = h - 1; r >= 0; r--) {
      let dark = 0;
      for (let cIdx = 0, o = r * w * 4; cIdx < w; cIdx++, o += 4) if (data[o] + data[o + 1] + data[o + 2] < 600) dark++;
      if (dark > minDark) { last = r; break; }
    }
    const pad = Math.round(canvas.width * 0.02);
    if (last > 0) h = Math.min(h, last + pad);
    const s = Math.min(1, maxW / w);
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  }

  global.Detect = { RENDER_WIDTH, HQ_WIDTH: 3000, loadPdf, analyzePage, renderPage, crop, indexPage, matchBookPage, alignOffset, titleTR };
})(window);
