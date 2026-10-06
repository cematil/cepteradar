// Veri betiklerinin ortak yardımcıları: İçişleri cevabını dönüştürme, sadeleştirme,
// iller_kucuk/ dosyalarına kaydetme ve index.json / koridorlar.json üretme.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'iller_kucuk');
const SPECIAL = new Set(['index.json', 'koridorlar.json', 'osm_radarlar.json', 'il_ozet.json']);

export const slug = (s) => String(s || '').trim().toLocaleLowerCase('tr')
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
  .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/[^a-z]/g, '');

export const asList = (d) => (Array.isArray(d) ? d : d ? [d] : []);
const round = (n) => Math.round(n * 1e5) / 1e5;

// js/iller.js içindeki 81 il listesi
export function loadIller() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/iller.js'), 'utf8'), sandbox);
  return sandbox.window.ILLER;
}

// Douglas-Peucker sadeleştirme ([lat, lon] dizisi, tolerans derece cinsinden ~0.0003 ≈ 30 m)
export function simplify(points, tol = 0.0003) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const xyToLatLon = (arr) => asList(arr)
  .filter((p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y))
  .map((p) => [round(+p.y), round(+p.x)]);

// İçişleri "CreateRoute" cevabını (tamamı ya da sadece "data" kısmı) uygulama kaydına çevirir.
export function donustur(cevap) {
  const d = cevap && cevap.data ? cevap.data : cevap;
  if (!d || !d.FromDistrict || !d.ToDistrict) throw new Error('Beklenmeyen cevap biçimi');
  const [kalkis_il, kalkis_ilce = 'Merkez'] = String(d.FromDistrict).split(',').map((s) => s.trim());
  const [varis_il, varis_ilce = 'Merkez'] = String(d.ToDistrict).split(',').map((s) => s.trim());
  const kayit = {
    kalkis_il, kalkis_ilce, varis_il, varis_ilce,
    radar_sayisi: String(d.RadarCount ?? 0),
    kontrol_sayisi: String(d.ControlPointCount ?? 0),
    koridor_sayisi: String(d.CorridorCount ?? 0),
    gecen_iller: asList(d.Cities).map((c) => ({ City: c.City, Radarli: +c.Radarli || 0, Radarsiz: +c.Radarsiz || 0 })),
    hiz_koridorlari: asList(d.SpeedTunnels).map((k) => ({
      id: k.id ?? null,
      name: String(k.name || '').replace(/\s+/g, ' ').trim(),
      province: String(k.provinceName || '').trim(),
      speed_limit: +k.speedLimit || null,
      length: +k.length || 0,
      coords: simplify(xyToLatLon(k.coordinates), 0.0001),
    })),
    rota_coords: simplify(xyToLatLon(d.Coordinates)),
    guncelleme: new Date().toISOString().slice(0, 10),
  };
  // Site ileride radar konumu verirse ham haliyle saklanır.
  if (asList(d.Radars).length) kayit.radarlar = d.Radars;
  return kayit;
}

export function loadCity(id) {
  const file = path.join(DATA_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return [];
  try { return asList(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return []; }
}

// Kayıtları kalkış iline göre dosyalara yazar; aynı kalkış-varış çifti varsa yenisi geçerli olur.
export function kaydet(kayitlar) {
  const groups = new Map();
  for (const r of kayitlar) {
    const from = slug(r?.kalkis_il), to = slug(r?.varis_il);
    if (!from || !to || from === to) continue;
    if (!groups.has(from)) groups.set(from, new Map(loadCity(from).map((x) => [slug(x.varis_il), x])));
    groups.get(from).set(to, r);
  }
  for (const [from, routes] of groups) {
    const list = [...routes.values()].sort((a, b) => a.varis_il.localeCompare(b.varis_il, 'tr'));
    fs.writeFileSync(path.join(DATA_DIR, `${from}.json`), JSON.stringify(list));
  }
  return [...groups.keys()];
}

export function cityFiles() {
  return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && !SPECIAL.has(f)).map((f) => f.slice(0, -5)).sort();
}

// index.json (hangi rotaların verisi var) ve koridorlar.json (tekil hız koridorları) üretir.
export function indeksle() {
  const index = {};
  const corridors = new Map();
  const iller = new Map(); // il -> rotalardaki [radarlı, radarsız] değerleri
  const straight = (c) => c.length < 3 || c.every((p, i) => i === 0 ||
    (Math.abs(p[0] - c[i - 1][0] - (c[1][0] - c[0][0])) < 1e-3 && Math.abs(p[1] - c[i - 1][1] - (c[1][1] - c[0][1])) < 1e-3));
  for (const id of cityFiles()) {
    const recs = loadCity(id);
    const targets = [...new Set(recs.map((r) => slug(r.varis_il)).filter(Boolean))].sort();
    if (targets.length) index[id] = targets;
    for (const r of recs) {
      for (const c of asList(r.gecen_iller)) {
        if (!c || typeof c !== 'object' || !c.City) continue;
        const k = slug(c.City);
        if (!iller.has(k)) iller.set(k, { ad: String(c.City).trim(), r: [], rs: [] });
        iller.get(k).r.push(+c.Radarli || 0);
        iller.get(k).rs.push(+c.Radarsiz || 0);
      }
      for (const k of asList(r.hiz_koridorlari)) {
        const c = Array.isArray(k.coords) ? k.coords : [];
        if (c.length < 2 || straight(c)) continue;
        const key = k.id != null ? `id:${k.id}` : `${k.name}|${c[0]}|${c[c.length - 1]}`;
        if (!corridors.has(key)) corridors.set(key, { id: k.id ?? null, name: k.name, province: k.province || '', speed_limit: k.speed_limit, length: k.length, coords: c });
      }
    }
  }
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(DATA_DIR, 'koridorlar.json'), JSON.stringify([...corridors.values()]));
  // il_ozet.json: her ilin farklı rotalardaki denetim sayılarının ortancası (rota verisi olmayan
  // güzergahlarda tahmin için kullanılır)
  const ortanca = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  const ozet = {};
  for (const [k, v] of [...iller].sort()) ozet[k] = { ad: v.ad, radarli: ortanca(v.r), radarsiz: ortanca(v.rs), rota: v.r.length };
  fs.writeFileSync(path.join(DATA_DIR, 'il_ozet.json'), JSON.stringify(ozet));
  const total = Object.values(index).reduce((n, t) => n + t.length, 0);
  return { iller: Object.keys(index).length, rotalar: total, koridorlar: corridors.size };
}
