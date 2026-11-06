/* Soru Tekrar — arayüz, tekrar sistemi, içe aktarma, analiz ve yedekleme */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const MIN = 60000, DAY = 86400000;
  const LEARNED_IVL = 21;          // 21+ gün aralığa ulaşan soru "öğrenildi" sayılır
  const TRASH_DAYS = 30;
  const REASONS = Catalog.REASONS;
  const reasonLabel = (id) => (REASONS.find(r => r.id === id) || {}).label || '';
  const tick = () => new Promise(r => setTimeout(r, 0));

  const toast = (msg, ms = 2400) => { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); };
  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const fmtSec = (ms) => ms == null ? '–' : (ms < 60000 ? `${Math.round(ms / 1000)} sn` : `${(ms / 60000).toFixed(1)} dk`);
  const fmtDays = (d) => d < 1 ? 'bugün' : d === 1 ? 'yarın' : d < 30 ? `${d} gün sonra` : `${Math.round(d / 30)} ay sonra`;
  const qLabel = (q) => `${q.test != null ? 'Test-' + q.test + ' · ' : ''}Soru ${q.no}${q.printed != null ? ' · s.' + q.printed : ''}`;
  const trSort = (a, b) => String(a).localeCompare(String(b), 'tr');
  const lower = (s) => String(s || '').toLocaleLowerCase('tr');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  // Gün sınırı gece 04:00 (gece geç saatte çalışınca "bugün" bölünmesin)
  const dayStart = (t) => { const d = new Date(t - 4 * 3600e3); d.setHours(0, 0, 0, 0); return d.getTime() + 4 * 3600e3; };
  const dayKey = (t) => { const d = new Date(dayStart(t)); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  // ---------------------------------------------------------------------
  // durum
  // ---------------------------------------------------------------------
  let Q = [];            // tüm sorular (silinenler dahil; resimsiz)
  let BOOKS = [];
  let PREFS = { fav: { ders: [], kaynak: [], konu: [] }, recent: { ders: [], kaynak: [], konu: [] }, custom: { ders: [], konu: {}, kaynak: {} } };
  let BACKUP = { last: 0, changes: 0 };
  const live = () => Q.filter(q => !q.deleted);

  async function reload() { Q = await DB.all(); Q.forEach(normalizeQ); refreshFilters(); updateHome(); }
  // Kayıt biçimini her zaman güvenli hale getirir (eski sürümler, bozuk ya da elle düzenlenmiş yedekler):
  // yanlış tipteki alanlar uygulamayı çökertmesin
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
  function normalizeQ(q) {
    q.history = Array.isArray(q.history) ? q.history.filter(h => h && typeof h === 'object' && isFinite(h.t)) : [];
    if (q.ivl == null) { const I = [0, 1, 3, 7, 14, 30, 60]; q.ivl = I[q.box || 0] || 0; }
    q.ivl = num(q.ivl, 0); q.ease = num(q.ease, 2.3); q.due = num(q.due, Date.now());
    q.lapses = num(q.lapses, q.history.filter(h => !h.ok).length);
    q.ders = str(q.ders, 'Diğer'); q.kaynak = str(q.kaynak); q.konu = str(q.konu, 'Diğer');
    if (q.no != null && typeof q.no !== 'number') q.no = num(+q.no, null);
    if (q.answer != null && !LETTERS.includes(q.answer)) q.answer = null;
    return q;
  }
  async function savePrefs() { await DB.setMeta('prefs', PREFS); }
  async function markChanged(n = 1) { BACKUP.changes += n; await DB.setMeta('backup', BACKUP); }
  async function saveQ(q, blob) { q.updated = Date.now(); delete q.rv; await DB.saveQuestions([{ q, blob }]); if (blob) dropImg(q.id); await markChanged(1); }

  // ---------------------------------------------------------------------
  // resimler: IndexedDB'den gerektiğinde yüklenir, son kullanılan 250 tanesi önbellekte
  // ---------------------------------------------------------------------
  const imgCache = new Map();
  async function imgURL(id) {
    if (imgCache.has(id)) { const u = imgCache.get(id); imgCache.delete(id); imgCache.set(id, u); return u; }
    const r = await DB.images.get(id); if (!r || !r.blob) return '';
    const u = URL.createObjectURL(r.blob); imgCache.set(id, u);
    if (imgCache.size > 250) { const [k, v] = imgCache.entries().next().value; URL.revokeObjectURL(v); imgCache.delete(k); }
    return u;
  }
  function dropImg(id) { const u = imgCache.get(id); if (u) { URL.revokeObjectURL(u); imgCache.delete(id); } }
  const lazyObs = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { lazyObs.unobserve(e.target); loadImgEl(e.target); }
  }, { rootMargin: '400px' }) : null;
  async function loadImgEl(el) { const u = await imgURL(el.dataset.img); if (u) el.src = u; }
  function hydrateImgs(root) { $$('img[data-img]:not([src])', root).forEach(el => lazyObs ? lazyObs.observe(el) : loadImgEl(el)); }

  // ---------------------------------------------------------------------
  // tekrar sistemi (aralıklı tekrar)
  // Yanlış → 10 dk sonra yeniden (aynı oturumda da tekrar sorulur), kolaylık azalır.
  // Zorlandım → aralık yavaş büyür. Rahat → aralık kolaylık katsayısıyla büyür.
  // ---------------------------------------------------------------------
  const dueAfterDays = (now, d) => dayStart(now) + d * DAY;
  function nextState(q, g, now = Date.now()) {
    let ivl = q.ivl || 0, ease = q.ease || 2.3, due;
    if (g === 'wrong') { ivl = 0; ease = Math.max(1.3, ease - 0.2); due = now + 10 * MIN; }
    else if (g === 'hard') { ivl = ivl < 1 ? 1 : Math.min(180, Math.max(ivl + 1, Math.round(ivl * 1.2))); ease = Math.max(1.3, ease - 0.15); due = dueAfterDays(now, ivl); }
    else { ivl = ivl < 1 ? 3 : Math.min(180, Math.max(ivl + 2, Math.round(ivl * ease))); ease = Math.min(3, ease + 0.05); due = dueAfterDays(now, ivl); }
    return { ivl, ease: Math.round(ease * 100) / 100, due };
  }
  function applyGrade(q, g, now = Date.now()) {
    Object.assign(q, nextState(q, g, now));
    q.reps = (q.reps || 0) + 1; q.last = now;
    if (g === 'wrong') q.lapses = (q.lapses || 0) + 1;
  }
  const isDue = (q) => (q.due ?? 0) <= Date.now();
  const isLearned = (q) => (q.ivl || 0) >= LEARNED_IVL;
  function stats(q) {
    const h = (q.history || []).filter(x => !x.rq);
    const wrong = h.filter(x => !x.ok).length;
    const times = h.filter(x => x.ms).map(x => x.ms);
    return { tries: h.length, wrong, right: h.length - wrong, avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null };
  }
  const weakness = (q) => { const s = stats(q); return (q.wrong ? 1 : 0) + (q.lapses || 0) * 2 - s.right * 0.4 + (q.ease ? (2.5 - q.ease) : 0); };
  const isLeech = (q) => (q.lapses || 0) >= 2 && !isLearned(q);

  // ---------------------------------------------------------------------
  // filtre açılır listeleri (var olan verilere göre)
  // ---------------------------------------------------------------------
  function fillSelect(sel, values, allLabel = 'Hepsi') {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option>${esc(v)}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  function refreshFilters() {
    const L = live(), dersler = uniq(L.map(q => q.ders)).sort(trSort);
    for (const id of ['#st-ders', '#ls-ders', '#sa-ders']) fillSelect($(id), dersler);
    refreshKonu('#st-ders', '#st-konu'); refreshKonu('#ls-ders', '#ls-konu');
    updateStudyCount();
  }
  function refreshKonu(dersSel, konuSel) {
    const d = $(dersSel).value;
    fillSelect($(konuSel), uniq(live().filter(q => !d || q.ders === d).map(q => q.konu)).sort(trSort));
  }
  const byFilter = (d, k) => live().filter(q => (!d || q.ders === d) && (!k || q.konu === k));

  // ---------------------------------------------------------------------
  // sekmeler
  // ---------------------------------------------------------------------
  function show(view) {
    if (view !== 'study' && window.Pad) Pad.end(); // sekme değişirken yarım kalan kalem çizgisini bitir
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'list') renderList(true);
    if (view === 'stats') renderStats();
    if (view === 'study') { updateStudyCount(); updateHome(); }
    if (view === 'backup') renderBackup();
    window.scrollTo({ top: 0 });
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });

  // ---------------------------------------------------------------------
  // modal, tam ekran görüntüleyici
  // ---------------------------------------------------------------------
  function openModal(html, cls = '') { $('#modal-box').className = 'modal-box ' + cls; $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = ''; }
  // "locked" pencereler (kırpma) dışına dokununca kapanmaz; yanlışlıkla iş kaybı olmasın
  $('#modal').addEventListener('click', e => { if ((e.target.id === 'modal' && !$('#modal-box').classList.contains('locked')) || e.target.closest('[data-close]')) closeModal(); });

  const V = { s: 1, x: 0, y: 0, pts: new Map(), start: null };
  function openViewer(src) {
    if (!src) return;
    $('#viewer-img').src = src; V.s = 1; V.x = V.y = 0; applyV();
    $('#viewer').classList.remove('hidden');
  }
  function applyV() { $('#viewer-img').style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.s})`; }
  function zoomTo(s) { V.s = Math.min(6, Math.max(1, s)); if (V.s === 1) V.x = V.y = 0; applyV(); }
  $('#viewer').addEventListener('click', e => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'close') $('#viewer').classList.add('hidden');
    if (z === 'in') zoomTo(V.s * 1.5); if (z === 'out') zoomTo(V.s / 1.5); if (z === 'reset') zoomTo(1);
  });
  const stage = $('.viewer-stage');
  let lastTap = 0;
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId); V.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (V.pts.size === 1) {
      const now = Date.now(); if (now - lastTap < 300) zoomTo(V.s > 1 ? 1 : 2.5); lastTap = now;
    }
    V.start = { s: V.s, x: V.x, y: V.y, pts: [...V.pts.values()].map(p => ({ ...p })) };
  });
  stage.addEventListener('pointermove', e => {
    if (!V.pts.has(e.pointerId)) return;
    V.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const P = [...V.pts.values()], S0 = V.start; if (!S0) return;
    if (P.length >= 2 && S0.pts.length >= 2) {
      const d0 = Math.hypot(S0.pts[0].x - S0.pts[1].x, S0.pts[0].y - S0.pts[1].y), d1 = Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y);
      V.s = Math.min(6, Math.max(1, S0.s * d1 / Math.max(1, d0)));
    } else if (P.length === 1 && V.s > 1) { V.x = S0.x + P[0].x - S0.pts[0].x; V.y = S0.y + P[0].y - S0.pts[0].y; }
    applyV();
  });
  const endPtr = e => { V.pts.delete(e.pointerId); V.start = { s: V.s, x: V.x, y: V.y, pts: [...V.pts.values()].map(p => ({ ...p })) }; if (V.s === 1) { V.x = V.y = 0; applyV(); } };
  stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
  stage.addEventListener('wheel', e => { e.preventDefault(); zoomTo(V.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });

  // ---------------------------------------------------------------------
  // ders / konu / kaynak seçici (hazır liste + favoriler + son kullanılanlar + kendi ekledikleri)
  // ---------------------------------------------------------------------
  const favKey = (kind, ders, v) => kind === 'konu' ? `${ders}::${v}` : v;
  function optionsFor(kind, ders) {
    if (kind === 'ders') return uniq([...Catalog.dersler, ...PREFS.custom.ders, ...live().map(q => q.ders), ...BOOKS.map(b => b.ders)]);
    if (kind === 'konu') return uniq([...Catalog.konular(ders), ...(PREFS.custom.konu[ders] || []), ...live().filter(q => q.ders === ders).map(q => q.konu), ...BOOKS.filter(b => b.ders === ders).flatMap(b => b.pages.map(p => p.konu))]);
    return uniq([...Catalog.kaynaklar(ders), ...(PREFS.custom.kaynak[ders] || []), ...live().filter(q => q.ders === ders).map(q => q.kaynak), ...BOOKS.filter(b => b.ders === ders).map(b => b.kaynak)]);
  }
  function openPicker({ kind, ders, current, onPick }) {
    const title = { ders: 'Ders seç', konu: `Konu seç${ders ? ' · ' + ders : ''}`, kaynak: `Kaynak seç${ders ? ' · ' + ders : ''}` }[kind];
    openModal(`<div class="sheet"><div class="row between"><h3>${esc(title)}</h3><button data-close>Kapat</button></div>
      <span class="search"><svg><use href="#i-search"/></svg><input id="pk-q" type="search" placeholder="Ara ya da yeni ekle…" autocomplete="off"></span>
      <div id="pk-list"></div></div>`, 'narrow');
    const render = () => {
      const all = optionsFor(kind, ders), q = lower($('#pk-q').value.trim());
      const favs = PREFS.fav[kind].filter(k => kind !== 'konu' || k.startsWith(ders + '::')).map(k => kind === 'konu' ? k.split('::')[1] : k).filter(v => all.includes(v) || kind !== 'konu');
      const recents = PREFS.recent[kind].filter(k => kind !== 'konu' || k.startsWith(ders + '::')).map(k => kind === 'konu' ? k.split('::')[1] : k).filter(v => !favs.includes(v));
      const match = (v) => !q || lower(v).includes(q);
      const row = (v) => { const fk = favKey(kind, ders, v), on = PREFS.fav[kind].includes(fk);
        return `<div class="opt ${v === current ? 'sel' : ''}" data-v="${esc(v)}"><span class="t">${esc(v)}</span><button class="fav ${on ? 'on' : ''}" data-fav="${esc(v)}" title="Favori"><svg><use href="#i-star"/></svg></button></div>`; };
      let html = '';
      const F = favs.filter(match), R = recents.filter(match).slice(0, 6), A = all.filter(v => match(v) && !F.includes(v) && !R.includes(v));
      if (F.length) html += `<div class="sheet-sec">Favoriler</div><div class="opt-list">${F.map(row).join('')}</div>`;
      if (R.length) html += `<div class="sheet-sec">Son kullanılanlar</div><div class="opt-list">${R.map(row).join('')}</div>`;
      if (A.length) html += `<div class="sheet-sec">${F.length || R.length ? 'Tümü' : 'Seçenekler'}</div><div class="opt-list">${A.map(row).join('')}</div>`;
      const typed = $('#pk-q').value.trim();
      if (typed && !all.some(v => lower(v) === lower(typed))) html += `<div class="opt-list"><div class="opt add" data-add="1"><span class="t">+ "${esc(typed)}" ekle</span></div></div>`;
      if (!html) html = '<p class="muted">Sonuç yok.</p>';
      $('#pk-list').innerHTML = html;
    };
    $('#pk-q').addEventListener('input', render);
    $('#pk-list').addEventListener('click', async e => {
      const fav = e.target.closest('[data-fav]');
      if (fav) { e.stopPropagation(); const fk = favKey(kind, ders, fav.dataset.fav), L = PREFS.fav[kind]; const i = L.indexOf(fk); i >= 0 ? L.splice(i, 1) : L.unshift(fk); await savePrefs(); render(); return; }
      const opt = e.target.closest('.opt'); if (!opt) return;
      let v = opt.dataset.v;
      if (opt.dataset.add) {
        v = $('#pk-q').value.trim();
        if (kind === 'ders') PREFS.custom.ders.push(v); else (PREFS.custom[kind][ders] ||= []).push(v);
      }
      const rk = favKey(kind, ders, v), R = PREFS.recent[kind];
      const i = R.indexOf(rk); if (i >= 0) R.splice(i, 1); R.unshift(rk); R.length = Math.min(R.length, 12);
      await savePrefs(); closeModal(); onPick(v);
    });
    render();
    if (matchMedia('(hover: hover)').matches) $('#pk-q').focus();
  }
  const pickerValue = (id) => $('#' + id).dataset.value || '';
  function setPicker(id, v) { const b = $('#' + id); b.dataset.value = v || ''; b.innerHTML = v ? `<span>${esc(v)}</span>` : '<span class="ph">Seç…</span>'; }
  $$('.picker').forEach(b => setPicker(b.id, ''));
  document.addEventListener('click', e => {
    const b = e.target.closest('button.picker'); if (!b || !b.id) return;
    const kind = b.dataset.kind, ders = b.dataset.dersFrom ? pickerValue(b.dataset.dersFrom) : '';
    if (kind !== 'ders' && !ders) return toast('Önce ders seç.');
    openPicker({ kind, ders, current: b.dataset.value, onPick: (v) => {
      setPicker(b.id, v);
      if (kind === 'ders') $$(`.picker[data-ders-from="${b.id}"]`).forEach(x => setPicker(x.id, ''));
    } });
  });

  // =====================================================================
  // ÇALIŞ
  // =====================================================================
  function pickQueue() {
    const mode = $('input[name=mode]:checked').value, now = Date.now();
    let pool = byFilter($('#st-ders').value, $('#st-konu').value);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // gecikmesi (aralığına göre) en büyük olan önce
    const overdue = (q) => (now - (q.due || 0)) / ((q.ivl || 0) * DAY + DAY);
    if (mode === 'due') pool = shuffle(pool.filter(isDue)).sort((a, b) => overdue(b) - overdue(a));
    else if (mode === 'weak') pool = pool.filter(q => weakness(q) > 0).sort((a, b) => weakness(b) - weakness(a));
    else if (mode === 'star') pool = shuffle(pool.filter(q => q.star));
    else pool = shuffle(pool);
    const lim = +$('#st-limit').value;
    return lim ? pool.slice(0, lim) : pool;
  }
  function updateStudyCount() {
    const n = pickQueue().length, L = live();
    const due = byFilter($('#st-ders').value, $('#st-konu').value).filter(isDue).length;
    $('#st-count').textContent = L.length ? `Bu seçimle ${n} soru gelecek · sırası gelen ${due}` : 'Henüz soru yok. "PDF Ekle" sekmesinden başla.';
    $('#st-start').disabled = !n;
  }
  function streak() {
    const days = new Set(live().flatMap(q => q.history.map(h => dayKey(h.t))));
    let s = 0, t = Date.now();
    if (!days.has(dayKey(t))) t -= DAY; // bugün henüz çözmediysen dünden say
    while (days.has(dayKey(t))) { s++; t -= DAY; }
    return s;
  }
  function updateHome() {
    const L = live(), today = dayKey(Date.now());
    const doneToday = L.reduce((s, q) => s + q.history.filter(h => dayKey(h.t) === today).length, 0);
    const tile = (v, k) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    $('#st-today').innerHTML = L.length ? tile(L.filter(isDue).length, 'Bekleyen tekrar') + tile(doneToday, 'Bugün çözülen') + tile(streak() + ' gün', 'Seri') + tile(L.length, 'Toplam soru') : '';
    // yedek hatırlatıcı
    const ban = $('#backup-banner'), age = Date.now() - (BACKUP.last || 0);
    const need = L.length && BACKUP.changes > 0 && (!BACKUP.last || age > 7 * DAY || BACKUP.changes >= 60);
    ban.classList.toggle('hidden', !need);
    if (need) ban.innerHTML = `<span>${BACKUP.last ? `Son yedeğin ${Math.floor(age / DAY)} gün önce alındı` : 'Henüz hiç yedek almadın'} · ${BACKUP.changes} değişiklik yedekte değil.</span><button class="btn primary" id="ban-go">Şimdi yedek al</button>`;
  }
  $('#backup-banner').addEventListener('click', e => { if (e.target.closest('#ban-go')) exportBackup(); });
  $('#st-ders').addEventListener('change', () => { refreshKonu('#st-ders', '#st-konu'); updateStudyCount(); });
  $('#st-konu').addEventListener('change', updateStudyCount);
  $('#st-mode').addEventListener('change', updateStudyCount);
  $('#st-limit').addEventListener('change', updateStudyCount);

  const S = { queue: [], i: 0, t0: 0, pausedAt: 0, timer: null, phase: 'idle', token: 0, seen: new Set(), results: [], requeued: new Set(), cur: null, choice: null, ok: false, ms: 0, reason: null };
  const elapsed = () => (S.pausedAt || Date.now()) - S.t0;
  // uygulamadan çıkınca süre durur, dönünce devam eder
  document.addEventListener('visibilitychange', () => {
    if (S.phase !== 'answer') return;
    if (document.hidden) S.pausedAt = Date.now();
    else if (S.pausedAt) { S.t0 += Date.now() - S.pausedAt; S.pausedAt = 0; }
  });

  $('#st-start').addEventListener('click', () => {
    S.queue = pickQueue().map(q => q.id); S.i = 0; S.seen = new Set(); S.results = []; S.requeued = new Set();
    if (!S.queue.length) return;
    $('#study-setup').classList.add('hidden'); $('#study-done').classList.add('hidden'); $('#study-run').classList.remove('hidden');
    showQuestion();
  });
  $('#run-stop').addEventListener('click', finishSession);
  $('#run-skip').addEventListener('click', () => { S.i++; next(); });
  $('#run-next').addEventListener('click', () => { if (S.phase === 'grade' && !S.ok) commit('wrong'); });
  // resme dokunmak artık kalemle yazmak için; büyütme ayrı düğmede
  $('#pad-zoom').addEventListener('click', () => openViewer($('#run-img').src));
  Pad.init();
  document.addEventListener('keydown', e => {
    if (!$('#view-study').classList.contains('active') || $('#study-run').classList.contains('hidden') || !$('#modal').classList.contains('hidden')) return;
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toUpperCase();
    if (S.phase === 'answer' && LETTERS.includes(k)) { const b = $$('#run-choices button').find(b => b.dataset.l === k && !b.disabled); if (b) b.click(); }
    else if (S.phase === 'grade' && S.ok && (e.key === '1' || e.key === '2')) commit(e.key === '1' ? 'hard' : 'easy');
    else if (S.phase === 'grade' && !S.ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); commit('wrong'); }
  });

  function next() { if (S.i >= S.queue.length) finishSession(); else showQuestion(); }

  async function showQuestion() {
    const q = Q.find(x => x.id === S.queue[S.i]);
    if (!q || q.deleted) { S.i++; return next(); }
    // yüklenirken önceki sorunun şıkları kullanılamasın; art arda geçişlerde sadece son istek ekrana gelsin
    const token = ++S.token;
    S.cur = q; S.phase = 'loading'; S.choice = null; S.reason = null; S.pausedAt = 0;
    $('#run-choices').innerHTML = ''; $('#run-skip').disabled = true;
    $('#run-meta').textContent = `${q.ders} · ${q.konu} · ${q.kaynak} · ${qLabel(q)}`;
    $('#run-progress').textContent = `${S.i + 1} / ${S.queue.length}`;
    $('#run-bar').style.width = `${Math.round(S.i / S.queue.length * 100)}%`;
    const img = $('#run-img'); img.removeAttribute('src');
    const src = await imgURL(q.id);
    if (token !== S.token) return;
    img.src = src; S.phase = 'answer'; $('#run-skip').disabled = false;
    Pad.reset(); // her soruda temiz sayfa
    $('#run-feedback').className = 'feedback hidden'; $('#run-grade').className = 'grade hidden';
    $('#run-next').classList.add('hidden'); $('#run-skip').classList.remove('hidden');
    $('#run-choices').innerHTML = LETTERS.map(l => `<button data-l="${l}">${l}</button>`).join('');
    $$('#run-choices button').forEach(b => b.addEventListener('click', () => answer(q, b.dataset.l)));
    S.t0 = Date.now();
    clearInterval(S.timer);
    const st = stats(q), tEl = $('#run-timer'), tTxt = $('#run-timer b');
    S.timer = setInterval(() => { const ms = elapsed(); tTxt.textContent = fmtTime(ms); tEl.classList.toggle('slow', ms > 180000); }, 250);
    tTxt.textContent = '00:00'; tEl.classList.remove('slow');
    tEl.title = st.avgMs ? `Bu soruda ortalaman: ${fmtSec(st.avgMs)}` : '';
    window.scrollTo({ top: 0 });
  }

  async function answer(q, choice) {
    if (S.phase !== 'answer' || q !== S.cur) return;
    const ms = elapsed();
    if (!q.answer) {
      // cevap anahtarı yoksa: doğru şıkkı bir kez sor, kaydet, sonra değerlendir
      clearInterval(S.timer); S.phase = 'ask';
      const fb = $('#run-feedback');
      fb.className = 'feedback ask'; fb.textContent = `Bu sorunun cevabı kayıtlı değil. Cevap anahtarına bak: doğru şık hangisi? (Senin cevabın: ${choice})`;
      $$('#run-choices button').forEach(b => { const nb = b.cloneNode(true); b.replaceWith(nb); nb.addEventListener('click', async () => { q.answer = nb.dataset.l; await saveQ(q); S.phase = 'answer'; S.t0 = Date.now() - ms; answer(q, choice); }); });
      return;
    }
    clearInterval(S.timer);
    S.phase = 'grade'; S.choice = choice; S.ms = ms; S.ok = choice === q.answer;
    $$('#run-choices button').forEach(b => {
      b.disabled = true;
      if (b.dataset.l === q.answer) b.classList.add('correct');
      if (b.dataset.l === choice && !S.ok) b.classList.add('picked-bad');
    });
    $('#run-skip').classList.add('hidden');
    const fb = $('#run-feedback'), gr = $('#run-grade'), first = !S.seen.has(q.id);
    if (S.ok) {
      fb.className = 'feedback ok'; fb.textContent = `Doğru · ${fmtSec(ms)}`;
      const h = nextState(q, 'hard'), e = nextState(q, 'easy');
      gr.innerHTML = `<div class="q">Nasıldı?${first ? '' : ' (bu oturumda ikinci deneme, tekrar zamanı değişmez)'}</div>
        <div class="grade-btns"><button class="hard" data-g="hard">Zorlandım<small>${first ? 'tekrar ' + fmtDays(h.ivl) : '1'}</small></button>
        <button class="easy" data-g="easy">Rahat çözdüm<small>${first ? 'tekrar ' + fmtDays(e.ivl) : '2'}</small></button></div>`;
    } else {
      fb.className = 'feedback bad'; fb.textContent = `Yanlış · doğru cevap ${q.answer} · ${fmtSec(ms)}`;
      gr.innerHTML = `<div class="q">Neden yanlış yaptın? (isteğe bağlı)</div><div class="reasons">${REASONS.map(r => `<button data-r="${r.id}">${r.label}</button>`).join('')}</div>`;
      $('#run-next').classList.remove('hidden');
    }
    gr.className = 'grade';
  }
  $('#run-grade').addEventListener('click', e => {
    const g = e.target.closest('[data-g]'); if (g) return commit(g.dataset.g);
    const r = e.target.closest('[data-r]');
    if (r) { S.reason = S.reason === r.dataset.r ? null : r.dataset.r; $$('#run-grade [data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === S.reason)); }
  });

  async function commit(g) {
    if (S.phase !== 'grade') return;
    S.phase = 'saving';
    const q = S.cur, now = Date.now(), first = !S.seen.has(q.id);
    // kayıt başarısız olursa bellekteki soru eski haline döner ve kullanıcı yeniden deneyebilir
    const before = { history: q.history.slice(), ivl: q.ivl, ease: q.ease, due: q.due, reps: q.reps, last: q.last, lapses: q.lapses, updated: q.updated, rv: q.rv };
    const entry = { t: now, c: S.choice, ok: S.ok, ms: S.ms, g };
    if (S.reason) entry.r = S.reason;
    if (!first) entry.rq = true; // aynı oturumdaki tekrar denemesi: istatistikte ayrı tutulur
    q.history.push(entry);
    if (first) applyGrade(q, g, now);
    try { await saveQ(q); }
    catch (e) {
      console.error(e); Object.assign(q, before); if (before.rv === undefined) delete q.rv;
      S.phase = 'grade';
      toast('Kaydedilemedi (' + (e.message || 'depolama hatası') + '). Tekrar dene; sorun sürerse Yedek sekmesinden yer durumuna bak.', 6000);
      return;
    }
    S.seen.add(q.id);
    if (first) S.results.push({ id: q.id, ok: S.ok, ms: S.ms, g, r: S.reason });
    // yanlışsa aynı oturumda birkaç soru sonra yeniden sor
    if (!S.ok && !S.requeued.has(q.id)) { S.requeued.add(q.id); S.queue.splice(Math.min(S.i + 4, S.queue.length), 0, q.id); }
    S.i++; next();
  }

  function finishSession() {
    clearInterval(S.timer); S.phase = 'idle';
    $('#study-run').classList.add('hidden');
    const r = S.results, ok = r.filter(x => x.ok).length;
    const avg = r.length ? r.reduce((a, b) => a + b.ms, 0) / r.length : null;
    const wrongs = r.filter(x => !x.ok).map(x => Q.find(q => q.id === x.id)).filter(Boolean);
    const rc = {}; r.filter(x => x.r).forEach(x => { rc[x.r] = (rc[x.r] || 0) + 1; });
    $('#study-done').innerHTML = `
      <h2>Oturum bitti</h2>
      <div class="tiles" style="margin-top:14px">
        <div class="tile"><div class="v">${r.length}</div><div class="k">Çözülen</div></div>
        <div class="tile"><div class="v">${ok}</div><div class="k">Doğru</div></div>
        <div class="tile"><div class="v">${r.length - ok}</div><div class="k">Yanlış</div></div>
        <div class="tile"><div class="v">${fmtSec(avg)}</div><div class="k">Ort. süre</div></div>
      </div>
      ${Object.keys(rc).length ? `<p class="muted">Hata nedenlerin: ${Object.entries(rc).map(([k, v]) => `${reasonLabel(k)} (${v})`).join(', ')}</p>` : ''}
      ${wrongs.length ? `<h3 style="margin:16px 0 10px">Yanlış yaptıkların</h3><div class="cards small">${wrongs.map(cardSmall).join('')}</div>` : ''}
      <p style="margin-top:18px"><button class="btn primary" id="done-back">Yeni oturum</button></p>`;
    $('#study-done').classList.remove('hidden');
    $('#done-back').addEventListener('click', () => { $('#study-done').classList.add('hidden'); $('#study-setup').classList.remove('hidden'); updateStudyCount(); updateHome(); });
    bindCards($('#study-done'));
    refreshFilters(); updateHome();
  }

  // =====================================================================
  // KİTAPLAR
  // =====================================================================
  let IM = null; // içe aktarma oturumu
  // kitap PDF önbelleği: aynı anda tek kitap açık tutulur (iPad belleği için); çıkarılan kapatılır
  const bookPdfCache = new Map();
  function cacheBookPdf(id, pdf) {
    // içe aktarma incelemesinde hâlâ kullanılan kitap kapatılmaz
    for (const [k, v] of bookPdfCache) if (k !== id && !(IM && IM.bookPdf === v)) { try { v.destroy(); } catch (e) {} bookPdfCache.delete(k); }
    bookPdfCache.set(id, pdf);
  }
  // içe aktarma oturumunu kapat: işaretli PDF'in belleğini bırak (kitap PDF'i önbellekte kalır)
  function endImport() { if (IM && IM.pdf) { try { IM.pdf.destroy(); } catch (e) {} } IM = null; releaseHq(); }
  const compact = (s) => lower(s).replace(/[^a-zçğıöşüâîû0-9]/g, '');
  const isSubseq = (s, t) => { let i = 0; for (const c of t) if (c === s[i]) i++; return i === s.length; };
  // Font bozulması harf düşürür/boşluk ekler: kısa ad uzun adın alt dizisiyse aynı başlıktır.
  // ("Üslü"/"Köklü", "Yaş"/"Sayı" ya da "Yüzde Problemleri"/"Yüzde ve Kâr-Zarar Problemleri" birleşmez.)
  const similar = (a, b) => {
    const x = compact(a), y = compact(b); if (!x || !y) return false;
    if (x === y) return true;
    const [s, t, sn, tn] = x.length <= y.length ? [x, y, a, b] : [y, x, b, a];
    if (!(s.length >= t.length * 0.6 && isSubseq(s, t))) return false;
    const words = (n) => n.split(/[\s\-–]+/).map(compact).filter(Boolean);
    const tw = new Set(words(tn));
    return !words(sn).every(w => tw.has(w));
  };
  const nameQuality = (s) => compact(s).length * 10 + ((' ' + s + ' ').match(/ (ve|ile) /g) || []).length;
  function canonKonu(pages, ders) {
    let last = null;
    for (const p of pages) { if (!p.konu && p.key) p.konu = last; if (p.konu) last = p.konu; }
    const runs = [];
    for (const p of pages) { if (!p.key) continue; const r = runs[runs.length - 1]; if (r && r.k === p.konu) r.pages.push(p); else runs.push({ k: p.konu, pages: [p] }); }
    const sameCompact = (a, b) => compact(a) && compact(a) === compact(b);
    for (const test of [sameCompact, similar]) {
      for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i < runs.length && !changed; i++) for (let j = i + 1; j <= i + 2 && j < runs.length && !changed; j++) {
          if (runs[i].k !== runs[j].k && test(runs[i].k, runs[j].k)) {
            const best = nameQuality(runs[i].k) >= nameQuality(runs[j].k) ? runs[i].k : runs[j].k;
            const a = runs[i].k, b = runs[j].k;
            runs.forEach(r => { if (r.k === a || r.k === b) r.k = best; });
            changed = true;
          }
        }
      }
    }
    // müfredattaki adla eşleştir (ör. "Basiteşitsizlikler" → "Basit Eşitsizlikler"); dersler arası tutarlı istatistik için
    const cat = Catalog.konular(ders);
    for (const r of runs) { const m = cat.find(c => sameCompact(c, r.k)) || cat.find(c => similar(c, r.k)); if (m) r.k = m; }
    for (const r of runs) r.pages.forEach(p => { p.konu = r.k; });
    return pages;
  }
  const keyMap = (s) => Object.fromEntries((s || '').split(',').filter(Boolean).map(x => [+x.slice(0, -1), x.slice(-1)]));

  async function loadBooks() {
    BOOKS = await DB.books.all();
    const sel = $('#im-book'), cur = sel.value;
    sel.innerHTML = BOOKS.map(b => `<option value="${esc(b.id)}">${esc(b.ders)} · ${esc(b.name)}</option>`).join('') + '<option value="">Kitapsız (bilgileri ben seçerim)</option>';
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    renderBooks(); updateImportForm();
  }
  function konuRuns(b) {
    const runs = [];
    for (const p of b.pages) { if (!p.key) continue; const r = runs[runs.length - 1]; if (r && r.k === p.konu) r.to = p.printed ?? p.p; else runs.push({ k: p.konu, from: p.printed ?? p.p, to: p.printed ?? p.p }); }
    return runs;
  }
  function renderBooks() {
    $('#bk-list').innerHTML = BOOKS.length ? BOOKS.map(b => {
      const konular = new Set(b.pages.map(p => p.konu).filter(Boolean)).size;
      const nq = live().filter(q => q.bookId === b.id).length;
      return `<div class="bookrow" data-bid="${esc(b.id)}">
        <div><b>${esc(b.name)}</b> <span class="muted">· ${esc(b.ders)} · ${b.numPages} sayfa · ${konular} konu · ${nq} soru kayıtlı</span>
        <br><small>${b.hasFile ? 'PDF bu cihazda kayıtlı' : 'PDF bu cihazda kayıtlı değil (bölüm eklerken seçmen istenir)'}</small></div>
        <div class="row"><button data-act="konu">Konuları düzenle</button><button data-act="del" class="danger">Sil</button></div></div>`;
    }).join('') : '<p class="muted">Henüz kitap yok.</p>';
    if (!BOOKS.length) $('#bk-add-box').open = true;
  }
  $('#bk-list').addEventListener('click', async e => {
    const b = BOOKS.find(x => x.id === e.target.closest('[data-bid]')?.dataset.bid); if (!b) return;
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'del') {
      if (!confirm(`"${b.name}" kitabı silinsin mi? (Kaydedilmiş soruların silinmez.)`)) return;
      await DB.books.del(b.id); await DB.bookfiles.del(b.id); const bp = bookPdfCache.get(b.id); if (bp) { try { bp.destroy(); } catch (e) {} } bookPdfCache.delete(b.id); await loadBooks();
    }
    if (act === 'konu') openKonuEditor(b);
  });
  function openKonuEditor(b) {
    const runs = konuRuns(b), names = [...new Set(runs.map(r => r.k))];
    openModal(`<div class="row between"><b>${esc(b.name)} — konu adları</b><button data-close>Kapat</button></div>
      <p class="muted">Sayfa başlıklarından okunan adlar. Yanlış okunan varsa düzelt; aynı adı verdiğin bölümler birleşir. Kayıtlı soruların konusu da güncellenir.</p>
      <table class="topics"><thead><tr><th>Sayfalar</th><th>Konu</th></tr></thead><tbody>
      ${names.map((k, i) => `<tr><td class="muted">${runs.filter(r => r.k === k).map(r => r.from === r.to ? r.from : r.from + '–' + r.to).join(', ')}</td>
        <td><input data-i="${i}" value="${esc(k || '')}" list="ke-dl" style="width:100%"></td></tr>`).join('')}
      </tbody></table><datalist id="ke-dl">${optionsFor('konu', b.ders).map(k => `<option>${esc(k)}</option>`).join('')}</datalist>
      <div class="row between" style="margin-top:12px"><span></span><button id="ke-save" class="primary">Kaydet</button></div>`);
    $('#ke-save').onclick = async () => {
      const map = new Map(names.map((k, i) => [k, $(`#modal-box input[data-i="${i}"]`).value.trim() || k]));
      b.pages.forEach(p => { if (map.has(p.konu)) p.konu = map.get(p.konu); });
      b.updated = Date.now(); delete b.rv;
      await DB.books.put(b);
      const qs = live().filter(q => q.bookId === b.id && map.has(q.konu) && map.get(q.konu) !== q.konu);
      for (const q of qs) { q.konu = map.get(q.konu); q.updated = Date.now(); delete q.rv; }
      if (qs.length) { await DB.putMany(qs); await markChanged(qs.length); }
      closeModal(); await reload(); await loadBooks(); toast('Konu adları kaydedildi.');
    };
  }

  $('#ba-run').addEventListener('click', async () => {
    const f = $('#ba-file').files[0], ders = pickerValue('ba-ders'), kaynak = pickerValue('ba-kaynak'), extra = $('#ba-name').value.trim();
    if (!ders || !kaynak) return toast('Ders ve kaynak seç.');
    if (!f) return toast('Kitabın PDF dosyasını seç.');
    const st = $('#ba-status'); $('#ba-run').disabled = true;
    try {
      const buf = await f.arrayBuffer();
      const blob = new Blob([buf], { type: 'application/pdf' });
      const pdf = await Detect.loadPdf(buf.slice(0));
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (p % 10 === 1) { st.textContent = `Sayfa ${p} / ${pdf.numPages} okunuyor…`; await tick(); }
        pages.push(await Detect.indexPage(pdf, p));
      }
      canonKonu(pages, ders);
      const id = 'b' + Date.now();
      const book = { id, ders, kaynak, name: extra ? `${kaynak} – ${extra}` : kaynak, fileName: f.name, size: f.size, numPages: pdf.numPages, pages, created: Date.now(), updated: Date.now(), hasFile: false };
      try { await DB.bookfiles.put({ id, blob }); book.hasFile = true; } catch (e) { console.warn('Kitap PDF saklanamadı', e); }
      await DB.books.put(book);
      cacheBookPdf(id, pdf);
      const testPages = pages.filter(p => p.key).length;
      st.textContent = `Eklendi: ${testPages} soru sayfası, ${new Set(pages.map(p => p.konu).filter(Boolean)).size} konu.${book.hasFile ? '' : ' (Cihazda yer yetmediği için PDF saklanmadı; bölüm eklerken kitabı seçmen istenecek.)'}`;
      resetFile('#ba-file'); $('#ba-name').value = ''; $('#bk-add-box').open = false;
      await loadBooks(); $('#im-book').value = id; updateImportForm();
      if (!testPages) toast('Uyarı: bu PDF\'te cevap anahtarı olan sayfa bulunamadı. Taranmış (resim) bir PDF ya da farklı bir düzen olabilir; kitapsız ekleme yapabilirsin.', 7000);
    } catch (e) { console.error(e); st.textContent = 'Hata: ' + e.message; }
    finally { $('#ba-run').disabled = false; }
  });

  function updateImportForm() {
    const b = BOOKS.find(x => x.id === $('#im-book').value);
    $('#im-nobook').classList.toggle('hidden', !!b);
    $('#im-bookfile-wrap').classList.toggle('hidden', !b || b.hasFile || bookPdfCache.has(b.id));
  }
  $('#im-book').addEventListener('change', updateImportForm);

  async function getBookPdf(b, fileInput = '#im-bookfile') {
    if (bookPdfCache.has(b.id)) return bookPdfCache.get(b.id);
    let buf = null;
    if (b.hasFile) { const r = await DB.bookfiles.get(b.id); if (r && r.blob) buf = await r.blob.arrayBuffer(); }
    if (!buf) { const f = $(fileInput)?.files[0]; if (!f) throw new Error('Bu kitabın PDF\'i cihazda yok. "Kitap PDF\'i" alanından seç.'); buf = await f.arrayBuffer(); }
    const pdf = await Detect.loadPdf(buf);
    cacheBookPdf(b.id, pdf);
    return pdf;
  }

  // Yüksek çözünürlüklü kırpma (aynı sayfa üst üste istenirse yeniden çizmez)
  let hqPage = { key: null, canvas: null };
  async function hqCrop(pdf, page, box) {
    const key = pdf.fingerprints?.[0] + '#' + page;
    if (hqPage.key !== key) { if (hqPage.canvas) hqPage.canvas.width = 0; hqPage = { key, canvas: (await Detect.renderPage(pdf, page, Detect.HQ_WIDTH)).canvas }; }
    const c = hqPage.canvas, k = c.width / Detect.RENDER_WIDTH;
    return Detect.crop(c, { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k });
  }
  function releaseHq() { if (hqPage.canvas) hqPage.canvas.width = 0; hqPage = { key: null, canvas: null }; }

  // =====================================================================
  // İÇE AKTARMA
  // =====================================================================
  $('#im-run').addEventListener('click', async () => {
    const f = $('#im-file').files[0];
    const book = BOOKS.find(x => x.id === $('#im-book').value) || null;
    const ders = book ? book.ders : pickerValue('im-ders'), kaynak = book ? book.kaynak : pickerValue('im-kaynak'), manualKonu = pickerValue('im-konu');
    if (!f) return toast('Önce işaretli PDF dosyasını seç.');
    if (!book && (!ders || !kaynak)) return toast('Ders ve kaynak seç (ya da bir kitap seç).');
    const status = $('#im-status');
    $('#im-run').disabled = true; $('#im-review').classList.add('hidden');
    endImport(); // önceki taramanın belleğini bırak
    let pdf = null;
    try {
      pdf = await Detect.loadPdf(await f.arrayBuffer());
      const bookPdf = book ? await getBookPdf(book) : null;
      const items = [], pages = {}; let unmatched = 0;
      for (let p = 1; p <= pdf.numPages; p++) {
        status.textContent = `Sayfa ${p} / ${pdf.numPages} taranıyor…`;
        const r = await Detect.analyzePage(pdf, p);
        const bp = book ? Detect.matchBookPage(r, book.pages) : null;
        if (book && !bp && r.questions.length) unmatched++;
        const off = bp ? Detect.alignOffset(r.questions, bp.nums) : { dx: 0, dy: 0 };
        const srcPage = bp ? bp.p : p;
        const konu = (bp && bp.konu) || r.konu || manualKonu || 'Diğer';
        const test = bp ? bp.test : r.test, printed = bp ? bp.printed : r.printed;
        pages[p] = { fromBook: !!bp, srcPage, konu, test, printed, warn: r.pageWarn || (r.noNumbers && r.questions.length === 0) };
        // önizleme: işaretli sorular yüksek çözünürlükte, diğerleri düşük çözünürlükte (bellek tasarrufu)
        const lo = bp ? (await Detect.renderPage(bookPdf, bp.p)).canvas : r.canvas;
        const bkey = bp ? keyMap(bp.key) : {};
        for (const q of r.questions) {
          const box = { x: q.box.x + off.dx, y: q.box.y + off.dy, w: q.box.w, h: q.box.h };
          const picked = q.wrong || q.star;
          const img = picked ? await hqCrop(bp ? bookPdf : pdf, srcPage, box) : Detect.crop(lo, box, 700);
          items.push({
            hq: picked, regen: { fromBook: !!bp, page: srcPage, box }, pageNo: p,
            // kitapsız: basılı sayfa no da kimliğe girer (aynı yayının farklı kitaplarındaki aynı test/soru no çakışmasın)
            id: bp ? `${book.id}|${bp.p}|${q.n}` : [ders, kaynak, konu, test != null ? 'T' + test : f.name + '#p' + p, printed != null ? 'S' + printed : '', q.n].join('|'),
            bookId: bp ? book.id : null, bookPage: bp ? bp.p : null, clean: !!bp,
            ders, kaynak, konu, test, printed, no: q.n, page: p, file: f.name,
            img, answer: q.answer || bkey[q.n] || null, wrong: q.wrong, star: q.star, suggest: q.suggest,
            include: picked, detected: picked || q.suggest
          });
        }
        releaseHq();
        if (lo !== r.canvas) lo.width = 0; r.canvas.width = 0;
        await tick();
      }
      IM = { items, pdf, bookPdf, book, pages, ders, kaynak, fileName: f.name };
      const nW = items.filter(i => i.wrong).length, nS = items.filter(i => i.star).length, nSug = items.filter(i => i.suggest).length, noKey = items.filter(i => i.include && !i.answer).length;
      status.textContent = `${pdf.numPages} sayfada ${items.length} soru bulundu.`;
      $('#im-summary').innerHTML = `<b>${nW}</b> yanlış, <b>${nS}</b> yıldızlı${nSug ? `, <b>${nSug}</b> kontrol edilmesi gereken` : ''} soru${noKey ? ` · ${noKey} sorunun cevabı okunamadı` : ''}. Kontrol et, gerekirse düzelt, sonra kaydet.`;
      const warnPages = Object.entries(pages).filter(([, v]) => v.warn).map(([k]) => +k);
      $('#im-warn').innerHTML = `<div class="row" style="margin:0 0 14px;gap:8px;align-items:center"><span class="muted small">Kaçırılan soru mu var?</span><select id="im-addpage" class="compact">${Object.keys(pages).map(p => `<option value="${p}">PDF sayfa ${p}${pages[p].printed != null ? ' (s.' + pages[p].printed + ')' : ''}</option>`).join('')}</select><button class="btn soft" data-addsel="1"><svg><use href="#i-crop"/></svg>Elle soru ekle</button></div>` + (unmatched ? `<div class="warnbox">${unmatched} sayfa kitapta eşleşmedi; o sayfaların soruları işaretli halinden kesildi (el yazın görünebilir).</div>` : '') +
        (warnPages.length ? `<div class="warnbox">Şu sayfalarda işaret var ama soruya bağlanamadı: ${warnPages.map(p => `<button class="btn soft" data-addq="${p}">Sayfa ${p} · soru ekle</button>`).join('')}</div>` : '');
      renderImport();
      $('#im-review').classList.remove('hidden');
    } catch (e) {
      console.error(e); status.textContent = 'Hata: ' + e.message;
      if (pdf && (!IM || IM.pdf !== pdf)) { try { pdf.destroy(); } catch (er) {} } // başarısız taramanın belleğini bırak
    } finally { $('#im-run').disabled = false; }
  });

  $('#im-showall').addEventListener('change', renderImport);
  $('#im-cancel').addEventListener('click', () => { endImport(); $('#im-review').classList.add('hidden'); $('#im-status').textContent = ''; });
  function renderImport() {
    const all = $('#im-showall').checked;
    const list = IM.items.filter(i => all || i.detected || i.include);
    $('#im-cards').innerHTML = list.length ? list.map(i => {
      const idx = IM.items.indexOf(i), exists = Q.some(q => q.id === i.id && !q.deleted);
      return `<div class="card ${i.include ? '' : 'off'} ${i.suggest && !i.include ? 'suggest' : ''}" data-idx="${idx}">
        <img src="${i.img}" data-zoom="${idx}" alt="">
        <div class="body">
          <div><b>${esc(qLabel(i))}</b> ${i.suggest && !i.include ? '<span class="badge warn">Kontrol et</span>' : ''} ${exists ? '<span class="badge dup">Kayıtlı</span>' : ''}</div>
          <div class="muted small">${i.clean ? 'temiz kitaptan' : '<span style="color:var(--star)">işaretli sayfadan</span>'} · PDF sayfa ${i.pageNo}</div>
          <div class="chips">
            <button class="chip wrong ${i.wrong ? 'on' : ''}" data-t="wrong">✗ Yanlış</button>
            <button class="chip star ${i.star ? 'on' : ''}" data-t="star">★ Yıldız</button>
            <span class="chip">Cevap <select data-t="ans"><option value="">?</option>${LETTERS.map(l => `<option ${i.answer === l ? 'selected' : ''}>${l}</option>`).join('')}</select></span>
          </div>
          <div class="tools"><button class="btn soft" data-act="crop"><svg><use href="#i-crop"/></svg>Kırp</button><button class="chip konu" data-act="konu">${esc(i.konu)}</button></div>
        </div></div>`;
    }).join('') : '<p class="muted">İşaretli soru bulunamadı. "İşaretsizleri de göster" ile soruları elle seçebilirsin.</p>';
    updateImportSave();
  }
  function updateImportSave() { const n = IM.items.filter(i => i.include).length; $('#im-save').textContent = `Kaydet (${n} soru)`; $('#im-save').disabled = !n; }
  $('#im-cards').addEventListener('click', async e => {
    const card = e.target.closest('.card'); if (!card) return;
    const it = IM.items[+card.dataset.idx];
    if (e.target.closest('[data-zoom]')) return openViewer(it.img);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'crop') return editImportCrop(it);
    if (act === 'konu') return openPicker({ kind: 'konu', ders: it.ders, current: it.konu, onPick: (v) => { it.konu = v; renderImport(); } });
    const b = e.target.closest('button.chip[data-t]'); if (!b) return;
    it[b.dataset.t] = !it[b.dataset.t];
    it.include = it.wrong || it.star;
    if (it.include && !it.hq) { it.img = await hqCrop(it.regen.fromBook ? IM.bookPdf : IM.pdf, it.regen.page, it.regen.box); it.hq = true; releaseHq(); }
    renderImport();
  });
  $('#im-cards').addEventListener('change', e => {
    if (e.target.dataset.t !== 'ans') return;
    IM.items[+e.target.closest('.card').dataset.idx].answer = e.target.value || null;
  });
  $('#im-warn').addEventListener('click', e => {
    const b = e.target.closest('[data-addq]'); if (b) return addManualQuestion(+b.dataset.addq);
    if (e.target.closest('[data-addsel]')) addManualQuestion(+$('#im-addpage').value);
  });

  async function editImportCrop(it) {
    const pdf = it.regen.fromBook ? IM.bookPdf : IM.pdf;
    const box = await openCropper({ pdf, page: it.regen.page, box: it.regen.box, title: qLabel(it) });
    if (!box) return;
    it.regen.box = box; it.img = await hqCrop(pdf, it.regen.page, box); it.hq = true; releaseHq();
    renderImport();
  }
  async function addManualQuestion(pageNo) {
    const pg = IM.pages[pageNo], pdf = pg.fromBook ? IM.bookPdf : IM.pdf;
    const res = await openCropper({ pdf, page: pg.srcPage, box: null, title: `Sayfa ${pageNo} · yeni soru`, askNo: true });
    if (!res) return;
    const { box, no } = res;
    const img = await hqCrop(pdf, pg.srcPage, box); releaseHq();
    const bookId = pg.fromBook ? IM.book.id : null;
    const bkey = pg.fromBook ? keyMap((IM.book.pages.find(p => p.p === pg.srcPage) || {}).key) : {};
    IM.items.push({
      hq: true, regen: { fromBook: pg.fromBook, page: pg.srcPage, box }, pageNo,
      id: bookId ? `${bookId}|${pg.srcPage}|${no}` : [IM.ders, IM.kaynak, pg.konu, pg.test != null ? 'T' + pg.test : IM.fileName + '#p' + pageNo, pg.printed != null ? 'S' + pg.printed : '', no].join('|'),
      bookId, bookPage: bookId ? pg.srcPage : null, clean: pg.fromBook,
      ders: IM.ders, kaynak: IM.kaynak, konu: pg.konu, test: pg.test, printed: pg.printed, no, page: pageNo, file: IM.fileName,
      img, answer: bkey[no] || null, wrong: true, star: false, include: true, detected: true
    });
    renderImport();
  }

  $('#im-save').addEventListener('click', async () => {
    const btn = $('#im-save'); btn.disabled = true;
    try {
      const sel = IM.items.filter(i => i.include);
      for (const i of sel) if (!i.hq) { i.img = await hqCrop(i.regen.fromBook ? IM.bookPdf : IM.pdf, i.regen.page, i.regen.box); i.hq = true; }
      releaseHq();
      const now = Date.now();
      const out = sel.map(i => {
        const old = Q.find(q => q.id === i.id);
        const base = { id: i.id, bookId: i.bookId, bookPage: i.bookPage, ders: i.ders, kaynak: i.kaynak, konu: i.konu, test: i.test, printed: i.printed, no: i.no, page: i.page, file: i.file,
          answer: i.answer || (old && old.answer) || null, wrong: i.wrong, star: i.star, hasImg: true,
          crop: i.regen.fromBook ? { bookId: i.bookId, page: i.regen.page, box: i.regen.box } : null, updated: now, deleted: null, rv: null };
        const q = old ? { ...old, ...base, wrong: old.wrong || i.wrong, star: old.star || i.star } : normalizeQ({ ...base, ivl: 0, ease: 2.3, lapses: 0, reps: 0, due: now, history: [], created: now });
        return { q, blob: DB.dataURLToBlob(i.img) };
      });
      await DB.saveQuestions(out);
      out.forEach(o => dropImg(o.q.id));
      await markChanged(out.length);
      await reload();
      toast(`${out.length} soru kaydedildi.`);
      endImport(); $('#im-review').classList.add('hidden'); $('#im-status').textContent = ''; resetFile('#im-file');
      renderBooks(); show('study');
    } catch (e) { console.error(e); toast('Kaydedilemedi: ' + e.message, 6000); }
    finally { btn.disabled = false; }
  });

  // ---------------------------------------------------------------------
  // kırpma düzenleyici: sayfa görüntüsü üstünde sürüklenebilir kutu
  // box: RENDER_WIDTH koordinatlarında {x,y,w,h}; null ise ortada yeni kutu
  // ---------------------------------------------------------------------
  async function openCropper({ pdf, page, box, title, askNo }) {
    const { canvas } = await Detect.renderPage(pdf, page);
    const W = canvas.width, H = canvas.height, src = canvas.toDataURL('image/jpeg', 0.85); canvas.width = 0;
    let b = box ? { ...box } : { x: W * 0.08, y: H * 0.15, w: W * 0.42, h: H * 0.3 };
    return new Promise(resolve => {
      openModal(`<div class="row between"><b>${esc(title)} · kırpma</b><button data-close id="cr-x">Kapat</button></div>
        <p class="muted small">Kutuyu sürükle, köşelerinden boyutlandır. Sorunun tamamı kutunun içinde kalsın.</p>
        <div class="crop-wrap"><div class="cropper" id="cr"><img id="cr-img" src="${src}" alt=""><div class="crop-box" id="cr-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
        <div class="row between" style="margin-top:12px">${askNo ? '<label>Soru no <input id="cr-no" type="number" min="1" max="200" style="width:110px"></label>' : '<span></span>'}<button class="primary" id="cr-ok">Kaydet</button></div>`, 'wide locked');
      const img = $('#cr-img'), el = $('#cr-box');
      const sc = () => img.clientWidth / W;
      const draw = () => { const s = sc(); Object.assign(el.style, { left: b.x * s + 'px', top: b.y * s + 'px', width: b.w * s + 'px', height: b.h * s + 'px' }); };
      img.onload = draw; if (img.complete) draw(); window.addEventListener('resize', draw);
      let drag = null;
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, b: { ...b } }; });
      el.addEventListener('pointermove', e => {
        if (!drag) return;
        const s = sc(), dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s, o = drag.b, min = 40;
        let { x, y, w, h } = o;
        if (drag.h === 'move') { x = o.x + dx; y = o.y + dy; }
        if (drag.h.includes('w')) { x = Math.min(o.x + o.w - min, o.x + dx); w = o.w - (x - o.x); }
        if (drag.h.includes('e')) w = Math.max(min, o.w + dx);
        if (drag.h.includes('n')) { y = Math.min(o.y + o.h - min, o.y + dy); h = o.h - (y - o.y); }
        if (drag.h.includes('s')) h = Math.max(min, o.h + dy);
        x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y));
        b = { x, y, w: Math.min(w, W - x), h: Math.min(h, H - y) }; draw();
      });
      const up = () => { drag = null; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      const done = (v) => { window.removeEventListener('resize', draw); closeModal(); resolve(v); };
      $('#cr-x').addEventListener('click', () => { window.removeEventListener('resize', draw); resolve(null); });
      $('#cr-ok').addEventListener('click', () => {
        if (askNo) { const n = +$('#cr-no').value; if (!n) return toast('Soru numarasını yaz.'); done({ box: b, no: n }); }
        else done(b);
      });
    });
  }

  // =====================================================================
  // SORULAR
  // =====================================================================
  function cardSmall(q) {
    const s = stats(q);
    return `<div class="card" data-qid="${esc(q.id)}">
      <img data-img="${esc(q.id)}" alt="">
      <div class="body">
        <div><b>${esc(q.konu)}</b> · ${esc(qLabel(q))}</div>
        <div class="muted small">${esc(q.kaynak)} · ${isDue(q) ? 'tekrar zamanı geldi' : 'tekrar ' + new Date(q.due).toLocaleDateString('tr-TR')}</div>
        <div class="chips">
          ${q.wrong ? '<span class="chip wrong on">✗ Yanlış</span>' : ''}${q.star ? '<span class="chip star on">★</span>' : ''}
          ${isLearned(q) ? '<span class="chip learned">Öğrenildi</span>' : ''}${isLeech(q) ? `<span class="chip wrong on">${q.lapses}× yanlış</span>` : ''}
          <span class="chip">${s.tries} deneme · ${s.wrong} yanlış</span>
        </div>
      </div></div>`;
  }
  function bindCards(root) {
    root.querySelectorAll('[data-qid]').forEach(c => { if (!c._b) { c._b = 1; c.addEventListener('click', () => openQuestion(c.dataset.qid)); } });
    hydrateImgs(root);
  }
  let LS = { list: [], shown: 0 };
  function renderList(reset) {
    const f = $('#ls-filter').value, srt = $('#ls-sort').value, term = lower($('#ls-q').value.trim());
    let list = byFilter($('#ls-ders').value, $('#ls-konu').value);
    if (f === 'wrong') list = list.filter(q => q.wrong || stats(q).wrong);
    if (f === 'star') list = list.filter(q => q.star);
    if (f === 'due') list = list.filter(isDue);
    if (f === 'leech') list = list.filter(isLeech);
    if (f === 'learned') list = list.filter(isLearned);
    if (f === 'noans') list = list.filter(q => !q.answer);
    if (term) {
      // "test 3", "soru 5", "sayfa 12" / "s.12" numara olarak; kalan kelimeler metinde aranır
      let rest = term, m;
      const num = {};
      if ((m = rest.match(/test\s*-?\s*(\d+)/))) { num.test = +m[1]; rest = rest.replace(m[0], ' '); }
      if ((m = rest.match(/soru\s*(\d+)/))) { num.no = +m[1]; rest = rest.replace(m[0], ' '); }
      if ((m = rest.match(/(?:sayfa|s\.)\s*(\d+)/))) { num.printed = +m[1]; rest = rest.replace(m[0], ' '); }
      const words = rest.split(/\s+/).filter(Boolean);
      list = list.filter(q => {
        for (const k in num) if (q[k] !== num[k]) return false;
        const hay = lower(`${q.ders} ${q.kaynak} ${q.konu} ${q.answer || ''} ${q.history.map(h => reasonLabel(h.r)).join(' ')}`);
        return words.every(w => hay.includes(w));
      });
    }
    const sorters = {
      konu: (a, b) => trSort(a.ders, b.ders) || trSort(a.konu, b.konu) || (a.test ?? 0) - (b.test ?? 0) || a.no - b.no,
      new: (a, b) => (b.created || 0) - (a.created || 0),
      due: (a, b) => (a.due || 0) - (b.due || 0),
      weak: (a, b) => weakness(b) - weakness(a)
    };
    list.sort(sorters[srt] || sorters.konu);
    LS = { list, shown: 0 };
    $('#ls-count').textContent = `${list.length} soru`;
    $('#ls-cards').innerHTML = list.length ? '' : '<p class="muted">Soru yok.</p>';
    moreList();
  }
  function moreList() {
    const chunk = LS.list.slice(LS.shown, LS.shown + 60);
    $('#ls-cards').insertAdjacentHTML('beforeend', chunk.map(cardSmall).join(''));
    LS.shown += chunk.length;
    $('#ls-more').classList.toggle('hidden', LS.shown >= LS.list.length);
    bindCards($('#ls-cards'));
  }
  $('#ls-more').addEventListener('click', moreList);
  let lsT = null;
  $('#ls-q').addEventListener('input', () => { clearTimeout(lsT); lsT = setTimeout(() => renderList(true), 180); });
  $('#ls-ders').addEventListener('change', () => { refreshKonu('#ls-ders', '#ls-konu'); renderList(true); });
  for (const id of ['#ls-konu', '#ls-filter', '#ls-sort']) $(id).addEventListener('change', () => renderList(true));

  async function openQuestion(id) {
    const q = Q.find(x => x.id === id); if (!q) return;
    const s = stats(q), src = await imgURL(q.id);
    const gl = { wrong: 'yanlış', hard: 'zorlandım', easy: 'rahat' };
    const hist = q.history.slice().reverse().map(h => `<div>${new Date(h.t).toLocaleString('tr-TR')} — ${esc(h.c)} ${h.ok ? '✓' : '✗'}${h.g ? ' · ' + gl[h.g] : ''}${h.r ? ' · ' + esc(reasonLabel(h.r)) : ''} (${fmtSec(h.ms)})${h.rq ? ' · oturum içi tekrar' : ''}</div>`).join('') || 'Henüz çözülmedi.';
    let konu = q.konu;
    openModal(`
      <div class="row between"><b>${esc(q.ders)} · ${esc(q.kaynak)} · ${esc(qLabel(q))}</b><button data-close>Kapat</button></div>
      <img src="${src}" alt="" id="md-img" style="cursor:zoom-in">
      <div class="row">
        <div class="field" style="min-width:220px;flex:1">Konu <button type="button" class="picker" id="md-konu"></button></div>
        <label>Doğru cevap <select id="md-ans"><option value="">?</option>${LETTERS.map(l => `<option ${q.answer === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="inline"><input type="checkbox" id="md-wrong" ${q.wrong ? 'checked' : ''}> Yanlış</label>
        <label class="inline"><input type="checkbox" id="md-star" ${q.star ? 'checked' : ''}> Yıldızlı</label>
      </div>
      <p class="muted">${s.tries} deneme · ${s.wrong} yanlış · ort. süre ${fmtSec(s.avgMs)} · aralık ${q.ivl || 0} gün · kolaylık ${(q.ease || 2.3).toFixed(2)} · sıradaki tekrar ${isDue(q) ? 'şimdi' : new Date(q.due).toLocaleDateString('tr-TR')}</p>
      <details><summary>Çözüm geçmişi</summary><div class="hist">${hist}</div></details>
      <div class="row between" style="margin-top:12px">
        <div class="row">${q.crop ? '<button id="md-crop"><svg><use href="#i-crop"/></svg>Kırpmayı düzenle</button>' : ''}<button id="md-reset">Geçmişi sıfırla</button><button id="md-del" class="danger">Sil</button></div>
        <button id="md-save" class="primary">Kaydet</button>
      </div>`, 'wide');
    // konu seçici (seçim hemen kaydedilir, sonra soru penceresi yeniden açılır)
    const kb = $('#md-konu'); kb.removeAttribute('id'); kb.innerHTML = `<span>${esc(konu)}</span>`;
    kb.addEventListener('click', ev => {
      ev.stopPropagation();
      openPicker({ kind: 'konu', ders: q.ders, current: konu, onPick: async (v) => { q.konu = v; await saveQ(q); await reload(); toast('Konu değişti.'); openQuestion(id); } });
    });
    $('#md-img').onclick = () => openViewer(src);
    $('#md-save').onclick = async () => {
      q.answer = $('#md-ans').value || null; q.wrong = $('#md-wrong').checked; q.star = $('#md-star').checked;
      await saveQ(q); closeModal(); await reload(); renderList(true); toast('Kaydedildi.');
    };
    $('#md-del').onclick = async () => { q.deleted = Date.now(); await saveQ(q); closeModal(); await reload(); renderList(true); toast('Çöp kutusuna taşındı (30 gün içinde geri alabilirsin).'); };
    $('#md-reset').onclick = async () => {
      if (!confirm('Bu sorunun çözüm geçmişi ve tekrar durumu sıfırlansın mı?')) return;
      Object.assign(q, { history: [], ivl: 0, ease: 2.3, lapses: 0, reps: 0, due: Date.now(), last: null, resetAt: Date.now() });
      await saveQ(q); closeModal(); await reload(); renderList(true);
    };
    const cb = $('#md-crop');
    if (cb) cb.onclick = async () => {
      const book = BOOKS.find(b => b.id === q.crop.bookId);
      if (!book) return toast('Bu sorunun kitabı bu cihazda yok.');
      try {
        const pdf = await getBookPdf(book, null);
        const box = await openCropper({ pdf, page: q.crop.page, box: q.crop.box, title: qLabel(q) });
        if (!box) return openQuestion(id);
        const img = await hqCrop(pdf, q.crop.page, box); releaseHq();
        q.crop = { ...q.crop, box };
        await saveQ(q, DB.dataURLToBlob(img));
        toast('Kırpma güncellendi.'); openQuestion(id);
      } catch (e) { toast(e.message, 5000); }
    };
  }

  // =====================================================================
  // ANALİZ
  // =====================================================================
  $('#sa-ders').addEventListener('change', renderStats);
  function renderStats() {
    const list = byFilter($('#sa-ders').value, ''), now = Date.now();
    const H = list.flatMap(q => q.history.filter(h => !h.rq));
    const right = H.filter(h => h.ok).length, times = H.map(h => h.ms).filter(Boolean);
    const tile = (v, k) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    const tom = dayStart(now) + DAY, week = dayStart(now) + 7 * DAY;
    $('#sa-tiles').innerHTML =
      tile(list.length, 'Toplam soru') +
      tile(list.filter(isDue).length, 'Bekleyen tekrar') +
      tile(list.filter(q => q.due >= tom && q.due < tom + DAY).length, 'Yarın gelecek') +
      tile(list.filter(q => q.due > now && q.due < week).length, '7 gün içinde') +
      tile(list.filter(isLearned).length, 'Öğrenilen') +
      tile(H.length ? Math.round(right / H.length * 100) + '%' : '–', 'Tekrarda başarı') +
      tile(times.length ? fmtSec(times.reduce((a, b) => a + b, 0) / times.length) : '–', 'Ort. çözüm süresi') +
      tile(streak() + ' gün', 'Seri');

    // son 14 gün
    const days = [];
    for (let i = 13; i >= 0; i--) { const t = now - i * DAY; days.push({ k: dayKey(t), d: new Date(dayStart(t)), ok: 0, bad: 0 }); }
    const dm = new Map(days.map(d => [d.k, d]));
    list.forEach(q => q.history.forEach(h => { const d = dm.get(dayKey(h.t)); if (d) h.ok ? d.ok++ : d.bad++; }));
    const max = Math.max(1, ...days.map(d => d.ok + d.bad));
    $('#sa-daily').innerHTML = days.map(d => { const n = d.ok + d.bad;
      return `<div class="d" tabindex="0"><span class="tip">${d.d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}: ${n} soru · ${d.ok} doğru · ${d.bad} yanlış</span><span class="n">${n || ''}</span><div class="b ${n ? '' : 'zero'}" style="height:${Math.max(2, n / max * 120)}px"></div><span class="l">${d.d.getDate()}</span></div>`; }).join('');

    // ders tablosu
    const dg = {};
    for (const q of live()) { const g = dg[q.ders] ||= { n: 0, t: 0, ok: 0, l: 0 }; const s = stats(q); g.n++; g.t += s.tries; g.ok += s.right; if (isLearned(q)) g.l++; }
    const drows = Object.entries(dg).sort((a, b) => trSort(a[0], b[0]));
    $('#sa-ders-table').innerHTML = drows.length ? `<table class="topics"><thead><tr><th>Ders</th><th class="num">Soru</th><th>Başarı</th><th class="num">Öğrenilen</th></tr></thead><tbody>${drows.map(([d, g]) => {
      const r = g.t ? g.ok / g.t : null;
      return `<tr><td><b>${esc(d)}</b></td><td class="num">${g.n}</td><td><div class="bar-cell"><div class="bar good"><i style="width:${Math.round((r ?? 0) * 100)}%"></i></div><span>${r == null ? '–' : Math.round(r * 100) + '%'}</span></div></td><td class="num">${g.l}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">Henüz veri yok.</p>';

    // hata nedenleri
    const rc = {}; let rn = 0;
    list.forEach(q => q.history.forEach(h => { if (h.r) { rc[h.r] = (rc[h.r] || 0) + 1; rn++; } }));
    const rmax = Math.max(1, ...Object.values(rc));
    $('#sa-reasons').innerHTML = rn ? REASONS.filter(r => rc[r.id]).sort((a, b) => rc[b.id] - rc[a.id]).map(r =>
      `<div class="hbar"><span>${r.label}</span><div class="bar"><i style="width:${rc[r.id] / rmax * 100}%"></i></div><span class="v">${rc[r.id]}</span></div>`).join('') +
      `<p class="muted small">Toplam ${rn} yanlışta neden seçildi.</p>` : '<p class="muted">Yanlış yaptığında nedenini seçersen burada görünür.</p>';

    // konu tablosu
    const groups = {};
    for (const q of list) {
      const key = q.ders + ' › ' + q.konu;
      const g = groups[key] ||= { ders: q.ders, konu: q.konu, n: 0, marked: 0, tries: 0, wrong: 0, ms: [], learned: 0, due: 0 };
      const s = stats(q);
      g.n++; if (q.wrong) g.marked++; if (isLearned(q)) g.learned++; if (isDue(q)) g.due++;
      g.tries += s.tries; g.wrong += s.wrong; q.history.forEach(h => !h.rq && h.ms && g.ms.push(h.ms));
    }
    const rows = Object.values(groups).map(g => ({ ...g, rate: g.tries ? (g.tries - g.wrong) / g.tries : null, avg: g.ms.length ? g.ms.reduce((a, b) => a + b, 0) / g.ms.length : null }))
      .sort((a, b) => ((a.rate ?? 1) - (b.rate ?? 1)) || (b.marked - a.marked));
    $('#sa-topics').innerHTML = rows.length ? `<table class="topics">
      <thead><tr><th>Konu</th><th class="num">Soru</th><th class="num">İlk yanlış</th><th class="num">Bekleyen</th><th>Başarı (tekrarda)</th><th class="num">Ort. süre</th><th class="num">Öğrenilen</th></tr></thead>
      <tbody>${rows.map(g => `<tr>
        <td><b>${esc(g.konu)}</b><br><small>${esc(g.ders)}</small></td>
        <td class="num">${g.n}</td><td class="num">${g.marked}</td><td class="num">${g.due}</td>
        <td><div class="bar-cell"><div class="bar good" title="${g.tries - g.wrong} doğru / ${g.tries} deneme"><i style="width:${Math.round((g.rate ?? 0) * 100)}%"></i></div><span>${g.rate == null ? '–' : Math.round(g.rate * 100) + '%'}</span></div></td>
        <td class="num">${fmtSec(g.avg)}</td><td class="num">${g.learned} / ${g.n}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Henüz veri yok.</p>';

    const worst = list.filter(q => (q.lapses || 0) > 0).sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || weakness(b) - weakness(a)).slice(0, 12);
    $('#sa-worst').innerHTML = worst.map(cardSmall).join('') || '<p class="muted">Tekrarlarda henüz yanlış yok.</p>';
    bindCards($('#sa-worst'));
  }
  $('#sa-daily').addEventListener('click', e => { const d = e.target.closest('.d'); $$('#sa-daily .d').forEach(x => x.classList.toggle('show', x === d && !x.classList.contains('show'))); });

  // =====================================================================
  // YEDEK, GERİ YÜKLEME, ÇÖP KUTUSU
  // =====================================================================
  async function renderBackup() {
    $('#bk-last').textContent = BACKUP.last ? `Son yedek: ${new Date(BACKUP.last).toLocaleString('tr-TR')} · o zamandan beri ${BACKUP.changes} değişiklik.` : 'Henüz yedek alınmadı.';
    const rp = await DB.getMeta('restorePoint', null);
    $('#bk-undo').classList.toggle('hidden', !(rp && rp.added));
    const tr = Q.filter(q => q.deleted).sort((a, b) => b.deleted - a.deleted);
    $('#bk-trash').innerHTML = tr.length ? tr.map(q => `<div class="card" data-tid="${esc(q.id)}"><img data-img="${esc(q.id)}" alt=""><div class="body"><div><b>${esc(q.konu)}</b> · ${esc(qLabel(q))}</div>
      <div class="muted small">${new Date(q.deleted).toLocaleDateString('tr-TR')} tarihinde silindi</div>
      <div class="tools"><button class="btn soft" data-act="restore">Geri al</button><button class="btn danger" data-act="purge">Kalıcı sil</button></div></div></div>`).join('') : '<p class="muted">Çöp kutusu boş.</p>';
    hydrateImgs($('#bk-trash'));
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate(), mb = (x) => (x / 1048576).toFixed(0) + ' MB';
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      $('#bk-usage').textContent = `Kullanılan alan: ${mb(e.usage || 0)} / yaklaşık ${mb(e.quota || 0)}.${persisted ? ' Veriler kalıcı olarak korunuyor.' : ''}`;
    }
  }
  $('#bk-trash').addEventListener('click', async e => {
    const c = e.target.closest('[data-tid]'), act = e.target.closest('[data-act]')?.dataset.act; if (!c || !act) return;
    const q = Q.find(x => x.id === c.dataset.tid); if (!q) return;
    if (act === 'restore') { q.deleted = null; await saveQ(q); toast('Soru geri alındı.'); }
    if (act === 'purge') { if (!confirm('Bu soru kalıcı olarak silinsin mi? Geri alınamaz.')) return; await DB.deleteQuestionHard(q.id); dropImg(q.id); }
    await reload(); renderBackup();
  });
  async function purgeTrash() {
    const old = Q.filter(q => q.deleted && Date.now() - q.deleted > TRASH_DAYS * DAY);
    for (const q of old) await DB.deleteQuestionHard(q.id);
    if (old.length) Q = Q.filter(q => !old.includes(q));
  }

  async function buildBackup(onProgress) {
    const qs = await DB.all(), books = (await DB.books.all()).map(b => ({ ...b, hasFile: false }));
    const keys = new Set(await DB.images.keys());
    const entries = [], imgMap = {};
    let n = 0;
    for (const q of qs) {
      if (!keys.has(q.id)) continue;
      const r = await DB.images.get(q.id); if (!r || !r.blob) continue;
      const name = `img/${++n}.jpg`; imgMap[q.id] = name; entries.push({ name, data: r.blob });
    }
    entries.unshift({ name: 'data.json', data: JSON.stringify({ app: 'soru-tekrar', v: 3, exported: Date.now(), questions: qs, books, prefs: PREFS, imgMap }) });
    return { blob: await Zip.write(entries, onProgress), qs, n };
  }
  async function exportBackup() {
    const st = $('#bk-status');
    try {
      st.textContent = 'Yedek hazırlanıyor…';
      const { blob, qs, n } = await buildBackup((i, t) => { st.textContent = `Yedek hazırlanıyor… ${i}/${t}`; });
      const fname = `soru-tekrar-yedek-${new Date().toISOString().slice(0, 10)}.zip`;
      const file = new File([blob], fname, { type: 'application/zip' });
      const info = `${qs.length} soru, ${n} resim (${(blob.size / 1048576).toFixed(1)} MB)`;
      const done = async () => {
        BACKUP = { last: Date.now(), changes: 0 }; await DB.setMeta('backup', BACKUP);
        st.textContent = `Yedek alındı: ${info}.`; updateHome(); renderBackup();
      };
      const touchApple = /iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
      if (touchApple && navigator.canShare && navigator.canShare({ files: [file] })) {
        // iPad: paylaşım penceresi kullanıcının dokunuşuyla açılmalı; hazırlık uzun sürdüyse ilk dokunuşun süresi dolmuş olur.
        // Bu yüzden hazır dosya için ayrı bir "Kaydet" düğmesi gösterilir.
        st.innerHTML = `Yedek hazır: ${esc(info)}. <button class="btn primary sm" id="bk-share">Dosyalar'a kaydet / paylaş</button>`;
        $('#bk-share').onclick = async () => {
          try { await navigator.share({ files: [file], title: 'Soru Tekrar yedeği' }); await done(); }
          catch (e) { st.textContent = e.name === 'AbortError' ? 'Yedek kaydedilmedi (iptal edildi). Yeniden "Yedek al"a dokunabilirsin.' : 'Paylaşım açılamadı: ' + e.message; }
        };
        return;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      await done();
    } catch (e) { console.error(e); st.textContent = 'Yedek alınamadı: ' + e.message; }
  }
  $('#bk-export').addEventListener('click', exportBackup);

  // Birleştirme: çözüm geçmişleri birleşir; bilgi alanlarında en son düzenlenen, tekrar durumunda en son çözülen kazanır.
  const META_KEYS = ['ders', 'kaynak', 'konu', 'answer', 'wrong', 'star', 'deleted', 'crop', 'test', 'printed', 'no', 'bookId', 'bookPage', 'page', 'file', 'created', 'updated'];
  const SRS_KEYS = ['ivl', 'ease', 'due', 'lapses', 'reps', 'last'];
  // "Geçmişi sıfırla" zamanı (resetAt) birleştirmede korunur: sıfırlamadan önceki geçmiş eski bir yedekten geri gelmez
  const lastT = (q) => Math.max(q.last || 0, q.resetAt || 0, ...(q.history || []).map(h => h.t));
  function mergeQ(o, n) {
    if (!o) return n;
    const resetAt = Math.max(o.resetAt || 0, n.resetAt || 0);
    const hs = new Map([...(o.history || []), ...(n.history || [])].filter(h => h.t > resetAt).map(h => [h.t + '|' + h.c, h]));
    const out = { ...o, history: [...hs.values()].sort((a, b) => a.t - b.t) };
    if (resetAt) out.resetAt = resetAt;
    const m = (n.updated || 0) > (o.updated || 0) ? n : o, s = lastT(n) > lastT(o) ? n : o;
    META_KEYS.forEach(k => { if (k in m) out[k] = m[k]; });
    SRS_KEYS.forEach(k => { if (k in s) out[k] = s[k]; });
    // sıfırlama varsa eski kayıtların hata sayısı geri gelmesin: sadece sıfırlamadan sonra sayılanlar
    const after = (q) => ((q.resetAt || 0) >= resetAt ? (q.lapses || 0) : 0);
    out.lapses = Math.max(resetAt ? Math.max(after(o), after(n)) : Math.max(o.lapses || 0, n.lapses || 0), out.history.filter(h => !h.ok && !h.rq).length);
    return out;
  }
  $('#bk-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const st = $('#bk-status');
    try {
      st.textContent = 'Yedek okunuyor…';
      let data, zip = null;
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip') { zip = await Zip.read(f); data = JSON.parse(await zip.text('data.json')); }
      else data = JSON.parse(await f.text());
      if (!data || data.app && data.app !== 'soru-tekrar' || !Array.isArray(data.questions)) throw new Error('Bu bir Soru Tekrar yedeği değil');
      const incoming = data.questions.map(q => normalizeQ({ ...q }));
      if (incoming.some(q => typeof q.id !== 'string' || !q.id)) throw new Error('Yedekte kimliği eksik soru kaydı var');
      if ((data.books || []).some(b => !b || typeof b.id !== 'string' || !b.id)) throw new Error('Yedekte kimliği eksik kitap kaydı var');
      if ((data.books || []).some(b => !Array.isArray(b.pages) || b.pages.some(p => !p || typeof p !== 'object'))) throw new Error('Yedekteki kitap dizini bozuk');
      if (data.imgMap && (typeof data.imgMap !== 'object' || Object.values(data.imgMap).some(v => typeof v !== 'string'))) throw new Error('Yedekteki resim listesi bozuk');
      const existing = new Map(Q.map(q => [q.id, q]));
      const localImgs = new Set(await DB.images.keys());
      const now = Date.now();

      // 1) HAZIRLIK — veritabanına hiçbir şey yazılmadan önce her şey okunur ve doğrulanır
      const writes = [], added = [], prevQ = [], prevImg = [], addedImg = []; let imgs = 0;
      for (let i = 0; i < incoming.length; i++) {
        const n = incoming[i], o = existing.get(n.id);
        // resim: yerelde yoksa ya da gelen kayıt daha yeni düzenlenmişse (ör. başka cihazda kırpma düzeltildi) gelen resim alınır
        const wantImg = !localImgs.has(n.id) || (o && (n.updated || 0) > (o.updated || 0));
        let blob = null;
        if (wantImg) {
          if (typeof n.img === 'string' && n.img.startsWith('data:')) blob = DB.dataURLToBlob(n.img);
          else if (zip && data.imgMap && data.imgMap[n.id]) {
            await zip.bytes(data.imgMap[n.id]);                 // CRC doğrulaması (bozuksa hata fırlatır)
            blob = await zip.blob(data.imgMap[n.id]);           // yazarken dosyadan okunur, belleğe kopyalanmaz
          }
          if (blob) {
            imgs++;
            if (o && localImgs.has(n.id)) { const r = await DB.images.get(n.id); if (r) prevImg.push(r); }
            else if (o) addedImg.push(n.id); // var olan ama resmi olmayan soruya resim eklendi: geri alınca silinecek
          }
        }
        delete n.img; if (blob || localImgs.has(n.id)) n.hasImg = true;
        if (o) prevQ.push(o); else added.push(n.id);
        writes.push({ q: mergeQ(o, n), blob });
        if (i % 50 === 0) { st.textContent = `Yedek doğrulanıyor… ${i + 1}/${incoming.length}`; await tick(); }
      }
      const bookWrites = [], prevBooks = [], addedBooks = [];
      for (const b of data.books || []) {
        const old = BOOKS.find(x => x.id === b.id);
        if (!old || (b.updated || 0) > (old.updated || 0)) { bookWrites.push(old ? { ...b, hasFile: old.hasFile } : { ...b, hasFile: false }); old ? prevBooks.push(old) : addedBooks.push(b.id); }
      }
      const prevPrefs = JSON.parse(JSON.stringify(PREFS)), newPrefs = JSON.parse(JSON.stringify(PREFS));
      if (data.prefs) {
        for (const k of ['ders', 'kaynak', 'konu']) { newPrefs.fav[k] = uniq([...newPrefs.fav[k], ...(data.prefs.fav?.[k] || [])]); newPrefs.recent[k] = uniq([...newPrefs.recent[k], ...(data.prefs.recent?.[k] || [])]).slice(0, 12); }
        newPrefs.custom.ders = uniq([...newPrefs.custom.ders, ...(data.prefs.custom?.ders || [])]);
        for (const k of ['konu', 'kaynak']) for (const [d, arr] of Object.entries(data.prefs.custom?.[k] || {})) newPrefs.custom[k][d] = uniq([...(newPrefs.custom[k][d] || []), ...arr]);
      }
      // geri alma noktası: bu geri yüklemenin eklediği ve değiştirdiği her şeyin önceki hali
      // written: bu geri yüklemenin yazdığı her kaydın damgası; geri alırken "sonradan değişmiş mi" kesin anlaşılır
      writes.forEach(w => { w.q.rv = now; });
      bookWrites.forEach(b => { b.rv = now; });
      const restorePoint = { t: now, added, prevQ, prevImg, addedImg, addedBooks, prevBooks, prevPrefs, newPrefs: JSON.stringify(newPrefs) };

      // 2) YAZMA — tek işlem: ya hepsi yazılır ya hiçbiri
      st.textContent = 'Geri yükleniyor…';
      await DB.applyRestore({ questions: writes, books: bookWrites, meta: [{ key: 'prefs', value: newPrefs }, { key: 'restorePoint', value: restorePoint }] });
      PREFS = newPrefs;
      imgCache.forEach((u) => URL.revokeObjectURL(u)); imgCache.clear();
      await reload(); await loadBooks();
      st.textContent = `Geri yüklendi: ${added.length} yeni soru, ${prevQ.length} soru birleştirildi, ${imgs} resim${bookWrites.length ? `, ${bookWrites.length} kitap dizini` : ''}.` + ((data.books || []).length ? ' Kitaplardan yeni bölüm eklemek için kitap PDF\'ini bu cihazda bir kez seçmen gerekebilir.' : '');
      renderBackup();
    } catch (err) { console.error(err); st.textContent = 'Geri yüklenemedi: ' + err.message + ' (Hiçbir şey değiştirilmedi.)'; }
  });
  $('#bk-undo').addEventListener('click', async () => {
    const rp = await DB.getMeta('restorePoint', null); if (!rp || !rp.added) return;
    if (!confirm(`${new Date(rp.t).toLocaleString('tr-TR')} tarihli geri yükleme geri alınsın mı? Geri yüklemeden sonra üzerinde çalıştığın sorulara dokunulmaz.`)) return;
    // geri yüklemeden SONRA değiştirilen (çözülen, düzenlenen) kayıtlar korunur
    const cur = new Map(Q.map(q => [q.id, q]));
    // geri yüklemenin yazdığı kayıt hâlâ aynıysa (rv damgası duruyor ve sonra kaydedilmemiş) dokunulmamış sayılır
    const untouched = (id) => { const q = cur.get(id); return q && q.rv === rp.t; };
    const delQ = rp.added.filter(untouched);
    const putQ = rp.prevQ.filter(p => untouched(p.id));
    const putImg = rp.prevImg.filter(r => untouched(r.id));
    const delImg = (rp.addedImg || []).filter(untouched);
    const kept = rp.added.length - delQ.length + rp.prevQ.length - putQ.length;
    // kitaplar: sadece geri yüklemenin yazdığı ve sonradan değişmemiş olanlar; kalan sorulardan biri hâlâ kullanıyorsa silinmez
    const bmap = new Map(BOOKS.map(b => [b.id, b])), delSet = new Set(delQ);
    const bookUntouched = (id) => bmap.get(id) && bmap.get(id).rv === rp.t;
    const inUse = (id) => Q.some(q => q.bookId === id && !delSet.has(q.id));
    const delBooks = rp.addedBooks.filter(id => bookUntouched(id) && !inUse(id));
    const putBooks = rp.prevBooks.filter(b => bookUntouched(b.id)).map(b => ({ ...b, hasFile: bmap.get(b.id).hasFile }));
    // ayarlar: geri yüklemeden sonra değiştirilmediyse eski haline döner (değiştiyse sonraki hali korunur)
    const prefsSame = JSON.stringify(PREFS) === rp.newPrefs;
    const undoMeta = prefsSame ? [{ key: 'prefs', value: rp.prevPrefs }] : [];
    await DB.applyUndo({ delQ, putQ, putImg, delBooks, putBooks, meta: undoMeta, delMeta: ['restorePoint'], delImg });
    if (prefsSame) PREFS = rp.prevPrefs;
    imgCache.forEach((u) => URL.revokeObjectURL(u)); imgCache.clear();
    await reload(); await loadBooks(); renderBackup();
    toast('Geri yükleme geri alındı.' + (kept ? ` Sonradan üzerinde çalıştığın ${kept} soru korundu.` : ''), 5000);
  });
  $('#bk-wipe').addEventListener('click', async () => {
    const t = prompt('Tüm sorular, geçmiş ve kitaplar silinecek. Onaylamak için SİL yaz.');
    if (!t || t.trim().toLocaleUpperCase('tr') !== 'SİL') return toast('Silme iptal edildi.');
    await DB.clearAll(); bookPdfCache.clear(); imgCache.forEach(u => URL.revokeObjectURL(u)); imgCache.clear();
    BACKUP = { last: 0, changes: 0 };
    await reload(); await loadBooks(); renderBackup(); toast('Tüm veriler silindi.');
  });

  // ---------------------------------------------------------------------
  // dosya seçici etiketi
  // ---------------------------------------------------------------------
  document.addEventListener('change', e => {
    if (!e.target.matches('.file input[type=file]')) return;
    const wrap = e.target.closest('.file'), f = e.target.files[0];
    wrap.querySelector('.fname').textContent = f ? f.name : 'Seçilmedi';
    wrap.classList.toggle('has', !!f);
  });
  function resetFile(sel) { const i = $(sel); i.value = ''; const w = i.closest('.file'); if (w) { w.classList.remove('has'); w.querySelector('.fname').textContent = 'Seçilmedi'; } }

  // ---------------------------------------------------------------------
  // başlat
  // ---------------------------------------------------------------------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  (async () => {
    try {
      const p = await DB.getMeta('prefs', null);
      if (p) PREFS = { fav: { ...PREFS.fav, ...p.fav }, recent: { ...PREFS.recent, ...p.recent }, custom: { ders: p.custom?.ders || [], konu: p.custom?.konu || {}, kaynak: p.custom?.kaynak || {} } };
      BACKUP = await DB.getMeta('backup', BACKUP);
      Q = await DB.all(); await purgeTrash();
      await reload(); await loadBooks();
      show('study');
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      console.error(e);
      document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="warnbox">Veriler açılamadı: ${esc(e.message)}. Sayfayı yenile; sorun sürerse yedekten geri yükleyebilirsin.</div>`);
    }
  })();
  window.__app = { reload, loadBooks, get Q() { return Q; }, get BOOKS() { return BOOKS; }, nextState, mergeQ, exportBackup, buildBackup, setPicker, openCropper };
})();
