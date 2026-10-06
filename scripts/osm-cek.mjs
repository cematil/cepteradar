#!/usr/bin/env node
// OpenStreetMap'teki Türkiye hız kameralarını (gerçek konumlarıyla) indirir ve
// iller_kucuk/osm_radarlar.json dosyasına yazar. Veri: © OpenStreetMap katkıda bulunanlar (ODbL).
//
// Kullanım:
//   node scripts/osm-cek.mjs                  -> Overpass servisinden indirir (birkaç saniye)
//   node scripts/osm-cek.mjs export.geojson   -> overpass-turbo'dan "Dışa aktar → GeoJSON" ile alınmış dosyayı işler

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib-veri.mjs';

const SUNUCULAR = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const SORGU = `[out:json][timeout:90];
area["ISO3166-1"="TR"][admin_level=2]->.tr;
(
  node["highway"="speed_camera"](area.tr);
  relation["type"="enforcement"]["enforcement"~"maxspeed|average_speed"](area.tr);
);
out body;
>;
out skel qt;`;

async function indir() {
  for (const url of SUNUCULAR) {
    try {
      console.log(`İndiriliyor: ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'CepteRadar/1.0 (veri:osm)' },
        body: `data=${encodeURIComponent(SORGU)}`,
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`  ! ${e.message}`);
    }
  }
  throw new Error('Overpass servislerine ulaşılamadı. overpass-turbo.eu üzerinden GeoJSON indirip dosya yoluyla verebilirsiniz.');
}

// Her iki biçimi de ortak hale getirir: [{ id, lat, lon, tags, rels: [{ role, tags }] }]
function noktalar(veri) {
  const out = [];
  if (Array.isArray(veri.features)) { // GeoJSON (overpass-turbo dışa aktarımı)
    for (const f of veri.features) {
      if (f.geometry?.type !== 'Point') continue;
      const { '@id': id, '@relations': rels = [], ...tags } = f.properties || {};
      const [lon, lat] = f.geometry.coordinates;
      out.push({ id, lat, lon, tags, rels: rels.map((r) => ({ role: r.role, tags: r.reltags || {} })) });
    }
  } else if (Array.isArray(veri.elements)) { // Overpass JSON
    const iliski = new Map();
    for (const e of veri.elements) {
      if (e.type !== 'relation') continue;
      for (const m of e.members || []) {
        if (m.type !== 'node') continue;
        if (!iliski.has(m.ref)) iliski.set(m.ref, []);
        iliski.get(m.ref).push({ role: m.role, tags: e.tags || {} });
      }
    }
    for (const e of veri.elements) {
      if (e.type !== 'node' || e.lat == null) continue;
      const rels = iliski.get(e.id) || [];
      if (!e.tags?.highway && !rels.length) continue;
      out.push({ id: `node/${e.id}`, lat: e.lat, lon: e.lon, tags: e.tags || {}, rels });
    }
  } else throw new Error('Tanınmayan dosya biçimi (GeoJSON ya da Overpass JSON bekleniyor)');
  return out;
}

const sayi = (v) => { const n = parseInt(String(v || ''), 10); return Number.isFinite(n) && n > 0 && n < 200 ? n : null; };
const round = (n) => Math.round(n * 1e5) / 1e5;

function donustur(liste) {
  const sonuc = [];
  const goruldu = new Set();
  for (const n of liste) {
    const kamera = n.tags.highway === 'speed_camera';
    const rels = n.rels;
    // Kamera değilse sadece ortalama hız uygulamasının başlangıç noktası alınır.
    const baslangic = !kamera && rels.find((r) => r.role === 'from' && r.tags.enforcement === 'average_speed');
    if (!kamera && !baslangic) continue;
    const hepsi = [n.tags, ...rels.map((r) => r.tags)];
    const ortalama = hepsi.some((t) => t.enforcement === 'average_speed' || t.average_speed === 'enforcement');
    const mobil = hepsi.some((t) => /mobil|her zaman burada değil/i.test(t.description || ''));
    const k = `${round(n.lat).toFixed(4)},${round(n.lon).toFixed(4)}`;
    if (goruldu.has(k)) continue;
    goruldu.add(k);
    sonuc.push({
      id: n.id,
      tur: mobil ? 'mobil' : ortalama ? 'ortalama' : 'sabit',
      lat: round(n.lat),
      lon: round(n.lon),
      hiz: sayi(n.tags.maxspeed) ?? hepsi.map((t) => sayi(t.maxspeed)).find(Boolean) ?? null,
      ad: n.tags.name || hepsi.map((t) => t.name).find(Boolean) || null,
    });
  }
  return sonuc;
}

const dosya = process.argv[2];
const veri = dosya ? JSON.parse(fs.readFileSync(path.resolve(dosya), 'utf8')) : await indir();
const kayitlar = donustur(noktalar(veri));
if (!kayitlar.length) { console.error('Hiç hız kamerası bulunamadı; dosya değiştirilmedi.'); process.exit(1); }
fs.writeFileSync(path.join(DATA_DIR, 'osm_radarlar.json'), JSON.stringify(kayitlar));
const say = (t) => kayitlar.filter((k) => k.tur === t).length;
console.log(`✓ ${kayitlar.length} kamera kaydedildi: ${say('sabit')} sabit, ${say('ortalama')} ortalama hız, ${say('mobil')} mobil (iller_kucuk/osm_radarlar.json)`);
