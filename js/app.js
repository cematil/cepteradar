// Cepte Radar — ana uygulama mantığı (harita, rota sorgusu, sürüş modu).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ILLER = window.ILLER;
  const ilById = new Map(ILLER.map((il) => [il.id, il]));
  const byName = (a, b) => a.ad.localeCompare(b.ad, 'tr', { sensitivity: 'base' });
  const WARN_DISTANCE_KM = 2; // radar, koridor ve yol çalışması uyarı mesafesi
  const STORE_KEY = 'cepteradar:son-rotalar';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

  function toast(msg, ms = 3500) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function store(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* gizli mod vb. */ }
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const pathLengthKm = (coords) => coords.reduce((s, p, i) => i ? s + distanceKm(coords[i - 1][0], coords[i - 1][1], p[0], p[1]) : 0, 0);

  // a'dan b'ye pusula yönü (derece)
  function bearing(a, b) {
    const r = Math.PI / 180;
    const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  // Uyarılar sıraya alınır (aynı anda birden çok uyarı birbirini kesmesin); interrupt=true öncekileri susturur.
  function speak(text, interrupt) {
    if (!('speechSynthesis' in window)) return;
    if (interrupt) window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'tr-TR';
    window.speechSynthesis.speak(u);
  }

  // ---------------------------------------------------------------- HIZ KAMERALARI (OSM)
  const CAMERA_TYPES = {
    sabit: { label: 'Sabit hız kamerası', say: 'sabit hız kamerası', color: '#f97316' },
    ortalama: { label: 'Ortalama hız kamerası', say: 'ortalama hız tespit kamerası', color: '#eab308' },
    mobil: { label: 'Mobil radar noktası', say: 'mobil radar noktası olabilir', color: '#a855f7' },
  };
  const cameraType = (c) => CAMERA_TYPES[c.tur] || CAMERA_TYPES.sabit;
  const cameraPopup = (c) => `<b>📷 ${esc(c.ad || cameraType(c).label)}</b>` +
    `${c.ad ? `<br>${cameraType(c).label}` : ''}${c.hiz ? `<br>Hız sınırı: ${c.hiz} km/s` : ''}` +
    '<br><small>Kaynak: OpenStreetMap gönüllüleri; güncel olmayabilir.</small>';
  const cameraWarning = (c) => ({
    key: `cam:${c.id}`, type: 'kamera', coords: [c.lat, c.lon],
    say: `Dikkat! ${WARN_DISTANCE_KM} kilometre sonra ${cameraType(c).say}.${c.hiz ? ` Hız sınırı ${c.hiz}.` : ''}`,
    text: `📷 ${WARN_DISTANCE_KM} km sonra ${cameraType(c).label.toLowerCase()}${c.hiz ? ` (${c.hiz} km/s)` : ''}`,
  });

  // ---------------------------------------------------------------- HARİTA
  const streetTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const darkTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: '© Esri' });
  const map = L.map('map', { center: [39.0, 35.0], zoom: 6, layers: [streetTile], zoomControl: false });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  const KGM_URL = 'https://giscbs.kgm.gov.tr/server/rest/services/YolDurumu/YolDurumu/MapServer';
  const kgmLayer = L.esri.dynamicMapLayer({ url: KGM_URL, opacity: 0.9, layers: [0, 1, 2, 3] });

  map.on('click', (e) => {
    if (!map.hasLayer(kgmLayer)) return;
    const size = map.getSize();
    kgmLayer.identify().at(e.latlng).size([size.x, size.y]).bounds(map.getBounds()).tolerance(15)
      .run((error, fc) => {
        if (error || !fc || !fc.features || !fc.features.length) return;
        const p = fc.features[0].properties;
        L.popup().setLatLng(e.latlng).setContent(`
          <div class="popup">
            <h4>🚧 KGM Yol Durumu Bilgisi</h4>
            <div><b>Açıklama / Neden:</b> ${esc(p.nedeni || p.YOL_DURUMU || p.ACIKLAMA || p.yolunadi || 'Aktif Yol Çalışması / Kapanma')}</div>
            <div><b>Güzergah:</b> ${esc(p.yolunadi || p.YOL_ADI || 'Karayolu Hattı')}</div>
            <div><b>İl / Bölge:</b> ${esc(p.KAYNAK_ADI || p.BOLGE || 'Genel Bölge')}</div>
          </div>`).openOn(map);
      });
  });

  // Tüm Türkiye'deki hız kameraları (açılınca bir kez yüklenir)
  const allCamerasLayer = L.layerGroup();
  allCamerasLayer.on('add', async () => {
    if (allCamerasLayer.getLayers().length) return;
    (await Veri.loadCameras()).forEach((c) => {
      L.circleMarker([c.lat, c.lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: CAMERA_TYPES[c.tur]?.color || '#f97316', fillOpacity: 1 })
        .bindPopup(cameraPopup(c)).addTo(allCamerasLayer);
    });
  });
  allCamerasLayer.addTo(map); // varsayılan olarak açık
  map.attributionControl.addAttribution('Kamera konumları © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıda bulunanlar');

  L.control.layers(
    { '🗺️ Gerçek Karayolu Haritası': streetTile, '🌙 Koyu Tema Harita': darkTile },
    { '🚧 KGM Yol Çalışmaları & Kapalı Yollar': kgmLayer, '📷 Tüm Hız Kameraları (Türkiye)': allCamerasLayer },
    { position: 'topright' }
  ).addTo(map);

  const FullscreenControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'map-btn', box);
      a.href = '#';
      a.title = 'Tam Sayfa Harita';
      a.setAttribute('role', 'button');
      a.innerHTML = '⛶';
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.stop(e); toggleFullscreen(); });
      return box;
    },
  });
  map.addControl(new FullscreenControl());

  function toggleFullscreen(force) {
    const c = $('map-container');
    const on = c.classList.toggle('fullscreen-map', force);
    document.body.classList.toggle('no-scroll', on);
    setTimeout(() => map.invalidateSize(), 250);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('map-container').classList.contains('fullscreen-map')) toggleFullscreen(false);
      if (!$('legal-modal').classList.contains('hidden')) toggleLegal(false);
    }
  });

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend collapsed');
    div.innerHTML = `
      <button type="button" class="legend-toggle">Lejant ▾</button>
      <div class="legend-body">
        <div><i class="lg-line bg-blue"></i> Karayolu Rotası</div>
        <div><i class="lg-line lg-dash"></i> Hız Koridoru</div>
        <div><i class="lg-dot lg-blink bg-red"></i> Radarlı Denetim (il bazında)</div>
        <div><i class="lg-dot lg-blink" style="background:#0891b2"></i> Kontrol Noktası (il bazında)</div>
        <div><i class="lg-dot lg-blink" style="background:#f97316"></i> Hız Kamerası (gerçek konum)</div>
        <div><i class="lg-sq bg-amber"></i> Yol Çalışması / Kapanma</div>
        <div><span class="lg-emoji">🚆</span> Hemzemin Geçit / <span class="lg-emoji">🏫</span> Okul Geçidi</div>
        <div><i class="speed-limit-sign sm">82</i> Hız Limiti Tabelası</div>
        <div><i class="lg-dot lg-start"></i> Kalkış / <i class="lg-dot lg-end"></i> Varış</div>
      </div>`;
    L.DomEvent.disableClickPropagation(div);
    div.querySelector('.legend-toggle').addEventListener('click', () => div.classList.toggle('collapsed'));
    if (window.matchMedia('(min-width: 1024px)').matches) div.classList.remove('collapsed');
    return div;
  };
  legend.addTo(map);

  window.addEventListener('resize', () => setTimeout(() => map.invalidateSize(), 200));

  // ---------------------------------------------------------------- DURUM
  let routeLayers = [];
  let warnPoints = [];
  const warned = new Set();
  const warnedRoadWorks = new Set();
  let lastRoadWorkQuery = 0;
  let requestSeq = 0;

  function clearRoute() {
    routeLayers.forEach((l) => map.removeLayer(l));
    routeLayers = [];
    warnPoints = [];
    warned.clear();
    warnedRoadWorks.clear();
    lastRoadWorkQuery = 0;
  }
  const addLayer = (l) => { l.addTo(map); routeLayers.push(l); return l; };

  // ---------------------------------------------------------------- İL SEÇİMİ
  const startSel = $('start-city');
  const endSel = $('end-city');

  function fillSelect(sel, mark) {
    const current = sel.value;
    sel.innerHTML = '';
    ILLER.slice().sort(byName).forEach((il) => {
      const label = `${String(il.plaka).padStart(2, '0')} · ${il.ad}${mark && mark(il) ? '  ●' : ''}`;
      sel.appendChild(new Option(label, il.id));
    });
    if (current) sel.value = current;
  }

  // Varış listesinde, seçili kalkış ilinden verisi olan illeri "●" ile işaretler.
  async function refreshEndOptions() {
    const idx = await Veri.loadIndex();
    const from = startSel.value;
    const available = new Set([...(idx[from] || []), ...Object.keys(idx).filter((k) => (idx[k] || []).includes(from))]);
    fillSelect(endSel, (il) => available.has(il.id));
    syncDisables();
  }

  function syncDisables() {
    Array.from(endSel.options).forEach((o) => { o.disabled = o.value === startSel.value; });
    Array.from(startSel.options).forEach((o) => { o.disabled = o.value === endSel.value; });
  }

  function renderRecent() {
    const list = store(STORE_KEY, []);
    $('recent-routes').innerHTML = list.map(([a, b]) =>
      ilById.has(a) && ilById.has(b)
        ? `<button type="button" class="chip" data-route="${a}|${b}">${esc(ilById.get(a).ad)} → ${esc(ilById.get(b).ad)}</button>`
        : '').join('');
  }
  function rememberRoute(a, b) {
    const list = store(STORE_KEY, []).filter(([x, y]) => !(x === a && y === b));
    list.unshift([a, b]);
    save(STORE_KEY, list.slice(0, 4));
    renderRecent();
  }

  // ---------------------------------------------------------------- ROTA
  function setRisk(score, hasData) {
    const badge = $('risk-badge');
    $('risk-gauge').style.setProperty('--p', hasData ? score : 0);
    $('risk-score').textContent = hasData ? `%${score}` : '—';
    let level = 'none';
    if (!hasData) badge.textContent = 'VERİ YOK';
    else if (score > 65) { badge.textContent = 'YÜKSEK RİSK'; level = 'high'; }
    else if (score > 35) { badge.textContent = 'ORTA RİSK'; level = 'mid'; }
    else { badge.textContent = 'DÜŞÜK RİSK'; level = 'low'; }
    $('risk-gauge').dataset.level = level;
  }

  function setWeather(prefix, il, icon, w) {
    $(`weather-${prefix}-title`).textContent = `${icon} ${il.ad}`;
    if (!w) {
      $(`weather-${prefix}-temp`).textContent = '--°C';
      $(`weather-${prefix}-cond`).textContent = 'Hava durumu alınamadı';
      return;
    }
    $(`weather-${prefix}-temp`).textContent = `${w.icon} ${w.temp}`;
    $(`weather-${prefix}-cond`).textContent = [w.condition, w.visibility && `Görüş: ${w.visibility}`, w.wind && `Rüzgar: ${w.wind}`].filter(Boolean).join(' · ');
  }

  function renderStatus(from, to, found) {
    const el = $('data-status');
    el.classList.remove('hidden', 'notice-red', 'notice-amber', 'notice-green');
    if (!found) {
      el.classList.add('notice-amber');
      el.innerHTML = `ℹ️ <b>${esc(from.ad)} → ${esc(to.ad)}</b> rotası için İçişleri Bakanlığı radar/kontrol verisi henüz yüklenmemiş. Harita ve hava durumu gösteriliyor; radar sayıları için veri eklenmesi gerekiyor.`;
    } else if (found.reversed) {
      el.classList.add('notice-amber');
      el.innerHTML = `↔️ Bu yön için kayıt yok; aynı güzergahın <b>${esc(to.ad)} → ${esc(from.ad)}</b> yönündeki İçişleri verisi gösteriliyor.`;
    } else {
      el.classList.add('notice-green');
      const r = found.record;
      el.innerHTML = `✅ İçişleri Bakanlığı verisi: <b>${esc(r.kalkis_il)}${r.kalkis_ilce ? ' / ' + esc(r.kalkis_ilce) : ''}</b> → <b>${esc(r.varis_il)}${r.varis_ilce ? ' / ' + esc(r.varis_ilce) : ''}</b>`;
    }
  }

  function renderCorridors(list) {
    const ul = $('speed-corridors');
    if (!list.length) { ul.innerHTML = '<li class="muted small">Bu güzergahta kayıtlı hız koridoru yok.</li>'; return; }
    ul.innerHTML = list.map((c) => {
      const meta = [c.province && esc(c.province), c.length ? `${esc(c.length)} km` : ''].filter(Boolean).join(' · ');
      return `<li>
        <span class="speed-limit-sign">${toInt(c.speed_limit || c.speedLimit) || '—'}</span>
        <span class="corridor-name">${esc(c.name || 'Hız Koridoru')}${meta ? `<small class="muted">${meta}</small>` : ''}</span>
      </li>`;
    }).join('');
  }

  function renderBreakdown(list, camCounts = new Map()) {
    const box = $('city-breakdown');
    if (!list.length) { box.innerHTML = '<p class="muted small">İl bazında denetim verisi yok.</p>'; return; }
    box.innerHTML = list.map((it) => {
      const r = toInt(it.Radarli ?? it.radarli);
      const rs = toInt(it.Radarsiz ?? it.radarsiz);
      const total = r + rs;
      const cam = camCounts.get(Veri.slug(it.City || it.name)) || 0;
      return `<div class="bd-row">
        <div class="bd-head"><b>${esc(it.City || it.name || 'Bölge')}</b><span class="muted">${r} radarlı · ${rs} radarsız${cam ? ` · <span class="c-orange">${cam} kamera</span>` : ''}</span></div>
        <div class="bar">${total ? `<i class="bg-red" style="width:${(r / total) * 100}%"></i><i class="bg-cyan" style="width:${(rs / total) * 100}%"></i>` : ''}</div>
      </div>`;
    }).join('');
  }

  // Güzergah uyarı listesi (Detay bölümü): rota başından uzaklığa göre sıralı
  let alerts = [];
  let alertCum = [];
  let alertDense = [];
  function renderAlerts() {
    const ol = $('route-alerts');
    $('alerts-count').textContent = alerts.length ? `(${alerts.length})` : '';
    if (!alerts.length) { ol.innerHTML = '<li class="muted small">Bu güzergahta kayıtlı uyarı noktası yok.</li>'; return; }
    alerts.sort((a, b) => a.idx - b.idx);
    ol.innerHTML = alerts.map((a, i) => `<li data-i="${i}" tabindex="0">
      <span class="al-km">${Math.round(alertCum[a.idx] || 0)} km</span><span class="al-ico">${a.icon}</span><span class="al-text">${esc(a.text)}</span></li>`).join('');
  }
  $('route-alerts').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    const a = li && alerts[+li.dataset.i];
    if (!a) return;
    map.setView(a.coords || alertDense[a.idx], 15);
    $('panel-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // OpenStreetMap tehlike türleri
  const HAZARD_TR = {
    animal_crossing: 'hayvan geçidi', cattle: 'hayvan geçidi', deer: 'yaban hayvanı geçidi', horse_riders: 'atlı geçidi',
    curve: 'tehlikeli viraj', curves: 'tehlikeli virajlar', dangerous_curve: 'tehlikeli viraj',
    falling_rocks: 'kaya düşmesi tehlikesi', landslide: 'heyelan bölgesi', slippery: 'kaygan yol', ice: 'buzlanma tehlikesi',
    fog: 'sis bölgesi', side_winds: 'yan rüzgar', school_zone: 'okul bölgesi', children: 'çocuk geçidi',
    pedestrians: 'yaya geçidi', dangerous_junction: 'tehlikeli kavşak', junction: 'tehlikeli kavşak',
    bump: 'kasis', speed_bump: 'kasis', queues_likely: 'trafik sıkışıklığı', roadworks: 'yol çalışması',
    damaged_road: 'bozuk yol', steep_incline: 'dik yokuş', steep_decline: 'dik iniş', loose_gravel: 'gevşek malzeme',
    flooding: 'su baskını tehlikesi', low_flying_aircraft: 'alçak uçuş bölgesi', accident_area: 'kaza kara noktası',
  };
  function hazardInfo(h) {
    if (h.kind === 'tren') return { icon: '🚆', label: 'Hemzemin geçit', say: 'hemzemin geçit' };
    if (h.kind === 'okul') return { icon: '🏫', label: 'Okul geçidi', say: 'okul geçidi' };
    const first = String(h.hazard || '').split(';')[0];
    const tr = HAZARD_TR[first] || 'tehlikeli bölge';
    return { icon: '⚠️', label: tr.charAt(0).toLocaleUpperCase('tr') + tr.slice(1), say: tr };
  }

  const pinIcon = (cls) => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });

  // Güzergah boyunca OpenStreetMap tehlike noktalarını (hemzemin/okul geçidi, tehlike tabelaları,
  // güncel kameralar, hız tabelaları) yükler; rota çizildikten sonra arka planda çalışır.
  function loadHazards(seq, coords, nearestIndex, cameras) {
    const status = $('alerts-status');
    status.textContent = 'Hemzemin geçit, okul geçidi ve tehlike noktaları yükleniyor…';
    Veri.routeHazards(coords).then((list) => {
      if (seq !== requestSeq) return;
      const camIds = new Set(cameras.map((c) => c.id));
      let added = 0;
      list.forEach((h) => {
        const idx = nearestIndex([h.lat, h.lon], 0.2);
        if (idx < 0) return;
        const pos = [h.lat, h.lon];
        if (h.kind === 'kamera') {
          if (camIds.has(h.id) || cameras.some((c) => Veri.fastKm([c.lat, c.lon], pos) < 0.03)) return;
          const c = { id: h.id, tur: 'sabit', lat: h.lat, lon: h.lon, hiz: Yol.parseLimit(h.maxspeed), ad: h.name || null };
          addLayer(L.marker(pos, { icon: L.divIcon({ className: '', html: `<div class="blink-marker kamera sabit"><span>${c.hiz || '📷'}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 600 }))
            .bindPopup(cameraPopup(c));
          warnPoints.push(cameraWarning(c));
          alerts.push({ idx, coords: pos, icon: '📷', text: `${cameraType(c).label}${c.hiz ? ` (${c.hiz} km/s)` : ''}` });
          $('stat-kamera').textContent = +$('stat-kamera').textContent + 1;
          added++;
          return;
        }
        if (h.kind === 'tabela') {
          const lim = Yol.parseLimit(h.maxspeed);
          if (lim) addLayer(L.marker(pos, { icon: L.divIcon({ className: '', html: `<i class="speed-limit-sign">${lim}</i>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 300 }))
            .bindPopup(`<b>Hız sınırı tabelası: ${lim} km/s</b><br><small>Kaynak: OpenStreetMap</small>`);
          return;
        }
        const info = hazardInfo(h);
        addLayer(L.marker(pos, { icon: L.divIcon({ className: '', html: `<div class="poi-marker ${h.kind} blink">${info.icon}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 450 }))
          .bindPopup(`<b>${info.icon} ${esc(info.label)}</b><br><small>Kaynak: OpenStreetMap</small>`);
        warnPoints.push({
          key: `osm:${h.id}`, type: h.kind, dist: 0.4, coords: pos,
          say: `Dikkat! 400 metre sonra ${info.say}. Yavaşlayın.`,
          text: `${info.icon} 400 m sonra ${info.label.toLocaleLowerCase('tr')}`,
        });
        alerts.push({ idx, coords: pos, icon: info.icon, text: info.label });
        added++;
      });
      renderAlerts();
      status.textContent = added ? `${added} ek nokta OpenStreetMap'ten eklendi.` : '';
    }).catch(() => {
      if (seq === requestSeq) status.textContent = 'Ek tehlike noktaları şu an alınamadı; kameralar ve İçişleri verisi gösteriliyor.';
    });
  }

  async function calculateRoute() {
    const from = ilById.get(startSel.value);
    const to = ilById.get(endSel.value);
    if (!from || !to) return;
    if (from.id === to.id) { toast('Başlangıç ve varış ili aynı olamaz!'); return; }
    if (!navigator.onLine) { toast('İnternet bağlantısı yok. Lütfen Wi-Fi veya mobil veriyi kontrol edin.'); return; }

    const seq = ++requestSeq;
    const btn = $('btn-submit');
    btn.disabled = true;
    btn.textContent = 'HESAPLANIYOR…';
    $('route-title').textContent = `${from.ad} → ${to.ad}`;
    $('route-meta').textContent = 'Rota hesaplanıyor…';

    try {
      const [found, wStart, wEnd] = await Promise.all([
        Veri.findRoute(from.id, to.id),
        Veri.weather(from.lat, from.lon).catch(() => null),
        Veri.weather(to.lat, to.lon).catch(() => null),
      ]);
      const rec = found && found.record;
      const recCoords = rec && Array.isArray(rec.rota_coords) ? rec.rota_coords : [];
      const recIsReal = recCoords.length > 1 && !Veri.isStraightLine(recCoords);

      let coords = recIsReal ? recCoords : null;
      let durationMin = null;
      let distKm = null;
      let approx = false;
      if (!coords) {
        try {
          const o = await Veri.osrmRoute(from, to);
          coords = o.coords; distKm = o.distanceKm; durationMin = o.durationMin;
        } catch (e) {
          coords = recCoords.length > 1 ? recCoords : [[from.lat, from.lon], [to.lat, to.lon]];
          approx = true;
        }
      }
      if (seq !== requestSeq) return; // daha yeni bir sorgu başladı

      if (distKm == null) distKm = pathLengthKm(coords);
      clearRoute();
      renderStatus(from, to, found);

      // Güzergah analizi: rotadaki gerçek hız koridorları ve il bazında denetim bölgeleri
      const dense = Veri.densify(coords);
      const nearestIndex = Veri.buildRouteIndex(dense);
      const realOwn = (rec ? (rec.hiz_koridorlari || []) : []).filter((c) => Array.isArray(c.coords) && c.coords.length > 1 && !Veri.isStraightLine(c.coords));
      const onRoute = Veri.corridorsOnRoute(dense, nearestIndex, (await Veri.loadCorridors()).concat(realOwn));
      const cameras = Veri.camerasOnRoute(dense, nearestIndex, await Veri.loadCameras());
      if (seq !== requestSeq) return;
      const seen = new Set();
      const mapCorridors = onRoute.filter((c) => {
        const k = c.id != null ? `id:${c.id}` : `${c.name}|${c.coords[0]}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // Listede: kayıttaki koridorlar (geometrisi olmasa da) + haritada bulunanlar
      const listed = mapCorridors.slice();
      (rec ? (rec.hiz_koridorlari || []) : []).forEach((c) => {
        if (!listed.some((x) => (c.id != null && x.id === c.id) || x.name === c.name)) listed.push(c);
      });

      const radar = rec ? toInt(rec.radar_sayisi) : 0;
      const kontrol = rec ? toInt(rec.kontrol_sayisi) : 0;
      const koridor = rec ? toInt(rec.koridor_sayisi) : mapCorridors.length;
      $('stat-radar').textContent = rec ? radar : '—';
      $('stat-kontrol').textContent = rec ? kontrol : '—';
      $('stat-koridor').textContent = koridor;
      $('stat-kamera').textContent = cameras.length;
      setRisk(Math.min(99, Math.round(((radar + kontrol + koridor + cameras.length) / 45) * 100)), !!rec);

      const meta = [`${Math.round(distKm)} km${approx ? ' (yaklaşık)' : ''}`];
      if (durationMin) meta.push(`~${Math.floor(durationMin / 60)} sa ${Math.round(durationMin % 60)} dk`);
      $('route-meta').textContent = meta.join(' · ');

      setWeather('start', from, '📍', wStart);
      setWeather('end', to, '🎯', wEnd);

      renderCorridors(listed);
      const breakdown = rec ? (rec.gecen_iller || []) : [];
      // İl bazında kamera sayısı (rotanın o ilden geçen bölümündeki kameralar)
      const segs = Veri.provinceSegments(dense, ILLER);
      const camCounts = new Map();
      cameras.forEach((c) => {
        for (const [id, s] of segs) if (c.routeIndex >= s.first && c.routeIndex <= s.last) { camCounts.set(id, (camCounts.get(id) || 0) + 1); break; }
      });
      renderBreakdown(breakdown, camCounts);
      alerts = [];
      alertDense = dense;
      alertCum = [0];
      for (let i = 1; i < dense.length; i++) alertCum.push(alertCum[i - 1] + Veri.fastKm(dense[i - 1], dense[i]));

      // Harita çizimi
      const line = addLayer(L.polyline(coords, { color: '#2563eb', weight: 6, opacity: 0.85, dashArray: approx ? '4 8' : null }));
      addLayer(L.marker(coords[0], { icon: pinIcon('pin-start') }).bindPopup(`<b>📍 Kalkış:</b> ${esc(from.ad)}`));
      addLayer(L.marker(coords[coords.length - 1], { icon: pinIcon('pin-end') }).bindPopup(`<b>🎯 Varış:</b> ${esc(to.ad)}`));

      mapCorridors.forEach((c, i) => {
        const cc = c.coords;
        const limit = toInt(c.speed_limit || c.speedLimit) || 82;
        const popup = `<b>⚡ ${esc(c.name || 'Hız Koridoru')}</b><br>Limit: ${limit} km/s${c.length ? `<br>Uzunluk: ${esc(c.length)} km` : ''}`;
        addLayer(L.polyline(cc, { color: '#ef4444', weight: 8, opacity: 0.95, dashArray: '10 8', className: 'blink-line' })).bindPopup(popup);
        const mid = cc[Math.floor(cc.length / 2)];
        addLayer(L.marker(mid, { icon: L.divIcon({ className: '', html: `<div class="speed-limit-sign blink">${limit}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(popup));
        alerts.push({ idx: c.routeIndex ?? 0, coords: cc[0], icon: '⚡', text: `Hız koridoru başlıyor: ${c.name || 'Hız koridoru'} (${limit} km/s${c.length ? `, ${c.length} km` : ''})` });
        warnPoints.push({
          key: `k${i}`, type: 'koridor', coords: cc[0],
          say: `Dikkat! ${WARN_DISTANCE_KM} kilometre sonra ${limit} kilometre hız sınırlı hız koridoru başlıyor.`,
          text: `⚡ ${WARN_DISTANCE_KM} km sonra hız koridoru (${limit} km/s)`,
        });
      });

      // Gerçek konumlu hız kameraları (OpenStreetMap)
      cameras.forEach((c) => {
        addLayer(L.marker([c.lat, c.lon], {
          icon: L.divIcon({ className: '', html: `<div class="blink-marker kamera ${esc(c.tur)}"><span>${c.hiz || '📷'}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
          zIndexOffset: 600,
        })).bindPopup(cameraPopup(c));
        warnPoints.push(cameraWarning(c));
        alerts.push({ idx: c.routeIndex, coords: [c.lat, c.lon], icon: '📷', text: `${cameraType(c).label}${c.hiz ? ` (${c.hiz} km/s)` : ''}` });
      });

      // İçişleri verisi il bazındadır (kesin nokta yok): radar ve kontrol işaretleri,
      // rotanın o ilden geçen bölümünün ortasına yerleştirilir.
      if (breakdown.length) {
        breakdown.forEach((it, i) => {
          const il = ilById.get(Veri.slug(it.City || it.name));
          const r = toInt(it.Radarli ?? it.radarli);
          const rs = toInt(it.Radarsiz ?? it.radarsiz);
          if (!il || r + rs === 0) return;
          let s = segs.get(il.id);
          if (!s) { const n = nearestIndex([il.lat, il.lon], 60); if (n < 0) return; s = { first: n, last: n }; }
          const atIdx = (f) => Math.round(s.first + (s.last - s.first) * f);
          const at = (f) => dense[atIdx(f)];
          const note = '<br><small>Konum il bazında yaklaşıktır; kesin denetim noktası değildir.</small>';
          if (r > 0) {
            const pos = at(0.4);
            addLayer(L.marker(pos, { icon: L.divIcon({ className: '', html: `<div class="blink-marker radar"><span>${r}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 500 }))
              .bindPopup(`<b>📷 ${esc(il.ad)} — ${r} radarlı denetim</b>${note}`);
            alerts.push({ idx: atIdx(0.4), icon: '🔴', text: `Radar denetim bölgesi — ${il.ad}: ${r} radarlı denetim (il bazında)` });
            warnPoints.push({
              key: `r${i}`, type: 'radar', coords: pos,
              say: `Dikkat! ${WARN_DISTANCE_KM} kilometre sonra radar denetim bölgesi. ${il.ad} ilinde ${r} radarlı denetim noktası bulunuyor.`,
              text: `📷 ${WARN_DISTANCE_KM} km sonra radar bölgesi (${il.ad}: ${r})`,
            });
          }
          if (rs > 0) {
            const pos = at(0.6);
            addLayer(L.marker(pos, { icon: L.divIcon({ className: '', html: `<div class="blink-marker kontrol"><span>${rs}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 500 }))
              .bindPopup(`<b>👮 ${esc(il.ad)} — ${rs} radarsız kontrol noktası</b>${note}`);
            alerts.push({ idx: atIdx(0.6), icon: '🔵', text: `Kontrol noktası bölgesi — ${il.ad}: ${rs} kontrol noktası (il bazında)` });
            warnPoints.push({
              key: `c${i}`, type: 'kontrol', coords: pos,
              say: `Dikkat! ${WARN_DISTANCE_KM} kilometre sonra trafik kontrol noktası bölgesi. ${il.ad} ilinde ${rs} kontrol noktası bulunuyor.`,
              text: `👮 ${WARN_DISTANCE_KM} km sonra kontrol noktası bölgesi (${il.ad}: ${rs})`,
            });
          }
        });
      }

      map.fitBounds(line.getBounds(), { padding: [30, 30] });
      setTimeout(() => map.invalidateSize(), 150);
      rememberRoute(from.id, to.id);
      renderAlerts();
      loadHazards(seq, coords, nearestIndex, cameras);
    } catch (err) {
      console.error(err);
      if (seq === requestSeq) {
        toast('Rota oluşturulamadı. Lütfen tekrar deneyin.');
        $('route-meta').textContent = 'Rota oluşturulamadı';
      }
    } finally {
      if (seq === requestSeq) {
        btn.disabled = false;
        btn.textContent = 'ROTA OLUŞTUR';
      }
    }
  }

  // ---------------------------------------------------------------- KONUM & SÜRÜŞ MODU
  let watchId = null;
  let gpsMarker = null;
  let wakeLock = null;
  let cameraNear = null;
  let lastFix = null;
  let zoomOnFix = false;
  Veri.loadCameras().then((l) => { cameraNear = Veri.pointIndex(l); });

  async function locationByIP() {
    const apis = ['https://ipapi.co/json/', 'https://ipwho.is/'];
    for (const url of apis) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3500);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) continue;
        const d = await res.json();
        const lat = d.latitude ?? d.lat;
        const lon = d.longitude ?? d.lon;
        if (lat && lon) return { lat, lon, city: d.city || 'Konum' };
      } catch (e) { /* sıradaki servis */ }
    }
    return null;
  }

  function nearestIl(lat, lon) {
    return ILLER.reduce((best, il) => {
      const d = distanceKm(lat, lon, il.lat, il.lon);
      return d < best.d ? { il, d } : best;
    }, { il: null, d: Infinity }).il;
  }

  function onPosition(lat, lon, label) {
    const ll = [lat, lon];
    $('gps-status-text').textContent = label;
    if (!gpsMarker) {
      gpsMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gps-car-marker"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 }).addTo(map);
    } else gpsMarker.setLatLng(ll);
    // Sürüş başladığında ilk konumda sokak seviyesine yaklaş (tabela ve geçitler görünsün).
    if (zoomOnFix) { zoomOnFix = false; if (map.getZoom() < 14) map.setView(ll, 15); else map.panTo(ll); } else map.panTo(ll);

    warnPoints.forEach((pt) => {
      if (!warned.has(pt.key) && distanceKm(lat, lon, pt.coords[0], pt.coords[1]) <= (pt.dist || WARN_DISTANCE_KM)) {
        // Aynı türden birbirine çok yakın noktalar (ör. aynı yerden başlayan iki koridor) için tek uyarı ver.
        warnPoints.forEach((o) => { if (o.type === pt.type && distanceKm(pt.coords[0], pt.coords[1], o.coords[0], o.coords[1]) < 0.5) warned.add(o.key); });
        warned.add(pt.key);
        speak(pt.say);
        toast(pt.text);
      }
    });

    // Rotadan bağımsız: yaklaşılan hız kameraları (rota dışına çıkılsa da uyarır)
    if (cameraNear) {
      const prev = lastFix;
      lastFix = ll;
      if (prev && distanceKm(prev[0], prev[1], lat, lon) > 0.02) {
        // Sadece gidiş yönünde (±30°) önde kalan, henüz uyarılmamış en yakın kamera için uyarılır.
        const heading = bearing(prev, ll);
        const ahead = cameraNear(ll, WARN_DISTANCE_KM)
          .filter((c) => !warned.has(`cam:${c.id}`))
          .filter((c) => { const d = Math.abs(bearing(ll, [c.lat, c.lon]) - heading) % 360; return Math.min(d, 360 - d) <= 30; })
          .sort((x, y) => distanceKm(lat, lon, x.lat, x.lon) - distanceKm(lat, lon, y.lat, y.lon));
        if (ahead.length) {
          const w = cameraWarning(ahead[0]);
          warned.add(w.key);
          speak(w.say);
          toast(w.text);
        }
      }
    }

    // Yol çalışmaları: en fazla 20 sn'de bir sorgulanır, her çalışma için bir kez uyarılır.
    const now = Date.now();
    if (map.hasLayer(kgmLayer) && now - lastRoadWorkQuery > 20000) {
      lastRoadWorkQuery = now;
      L.esri.query({ url: `${KGM_URL}/0` }).nearby(L.latLng(ll), WARN_DISTANCE_KM * 1000).run((error, fc) => {
        if (error || !fc || !fc.features) return;
        const fresh = fc.features.filter((f) => !warnedRoadWorks.has(String(f.id ?? JSON.stringify(f.geometry && f.geometry.coordinates).slice(0, 60))));
        if (!fresh.length) return;
        fresh.forEach((f) => warnedRoadWorks.add(String(f.id ?? JSON.stringify(f.geometry && f.geometry.coordinates).slice(0, 60))));
        speak(`Dikkat! ${WARN_DISTANCE_KM} kilometre içinde yol çalışması veya kapalı yol bulunmaktadır.`);
        toast(`🚧 ${WARN_DISTANCE_KM} km içinde yol çalışması / kapalı yol var`);
      });
    }
  }

  async function startDrive() {
    const btn = $('btn-drive');
    btn.classList.add('active');
    btn.textContent = '■ Sürüşü Bitir';
    $('gps-status-text').textContent = 'Konum aranıyor…';
    if (!map.hasLayer(kgmLayer)) kgmLayer.addTo(map);
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* desteklenmiyor */ }

    let gotGps = false;
    const fallback = setTimeout(async () => {
      if (gotGps || watchId === null) return;
      const ip = await locationByIP();
      if (ip && !gotGps && watchId !== null) onPosition(ip.lat, ip.lon, `Şebeke konumu (${ip.city})`);
    }, 4000);

    if (!navigator.geolocation) { toast('Bu cihaz konum servisini desteklemiyor.'); stopDrive(); return; }
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        gotGps = true;
        clearTimeout(fallback);
        const acc = Math.round(pos.coords.accuracy);
        const kmh = pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : null;
        onPosition(pos.coords.latitude, pos.coords.longitude, `GPS aktif (±${acc} m)`);
        // Hız sınırı eşleştirmesi için yeterince hassas konum gerekir (şebeke konumu kullanılmaz).
        if (acc <= 60) Yol.update(pos.coords.latitude, pos.coords.longitude, kmh);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          toast('Konum izni verilmedi. Ayarlardan konum iznini açabilirsiniz.');
          stopDrive();
        } else $('gps-status-text').textContent = 'GPS sinyali zayıf, yeniden deneniyor…';
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    Yol.start({ map, speak, toast, warned });
    zoomOnFix = true;
    speak('Sürüş modu başlatıldı. İyi yolculuklar.', true);
  }

  function stopDrive() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
    lastFix = null;
    Yol.stop();
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    const btn = $('btn-drive');
    btn.classList.remove('active');
    btn.textContent = '▶ Sürüş Modu';
    $('gps-status-text').textContent = 'Konum kapalı';
  }

  function locateStart() {
    const btn = $('btn-locate');
    btn.disabled = true;
    const done = async (lat, lon) => {
      btn.disabled = false;
      const il = nearestIl(lat, lon);
      if (!il) return;
      startSel.value = il.id;
      if (endSel.value === il.id) endSel.value = ILLER.find((x) => x.id !== il.id).id;
      await refreshEndOptions();
      toast(`📍 Kalkış ili: ${il.ad}`);
    };
    const viaIp = async () => {
      const ip = await locationByIP();
      if (ip) done(ip.lat, ip.lon);
      else { btn.disabled = false; toast('Konum bulunamadı.'); }
    };
    if (!navigator.geolocation) return viaIp();
    navigator.geolocation.getCurrentPosition((p) => done(p.coords.latitude, p.coords.longitude), viaIp, { timeout: 8000, maximumAge: 60000 });
  }

  // ---------------------------------------------------------------- ARAYÜZ
  function toggleLegal(force) {
    const m = $('legal-modal');
    const open = force ?? m.classList.contains('hidden');
    m.classList.toggle('hidden', !open);
    document.body.classList.toggle('no-scroll', open);
  }
  document.querySelectorAll('[data-open-legal]').forEach((b) => b.addEventListener('click', () => toggleLegal(true)));
  document.querySelectorAll('[data-close-legal]').forEach((b) => b.addEventListener('click', () => toggleLegal(false)));
  $('legal-modal').addEventListener('click', (e) => { if (e.target.id === 'legal-modal') toggleLegal(false); });

  startSel.addEventListener('change', refreshEndOptions);
  endSel.addEventListener('change', syncDisables);
  $('btn-submit').addEventListener('click', calculateRoute);
  $('btn-swap').addEventListener('click', async () => {
    const a = startSel.value;
    startSel.value = endSel.value;
    await refreshEndOptions();
    endSel.value = a;
    syncDisables();
  });
  $('btn-locate').addEventListener('click', locateStart);
  $('btn-drive').addEventListener('click', () => ($('btn-drive').classList.contains('active') ? stopDrive() : startDrive()));
  $('recent-routes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-route]');
    if (!b) return;
    const [a, z] = b.dataset.route.split('|');
    startSel.value = a;
    await refreshEndOptions();
    endSel.value = z;
    syncDisables();
    calculateRoute();
  });

  // Mobil alt menü: bölüme kaydır ve etkin sekmeyi işaretle.
  const navLinks = document.querySelectorAll('.bottom-nav [data-nav]');
  navLinks.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const key = en.target.id.replace('panel-', '');
        navLinks.forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
      });
    }, { threshold: 0.35 });
    ['panel-route', 'panel-map', 'panel-details'].forEach((id) => io.observe($(id)));
  }

  window.addEventListener('offline', () => toast('📴 İnternet bağlantısı kesildi.'));
  window.addEventListener('online', () => toast('📶 İnternet bağlantısı geri geldi.'));

  // ---------------------------------------------------------------- BAŞLAT
  async function init() {
    const last = store(STORE_KEY, [])[0];
    fillSelect(startSel);
    startSel.value = last && ilById.has(last[0]) ? last[0] : 'adana';
    await refreshEndOptions();
    endSel.value = last && ilById.has(last[1]) ? last[1] : 'ankara';
    syncDisables();
    renderRecent();
    calculateRoute();
  }

  init();
  setTimeout(() => {
    const s = $('splash-screen');
    if (!s) return;
    s.classList.add('gone');
    setTimeout(() => s.remove(), 500);
  }, 1800);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
