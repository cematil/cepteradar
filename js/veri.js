// Veri katmanı: iller_kucuk/ JSON dosyaları, OSRM rota servisi ve Open-Meteo hava durumu.
// Sunucuya ihtiyaç duymaz; statik barındırmada ve Android (Capacitor) uygulamasında çalışır.
(function () {
  'use strict';

  const DATA_DIR = 'iller_kucuk';
  const cityCache = new Map();
  let indexPromise = null;

  const slug = (s) => String(s || '').trim().toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z]/g, '');

  const asList = (d) => (Array.isArray(d) ? d : d ? [d] : []);

  async function fetchJson(url, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // { kalkisId: [varisId, ...] } — hangi rotaların verisi olduğunu gösterir.
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetchJson(`${DATA_DIR}/index.json`).catch(() => ({}));
    }
    return indexPromise;
  }

  async function hasRoute(fromId, toId) {
    const idx = await loadIndex();
    if ((idx[fromId] || []).includes(toId)) return 'direct';
    if ((idx[toId] || []).includes(fromId)) return 'reverse';
    return null;
  }

  async function loadCity(id) {
    if (!cityCache.has(id)) {
      cityCache.set(id, fetchJson(`${DATA_DIR}/${id}.json`).then(asList).catch(() => []));
    }
    return cityCache.get(id);
  }

  // Kalkış→varış kaydını bulur. Doğrudan kayıt yoksa ters yön (varış→kalkış) kaydını kullanır.
  async function findRoute(fromId, toId) {
    if (!(await hasRoute(fromId, toId))) return null;
    const direct = (await loadCity(fromId)).find((r) => slug(r.varis_il) === toId);
    if (direct) return { record: direct, reversed: false };
    const back = (await loadCity(toId)).find((r) => slug(r.varis_il) === fromId);
    if (back) {
      return {
        reversed: true,
        record: {
          ...back,
          gecen_iller: asList(back.gecen_iller).slice().reverse(),
          rota_coords: asList(back.rota_coords).slice().reverse(),
        },
      };
    }
    return null;
  }

  // Bazı eski kayıtlarda rota iki il merkezi arasında eşit aralıklı düz bir çizgidir.
  // Böyle bir rota gerçek yolu göstermez; haritada OSRM rotası çizilir.
  function isStraightLine(coords) {
    if (!coords || coords.length < 3) return true;
    const dLat = coords[1][0] - coords[0][0];
    const dLon = coords[1][1] - coords[0][1];
    return coords.every((p, i) => i === 0 ||
      (Math.abs(p[0] - coords[i - 1][0] - dLat) < 1e-3 && Math.abs(p[1] - coords[i - 1][1] - dLon) < 1e-3));
  }

  async function osrmRoute(a, b) {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    const data = await fetchJson(url, 20000);
    const r = data.routes && data.routes[0];
    if (!r) throw new Error('Rota bulunamadı');
    return {
      coords: r.geometry.coordinates.map((p) => [p[1], p[0]]),
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
    };
  }

  const WMO_WEATHER_CODES = {
    0: ['Açık', '☀️'], 1: ['Açık / Az Bulutlu', '🌤️'], 2: ['Parçalı Bulutlu', '⛅'],
    3: ['Kapalı / Bulutlu', '☁️'], 45: ['Sisli', '🌫️'], 48: ['Yoğun Sisli', '🌁'],
    51: ['Hafif Çiseleyen', '🌦️'], 53: ['Çiseleyen Yağmur', '🌧️'], 55: ['Yoğun Çisenti', '🌧️'],
    61: ['Hafif Yağmurlu', '🌧️'], 63: ['Yağmurlu', '🌧️'], 65: ['Şiddetli Yağmurlu', '🌧️'],
    66: ['Dondurucu Yağmur', '🌧️'], 67: ['Şiddetli Dondurucu Yağmur', '🌧️'],
    71: ['Hafif Kar', '🌨️'], 73: ['Kar Yağışlı', '❄️'], 75: ['Yoğun Kar', '❄️'], 77: ['Kar Taneli', '🌨️'],
    80: ['Sağanak', '🌦️'], 81: ['Kuvvetli Sağanak', '🌧️'], 82: ['Şiddetli Sağanak', '⛈️'],
    85: ['Kar Sağanağı', '🌨️'], 86: ['Yoğun Kar Sağanağı', '❄️'],
    95: ['Gökgürültülü Fırtına', '🌩️'], 96: ['Dolu ve Fırtına', '⛈️'], 99: ['Şiddetli Dolu ve Fırtına', '⛈️'],
  };

  async function weather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,weather_code,wind_speed_10m,visibility&timezone=auto';
    const d = await fetchJson(url, 10000);
    const c = d.current || {};
    const [condition, icon] = WMO_WEATHER_CODES[c.weather_code] || ['Bilinmiyor', '🌡️'];
    return {
      temp: `${Math.round(c.temperature_2m)}°C`,
      wind: c.wind_speed_10m != null ? `${Math.round(c.wind_speed_10m)} km/s` : null,
      visibility: c.visibility != null ? `${Math.max(0, Math.round(c.visibility / 1000))} km` : null,
      condition,
      icon,
    };
  }

  // ------------------------------------------------------------ GÜZERGAH ANALİZİ
  let corridorsPromise = null;
  function loadCorridors() {
    if (!corridorsPromise) corridorsPromise = fetchJson(`${DATA_DIR}/koridorlar.json`).then(asList).catch(() => []);
    return corridorsPromise;
  }

  // İl bazında denetim özeti (scripts/lib-veri.mjs üretir): rota verisi olmayan güzergahlarda tahmin için
  let ozetPromise = null;
  function loadProvinceSummary() {
    if (!ozetPromise) ozetPromise = fetchJson(`${DATA_DIR}/il_ozet.json`).catch(() => ({}));
    return ozetPromise;
  }

  // OpenStreetMap'ten alınmış, gerçek konumlu hız kameraları (scripts/osm-cek.mjs üretir).
  let camerasPromise = null;
  function loadCameras() {
    if (!camerasPromise) {
      camerasPromise = fetchJson(`${DATA_DIR}/osm_radarlar.json`).then(asList)
        .then((l) => l.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)))
        .catch(() => []);
    }
    return camerasPromise;
  }

  // Douglas-Peucker sadeleştirme ([lat, lon] dizisi, tolerans derece cinsinden)
  function simplify(points, tol) {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = points[a], [bx, by] = points[b];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let maxD = -1, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = points[i];
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol * tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return points.filter((_, i) => keep[i]);
  }

  // Güzergah boyunca (yola en fazla ~50 m) OpenStreetMap'teki tehlike noktaları:
  // hemzemin geçit, okul geçidi, tehlike tabelaları, hız kameraları ve hız sınırı tabelaları.
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  async function routeHazards(coords) {
    const line = simplify(coords, 0.0002).map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(',');
    const a = `around:50,${line}`;
    const q = `[out:json][timeout:90];
(
  node(${a})["railway"="level_crossing"];
  node(${a})["highway"="crossing"]["crossing"="school"];
  node(${a})["hazard"];
  node(${a})["highway"="speed_camera"];
  node(${a})["traffic_sign"~"maxspeed"]["maxspeed"];
);
out qt;`;
    for (const url of OVERPASS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 95000);
        const res = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        return asList(d.elements).filter((e) => e.type === 'node' && e.tags).map((e) => {
          const t = e.tags;
          const kind = t.highway === 'speed_camera' ? 'kamera' : t.railway === 'level_crossing' ? 'tren'
            : t.crossing === 'school' ? 'okul' : t.hazard ? 'tehlike' : 'tabela';
          return { id: `node/${e.id}`, kind, lat: e.lat, lon: e.lon, maxspeed: t.maxspeed, hazard: t.hazard, name: t.name };
        });
      } catch (e) { /* sıradaki sunucu */ }
    }
    throw new Error('Overpass servisine ulaşılamadı');
  }

  // Yaklaşık mesafe (km) — kısa mesafelerde yeterince hassas ve hızlı.
  function fastKm(a, b) {
    const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
    const y = b[0] - a[0];
    return Math.sqrt(x * x + y * y) * 111.32;
  }

  // Noktalar arası en fazla `stepKm` olacak şekilde rotayı sıklaştırır.
  function densify(coords, stepKm = 0.4) {
    const out = [];
    for (let i = 0; i < coords.length; i++) {
      const p = coords[i];
      if (i > 0) {
        const q = coords[i - 1];
        const n = Math.floor(fastKm(q, p) / stepKm);
        for (let k = 1; k < n; k++) out.push([q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n]);
      }
      out.push(p);
    }
    return out;
  }

  const CELL = 0.02; // ~2 km'lik ızgara hücresi
  const cellKey = (p) => `${Math.floor(p[0] / CELL)}:${Math.floor(p[1] / CELL)}`;

  function buildRouteIndex(dense) {
    const grid = new Map();
    dense.forEach((p, i) => {
      const k = cellKey(p);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    // p noktasına `maxKm` içindeki en yakın rota noktasının sırası (yoksa -1)
    return function nearestIndex(p, maxKm) {
      const r = Math.floor(p[0] / CELL), c = Math.floor(p[1] / CELL);
      let best = -1, bestD = maxKm;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        for (const i of grid.get(`${r + dr}:${c + dc}`) || []) {
          const d = fastKm(p, dense[i]);
          if (d <= bestD) { bestD = d; best = i; }
        }
      }
      return best;
    };
  }

  // p noktasının [a, b] doğru parçasına uzaklığı (km)
  function segmentKm(p, a, b) {
    const k = Math.cos(p[0] * Math.PI / 180);
    const ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
    const dx = (b[1] - p[1]) * k - ax, dy = b[0] - p[0] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy) * 111.32;
  }

  // Rotanın üzerindeki (en fazla `maxKm` uzaklıktaki) kameralar, rota sırasına göre.
  function camerasOnRoute(dense, nearestIndex, cameras, maxKm = 0.08) {
    const hits = [];
    for (const c of cameras) {
      const p = [c.lat, c.lon];
      const i = nearestIndex(p, 0.5);
      if (i < 0) continue;
      let d = dense.length > 1 ? Infinity : fastKm(p, dense[i]);
      for (const j of [i - 1, i]) if (j >= 0 && j + 1 < dense.length) d = Math.min(d, segmentKm(p, dense[j], dense[j + 1]));
      if (d <= maxKm) hits.push({ ...c, routeIndex: i });
    }
    return hits.sort((a, b) => a.routeIndex - b.routeIndex);
  }

  // Noktaları ~2 km'lik hücrelere dizer; near(p, km) yakındaki noktaları döndürür.
  function pointIndex(items) {
    const grid = new Map();
    for (const it of items) {
      const k = cellKey([it.lat, it.lon]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(it);
    }
    return function near(p, maxKm) {
      const r = Math.floor(p[0] / CELL), c = Math.floor(p[1] / CELL), n = Math.ceil(maxKm / 2) + 1;
      const out = [];
      for (let dr = -n; dr <= n; dr++) for (let dc = -n; dc <= n; dc++) {
        for (const it of grid.get(`${r + dr}:${c + dc}`) || []) if (fastKm(p, [it.lat, it.lon]) <= maxKm) out.push(it);
      }
      return out;
    };
  }

  // Güzergah üzerinde, aynı yönde ilerleyen hız koridorlarını bulur.
  function corridorsOnRoute(dense, nearestIndex, corridors) {
    const hits = [];
    for (const k of corridors) {
      const c = k.coords || [];
      if (c.length < 2) continue;
      const step = Math.max(1, Math.floor(c.length / 12));
      const sample = c.filter((_, i) => i % step === 0).concat([c[c.length - 1]]);
      const idx = sample.map((p) => nearestIndex(p, 0.6));
      const matched = idx.filter((i) => i >= 0);
      if (matched.length < sample.length * 0.8) continue;
      if (matched[0] >= matched[matched.length - 1]) continue; // ters yön
      hits.push({ ...k, routeIndex: matched[0] });
    }
    return hits.sort((a, b) => a.routeIndex - b.routeIndex);
  }

  // Rotayı geçtiği illere böler: her ilin rota üzerindeki [ilk, son] nokta sırası.
  function provinceSegments(dense, iller) {
    const seg = new Map();
    const stride = Math.max(1, Math.floor(dense.length / 1500));
    for (let i = 0; i < dense.length; i += stride) {
      let best = null, bestD = Infinity;
      for (const il of iller) {
        const d = fastKm(dense[i], [il.lat, il.lon]);
        if (d < bestD) { bestD = d; best = il; }
      }
      const s = seg.get(best.id);
      if (!s) seg.set(best.id, { first: i, last: i });
      else s.last = i;
    }
    return seg;
  }

  window.Veri = {
    slug, loadIndex, hasRoute, findRoute, isStraightLine, osrmRoute, weather,
    loadCorridors, densify, buildRouteIndex, corridorsOnRoute, provinceSegments,
    loadCameras, camerasOnRoute, pointIndex, fastKm, routeHazards, loadProvinceSummary,
  };
})();
