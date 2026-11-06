/* Karalama alanı (v2): Apple Pencil ile soru üstüne ve altındaki büyüyen alana yazma.

   Neden böyle:
   - Her çizgi TEK dolgu şekli olarak çizilir (perfect-freehand): kenarlar pürüzsüz, kalınlık basınçla
     yumuşakça değişir; parça parça çizimdeki basamaklar/tırtıklar oluşmaz.
   - İki katman: çizilmekte olan çizgi "canlı" katmanda her karede yeniden üretilir (ucu kaleme yetişir,
     iPad'in tahmini noktaları da kullanılır); kalem kalkınca kalıcı katmana işlenir.
   - Kalıcı katman 1024 px yüksekliğinde karolardan oluşur: sayfa uzasa da her karo tam ekran
     çözünürlüğünde kalır, büyüme eski çizgileri yeniden çizmez.
   - Sadece kalem (bilgisayarda fare) çizer; parmak sayfayı kaydırır. Çizimler kaydedilmez. */
(function (global) {
  const INK = '#1b1f2e';
  const SIZES = { 1: 2.4, 2: 3.6, 3: 5.4 };            // çizgi çapı (CSS px), basınçla incelir/kalınlaşır
  const TILE = 1024;                                    // karo yüksekliği (CSS px)
  const GROW_AT = 160, GROW_BY = 480, MAX_H = 4500;     // alt kenara yaklaşınca büyü; en fazla ~4 ekran (iPad belleği için sınırlı)
  const PF = () => global.PerfectFreehand;

  let sheet, hit, tilesEl, live, lctx, space, img;
  let strokes = [], cur = null, size = 2, W = 0, H = 0, dpr = 1, tiles = [], liveTop = 0, raf = 0, predicted = null;

  function init() {
    sheet = document.getElementById('sheet'); hit = document.getElementById('pad-hit'); tilesEl = document.getElementById('pad-tiles');
    live = document.getElementById('pad-live'); space = document.getElementById('pad-space'); img = document.getElementById('run-img');
    if (!sheet || !hit) return;
    lctx = live.getContext('2d', { desynchronized: true });

    // iPad: kalem dokunuşunda sayfa kaymasın; parmak dokunuşu normal kaydırsın
    const isStylus = (e) => [...e.touches].some(t => t.touchType === 'stylus');
    sheet.addEventListener('touchstart', e => { if (isStylus(e)) e.preventDefault(); }, { passive: false });
    sheet.addEventListener('touchmove', e => { if (isStylus(e)) e.preventDefault(); }, { passive: false });

    hit.addEventListener('pointerdown', down);
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerup', up);
    hit.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => resize());
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (sheet.clientWidth && (sheet.clientWidth !== W || sheet.clientHeight !== H)) resize(); }).observe(sheet);

    document.getElementById('pad-undo').addEventListener('click', () => { const s = strokes.pop(); if (s) repaint(s.box); });
    document.getElementById('pad-clear').addEventListener('click', () => { strokes = []; clearTiles(); });
    // kesintiler: kalem yakalaması kaybolursa, uygulamadan çıkılırsa ya da pencere odağı giderse çizgiyi bitir
    hit.addEventListener('lostpointercapture', up);
    document.addEventListener('visibilitychange', () => { if (document.hidden) up(); });
    window.addEventListener('blur', () => up());
    document.getElementById('pad-size').addEventListener('click', e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      size = +b.dataset.s;
      document.querySelectorAll('#pad-size button').forEach(x => x.classList.toggle('on', x === b));
    });
  }

  // ---------- giriş ----------
  const drawable = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse';
  let rect = null, lastP = 0.5;
  // noktalar sayfa genişliğine oranla tutulur: ekran döndürülünce çizim resimle hizalı kalır
  function sample(e) {
    let p = 0.5;
    if (e.pointerType === 'pen') {
      // Apple Pencil basıncı gürültülü: hafif yumuşatma (gecikme yaratmayacak kadar)
      const raw = e.pressure > 0 ? e.pressure : lastP;
      p = lastP = lastP * 0.55 + raw * 0.45;
    }
    return [(e.clientX - rect.left) / W, (e.clientY - rect.top) / W, p];
  }
  function down(e) {
    if (!drawable(e) || (e.pointerType === 'mouse' && e.button !== 0) || !W) return;
    e.preventDefault();
    try { hit.setPointerCapture(e.pointerId); } catch (err) { /* desteklenmezse de çizer */ }
    rect = sheet.getBoundingClientRect();
    lastP = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    cur = { id: e.pointerId, s: size, pen: e.pointerType === 'pen', pts: [sample(e)] };
    placeLive();
    schedule();
  }
  function move(e) {
    if (!cur || e.pointerId !== cur.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    for (const ce of (evs && evs.length ? evs : [e])) cur.pts.push(sample(ce));
    // iPad'in tahmini noktaları sadece canlı katmanda gösterilir (kalıcı çizgiye girmez)
    const pr = e.getPredictedEvents ? e.getPredictedEvents() : null;
    predicted = pr && pr.length ? pr.map(p => [(p.clientX - rect.left) / W, (p.clientY - rect.top) / W, lastP]) : null;
    if ((e.clientY - rect.top) > H - GROW_AT) grow();
    schedule();
  }
  function up(e) {
    if (!cur || (e && e.pointerId !== cur.id)) return;
    if (e && e.type === 'pointerup' && drawable(e)) cur.pts.push(sample(e)); // kaldırma anındaki son nokta
    const st = cur; cur = null; predicted = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height);
    commit(st);
  }

  // ---------- çizgi geometrisi ----------
  function outlineOf(pts, s, pen, last) {
    const px = pts.map(p => [p[0] * W, p[1] * W, p[2]]);
    return PF().getStroke(px, {
      size: SIZES[s], thinning: pen ? 0.45 : 0, smoothing: 0.55, streamline: 0.32,
      simulatePressure: !pen, easing: (t) => t, last,
      start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }
    });
  }
  // dış hattı yumuşak (quadratic) kapalı bir şekle çevir: her köşe kontrol noktası, geçişler orta noktalardan
  // (başlangıç da bir orta noktadan yapılır; böylece kapanışta köşe kalmaz)
  function pathOf(o, dy = 0) {
    const p = new Path2D(), n = o.length;
    if (n < 3) { if (n) { p.arc(o[0][0], o[0][1] + dy, 1, 0, Math.PI * 2); } return p; }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + dy];
    const s = mid(o[0], o[1]);
    p.moveTo(s[0], s[1]);
    for (let i = 1; i <= n; i++) {
      const a = o[i % n], m = mid(a, o[(i + 1) % n]);
      p.quadraticCurveTo(a[0], a[1] + dy, m[0], m[1]);
    }
    p.closePath();
    return p;
  }
  function bboxOf(o) {
    let y0 = Infinity, y1 = -Infinity;
    for (const q of o) { if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return { y0, y1 };
  }

  // ---------- canlı katman ----------
  function placeLive() {
    // canlı katman ekranda görünen bölümü kaplar (çizerken sayfa kaymaz)
    const vis = Math.max(0, -rect.top);
    liveTop = Math.min(vis, Math.max(0, H - 10));
    const h = Math.max(10, Math.min(window.innerHeight + 200, H - liveTop));
    live.style.top = liveTop + 'px'; live.style.width = W + 'px'; live.style.height = h + 'px';
    const bw = Math.round(W * dpr), bh = Math.round(h * dpr);
    if (live.width !== bw || live.height !== bh) { live.width = bw; live.height = bh; }
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    if (!cur) return;
    const pts = predicted ? cur.pts.concat(predicted.slice(-1)) : cur.pts;
    const o = outlineOf(pts, cur.s, cur.pen, false);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, live.width / dpr, live.height / dpr);
    lctx.fillStyle = INK;
    lctx.fill(pathOf(o, -liveTop));
  }

  // ---------- kalıcı katman (karolar) ----------
  function makeTiles() {
    const need = Math.max(1, Math.ceil(H / TILE));
    while (tiles.length < need) {
      const c = document.createElement('canvas'), i = tiles.length;
      c.className = 'pad-tile'; tilesEl.appendChild(c);
      tiles.push({ c, ctx: c.getContext('2d'), top: i * TILE });
    }
    while (tiles.length > need) { const t = tiles.pop(); t.c.width = 0; t.c.remove(); }
    for (const t of tiles) {
      const h = Math.min(TILE, H - t.top), bw = Math.round(W * dpr), bh = Math.round(h * dpr);
      t.h = h; t.c.style.top = t.top + 'px'; t.c.style.width = W + 'px'; t.c.style.height = h + 'px';
      if (t.c.width !== bw || t.c.height !== bh) { t.c.width = bw; t.c.height = bh; t.fresh = true; }
    }
  }
  function drawStroke(st, onlyFresh) {
    if (!st.o || st.w !== W) { st.o = outlineOf(st.pts, st.s, st.pen, true); st.w = W; st.box = bboxOf(st.o); }
    for (const t of tiles) {
      if (onlyFresh && !t.fresh) continue;
      if (st.box.y1 < t.top - 8 || st.box.y0 > t.top + t.h + 8) continue;
      t.ctx.setTransform(dpr, 0, 0, dpr, 0, -t.top * dpr);
      t.ctx.fillStyle = INK; t.ctx.fill(pathOf(st.o));
    }
  }
  function commit(st) { strokes.push(st); drawStroke(st, false); }
  function clearTiles() { tiles.forEach(t => { t.ctx.setTransform(1, 0, 0, 1, 0, 0); t.ctx.clearRect(0, 0, t.c.width, t.c.height); }); }
  // bir bölgeyi (geri alma sonrası) sadece etkilenen karolarda yeniden çiz
  function repaint(box) {
    for (const t of tiles) {
      if (box && (box.y1 < t.top - 8 || box.y0 > t.top + t.h + 8)) continue;
      t.ctx.setTransform(1, 0, 0, 1, 0, 0); t.ctx.clearRect(0, 0, t.c.width, t.c.height);
      for (const st of strokes) {
        if (st.box.y1 < t.top - 8 || st.box.y0 > t.top + t.h + 8) continue;
        t.ctx.setTransform(dpr, 0, 0, dpr, 0, -t.top * dpr); t.ctx.fillStyle = INK; t.ctx.fill(pathOf(st.o));
      }
    }
  }

  function resize() {
    // görünmezken (başka sekme açıkken) ölçüler 0 olur: eski boyutu koru, görünür olunca yeniden ölçülür
    if (!sheet || !sheet.clientWidth || !sheet.clientHeight) return;
    const widthChanged = sheet.clientWidth !== W;
    // çizerken genişlik değişirse (ekran döndürme) eski ölçülerle devam etmek çizgiyi kaydırır: önce bitir
    if (cur && widthChanged) up();
    W = sheet.clientWidth; H = sheet.clientHeight; dpr = Math.min(3, window.devicePixelRatio || 1);
    tiles.forEach(t => { t.fresh = false; });
    makeTiles();
    if (widthChanged) { clearTiles(); strokes.forEach(st => drawStroke(st, false)); }
    else strokes.forEach(st => drawStroke(st, true)); // sadece yeni/yeniden boyutlanan karolar
    tiles.forEach(t => { t.fresh = false; });
  }
  function grow() {
    if (H + GROW_BY > MAX_H) return;
    space.style.height = (space.offsetHeight + GROW_BY) + 'px';
    resize();
    // çizim sürerken canlı katmanı yeni alt sınıra kadar genişlet (çizgi yeni bölümde de görünsün)
    if (cur) { rect = sheet.getBoundingClientRect(); const h = Math.max(10, Math.min(window.innerHeight + 200, H - liveTop)); live.style.height = h + 'px'; const bh = Math.round(h * dpr); if (live.height !== bh) live.height = bh; schedule(); }
  }
  // yeni soru: çizimi sil, boş alanı ilk boyuna getir
  function reset() {
    strokes = []; cur = null; predicted = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    space.style.height = '';
    clearTiles();
    if (lctx) { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); }
    const go = () => resize();
    if (img.complete && img.naturalWidth) requestAnimationFrame(go); else img.addEventListener('load', go, { once: true });
  }

  global.Pad = { init, reset, resize, _debug: () => ({ W, H, dpr, tiles: tiles.length, strokes: strokes.length }) };
})(window);
