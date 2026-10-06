#!/usr/bin/env node
// İçişleri Bakanlığı "İller Arası Radar ve Kontrol Noktası Uygulama Sayıları" sayfasını
// gerçek bir tarayıcıda açar, her il çifti için "ROTA OLUŞTUR"a basar ve sitenin
// CreateRoute cevabını iller_kucuk/ klasörüne kaydeder.
//
// Kurulum (bir kez):  npm install   ve   npx playwright install chromium
//
// Kullanım:
//   node scripts/icisleri-cek.mjs                       -> 81 ilin tüm rotaları (eksik olanlar)
//   node scripts/icisleri-cek.mjs --kalkis adana,izmir  -> sadece bu kalkış illeri
//   node scripts/icisleri-cek.mjs --varis ankara        -> sadece bu varış illeri
//   node scripts/icisleri-cek.mjs --paralel 3           -> aynı anda 3 sekme (varsayılan 2)
//   node scripts/icisleri-cek.mjs --yeniden             -> var olan rotaları da yeniden indir
//   node scripts/icisleri-cek.mjs --gorunmez            -> tarayıcı penceresini gösterme
//
// İstediğiniz zaman Ctrl+C ile durdurabilirsiniz; tekrar çalıştırınca kaldığı yerden devam eder.

import { chromium } from 'playwright';
import { loadIller, loadCity, slug, donustur, kaydet, indeksle } from './lib-veri.mjs';

const URL = process.env.ICISLERI_URL || 'https://www.icisleri.gov.tr/iller-arasi-radar-ve-kontrol-noktasi-uygulama-sayilari';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const liste = (v) => (typeof v === 'string' ? v.split(',').map(slug).filter(Boolean) : null);

const ILLER = loadIller();
const kalkisFiltre = liste(arg('kalkis'));
const varisFiltre = liste(arg('varis'));
const paralel = Math.max(1, Math.min(6, parseInt(arg('paralel', '2'), 10) || 2));
const yeniden = !!arg('yeniden', false);
const gorunmez = !!arg('gorunmez', false);
const bekleme = parseInt(arg('bekle', '800'), 10) || 800;

// İş listesi: her kalkış ili için eksik varış illeri
const isler = ILLER
  .filter((a) => !kalkisFiltre || kalkisFiltre.includes(a.id))
  .map((a) => {
    const mevcut = new Set(yeniden ? [] : loadCity(a.id).map((r) => slug(r.varis_il)));
    const hedefler = ILLER.filter((b) => b.id !== a.id && (!varisFiltre || varisFiltre.includes(b.id)) && !mevcut.has(b.id));
    return { kalkis: a, hedefler };
  })
  .filter((x) => x.hedefler.length);

const toplam = isler.reduce((n, x) => n + x.hedefler.length, 0);
if (!toplam) { console.log('İndirilecek eksik rota yok.'); process.exit(0); }
console.log(`${isler.length} kalkış ili, ${toplam} rota indirilecek (${paralel} sekme).`);

let bitti = 0, hata = 0;
const baslangic = Date.now();

async function sayfaHazirla(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll('select')].filter((s) => s.options.length >= 70).length >= 2, null, { timeout: 60000 });
}

// Sayfadaki seçim kutuları: [kalkışİl, kalkışİlçe, varışİl, varışİlçe] sıra numaraları
async function secimKutulari(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('select')];
    const il = all.map((s, i) => (s.options.length >= 70 ? i : -1)).filter((i) => i >= 0).slice(0, 2);
    return [il[0], il[0] + 1, il[1], il[1] + 1];
  });
}

const trSlug = `(s) => String(s||'').trim().toLocaleLowerCase('tr').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u').replace(/[^a-z]/g,'')`;

// Merkez ilçesi olmayan büyükşehirlerde kullanılacak ilçe (mevcut verilerle aynı).
const MERKEZ_ILCE = {
  adana: 'cukurova', ankara: 'cankaya', antalya: 'kepez', aydin: 'efeler', balikesir: 'altieylul',
  bursa: 'nilufer', denizli: 'merkezefendi', diyarbakir: 'baglar', erzurum: 'palandoken',
  eskisehir: 'odunpazari', gaziantep: 'sahinbey', hatay: 'antakya', istanbul: 'fatih', izmir: 'konak',
  kahramanmaras: 'onikisubat', kayseri: 'melikgazi', kocaeli: 'izmit', konya: 'selcuklu',
  malatya: 'battalgazi', manisa: 'sehzadeler', mardin: 'artuklu', mersin: 'yenisehir', mugla: 'mentese',
  ordu: 'altinordu', sakarya: 'adapazari', samsun: 'ilkadim', sanliurfa: 'haliliye',
  tekirdag: 'suleymanpasa', trabzon: 'ortahisar', van: 'ipekyolu',
};

async function ilSec(page, selIndex, ilceIndex, il) {
  const sel = page.locator('select').nth(selIndex);
  const ilce = page.locator('select').nth(ilceIndex);
  const idx = await sel.evaluate((s, [id, fn]) => {
    const slugF = eval(fn);
    return [...s.options].findIndex((o) => slugF(o.textContent) === id);
  }, [il.id, trSlug]);
  if (idx < 0) throw new Error(`${il.ad} seçeneklerde bulunamadı`);
  const once = await ilce.evaluate((s) => [...s.options].map((o) => o.value).join('|'));
  const ilceCevabi = page.waitForResponse((r) => /GetDistricts/i.test(r.url()), { timeout: 20000 }).catch(() => null);
  await sel.selectOption({ index: idx });
  await ilceCevabi;
  await page.waitForFunction(([i, eski]) => {
    const s = document.querySelectorAll('select')[i];
    return s && s.options.length > 1 && [...s.options].map((o) => o.value).join('|') !== eski;
  }, [ilceIndex, once], { timeout: 20000 }).catch(() => {});
  // İlçe: büyükşehir merkez ilçesi ya da "Merkez", yoksa ilk gerçek seçenek
  const ilceIdx = await ilce.evaluate((s, [hedef, fn]) => {
    const slugF = eval(fn);
    const opts = [...s.options];
    for (const ad of [hedef, 'merkez']) {
      const m = ad ? opts.findIndex((o) => slugF(o.textContent) === ad) : -1;
      if (m >= 0) return m;
    }
    return opts.findIndex((o) => o.value && !/seçiniz|seciniz/i.test(o.textContent));
  }, [MERKEZ_ILCE[il.id] || '', trSlug]);
  if (ilceIdx >= 0) await ilce.selectOption({ index: ilceIdx });
}

async function rotaCek(page, kutular, a, b) {
  await ilSec(page, kutular[0], kutular[1], a);
  await ilSec(page, kutular[2], kutular[3], b);
  const cevap = page.waitForResponse((r) => /CreateRoute/i.test(r.url()), { timeout: 120000 });
  await page.getByText(/ROTA OLUŞTUR/i).first().click();
  const res = await cevap;
  const json = await res.json();
  if (!json || json.success === false || !json.data) throw new Error(json?.message || 'Boş cevap');
  return donustur(json);
}

async function calisan(browser, kuyruk) {
  const page = await browser.newPage();
  await sayfaHazirla(page);
  let kutular = await secimKutulari(page);
  while (kuyruk.length) {
    const { kalkis, hedefler } = kuyruk.shift();
    const tampon = [];
    for (const hedef of hedefler) {
      for (let deneme = 1; deneme <= 3; deneme++) {
        try {
          tampon.push(await rotaCek(page, kutular, kalkis, hedef));
          break;
        } catch (e) {
          if (deneme === 3) { hata++; console.warn(`  ! ${kalkis.ad} → ${hedef.ad}: ${e.message}`); break; }
          await page.waitForTimeout(3000 * deneme);
          await sayfaHazirla(page).catch(() => {});
          kutular = await secimKutulari(page).catch(() => kutular);
        }
      }
      bitti++;
      if (tampon.length >= 3) kaydet(tampon.splice(0));
      const dk = (Date.now() - baslangic) / 60000;
      const kalan = bitti ? Math.round((dk / bitti) * (toplam - bitti)) : '?';
      process.stdout.write(`\r${bitti}/${toplam} rota · hata ${hata} · tahmini kalan ${kalan} dk   `);
      await page.waitForTimeout(bekleme);
    }
    if (tampon.length) kaydet(tampon);
    console.log(`\n✓ ${kalkis.ad} tamamlandı`);
  }
  await page.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: gorunmez, channel: 'chrome' });
} catch {
  browser = await chromium.launch({ headless: gorunmez });
}

const bitir = async () => {
  const ozet = indeksle();
  console.log(`\nVeri olan kalkış ili: ${ozet.iller}/81, toplam rota: ${ozet.rotalar}/6480, hız koridoru: ${ozet.koridorlar}`);
};
process.on('SIGINT', async () => {
  console.log('\nDurduruluyor, kaydedilenler indeksleniyor…');
  await bitir();
  process.exit(0);
});

const kuyruk = isler.slice();
await Promise.all(Array.from({ length: Math.min(paralel, kuyruk.length) }, () => calisan(browser, kuyruk)));
await browser.close();
await bitir();
console.log('Bitti. Değişiklikleri GitHub\'a göndermeyi unutmayın (git add iller_kucuk && git commit && git push).');
