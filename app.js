/* Soru Tekrar — arayüz ve tekrar mantığı */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const DAY = 86400000;
  // Kutu sistemi: doğru bildikçe tekrar aralığı uzar; yanlışta başa döner.
  const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // gün
  const LEARNED_BOX = 4;

  let Q = []; // tüm sorular (bellekte)
  const toast = (msg, ms = 2200) => { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); };
  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const fmtSec = (ms) => ms == null ? '–' : (ms < 60000 ? `${Math.round(ms / 1000)} sn` : `${(ms / 60000).toFixed(1)} dk`);
  const qLabel = (q) => `${q.test != null ? 'Test-' + q.test + ' · ' : ''}Soru ${q.no}${q.printed != null ? ' · s.' + q.printed : ''}`;
  const trSort = (a, b) => a.localeCompare(b, 'tr');

  async function reload() { Q = await DB.all(); refreshFilters(); }

  // ---------- istatistik yardımcıları ----------
  function stats(q) {
    const h = q.history || [];
    const wrong = h.filter(x => !x.ok).length;
    const times = h.filter(x => x.ms).map(x => x.ms);
    return { tries: h.length, wrong, right: h.length - wrong, avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null };
  }
  const isDue = (q) => (q.due ?? 0) <= Date.now();
  const isLearned = (q) => (q.box || 0) >= LEARNED_BOX;
  // zayıflık: işaretlenmiş yanlış + tekrar yanlışları; doğrular biraz düşürür
  const weakness = (q) => { const s = stats(q); return (q.wrong ? 1 : 0) + s.wrong * 2 - s.right * 0.5; };

  // ---------- filtreler ----------
  function fillSelect(sel, values, allLabel = 'Hepsi') {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option>${esc(v)}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort(trSort);
  function refreshFilters() {
    const dersler = uniq(Q.map(q => q.ders));
    for (const id of ['#st-ders', '#ls-ders', '#sa-ders']) fillSelect($(id), dersler);
    refreshKonu('#st-ders', '#st-konu'); refreshKonu('#ls-ders', '#ls-konu');
    $('#dl-kaynak').innerHTML = uniq(Q.map(q => q.kaynak)).map(v => `<option>${esc(v)}</option>`).join('');
    $('#dl-konu').innerHTML = uniq(Q.map(q => q.konu)).map(v => `<option>${esc(v)}</option>`).join('');
    updateStudyCount();
  }
  function refreshKonu(dersSel, konuSel) {
    const d = $(dersSel).value;
    fillSelect($(konuSel), uniq(Q.filter(q => !d || q.ders === d).map(q => q.konu)));
  }
  const byFilter = (d, k) => Q.filter(q => (!d || q.ders === d) && (!k || q.konu === k));

  // ---------- sekmeler ----------
  function show(view) {
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'list') renderList();
    if (view === 'stats') renderStats();
    if (view === 'study') updateStudyCount();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });

  // =====================================================================
  // ÇALIŞ
  // =====================================================================
  function pickQueue() {
    const mode = $('input[name=mode]:checked').value;
    let pool = byFilter($('#st-ders').value, $('#st-konu').value);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    if (mode === 'due') pool = shuffle(pool.filter(isDue)).sort((a, b) => (a.box || 0) - (b.box || 0));
    else if (mode === 'weak') pool = pool.filter(q => weakness(q) > 0).sort((a, b) => weakness(b) - weakness(a));
    else if (mode === 'star') pool = shuffle(pool.filter(q => q.star));
    else pool = shuffle(pool);
    const lim = +$('#st-limit').value;
    return lim ? pool.slice(0, lim) : pool;
  }
  function updateStudyCount() {
    const n = pickQueue().length;
    const due = byFilter($('#st-ders').value, $('#st-konu').value).filter(isDue).length;
    $('#st-count').textContent = Q.length ? `Bu seçimle ${n} soru gelecek. Sırası gelen: ${due}. Toplam soru: ${Q.length}.` : 'Henüz soru yok. "PDF Ekle" sekmesinden başla.';
    $('#st-start').disabled = !n;
  }
  $('#st-ders').addEventListener('change', () => { refreshKonu('#st-ders', '#st-konu'); updateStudyCount(); });
  $('#st-konu').addEventListener('change', updateStudyCount);
  $('#st-mode').addEventListener('change', updateStudyCount);
  $('#st-limit').addEventListener('change', updateStudyCount);

  const S = { queue: [], i: 0, t0: 0, timer: null, answered: false, seen: new Set(), results: [], requeued: new Set() };

  $('#st-start').addEventListener('click', () => {
    S.queue = pickQueue().map(q => q.id); S.i = 0; S.seen = new Set(); S.results = []; S.requeued = new Set();
    if (!S.queue.length) return;
    $('#study-setup').classList.add('hidden'); $('#study-done').classList.add('hidden'); $('#study-run').classList.remove('hidden');
    showQuestion();
  });
  $('#run-stop').addEventListener('click', finishSession);
  $('#run-skip').addEventListener('click', () => { S.i++; next(); });
  $('#run-next').addEventListener('click', () => { S.i++; next(); });
  document.addEventListener('keydown', e => {
    if (!$('#view-study').classList.contains('active') || $('#study-run').classList.contains('hidden')) return;
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toUpperCase();
    if (LETTERS.includes(k)) { const b = $$('#run-choices button').find(b => b.dataset.l === k && !b.disabled); if (b) b.click(); }
    else if ((e.key === 'Enter' || e.key === ' ') && !$('#run-next').classList.contains('hidden')) { e.preventDefault(); $('#run-next').click(); }
  });

  function next() { if (S.i >= S.queue.length) finishSession(); else showQuestion(); }

  function showQuestion() {
    const q = Q.find(x => x.id === S.queue[S.i]);
    if (!q) { S.i++; return next(); }
    S.answered = false;
    $('#run-meta').textContent = `${q.ders} · ${q.konu} · ${q.kaynak} · ${qLabel(q)}`;
    $('#run-progress').textContent = `${S.i + 1} / ${S.queue.length}`;
    $('#run-img').src = q.img;
    $('#run-feedback').className = 'feedback hidden';
    $('#run-next').classList.add('hidden'); $('#run-skip').classList.remove('hidden');
    $('#run-choices').innerHTML = LETTERS.map(l => `<button data-l="${l}">${l}</button>`).join('');
    $$('#run-choices button').forEach(b => b.addEventListener('click', () => answer(q, b.dataset.l)));
    S.t0 = Date.now();
    clearInterval(S.timer);
    const st = stats(q);
    const tEl = $('#run-timer'), tTxt = $('#run-timer b');
    S.timer = setInterval(() => { const ms = Date.now() - S.t0; tTxt.textContent = fmtTime(ms); tEl.classList.toggle('slow', ms > 180000); }, 250);
    tTxt.textContent = '00:00'; tEl.classList.remove('slow');
    $('#run-bar').style.width = `${Math.round(S.i / S.queue.length * 100)}%`;
    tEl.title = st.avgMs ? `Bu soruda ortalaman: ${fmtSec(st.avgMs)}` : '';
    window.scrollTo({ top: 0 });
  }

  async function answer(q, choice) {
    if (S.answered) return;
    const ms = Date.now() - S.t0;
    clearInterval(S.timer);
    if (!q.answer) {
      // cevap anahtarı yoksa: doğru şıkkı bir kez sor, sonra değerlendir
      const fb = $('#run-feedback');
      fb.className = 'feedback ask'; fb.textContent = `Bu sorunun cevabı kayıtlı değil. Cevap anahtarına bak: doğru şık hangisi? (Senin cevabın: ${choice})`;
      $$('#run-choices button').forEach(b => { b.onclick = null; const nb = b.cloneNode(true); b.replaceWith(nb); nb.addEventListener('click', async () => { q.answer = nb.dataset.l; await DB.put(q); S.t0 = Date.now() - ms; answer(q, choice); }); });
      return;
    }
    S.answered = true;
    const ok = choice === q.answer;
    $$('#run-choices button').forEach(b => {
      b.disabled = true;
      if (b.dataset.l === q.answer) b.classList.add('correct');
      if (b.dataset.l === choice && !ok) b.classList.add('picked-bad');
    });
    const first = !S.seen.has(q.id); S.seen.add(q.id);
    q.history = q.history || [];
    q.history.push({ t: Date.now(), c: choice, ok, ms });
    if (first) {
      if (ok) { q.box = Math.min((q.box || 0) + 1, INTERVALS.length - 1); q.due = Date.now() + INTERVALS[q.box] * DAY; }
      else { q.box = 0; q.due = Date.now(); }
    }
    await DB.put(q);
    if (first) S.results.push({ id: q.id, ok, ms });
    // yanlışsa aynı oturumda birkaç soru sonra tekrar sor
    if (!ok && !S.requeued.has(q.id)) { S.requeued.add(q.id); S.queue.splice(Math.min(S.i + 4, S.queue.length), 0, q.id); }
    const fb = $('#run-feedback');
    const nextDays = INTERVALS[q.box || 0];
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.textContent = ok
      ? `Doğru! ${fmtSec(ms)}. ${first ? (nextDays ? `Bir sonraki tekrar ${nextDays} gün sonra.` : '') : ''}`
      : `Yanlış. Doğru cevap ${q.answer}. ${fmtSec(ms)}. Bu soru birazdan ve sonraki oturumlarda tekrar gelecek.`;
    $('#run-next').classList.remove('hidden'); $('#run-skip').classList.add('hidden');
  }

  function finishSession() {
    clearInterval(S.timer);
    $('#study-run').classList.add('hidden');
    const r = S.results, ok = r.filter(x => x.ok).length;
    const avg = r.length ? r.reduce((a, b) => a + b.ms, 0) / r.length : null;
    const wrongs = r.filter(x => !x.ok).map(x => Q.find(q => q.id === x.id)).filter(Boolean);
    $('#study-done').innerHTML = `
      <h2>Oturum bitti</h2>
      <div class="tiles">
        <div class="tile"><div class="v">${r.length}</div><div class="k">Çözülen</div></div>
        <div class="tile"><div class="v">${ok}</div><div class="k">Doğru</div></div>
        <div class="tile"><div class="v">${r.length - ok}</div><div class="k">Yanlış</div></div>
        <div class="tile"><div class="v">${fmtSec(avg)}</div><div class="k">Ort. süre</div></div>
      </div>
      ${wrongs.length ? `<h3>Yanlış yaptıkların</h3><div class="cards small">${wrongs.map(cardSmall).join('')}</div>` : ''}
      <p><button class="primary" id="done-back">Yeni oturum</button></p>`;
    $('#study-done').classList.remove('hidden');
    $('#done-back').addEventListener('click', () => { $('#study-done').classList.add('hidden'); $('#study-setup').classList.remove('hidden'); updateStudyCount(); });
    bindCardClicks($('#study-done'));
  }

  // =====================================================================
  // PDF EKLE
  // =====================================================================
  let IM = null; // { items: [...] }
  let BOOKS = [];
  const bookPdfCache = new Map(); // id -> pdf (bu oturum için)

  // ---------- kitaplar ----------
  // Konu adlarını toparla: boş olanlar önceki sayfadan devralır; komşu bölümlerde
  // bozuk yazılmış aynı başlık (ör. "Hıproemler" / "Hız Problemleri") tek isimde birleşir.
  const compact = (s) => (s || '').toLocaleLowerCase('tr').replace(/[^a-zçğıöşüâîû0-9]/g, '');
  // Font bozulması harf düşürür/boşluk ekler: kısa ad uzun adın alt dizisiyse aynı başlıktır.
  // ("Üslü"/"Köklü" ya da "Yaş"/"Sayı" gibi farklı konular birleşmez.)
  const isSubseq = (s, t) => { let i = 0; for (const c of t) if (c === s[i]) i++; return i === s.length; };
  const similar = (a, b) => {
    const x = compact(a), y = compact(b); if (!x || !y) return false;
    if (x === y) return true;
    const [s, t, sn, tn] = x.length <= y.length ? [x, y, a, b] : [y, x, b, a];
    if (!(s.length >= t.length * 0.6 && isSubseq(s, t))) return false;
    // kısa adın tüm kelimeleri uzun adda tam kelime olarak varsa bu ayrı bir konudur
    // ("Yüzde Problemleri" ⊂ "Yüzde ve Kâr-Zarar Problemleri"), bozulma değil
    const words = (n) => n.split(/[\s\-–]+/).map(compact).filter(Boolean);
    const tw = new Set(words(tn));
    return !words(sn).every(w => tw.has(w));
  };
  // daha uzun (harf kaybı olmayan) ve "ve/ile" ile düzgün ayrılmış ad tercih edilir
  const nameQuality = (s) => compact(s).length * 10 + ((' ' + s + ' ').match(/ (ve|ile) /g) || []).length;
  function canonKonu(pages) {
    let last = null;
    for (const p of pages) { if (!p.konu && p.key) p.konu = last; if (p.konu) last = p.konu; }
    // ardışık parçalar
    const runs = [];
    for (const p of pages) { if (!p.key) continue; const r = runs[runs.length - 1]; if (r && r.k === p.konu) r.pages.push(p); else runs.push({ k: p.konu, pages: [p] }); }
    // benzer komşuları (araya bir parça girse bile) birleştir.
    // 1. tur: sadece boşluk/işaret farkı olanlar; 2. tur: harf düşmesi olanlar.
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
    for (const r of runs) r.pages.forEach(p => { p.konu = r.k; });
    return pages;
  }
  const keyMap = (s) => Object.fromEntries((s || '').split(',').filter(Boolean).map(x => [+x.slice(0, -1), x.slice(-1)]));

  async function loadBooks() {
    BOOKS = await DB.books.all();
    const sel = $('#im-book'), cur = sel.value;
    sel.innerHTML = BOOKS.map(b => `<option value="${esc(b.id)}">${esc(b.ders)} · ${esc(b.name)}</option>`).join('') + '<option value="">Kitapsız (konuyu ben yazarım)</option>';
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
      const nq = Q.filter(q => q.bookId === b.id).length;
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
      await DB.books.del(b.id); await DB.bookfiles.del(b.id); bookPdfCache.delete(b.id); await loadBooks();
    }
    if (act === 'konu') openKonuEditor(b);
  });
  function openKonuEditor(b) {
    const runs = konuRuns(b), names = [...new Set(runs.map(r => r.k))];
    openModal(`<div class="row between"><b>${esc(b.name)} — konu adları</b><button data-close>Kapat</button></div>
      <p class="muted">Sayfa başlıklarından okunan adlar. Yanlış okunan varsa düzelt; aynı adı verdiğin bölümler birleşir. Kayıtlı soruların konusu da güncellenir.</p>
      <table class="topics"><thead><tr><th>Sayfalar</th><th>Konu</th></tr></thead><tbody>
      ${names.map((k, i) => `<tr><td class="muted">${runs.filter(r => r.k === k).map(r => r.from === r.to ? r.from : r.from + '–' + r.to).join(', ')}</td>
        <td><input data-i="${i}" value="${esc(k || '')}" style="width:100%"></td></tr>`).join('')}
      </tbody></table>
      <div class="row between" style="margin-top:12px"><span></span><button id="ke-save" class="primary">Kaydet</button></div>`);
    $('#ke-save').onclick = async () => {
      const map = new Map(names.map((k, i) => [k, $(`#modal-box input[data-i="${i}"]`).value.trim() || k]));
      b.pages.forEach(p => { if (map.has(p.konu)) p.konu = map.get(p.konu); });
      await DB.books.put(b);
      const qs = Q.filter(q => q.bookId === b.id && map.has(q.konu) && map.get(q.konu) !== q.konu).map(q => ({ ...q, konu: map.get(q.konu) }));
      if (qs.length) await DB.putMany(qs);
      closeModal(); await reload(); await loadBooks(); toast('Konu adları kaydedildi.');
    };
  }

  $('#ba-run').addEventListener('click', async () => {
    const f = $('#ba-file').files[0], ders = $('#ba-ders').value.trim(), name = $('#ba-name').value.trim();
    if (!f) return toast('Kitabın PDF dosyasını seç.');
    if (!ders || !name) return toast('Ders ve kitap adını yaz.');
    const st = $('#ba-status'); $('#ba-run').disabled = true;
    try {
      const buf = await f.arrayBuffer();
      const blob = new Blob([buf], { type: 'application/pdf' });
      const pdf = await Detect.loadPdf(buf.slice(0));
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (p % 10 === 1) { st.textContent = `Sayfa ${p} / ${pdf.numPages} okunuyor…`; await new Promise(r => setTimeout(r, 0)); }
        pages.push(await Detect.indexPage(pdf, p));
      }
      canonKonu(pages);
      const id = 'b' + Date.now();
      const book = { id, ders, name, kaynak: name, fileName: f.name, size: f.size, numPages: pdf.numPages, pages, created: Date.now(), hasFile: false };
      try { await DB.bookfiles.put({ id, blob }); book.hasFile = true; } catch (e) { console.warn('Kitap PDF saklanamadı', e); }
      await DB.books.put(book);
      bookPdfCache.set(id, pdf);
      const testPages = pages.filter(p => p.key).length;
      st.textContent = `Eklendi: ${testPages} soru sayfası, ${new Set(pages.map(p => p.konu).filter(Boolean)).size} konu.${book.hasFile ? '' : ' (Cihazda yer yetmediği için PDF saklanmadı; bölüm eklerken kitabı seçmen istenecek.)'}`;
      resetFile('#ba-file'); $('#bk-add-box').open = false;
      await loadBooks(); $('#im-book').value = id; updateImportForm();
      if (!testPages) toast('Uyarı: bu PDF\'te cevap anahtarı olan sayfa bulunamadı. Taranmış (resim) bir PDF olabilir.', 6000);
    } catch (e) { console.error(e); st.textContent = 'Hata: ' + e.message; }
    finally { $('#ba-run').disabled = false; }
  });

  function updateImportForm() {
    const b = BOOKS.find(x => x.id === $('#im-book').value);
    $('#im-nobook').classList.toggle('hidden', !!b);
    $('#im-bookfile-wrap').classList.toggle('hidden', !b || b.hasFile || bookPdfCache.has(b.id));
  }
  $('#im-book').addEventListener('change', updateImportForm);

  async function getBookPdf(b) {
    if (bookPdfCache.has(b.id)) return bookPdfCache.get(b.id);
    let buf = null;
    if (b.hasFile) { const r = await DB.bookfiles.get(b.id); if (r && r.blob) buf = await r.blob.arrayBuffer(); }
    if (!buf) { const f = $('#im-bookfile').files[0]; if (!f) throw new Error('Bu kitabın PDF\'i cihazda yok. "Kitap PDF\'i" alanından seç.'); buf = await f.arrayBuffer(); }
    const pdf = await Detect.loadPdf(buf);
    bookPdfCache.set(b.id, pdf);
    return pdf;
  }

  $('#im-run').addEventListener('click', async () => {
    const f = $('#im-file').files[0];
    const book = BOOKS.find(x => x.id === $('#im-book').value) || null;
    const ders = book ? book.ders : $('#im-ders').value.trim(), kaynak = book ? book.kaynak : $('#im-kaynak').value.trim(), manualKonu = $('#im-konu').value.trim();
    if (!f) return toast('Önce işaretli PDF dosyasını seç.');
    if (!book && !ders) return toast('Ders yaz (ya da bir kitap seç).');
    const status = $('#im-status');
    $('#im-run').disabled = true; $('#im-review').classList.add('hidden');
    try {
      const pdf = await Detect.loadPdf(await f.arrayBuffer());
      const bookPdf = book ? await getBookPdf(book) : null;
      const items = []; let unmatched = 0;
      for (let p = 1; p <= pdf.numPages; p++) {
        status.textContent = `Sayfa ${p} / ${pdf.numPages} taranıyor…`;
        const r = await Detect.analyzePage(pdf, p);
        const bp = book ? Detect.matchBookPage(r, book.pages) : null;
        if (book && !bp && r.questions.length) unmatched++;
        // soru görselleri yüksek çözünürlükte (iPad ekranında net görünsün diye) yeniden çizilir
        // Sadece işaretli sorular hemen yüksek çözünürlükte kesilir; diğerleri önizleme kalitesinde
        // tutulur ve elle seçilirse kaydederken yüksek çözünürlükte yeniden kesilir (bellek tasarrufu).
        const off = bp ? Detect.alignOffset(r.questions, bp.nums) : { dx: 0, dy: 0 };
        const srcPdf = bp ? bookPdf : pdf, srcPage = bp ? bp.p : p;
        const anyPicked = r.questions.some(q => q.wrong || q.star);
        const hq = anyPicked ? (await Detect.renderPage(srcPdf, srcPage, Detect.HQ_WIDTH)).canvas : null;
        const lo = bp ? (await Detect.renderPage(bookPdf, bp.p)).canvas : r.canvas;
        const k = hq ? hq.width / r.canvas.width : 1;
        const bkey = bp ? keyMap(bp.key) : {};
        const konu = (bp && bp.konu) || r.konu || manualKonu || 'Diğer';
        const test = bp ? bp.test : r.test, printed = bp ? bp.printed : r.printed;
        for (const q of r.questions) {
          const base = { x: q.box.x + off.dx, y: q.box.y + off.dy, w: q.box.w, h: q.box.h };
          const picked = q.wrong || q.star;
          const img = picked && hq ? Detect.crop(hq, { x: base.x * k, y: base.y * k, w: base.w * k, h: base.h * k }) : Detect.crop(lo, base, 700);
          items.push({
            hq: picked && !!hq, regen: { fromBook: !!bp, page: srcPage, box: base },
            id: bp ? `${book.id}|${bp.p}|${q.n}` : [ders, kaynak, konu, test != null ? 'T' + test : f.name + '#p' + p, q.n].join('|'),
            bookId: bp ? book.id : null, bookPage: bp ? bp.p : null, clean: !!bp,
            ders, kaynak, konu, test, printed, no: q.n, page: p, file: f.name,
            img, answer: q.answer || bkey[q.n] || null, wrong: q.wrong, star: q.star,
            include: q.wrong || q.star, detected: q.wrong || q.star
          });
        }
        for (const c of [r.canvas, hq, lo]) if (c) c.width = c.height = 0;
        await new Promise(res => setTimeout(res, 0));
      }
      IM = { items, pdf, bookPdf };
      const nW = items.filter(i => i.wrong).length, nS = items.filter(i => i.star).length, noKey = items.filter(i => i.include && !i.answer).length;
      status.textContent = `${pdf.numPages} sayfada ${items.length} soru bulundu.` + (unmatched ? ` ${unmatched} sayfa kitapta eşleşmedi; o sayfaların soruları işaretli halinden kesildi.` : '');
      $('#im-summary').innerHTML = `<b>${nW}</b> yanlış, <b>${nS}</b> yıldızlı soru tespit edildi${noKey ? ` · ${noKey} sorunun cevabı okunamadı (seçebilirsin)` : ''}. Kontrol et, gerekirse düzelt, sonra kaydet.`;
      renderImport();
      $('#im-review').classList.remove('hidden');
    } catch (e) {
      console.error(e); status.textContent = 'Hata: ' + e.message;
    } finally { $('#im-run').disabled = false; }
  });

  $('#im-showall').addEventListener('change', renderImport);
  function renderImport() {
    const all = $('#im-showall').checked;
    const list = IM.items.filter(i => all || i.detected);
    $('#im-cards').innerHTML = list.length ? list.map(i => {
      const idx = IM.items.indexOf(i), exists = Q.some(q => q.id === i.id);
      return `<div class="card ${i.include ? '' : 'off'}" data-idx="${idx}">
        <img src="${i.img}" data-zoom="${idx}" alt="">
        <div class="body">
          <div><b>${esc(i.konu)}</b> · ${esc(qLabel(i))}</div>
          <div class="muted">${i.clean ? 'temiz kitaptan' : '<span style="color:var(--star)">işaretli sayfadan (kitapta eşleşmedi)</span>'}${exists ? ' · zaten kayıtlı (güncellenir)' : ''}</div>
          <div class="chips">
            <button class="chip wrong ${i.wrong ? 'on' : ''}" data-t="wrong">✗ Yanlış</button>
            <button class="chip star ${i.star ? 'on' : ''}" data-t="star">★ Yıldız</button>
            <span class="chip">Cevap <select data-t="ans"><option value="">?</option>${LETTERS.map(l => `<option ${i.answer === l ? 'selected' : ''}>${l}</option>`).join('')}</select></span>
          </div>
        </div></div>`;
    }).join('') : '<p class="muted">İşaretli soru bulunamadı. "İşaretsizleri de göster" ile soruları elle seçebilirsin.</p>';
    updateImportSave();
  }
  function updateImportSave() { const n = IM.items.filter(i => i.include).length; $('#im-save').textContent = `Kaydet (${n} soru)`; $('#im-save').disabled = !n; }
  $('#im-cards').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const it = IM.items[+card.dataset.idx];
    const z = e.target.closest('[data-zoom]'); if (z) return openImage(it.img, qLabel(it));
    const b = e.target.closest('button.chip'); if (!b) return;
    it[b.dataset.t] = !it[b.dataset.t];
    it.include = it.wrong || it.star;
    b.classList.toggle('on', it[b.dataset.t]); card.classList.toggle('off', !it.include);
    updateImportSave();
  });
  $('#im-cards').addEventListener('change', e => {
    if (e.target.dataset.t !== 'ans') return;
    IM.items[+e.target.closest('.card').dataset.idx].answer = e.target.value || null;
  });
  $('#im-save').addEventListener('click', async () => {
    const sel = IM.items.filter(i => i.include);
    const now = Date.now();
    // elle seçilen (önizleme kalitesindeki) soruları yüksek çözünürlükte yeniden kes
    const need = sel.filter(i => !i.hq);
    if (need.length) {
      $('#im-save').disabled = true;
      const byPage = new Map();
      need.forEach(i => { const key = (i.regen.fromBook ? 'b' : 'm') + i.regen.page; (byPage.get(key) || byPage.set(key, []).get(key)).push(i); });
      for (const list of byPage.values()) {
        const g = list[0].regen;
        const cv = (await Detect.renderPage(g.fromBook ? IM.bookPdf : IM.pdf, g.page, Detect.HQ_WIDTH)).canvas;
        const k = cv.width / Detect.RENDER_WIDTH;
        list.forEach(i => { const b = i.regen.box; i.img = Detect.crop(cv, { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }); i.hq = true; });
        cv.width = cv.height = 0;
      }
      $('#im-save').disabled = false;
    }
    const out = sel.map(i => {
      const old = Q.find(q => q.id === i.id);
      const base = { id: i.id, bookId: i.bookId, bookPage: i.bookPage, ders: i.ders, kaynak: i.kaynak, konu: i.konu, test: i.test, printed: i.printed, no: i.no, page: i.page, file: i.file, img: i.img, answer: i.answer || (old && old.answer) || null, wrong: i.wrong, star: i.star };
      return old ? { ...old, ...base, wrong: old.wrong || i.wrong, star: old.star || i.star } : { ...base, box: 0, due: now, history: [], created: now };
    });
    await DB.putMany(out);
    await reload();
    toast(`${out.length} soru kaydedildi.`);
    IM = null; $('#im-review').classList.add('hidden'); $('#im-status').textContent = ''; resetFile('#im-file');
    renderBooks();
    show('study');
  });

  // =====================================================================
  // SORULAR
  // =====================================================================
  function cardSmall(q) {
    const s = stats(q);
    return `<div class="card" data-qid="${esc(q.id)}">
      <img src="${q.img}" alt="">
      <div class="body">
        <div><b>${esc(q.konu)}</b> · ${esc(qLabel(q))}</div>
        <div class="chips">
          ${q.wrong ? '<span class="chip wrong on">✗ Yanlış</span>' : ''}${q.star ? '<span class="chip star on">★</span>' : ''}
          ${isLearned(q) ? '<span class="chip learned">Öğrenildi</span>' : ''}
          <span class="chip">${s.tries} deneme · ${s.wrong} yanlış</span>
          ${s.avgMs ? `<span class="chip">ort. ${fmtSec(s.avgMs)}</span>` : ''}
        </div>
      </div></div>`;
  }
  function bindCardClicks(root) {
    root.querySelectorAll('[data-qid]').forEach(c => c.addEventListener('click', () => openQuestion(c.dataset.qid)));
  }
  function renderList() {
    const f = $('#ls-filter').value;
    let list = byFilter($('#ls-ders').value, $('#ls-konu').value);
    if (f === 'wrong') list = list.filter(q => q.wrong || stats(q).wrong);
    if (f === 'star') list = list.filter(q => q.star);
    if (f === 'due') list = list.filter(isDue);
    if (f === 'learned') list = list.filter(isLearned);
    if (f === 'noans') list = list.filter(q => !q.answer);
    list.sort((a, b) => trSort(a.konu, b.konu) || (a.test ?? 0) - (b.test ?? 0) || a.no - b.no);
    $('#ls-count').textContent = `${list.length} soru`;
    $('#ls-cards').innerHTML = list.map(cardSmall).join('') || '<p class="muted">Soru yok.</p>';
    bindCardClicks($('#ls-cards'));
  }
  $('#ls-ders').addEventListener('change', () => { refreshKonu('#ls-ders', '#ls-konu'); renderList(); });
  $('#ls-konu').addEventListener('change', renderList);
  $('#ls-filter').addEventListener('change', renderList);

  function openModal(html) { $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = ''; }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  function openImage(src, title) { openModal(`<div class="row between"><b>${esc(title)}</b><button data-close>Kapat</button></div><img src="${src}" alt="">`); }

  function openQuestion(id) {
    const q = Q.find(x => x.id === id); if (!q) return;
    const s = stats(q);
    const hist = (q.history || []).slice().reverse().map(h => `<div>${new Date(h.t).toLocaleString('tr-TR')} — ${h.c} ${h.ok ? '✓' : '✗'} (${fmtSec(h.ms)})</div>`).join('') || 'Henüz çözülmedi.';
    openModal(`
      <div class="row between"><b>${esc(q.ders)} · ${esc(q.kaynak)} · ${esc(qLabel(q))}</b><button data-close>Kapat</button></div>
      <img src="${q.img}" alt="">
      <div class="row">
        <label>Konu <input id="md-konu" value="${esc(q.konu)}" list="dl-konu"></label>
        <label>Doğru cevap <select id="md-ans"><option value="">?</option>${LETTERS.map(l => `<option ${q.answer === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="inline"><input type="checkbox" id="md-wrong" ${q.wrong ? 'checked' : ''}> Yanlış</label>
        <label class="inline"><input type="checkbox" id="md-star" ${q.star ? 'checked' : ''}> Yıldızlı</label>
      </div>
      <p class="muted">${s.tries} deneme · ${s.wrong} yanlış · ort. süre ${fmtSec(s.avgMs)} · kutu ${q.box || 0}/${INTERVALS.length - 1} · sıradaki tekrar ${isDue(q) ? 'şimdi' : new Date(q.due).toLocaleDateString('tr-TR')}</p>
      <details><summary>Geçmiş</summary><div class="hist">${hist}</div></details>
      <div class="row between" style="margin-top:12px">
        <div class="row"><button id="md-del" class="danger">Sil</button><button id="md-reset">İstatistiği sıfırla</button></div>
        <button id="md-save" class="primary">Kaydet</button>
      </div>`);
    $('#md-save').onclick = async () => {
      q.konu = $('#md-konu').value.trim() || q.konu; q.answer = $('#md-ans').value || null;
      q.wrong = $('#md-wrong').checked; q.star = $('#md-star').checked;
      await DB.put(q); closeModal(); await reload(); renderList(); toast('Kaydedildi.');
    };
    $('#md-del').onclick = async () => { if (!confirm('Bu soru silinsin mi?')) return; await DB.del(q.id); closeModal(); await reload(); renderList(); };
    $('#md-reset').onclick = async () => { if (!confirm('Bu sorunun çözüm geçmişi sıfırlansın mı?')) return; q.history = []; q.box = 0; q.due = Date.now(); await DB.put(q); closeModal(); await reload(); renderList(); };
  }

  // =====================================================================
  // ANALİZ
  // =====================================================================
  $('#sa-ders').addEventListener('change', renderStats);
  function renderStats() {
    const list = byFilter($('#sa-ders').value, '');
    const H = list.flatMap(q => q.history || []);
    const right = H.filter(h => h.ok).length;
    const times = H.map(h => h.ms).filter(Boolean);
    const tile = (v, k) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    $('#sa-tiles').innerHTML =
      tile(list.length, 'Toplam soru') +
      tile(list.filter(isDue).length, 'Tekrarı gelen') +
      tile(list.filter(isLearned).length, 'Öğrenilen') +
      tile(H.length, 'Toplam deneme') +
      tile(H.length ? Math.round(right / H.length * 100) + '%' : '–', 'Tekrarda doğruluk') +
      tile(times.length ? fmtSec(times.reduce((a, b) => a + b, 0) / times.length) : '–', 'Ort. çözüm süresi');

    // konu bazında
    const groups = {};
    for (const q of list) {
      const key = q.ders + ' › ' + q.konu;
      const g = groups[key] ||= { ders: q.ders, konu: q.konu, n: 0, marked: 0, star: 0, tries: 0, wrong: 0, ms: [], learned: 0 };
      const s = stats(q);
      g.n++; if (q.wrong) g.marked++; if (q.star) g.star++; if (isLearned(q)) g.learned++;
      g.tries += s.tries; g.wrong += s.wrong; (q.history || []).forEach(h => h.ms && g.ms.push(h.ms));
    }
    const rows = Object.values(groups).map(g => ({ ...g, rate: g.tries ? g.wrong / g.tries : null, avg: g.ms.length ? g.ms.reduce((a, b) => a + b, 0) / g.ms.length : null }))
      .sort((a, b) => (b.wrong + b.marked) - (a.wrong + a.marked) || (b.rate ?? 0) - (a.rate ?? 0));
    $('#sa-topics').innerHTML = rows.length ? `<table class="topics">
      <thead><tr><th>Konu</th><th class="num">Soru</th><th class="num">İlk yanlış</th><th class="num">Tekrar yanlış</th><th>Hata oranı (tekrarda)</th><th class="num">Ort. süre</th><th class="num">Öğrenilen</th></tr></thead>
      <tbody>${rows.map(g => `<tr>
        <td><b>${esc(g.konu)}</b><br><small>${esc(g.ders)}</small></td>
        <td class="num">${g.n}</td><td class="num">${g.marked}</td><td class="num">${g.wrong} / ${g.tries}</td>
        <td><div class="bar-cell"><div class="bar" title="${g.wrong} yanlış / ${g.tries} deneme"><i style="width:${Math.round((g.rate ?? 0) * 100)}%"></i></div><span>${g.rate == null ? '–' : Math.round(g.rate * 100) + '%'}</span></div></td>
        <td class="num">${fmtSec(g.avg)}</td><td class="num">${g.learned} / ${g.n}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Henüz veri yok.</p>';

    const worst = list.filter(q => stats(q).wrong > 0).sort((a, b) => stats(b).wrong - stats(a).wrong || weakness(b) - weakness(a)).slice(0, 12);
    $('#sa-worst').innerHTML = worst.map(cardSmall).join('') || '<p class="muted">Tekrarlarda henüz yanlış yok.</p>';
    bindCardClicks($('#sa-worst'));
  }

  // =====================================================================
  // YEDEK
  // =====================================================================
  $('#bk-export').addEventListener('click', async () => {
    // kitap PDF'leri yedeğe girmez (büyük); sadece sayfa dizinleri
    const books = (await DB.books.all()).map(b => ({ ...b, hasFile: false }));
    const data = JSON.stringify({ app: 'soru-tekrar', v: 2, exported: Date.now(), questions: await DB.all(), books });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `soru-tekrar-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    $('#bk-status').textContent = `${Q.length} soru dışa aktarıldı.`;
  });
  $('#bk-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.questions)) throw new Error('Geçersiz yedek dosyası');
      // birleştir: aynı soru varsa geçmişleri birleştir
      const merged = d.questions.map(n => {
        const o = Q.find(q => q.id === n.id); if (!o) return n;
        const hs = new Map([...(o.history || []), ...(n.history || [])].map(h => [h.t + '|' + h.c, h]));
        const history = [...hs.values()].sort((a, b) => a.t - b.t);
        const newer = (n.history || []).length >= (o.history || []).length ? n : o;
        return { ...o, ...n, history, box: newer.box, due: newer.due };
      });
      await DB.putMany(merged);
      let nb = 0;
      for (const b of d.books || []) {
        const old = BOOKS.find(x => x.id === b.id);
        await DB.books.put(old ? { ...b, hasFile: old.hasFile } : b); nb++;
      }
      await reload(); await loadBooks();
      $('#bk-status').textContent = `${merged.length} soru${nb ? `, ${nb} kitap dizini` : ''} içe aktarıldı.` + (d.books && d.books.some(b => !BOOKS.find(x => x.id === b.id && x.hasFile)) ? ' Yeni bölüm eklerken kitap PDF\'ini bu cihazda bir kez seçmen gerekecek.' : '');
    } catch (err) { $('#bk-status').textContent = 'Hata: ' + err.message; }
    e.target.value = '';
  });
  $('#bk-wipe').addEventListener('click', async () => {
    if (!confirm('Tüm sorular, geçmiş ve kitaplar silinecek. Emin misin?')) return;
    await DB.clear(); await DB.books.clear(); await DB.bookfiles.clear(); bookPdfCache.clear();
    await reload(); await loadBooks(); toast('Tüm veriler silindi.');
  });

  // başlat
  // dosya seçici: seçilen dosyanın adını göster
  document.addEventListener('change', e => {
    if (!e.target.matches('.file input[type=file]')) return;
    const wrap = e.target.closest('.file'), f = e.target.files[0];
    wrap.querySelector('.fname').textContent = f ? f.name : 'Seçilmedi';
    wrap.classList.toggle('has', !!f);
  });
  // programla temizlenen dosya alanlarının etiketini sıfırla
  const resetFile = (sel) => { const i = $(sel); i.value = ''; const w = i.closest('.file'); if (w) { w.classList.remove('has'); w.querySelector('.fname').textContent = 'Seçilmedi'; } };
  window.__resetFile = resetFile;

  async function showUsage() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const e = await navigator.storage.estimate();
    const mb = (x) => (x / 1048576).toFixed(0) + ' MB';
    $('#bk-usage').textContent = `Kullanılan alan: ${mb(e.usage || 0)} / izin verilen yaklaşık ${mb(e.quota || 0)}.`;
  }
  $('#tabs').addEventListener('click', e => { if (e.target.closest('[data-view=backup]')) showUsage(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  reload().then(loadBooks).then(() => { show('study'); if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); });
  window.__app = { reload, loadBooks, get Q() { return Q; }, get BOOKS() { return BOOKS; } };
})();
