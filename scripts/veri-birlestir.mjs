#!/usr/bin/env node
// Rota JSON dosyalarını iller_kucuk/ klasörüne birleştirir.
//
// Kullanım:
//   node scripts/veri-birlestir.mjs                 -> sadece index.json ve koridorlar.json'u yeniden üretir
//   node scripts/veri-birlestir.mjs indirilenler/   -> klasördeki tüm .json dosyalarını birleştirir
//   node scripts/veri-birlestir.mjs a.json b.json   -> verilen dosyaları birleştirir
//
// Kabul edilen biçimler:
//   - İçişleri sitesinin "CreateRoute" cevabı ({"success":true,"data":{"FromDistrict":...}})
//   - Uygulama kaydı ({kalkis_il, varis_il, radar_sayisi, ...}) ya da bunların dizisi
// Mevcut kayıtlar korunur; aynı kalkış-varış çifti gelirse yenisi geçerli olur.

import fs from 'node:fs';
import path from 'node:path';
import { asList, donustur, kaydet, indeksle } from './lib-veri.mjs';

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

const kayitlar = [];
for (const file of collectInputs(process.argv.slice(2))) {
  const json = readJson(file);
  if (!json) continue;
  if (json.data?.FromDistrict || json.FromDistrict) {
    try { kayitlar.push(donustur(json)); } catch (e) { console.warn(`! ${file}: ${e.message}`); }
  } else {
    kayitlar.push(...asList(json).filter((r) => r && r.kalkis_il && r.varis_il));
  }
}

if (kayitlar.length) {
  const iller = kaydet(kayitlar);
  console.log(`✓ ${kayitlar.length} rota kaydedildi (${iller.join(', ')})`);
}
const ozet = indeksle();
console.log(`Veri olan kalkış ili: ${ozet.iller}/81, toplam rota: ${ozet.rotalar}/6480, hız koridoru: ${ozet.koridorlar}`);
