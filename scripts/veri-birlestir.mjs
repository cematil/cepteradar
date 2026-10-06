#!/usr/bin/env node
// İçişleri Bakanlığı "İller Arası Radar ve Kontrol Noktası Uygulama Sayıları"
// sayfasından indirilen rota JSON'larını iller_kucuk/ klasörüne birleştirir.
//
// Kullanım:
//   node scripts/veri-birlestir.mjs                 -> sadece iller_kucuk/index.json'u yeniden üretir
//   node scripts/veri-birlestir.mjs indirilenler/   -> klasördeki tüm .json dosyalarını birleştirir
//   node scripts/veri-birlestir.mjs a.json b.json   -> verilen dosyaları birleştirir
//
// Girdi dosyası tek bir rota nesnesi ({kalkis_il, varis_il, ...}) ya da bu
// nesnelerden oluşan bir dizi olabilir. Her rota kalkış iline göre
// iller_kucuk/<il>.json dosyasına yazılır; aynı kalkış-varış çifti zaten
// varsa yeni gelen kayıt eskisinin yerine geçer. Mevcut kayıtlar korunur.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'iller_kucuk');

const slug = (s) => String(s || '').trim().toLocaleLowerCase('tr')
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
  .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/[^a-z]/g, '');

const asList = (data) => (Array.isArray(data) ? data : data ? [data] : []);
const round = (n) => Math.round(n * 1e5) / 1e5;
const roundCoords = (coords) => Array.isArray(coords)
  ? coords.map((p) => (Array.isArray(p) ? [round(+p[0]), round(+p[1])] : p))
  : coords;

function normalize(rec) {
  return {
    ...rec,
    rota_coords: roundCoords(rec.rota_coords),
    hiz_koridorlari: asList(rec.hiz_koridorlari).map((k) => ({ ...k, coords: roundCoords(k.coords) })),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`! Okunamadı: ${file} (${e.message})`);
    return null;
  }
}

function collectInputs(args) {
  const files = [];
  for (const arg of args) {
    const p = path.resolve(arg);
    if (!fs.existsSync(p)) { console.warn(`! Bulunamadı: ${arg}`); continue; }
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) files.push(path.join(p, f));
    } else files.push(p);
  }
  return files;
}

function loadCity(id) {
  const file = path.join(DATA_DIR, `${id}.json`);
  return fs.existsSync(file) ? asList(readJson(file)) : [];
}

const inputs = collectInputs(process.argv.slice(2));
const updates = new Map(); // kalkış il id -> Map(varış il id -> kayıt)
let added = 0;

for (const file of inputs) {
  for (const rec of asList(readJson(file))) {
    const from = slug(rec?.kalkis_il);
    const to = slug(rec?.varis_il);
    if (!from || !to || from === to) continue;
    if (!updates.has(from)) {
      updates.set(from, new Map(loadCity(from).map((r) => [slug(r.varis_il), r])));
    }
    updates.get(from).set(to, normalize(rec));
    added++;
  }
}

for (const [from, routes] of updates) {
  const list = [...routes.values()].sort((a, b) => a.varis_il.localeCompare(b.varis_il, 'tr'));
  fs.writeFileSync(path.join(DATA_DIR, `${from}.json`), JSON.stringify(list));
  console.log(`✓ ${from}.json: ${list.length} rota`);
}

// index.json: hangi kalkış ilinden hangi varış illerine veri olduğunu listeler.
const index = {};
for (const f of fs.readdirSync(DATA_DIR).sort()) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'koridorlar.json') continue;
  const id = f.slice(0, -5);
  const targets = [...new Set(loadCity(id).map((r) => slug(r.varis_il)).filter(Boolean))].sort();
  if (targets.length) index[id] = targets;
}
fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index));

// koridorlar.json: tüm dosyalardaki gerçek geometrili hız koridorlarının tekil listesi.
// Uygulama, verisi olmayan rotalarda da güzergah üzerindeki koridorları buradan bulur.
const isStraightLine = (c) => c.length < 3 || c.every((p, i) => i === 0 ||
  (Math.abs(p[0] - c[i - 1][0] - (c[1][0] - c[0][0])) < 1e-3 && Math.abs(p[1] - c[i - 1][1] - (c[1][1] - c[0][1])) < 1e-3));
const corridors = new Map();
for (const id of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'koridorlar.json').map((f) => f.slice(0, -5))) {
  for (const r of loadCity(id)) {
    for (const k of asList(r.hiz_koridorlari)) {
      const c = Array.isArray(k.coords) ? k.coords : [];
      if (c.length < 2 || isStraightLine(c)) continue;
      const key = k.id != null ? `id:${k.id}` : `${k.name}|${c[0]}|${c[c.length - 1]}`;
      if (!corridors.has(key)) {
        corridors.set(key, { id: k.id ?? null, name: k.name, province: k.province || '', speed_limit: k.speed_limit, length: k.length, coords: roundCoords(c) });
      }
    }
  }
}
fs.writeFileSync(path.join(DATA_DIR, 'koridorlar.json'), JSON.stringify([...corridors.values()]));
console.log(`✓ koridorlar.json: ${corridors.size} gerçek hız koridoru`);

const total = Object.values(index).reduce((n, t) => n + t.length, 0);
console.log(`\n${added} kayıt işlendi. Veri olan kalkış ili: ${Object.keys(index).length}/81, toplam rota: ${total}/6480`);
