/* Karalama alanı: soru resmi + altındaki boş alan üzerinde Apple Pencil ile çizim.
   - Sadece kalem (ve bilgisayarda fare) çizer; parmak sayfayı kaydırır (avuç izi oluşmaz).
   - Akıcılık: birleştirilmiş (coalesced) olaylar + orta noktalı yumuşak eğriler + basınca göre kalınlık.
   - Çizimler kaydedilmez; her soruda temiz başlar. Uzun işlemlerde alan aşağı doğru büyür. */
(function (global) {
  const INK = '#1b1f2e';
  const SIZES = { 1: 1.4, 2: 2.3, 3: 3.6 };     // CSS piksel, basınçla çarpılır
  const GROW_AT = 160, GROW_BY = 420;            // alt kenara bu kadar yaklaşınca bu kadar büyü
  const MAX_PIXELS = 16e6;                       // iPad tuval bellek sınırının altında kal

  let sheet, canvas, ctx, space, img;
  let strokes = [], cur = null, size = 2, W = 0, H = 0, scale = 1, rect = null, initialSpace = 0;

  function init() {
    sheet = document.getElementById('sheet'); canvas = document.getElementById('pad'); space = document.getElementById('pad-space'); img = document.getElementById('run-img');
    if (!sheet) return;
    ctx = canvas.getContext('2d', { desynchronized: true });

    // iPad: kalem dokunuşunda sayfa kaymasın; parmak dokunuşu normal kaydırsın
    const isStylus = (e) => [...e.touches].some(t => t.touchType === 'stylus');
    sheet.addEventListener('touchstart', e => { if (isStylus(e)) e.preventDefault(); }, { passive: false });
    sheet.addEventListener('touchmove', e => { if (isStylus(e)) e.preventDefault(); }, { passive: false });

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    window.addEventListener('resize', () => resize());
    // sekme değişip çalışma ekranı yeniden görünür olunca ölçüleri tazele
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (sheet.clientWidth && (sheet.clientWidth !== W || sheet.clientHeight !== H)) resize(); }).observe(sheet);

    document.getElementById('pad-undo').addEventListener('click', () => { strokes.pop(); redraw(); });
    document.getElementById('pad-clear').addEventListener('click', () => { strokes = []; redraw(); });
    document.getElementById('pad-size').addEventListener('click', e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      size = +b.dataset.s;
      document.querySelectorAll('#pad-size button').forEach(x => x.classList.toggle('on', x === b));
    });
  }

  const drawable = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse';
  // noktalar sayfa genişliğine oranla tutulur: ekran döndürülünce çizim resimle hizalı kalır
  function pt(e) { return { x: (e.clientX - rect.left) / W, y: (e.clientY - rect.top) / W, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5 }; }
  const widthOf = (p) => SIZES[cur ? cur.s : size] * (0.55 + p * 0.9);

  function down(e) {
    if (!drawable(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* yakalama desteklenmezse çizim yine çalışır */ }
    rect = canvas.getBoundingClientRect();
    cur = { s: size, pts: [pt(e)], id: e.pointerId };
    strokes.push(cur);
    dot(cur.pts[0]);
  }
  function move(e) {
    if (!cur || e.pointerId !== cur.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of (evs.length ? evs : [e])) {
      const p = pt(ce), pts = cur.pts, last = pts[pts.length - 1];
      if (Math.abs(p.x - last.x) * W < 0.6 && Math.abs(p.y - last.y) * W < 0.6) continue; // çok yakın noktaları atla
      pts.push(p);
      segment(pts, pts.length - 1, cur.s);
    }
    // alt kenara yaklaşınca alanı büyüt
    if ((e.clientY - rect.top) > H - GROW_AT) grow();
  }
  // kalem kalkınca son orta noktadan son noktaya kalan parçayı da çiz (kısa işaretler eksik kalmasın)
  function up(e) {
    if (!cur || (e && e.pointerId !== cur.id)) return;
    if (cur.pts.length > 1) tail(cur.pts, cur.s);
    cur = null;
  }
  function tail(pts, s) {
    const b = pts[pts.length - 2], c = pts[pts.length - 1];
    ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = SIZES[s] * (0.55 + c.p * 0.9);
    ctx.beginPath(); ctx.moveTo(((b.x + c.x) / 2) * W, ((b.y + c.y) / 2) * W); ctx.lineTo(c.x * W, c.y * W); ctx.stroke();
  }

  function dot(p) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(p.x * W, p.y * W, widthOf(p.p) / 2, 0, Math.PI * 2); ctx.fill(); }
  // i. noktaya kadar olan parçayı çiz: önceki orta noktadan bu orta noktaya, kontrol noktası önceki nokta
  function segment(pts, i, s) {
    const a = pts[i - 2] || pts[i - 1], b = pts[i - 1], c = pts[i];
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = SIZES[s] * (0.55 + ((b.p + c.p) / 2) * 0.9);
    ctx.beginPath();
    ctx.moveTo((i === 1 ? b.x : m1.x) * W, (i === 1 ? b.y : m1.y) * W);
    ctx.quadraticCurveTo(b.x * W, b.y * W, m2.x * W, m2.y * W);
    ctx.stroke();
  }
  function redraw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const st of strokes) {
      if (st.pts.length === 1) { const keep = cur; cur = st; dot(st.pts[0]); cur = keep; continue; }
      for (let i = 1; i < st.pts.length; i++) segment(st.pts, i, st.s);
      if (st !== cur) tail(st.pts, st.s);
    }
  }
  function resize() {
    // görünmezken (başka sekme açıkken) ölçüler 0 olur: eski boyutu koru, görünür olunca yeniden ölçülür
    if (!sheet.clientWidth || !sheet.clientHeight) return;
    W = sheet.clientWidth; H = sheet.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    scale = Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(1, W * H)));
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    rect = canvas.getBoundingClientRect();
    redraw();
  }
  function grow() {
    if (W * (H + GROW_BY) * Math.pow(window.devicePixelRatio || 1, 2) > MAX_PIXELS * 4) return; // aşırı uzamasın
    space.style.height = (space.offsetHeight + GROW_BY) + 'px';
    resize();
  }
  // yeni soru: çizimi sil, boş alanı ilk boyuna getir
  function reset() {
    strokes = []; cur = null;
    if (!initialSpace) initialSpace = space.offsetHeight;
    space.style.height = '';
    const go = () => resize();
    if (img.complete && img.naturalWidth) requestAnimationFrame(go); else img.addEventListener('load', go, { once: true });
  }

  global.Pad = { init, reset, resize };
})(window);
