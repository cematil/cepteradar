// Cepte Radar — topluluk bildirimleri (Firebase Firestore).
// Sürücüler bulundukları yere tek dokunuşla bildirim bırakır (kaza, tehlike, yol çalışması…);
// bildirimler 1 saat görünür, diğer sürücüler "Hâlâ orada mı?" sorusuna Evet/Hayır der.
// Firebase ayarı (js/firebase-ayar.js) yoksa bu özellik tamamen gizli kalır, uygulamanın geri kalanı etkilenmez.
(function () {
  'use strict';

  const TURLER = {
    kaza: { icon: '💥', ad: 'Kaza' },
    tehlike: { icon: '⚠️', ad: 'Yolda tehlike' },
    calisma: { icon: '🚧', ad: 'Yol çalışması' },
    yogunluk: { icon: '🚗', ad: 'Trafik yoğunluğu' },
    ariza: { icon: '🛑', ad: 'Yolda duran araç' },
    polis: { icon: '👮', ad: 'Polis kontrolü' },
  };
  const OMUR_DK = 60;
  const OY_KEY = 'cepteradar:oylarim';

  const CR = () => window.CepteRadar;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ geohash (4 karakter ≈ 20×40 km hücre)
  const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  function geohash(lat, lon, len = 4) {
    let latR = [-90, 90], lonR = [-180, 180], bit = 0, ch = 0, even = true, out = '';
    while (out.length < len) {
      const r = even ? lonR : latR, v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
      if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
      even = !even;
      if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
    }
    return out;
  }
  // Bir noktanın hücresi ve 8 komşusu
  function cellsAround(lat, lon) {
    const set = new Set();
    for (const dLat of [-0.18, 0, 0.18]) for (const dLon of [-0.36, 0, 0.36]) set.add(geohash(lat + dLat, lon + dLon));
    return [...set];
  }
  function cellsInBounds(b) {
    const set = new Set();
    for (let lat = b.getSouth(); lat <= b.getNorth() + 0.18; lat += 0.17) {
      for (let lon = b.getWest(); lon <= b.getEast() + 0.36; lon += 0.34) set.add(geohash(Math.min(lat, b.getNorth()), Math.min(lon, b.getEast())));
      if (set.size > 60) return null; // çok geniş görünüm: sorgulanmaz
    }
    return [...set];
  }

  // ------------------------------------------------------------------ arka uç (Firebase)
  let api = null;       // { watch(cells, cb) -> unsubscribe, add(tur, lat, lon), vote(id, evet) }
  async function firebaseApi(cfg) {
    const [{ initializeApp }, { getAuth, signInAnonymously, connectAuthEmulator }, fs] = await Promise.all([
      import(new URL('vendor/firebase/firebase-app.js', document.baseURI).href),
      import(new URL('vendor/firebase/firebase-auth.js', document.baseURI).href),
      import(new URL('vendor/firebase/firebase-firestore.js', document.baseURI).href),
    ]);
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    const db = fs.getFirestore(app);
    if (cfg.emulator) { // yalnızca yerel testler için
      connectAuthEmulator(auth, `http://${cfg.emulator}:9099`, { disableWarnings: true });
      fs.connectFirestoreEmulator(db, cfg.emulator, 8080);
    }
    const user = async () => auth.currentUser || (await signInAnonymously(auth)).user;
    const bitis = () => fs.Timestamp.fromMillis(Date.now() + OMUR_DK * 60000);
    return {
      uid: () => auth.currentUser && auth.currentUser.uid,
      watch(cells, cb) {
        const subs = [];
        const parts = new Map();
        for (let i = 0; i < cells.length; i += 30) {
          const key = i;
          const q = fs.query(fs.collection(db, 'bildirimler'), fs.where('g4', 'in', cells.slice(i, i + 30)));
          subs.push(fs.onSnapshot(q, (snap) => {
            parts.set(key, snap.docs.map((d) => {
              const x = d.data();
              return { id: d.id, tur: x.tur, lat: x.lat, lon: x.lon, uid: x.uid, evet: x.evet || 0, hayir: x.hayir || 0,
                olusturma: x.olusturma ? x.olusturma.toMillis() : Date.now(), bitis: x.bitis ? x.bitis.toMillis() : 0 };
            }));
            cb([].concat(...parts.values()));
          }, () => { /* çevrimdışı vb. — sessizce bekle */ }));
        }
        return () => subs.forEach((u) => u());
      },
      async add(tur, lat, lon) {
        const u = await user();
        const b = fs.writeBatch(db);
        b.set(fs.doc(fs.collection(db, 'bildirimler')), {
          tur, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, g4: geohash(lat, lon),
          olusturma: fs.serverTimestamp(), bitis: bitis(), uid: u.uid, evet: 0, hayir: 0,
        });
        b.set(fs.doc(db, 'kullanicilar', u.uid), { son: fs.serverTimestamp() });
        await b.commit();
      },
      async vote(id, evet) {
        const u = await user();
        const b = fs.writeBatch(db);
        b.set(fs.doc(db, 'bildirimler', id, 'oylar', u.uid), { evet, silinme: fs.Timestamp.fromMillis(Date.now() + 120 * 60000) });
        b.update(fs.doc(db, 'bildirimler', id), evet ? { evet: fs.increment(1), bitis: bitis() } : { hayir: fs.increment(1) });
        await b.commit();
      },
    };
  }

  // ------------------------------------------------------------------ durum
  let reports = [];            // görünen bildirimler
  let unwatch = null;
  let watchedKey = '';
  let layer = null;
  let lastFix = null;          // sürüşteki son konum
  let driving = false;
  const asked = new Set();     // "Hâlâ orada mı?" sorulanlar
  let myVotes = {};
  try { myVotes = JSON.parse(localStorage.getItem(OY_KEY) || '{}'); } catch (e) { myVotes = {}; }
  const saveVote = (id, v) => { myVotes[id] = v; try { localStorage.setItem(OY_KEY, JSON.stringify(myVotes)); } catch (e) { /* gizli mod */ } };

  // Süresi dolan ya da çoğunluk "artık yok" diyen bildirimler gösterilmez.
  const visible = (r) => r.bitis > Date.now() && !(r.hayir >= 2 && r.hayir > r.evet) && TURLER[r.tur];

  function ago(ms) {
    const dk = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return dk < 1 ? 'az önce' : `${dk} dk önce`;
  }

  function popupHtml(r) {
    const t = TURLER[r.tur];
    const mine = api && api.uid && api.uid() === r.uid;
    const voted = myVotes[r.id];
    const buttons = mine ? '<small>Bu sizin bildiriminiz.</small>'
      : voted != null ? `<small>Oyunuz alındı: ${voted ? 'Hâlâ orada' : 'Artık yok'}.</small>`
        : `<div class="bld-oy"><button type="button" data-oy="1" data-id="${r.id}">✅ Hâlâ orada</button><button type="button" data-oy="0" data-id="${r.id}">❌ Artık yok</button></div>`;
    return `<b>${t.icon} ${t.ad}</b><br><small>Kullanıcı bildirimi · ${ago(r.olusturma)} · 👍 ${r.evet} · 👎 ${r.hayir}</small>${buttons}`;
  }

  function draw() {
    const cr = CR();
    if (!cr || !cr.map) return;
    if (!layer) layer = L.layerGroup().addTo(cr.map);
    layer.clearLayers();
    reports.filter(visible).forEach((r) => {
      L.marker([r.lat, r.lon], { icon: cr.symIcon(cr.SYM.bildirim(TURLER[r.tur].icon), 30), zIndexOffset: 700 })
        .bindPopup(() => popupHtml(r)).addTo(layer);
    });
  }

  function setCells(cells) {
    if (!api || !cells || !cells.length) return;
    const key = cells.slice().sort().join(',');
    if (key === watchedKey) return;
    watchedKey = key;
    if (unwatch) unwatch();
    unwatch = api.watch(cells, (list) => { reports = list; draw(); });
  }

  // ------------------------------------------------------------------ arayüz
  function buildUi() {
    const host = $('map-container');
    if (!host) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bildir-btn';
    btn.innerHTML = '<span>⚠️</span>Bildir';
    btn.setAttribute('aria-label', 'Bulunduğunuz yere bildirim bırakın');
    btn.addEventListener('click', openPanel);
    host.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'modal hidden';
    panel.id = 'bildir-panel';
    panel.innerHTML = `<div class="modal-box bildir-kutu">
      <h2>Ne var?</h2>
      <p class="muted small">Bildiriminiz bulunduğunuz konuma bırakılır ve 1 saat boyunca diğer sürücülere görünür.</p>
      <div class="bildir-turler">${Object.entries(TURLER).map(([k, t]) => `<button type="button" data-tur="${k}"><span>${t.icon}</span>${t.ad}</button>`).join('')}</div>
      <button type="button" class="btn btn-ghost bildir-iptal">Vazgeç</button>
    </div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', (e) => {
      if (e.target === panel || e.target.closest('.bildir-iptal')) { panel.classList.add('hidden'); return; }
      const b = e.target.closest('[data-tur]');
      if (b) { panel.classList.add('hidden'); send(b.dataset.tur); }
    });

    const soru = document.createElement('div');
    soru.className = 'bld-soru hidden';
    soru.id = 'bld-soru';
    host.appendChild(soru);
    soru.addEventListener('click', (e) => {
      const b = e.target.closest('[data-oy]');
      if (b) { vote(b.dataset.id, b.dataset.oy === '1'); soru.classList.add('hidden'); }
    });

    // Harita açılır penceresindeki oy düğmeleri
    host.addEventListener('click', (e) => {
      const b = e.target.closest('.bld-oy [data-oy]');
      if (!b) return;
      vote(b.dataset.id, b.dataset.oy === '1');
      CR().map.closePopup();
    });
  }

  function openPanel() {
    $('bildir-panel').classList.remove('hidden');
  }

  function position() {
    if (lastFix && Date.now() - lastFix.t < 30000) return Promise.resolve(lastFix);
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('konum yok')); return; }
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
  }

  // İlk bildirimden önce bir kez: verinin nerede, ne kadar saklandığı ve kimlere görüneceği (KVKK açık rıza).
  const RIZA_KEY = 'cepteradar:bildirim-riza';
  function reportConsent() {
    try { if (localStorage.getItem(RIZA_KEY) === '1') return Promise.resolve(true); } catch (e) { /* gizli mod */ }
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'modal';
      box.innerHTML = `<div class="modal-box konum-onay">
        <h2>📣 Bildirim paylaşımı</h2>
        <p>Bildiriminiz; <b>türü, bulunduğunuz konum ve zamanı</b> ile birlikte, isimsiz bir cihaz kimliği kullanılarak
        <b>Google Firebase</b> sunucularında (Avrupa Birliği) saklanır ve <b>1 saat</b> boyunca diğer sürücülere haritada gösterilir.
        Süresi dolan bildirimler otomatik silinir. Adınız, telefonunuz veya gittiğiniz yol kaydedilmez.</p>
        <p>Devam ederek bu bilgilerin yurt dışındaki sunucularda bu amaçla işlenmesine açık rıza vermiş olursunuz.
        Ayrıntılar: <a href="gizlilik.html" target="_blank" rel="noopener">Gizlilik Politikası</a>.</p>
        <div class="konum-onay-btn">
          <button type="button" class="btn btn-ghost" data-cevap="0">Vazgeç</button>
          <button type="button" class="btn btn-primary" data-cevap="1">Kabul ediyorum</button>
        </div></div>`;
      document.body.appendChild(box);
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cevap]');
        if (!b) return;
        const ok = b.dataset.cevap === '1';
        if (ok) try { localStorage.setItem(RIZA_KEY, '1'); } catch (err) { /* gizli mod */ }
        box.remove();
        resolve(ok);
      });
    });
  }

  async function send(tur) {
    const cr = CR();
    if (!(await reportConsent())) return;
    if (cr.locationConsent && !(await cr.locationConsent())) return;
    try {
      const p = await position();
      if (p.acc && p.acc > 200) { cr.toast('Konumunuz yeterince hassas değil; biraz sonra tekrar deneyin.'); return; }
      await api.add(tur, p.lat, p.lon);
      setCells(cellsAround(p.lat, p.lon));
      cr.toast(`${TURLER[tur].icon} Bildiriminiz alındı. Teşekkürler! 1 saat görünecek.`);
    } catch (e) {
      const msg = String(e && (e.code || e.message) || '');
      if (/permission/i.test(msg)) cr.toast('Çok sık bildirim yapıldı. Lütfen 2 dakika sonra tekrar deneyin.');
      else if (/geolocation|konum|denied|1/.test(msg) && !/firestore/i.test(msg)) cr.toast('Konum alınamadı. Konum izninizi kontrol edin.');
      else cr.toast('Bildirim gönderilemedi. İnternet bağlantınızı kontrol edin.');
    }
  }

  async function vote(id, evet) {
    if (myVotes[id] != null) return;
    if (!(await reportConsent())) return;
    try {
      await api.vote(id, evet);
      saveVote(id, evet);
      CR().toast(evet ? '✅ Teşekkürler, bildirim süresi uzatıldı.' : '❌ Teşekkürler, bildirildi.');
    } catch (e) {
      CR().toast('Oy gönderilemedi.');
    }
  }

  // ------------------------------------------------------------------ app.js bağlantıları
  // Sürüşte yaklaşılan bildirimler için uyarı noktaları (app.js aşamalı uyarı sistemine eklenir)
  function warnPoints() {
    return reports.filter(visible).map((r) => ({
      key: `bld:${r.id}`, type: 'bildirim', icon: TURLER[r.tur].icon, coords: [r.lat, r.lon],
      what: `kullanıcı bildirimi, ${TURLER[r.tur].ad.toLocaleLowerCase('tr')}`, extra: '', note: ago(r.olusturma), stages: [1000, 300],
    }));
  }

  // Sürüşte konum güncellemesi: çevredeki hücreleri izle; bildirimin yanından geçerken "Hâlâ orada mı?" sor.
  function update(lat, lon) {
    driving = true;
    lastFix = { lat, lon, t: Date.now() };
    setCells(cellsAround(lat, lon));
    const near = reports.filter(visible).find((r) => !asked.has(r.id) && myVotes[r.id] == null
      && !(api.uid && api.uid() === r.uid) && L.latLng(lat, lon).distanceTo([r.lat, r.lon]) < 120);
    if (!near) return;
    asked.add(near.id);
    const t = TURLER[near.tur];
    const soru = $('bld-soru');
    soru.innerHTML = `<b>${t.icon} ${t.ad} hâlâ orada mı?</b><div class="bld-oy"><button type="button" data-oy="1" data-id="${near.id}">✅ Evet</button><button type="button" data-oy="0" data-id="${near.id}">❌ Hayır</button></div>`;
    soru.classList.remove('hidden');
    clearTimeout(soru._t);
    soru._t = setTimeout(() => soru.classList.add('hidden'), 15000);
  }

  function stop() { driving = false; }

  window.Topluluk = { warnPoints, update, stop, geohash, TURLER };

  // ------------------------------------------------------------------ başlatma
  async function init() {
    const cfg = window.CEPTE_FIREBASE;
    const fake = window.__TOPLULUK_SAHTE; // testler için sahte arka uç
    if (!cfg && !fake) return;
    try {
      api = fake || await firebaseApi(cfg);
    } catch (e) {
      console.warn('Topluluk bildirimleri başlatılamadı', e);
      return;
    }
    buildUi();
    document.body.classList.add('topluluk-acik');
    const map = CR() && CR().map;
    if (!map) return;
    // Sürüş dışında: harita yeterince yakınsa görünen alandaki bildirimleri izle
    const follow = () => { if (!driving && map.getZoom() >= 8) { const c = cellsInBounds(map.getBounds()); if (c) setCells(c); } };
    map.on('moveend', follow);
    document.addEventListener('cepteradar:rota', () => setTimeout(follow, 300));
    follow();
    setInterval(draw, 60000); // "x dk önce" ve süresi dolanlar için
  }
  init();
})();
