// Cepte Radar — sürüş sırasında bulunulan yolun hız sınırı, hız aşımı uyarısı ve
// yakındaki hemzemin geçit / okul geçidi / hız tabelası bilgisi.
// Veri: OpenStreetMap (Overpass servisi), konumun çevresindeki ~1,5 km için anlık sorgulanır.
(function () {
  'use strict';

  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const RADIUS_M = 1500;      // her sorguda alınan çevre
  const REFETCH_KM = 0.9;     // sorgu merkezinden bu kadar uzaklaşınca yenilenir
  const MATCH_KM = 0.03;      // konumun yola en fazla uzaklığı (GPS hatası payı)
  const POINT_WARN_KM = 0.4;  // hemzemin geçit / okul geçidi uyarı mesafesi

  const ROADS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
  const query = (lat, lon) => `[out:json][timeout:25];
way(around:${RADIUS_M},${lat},${lon})[highway~"^(${ROADS})$"];
out geom qt;
(
  node(around:${RADIUS_M},${lat},${lon})["railway"="level_crossing"];
  node(around:${RADIUS_M},${lat},${lon})["highway"="crossing"]["crossing"="school"];
  node(around:${RADIUS_M},${lat},${lon})["traffic_sign"~"maxspeed"]["maxspeed"];
);
out qt;`;

  // Türkiye'deki bölge kodları ve yönetmelikteki genel sınırlar (otomobil)
  const ZONES = { 'TR:urban': 50, 'TR:rural': 90, 'TR:trunk': 110, 'TR:expressway': 110, 'TR:motorway': 120, 'TR:living_street': 20 };
  const DEFAULTS = { motorway: 120, living_street: 20, residential: 50 };

  function parseLimit(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (ZONES[s]) return ZONES[s];
    const n = parseInt(s, 10);
    return n > 0 && n <= 150 ? n : null;
  }

  const R = Math.PI / 180;
  function km(a, b) {
    const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * R);
    return Math.hypot(x, b[0] - a[0]) * 111.32;
  }
  function bearing(a, b) {
    const y = Math.sin((b[1] - a[1]) * R) * Math.cos(b[0] * R);
    const x = Math.cos(a[0] * R) * Math.sin(b[0] * R) - Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R);
    return (Math.atan2(y, x) / R + 360) % 360;
  }
  const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  function segmentKm(p, a, b) {
    const k = Math.cos(p[0] * R);
    const ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
    const dx = (b[1] - p[1]) * k - ax, dy = b[0] - p[0] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy) * 111.32;
  }

  // ------------------------------------------------------------------ durum
  let opts = null;          // { map, speak, toast }
  let ways = [];            // { id, tags, pts, box }
  let points = [];          // { id, kind, lat, lon, limit }
  let center = null;
  let loading = false;
  let retryAt = 0;
  let prev = null;
  let heading = null;
  let currentWay = null;
  let overCount = 0;
  let lastOverWarn = 0;
  const warnedPoints = new Set();
  let layer = null;

  async function fetchArea(lat, lon) {
    loading = true;
    try {
      for (const url of SERVERS) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 30000);
          const res = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(query(lat.toFixed(5), lon.toFixed(5)))}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          setData(data.elements || []);
          center = [lat, lon];
          return;
        } catch (e) { /* sıradaki sunucu */ }
      }
      retryAt = Date.now() + 30000; // ikisi de olmadıysa 30 sn sonra tekrar dene
    } finally {
      loading = false;
    }
  }

  function setData(elements) {
    ways = [];
    points = [];
    for (const e of elements) {
      if (e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length > 1) {
        const pts = e.geometry.map((g) => [g.lat, g.lon]);
        const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
        ways.push({ id: e.id, tags: e.tags || {}, pts, box: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)] });
      } else if (e.type === 'node' && e.tags) {
        const t = e.tags;
        const kind = t.railway === 'level_crossing' ? 'tren' : t.crossing === 'school' ? 'okul' : 'tabela';
        points.push({ id: e.id, kind, lat: e.lat, lon: e.lon, limit: parseLimit(t.maxspeed) });
      }
    }
    drawPoints();
  }

  const ICONS = { tren: '🚆', okul: '🏫' };
  function drawPoints() {
    if (!opts || !window.L) return;
    if (!layer) layer = L.layerGroup().addTo(opts.map);
    layer.clearLayers();
    for (const p of points) {
      const html = p.kind === 'tabela'
        ? (p.limit ? `<i class="speed-limit-sign">${p.limit}</i>` : '')
        : `<div class="poi-marker ${p.kind}">${ICONS[p.kind]}</div>`;
      if (!html) continue;
      const title = p.kind === 'tren' ? 'Hemzemin geçit' : p.kind === 'okul' ? 'Okul geçidi' : `Hız sınırı tabelası: ${p.limit} km/s`;
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 400 })
        .bindPopup(`<b>${title}</b><br><small>Kaynak: OpenStreetMap</small>`).addTo(layer);
    }
  }

  // Konuma en uygun yol: yakınlık + gidiş yönüyle uyum. Önceki yol hâlâ yakınsa ona öncelik verilir.
  function matchWay(p) {
    let best = null, bestScore = Infinity;
    for (const w of ways) {
      const pad = 0.0005;
      if (p[0] < w.box[0] - pad || p[0] > w.box[2] + pad || p[1] < w.box[1] - pad || p[1] > w.box[3] + pad) continue;
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const d = segmentKm(p, w.pts[i], w.pts[i + 1]);
        if (d > MATCH_KM) continue;
        let score = d;
        let forward = true;
        if (heading != null) {
          const segB = bearing(w.pts[i], w.pts[i + 1]);
          const diff = angleDiff(segB, heading);
          forward = diff <= 90;
          const oneway = w.tags.oneway === 'yes' || w.tags.highway === 'motorway' || w.tags.junction === 'roundabout';
          const misfit = oneway ? diff : Math.min(diff, 180 - diff);
          if (oneway && diff > 100) continue; // tek yönlü yolun ters şeridi olamaz
          score += misfit / 1500; // 30° sapma ≈ 20 m
        }
        if (currentWay && currentWay.way.id === w.id) score -= 0.01;
        if (score < bestScore) { bestScore = score; best = { way: w, forward }; }
      }
    }
    return best;
  }

  function limitFor(m) {
    const t = m.way.tags;
    const dir = m.forward ? t['maxspeed:forward'] : t['maxspeed:backward'];
    const explicit = parseLimit(dir) ?? parseLimit(t.maxspeed);
    if (explicit) return { value: explicit, sure: true };
    const def = DEFAULTS[t.highway];
    return def ? { value: def, sure: t.highway === 'motorway' } : null;
  }

  // ------------------------------------------------------------------ arayüz
  const $ = (id) => document.getElementById(id);
  function render(limit, speed, way) {
    const box = $('limit-box');
    if (!box) return;
    box.classList.remove('hidden');
    $('limit-val').textContent = limit ? limit.value : '–';
    $('limit-sign').classList.toggle('unknown', !limit);
    $('cur-speed').textContent = speed != null ? Math.round(speed) : '–';
    const name = way && (way.tags.ref || way.tags.name);
    $('limit-note').textContent = !way ? 'Yol aranıyor…' : !limit ? 'Sınır bilinmiyor' : `${limit.sure ? '' : 'Genel kural · '}${name || ''}`.replace(/ · $/, '');
  }

  function checkSpeed(limit, speed) {
    const box = $('limit-box');
    const over = limit && limit.sure && speed != null && speed > limit.value + Math.max(5, limit.value * 0.1);
    overCount = over ? overCount + 1 : 0;
    if (box) box.classList.toggle('over', !!over);
    if (overCount >= 2 && Date.now() - lastOverWarn > 30000) {
      lastOverWarn = Date.now();
      opts.speak(`Hız sınırı ${limit.value}. Lütfen yavaşlayın.`);
      if (opts.flash) opts.flash('hiz');
      opts.toast(`⚠️ Hız sınırı ${limit.value} km/s — hızınız ${Math.round(speed)} km/s`);
    }
  }

  function checkPoints(p) {
    if (heading == null) return;
    const ahead = points
      .filter((x) => x.kind !== 'tabela' && !warnedPoints.has(x.id) && !(opts.warned && opts.warned.has(`osm:node/${x.id}@500`)))
      .map((x) => ({ x, d: km(p, [x.lat, x.lon]) }))
      .filter(({ x, d }) => d <= POINT_WARN_KM && angleDiff(bearing(p, [x.lat, x.lon]), heading) <= 35)
      .sort((a, b) => a.d - b.d)[0];
    if (!ahead) return;
    warnedPoints.add(ahead.x.id);
    // Rota uyarılarıyla (500 m / 200 m aşamaları) aynı noktayı tekrar söylememek için ortak kayıt
    if (opts.warned) [500, 200].forEach((s) => opts.warned.add(`osm:node/${ahead.x.id}@${s}`));
    if (opts.flash) opts.flash(ahead.x.kind);
    const m = Math.max(50, Math.round(ahead.d * 1000 / 50) * 50);
    if (ahead.x.kind === 'tren') {
      opts.speak(`Dikkat! ${m} metre sonra hemzemin geçit. Yavaşlayın.`);
      opts.toast(`🚆 ${m} m sonra hemzemin geçit`);
    } else {
      opts.speak(`Dikkat! ${m} metre sonra okul geçidi. Yavaşlayın.`);
      opts.toast(`🏫 ${m} m sonra okul geçidi`);
    }
  }

  // ------------------------------------------------------------------ dışa açık
  function update(lat, lon, speedKmh) {
    if (!opts) return;
    const p = [lat, lon];
    let speed = speedKmh;
    if (prev) {
      const d = km(prev.p, p);
      const dt = (Date.now() - prev.t) / 3600000;
      if (speed == null && dt > 0 && d > 0.005) speed = d / dt;
      if (d > 0.015) { heading = bearing(prev.p, p); prev = { p, t: Date.now() }; }
    } else prev = { p, t: Date.now() };

    if (!loading && Date.now() > retryAt && (!center || km(center, p) > REFETCH_KM)) fetchArea(lat, lon);

    const m = ways.length ? matchWay(p) : null;
    currentWay = m || (currentWay && ways.includes(currentWay.way) && segmentDistance(p, currentWay.way) < MATCH_KM * 2 ? currentWay : null);
    const limit = currentWay ? limitFor(currentWay) : null;
    render(limit, speed, currentWay && currentWay.way);
    checkSpeed(limit, speed);
    checkPoints(p);
    return { limit, speed, heading };
  }

  function segmentDistance(p, w) {
    let d = Infinity;
    for (let i = 0; i + 1 < w.pts.length; i++) d = Math.min(d, segmentKm(p, w.pts[i], w.pts[i + 1]));
    return d;
  }

  function start(o) {
    opts = o;
  }

  function stop() {
    const box = $('limit-box');
    if (box) { box.classList.add('hidden'); box.classList.remove('over'); }
    if (layer) layer.clearLayers();
    ways = []; points = []; center = null; prev = null; heading = null; currentWay = null;
    overCount = 0; warnedPoints.clear(); retryAt = 0;
  }

  window.Yol = { start, stop, update, parseLimit };
})();
