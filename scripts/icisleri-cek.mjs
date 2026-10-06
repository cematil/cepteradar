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

import fs from 'node:fs';
import path from 'node:path';
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

let ilkAdim = true; // ilk rotada adımları ayrıntılı yaz
const adim = (m) => { if (ilkAdim) console.log(`  · ${m}`); };

// Sorun olursa ekran görüntüsü, sayfa kaynağı ve seçim kutusu özetini hata-raporu/ klasörüne yazar.
async function taniKaydet(page, neden) {
  try {
    const dir = path.join(process.cwd(), 'hata-raporu');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'ekran.png'), fullPage: true }).catch(() => {});
    const ozet = [];
    for (const f of page.frames()) {
      const bilgi = await f.evaluate(() => ({
        url: location.href,
        selectler: [...document.querySelectorAll('select')].map((s) => ({
          id: s.id, name: s.name, gorunur: !!(s.offsetWidth || s.offsetHeight), secenek: s.options.length,
          ilkler: [...s.options].slice(0, 4).map((o) => `${o.value}=${o.textContent.trim()}`),
        })),
        butonlar: [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')]
          .map((b) => (b.innerText || b.value || '').trim()).filter((t) => /rota/i.test(t)),
        jquery: !!window.jQuery,
      })).catch((e) => ({ url: f.url(), hata: e.message }));
      ozet.push(bilgi);
      if (f === page.mainFrame()) fs.writeFileSync(path.join(dir, 'sayfa.html'), await f.content().catch(() => ''));
    }
    fs.writeFileSync(path.join(dir, 'bilgi.json'), JSON.stringify({ neden, zaman: new Date().toISOString(), cerceveler: ozet }, null, 2));
    console.log(`\n  Tanı bilgileri kaydedildi: ${dir} (ekran.png, bilgi.json, sayfa.html)`);
  } catch (e) {
    console.log(`  Tanı kaydedilemedi: ${e.message}`);
  }
}

// İl seçim kutularının bulunduğu çerçeveyi bulur (form bir iframe içinde olabilir).
async function formuBul(page, sureMs = 60000) {
  const bitis = Date.now() + sureMs;
  while (Date.now() < bitis) {
    for (const f of page.frames()) {
      const n = await f.evaluate(() => [...document.querySelectorAll('select')].filter((s) => s.options.length >= 70).length).catch(() => 0);
      if (n >= 2) return f;
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function sayfaHazirla(page) {
  adim('İçişleri sayfası açılıyor…');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const frame = await formuBul(page);
  if (!frame) {
    await taniKaydet(page, 'İl seçim kutuları bulunamadı');
    throw new Error('Sayfada il seçim kutuları bulunamadı');
  }
  const kutular = await frame.evaluate(() => {
    const all = [...document.querySelectorAll('select')];
    const il = all.map((s, i) => (s.options.length >= 70 ? i : -1)).filter((i) => i >= 0).slice(0, 2);
    return [il[0], il[0] + 1, il[1], il[1] + 1];
  });
  adim(`Form bulundu (seçim kutuları: ${kutular.join(', ')})`);
  return { frame, kutular };
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

// Seçim kutusunda seçeneği seçer; kutu gizli (select2 vb.) olsa da çalışır.
async function secenekSec(frame, kutu, hedefler) {
  return frame.evaluate(([i, hedefler, fn]) => {
    const slugF = eval(fn);
    const s = document.querySelectorAll('select')[i];
    const opts = [...s.options];
    let idx = -1;
    for (const h of hedefler) {
      if (h === '*ilk*') idx = opts.findIndex((o) => o.value && !/seçiniz|seciniz/i.test(o.textContent));
      else idx = opts.findIndex((o) => slugF(o.textContent) === h);
      if (idx >= 0) break;
    }
    if (idx < 0) return null;
    s.selectedIndex = idx;
    if (window.jQuery) window.jQuery(s).trigger('change');
    else { s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
    return opts[idx].textContent.trim();
  }, [kutu, hedefler, trSlug]);
}

const secenekler = (frame, kutu) => frame.evaluate((i) => [...document.querySelectorAll('select')[i].options].map((o) => o.value).join('|'), kutu);

async function ilSec(page, frame, ilKutu, ilceKutu, il) {
  const once = await secenekler(frame, ilceKutu);
  const secilen = await secenekSec(frame, ilKutu, [il.id]);
  if (!secilen) throw new Error(`${il.ad} il listesinde bulunamadı`);
  adim(`İl seçildi: ${secilen}`);
  const bitis = Date.now() + 20000;
  let simdi = once;
  while (Date.now() < bitis) {
    simdi = await secenekler(frame, ilceKutu);
    if (simdi !== once && simdi.split('|').length > 1) break;
    await page.waitForTimeout(250);
  }
  if (simdi === once && once.split('|').length <= 1) throw new Error(`${il.ad} için ilçe listesi yüklenmedi`);
  const ilce = await secenekSec(frame, ilceKutu, [MERKEZ_ILCE[il.id] || 'merkez', 'merkez', '*ilk*']);
  adim(`İlçe seçildi: ${ilce}`);
}

async function butonaBas(page, frame) {
  const aday = frame.locator('button, a, input[type=button], input[type=submit], [role=button]')
    .filter({ hasText: /rota oluştur/i }).first();
  if (await aday.count()) {
    await aday.click({ force: true, timeout: 10000 });
    return;
  }
  const tiklandi = await frame.evaluate(() => {
    const el = [...document.querySelectorAll('button,a,input,[role=button],div,span')]
      .find((e) => /rota oluştur/i.test((e.innerText || e.value || '').trim()) && (e.innerText || e.value || '').trim().length < 40);
    if (el) { el.click(); return true; }
    return false;
  });
  if (!tiklandi) throw new Error('"ROTA OLUŞTUR" düğmesi bulunamadı');
}

async function rotaCek(page, form, a, b) {
  const { frame, kutular } = form;
  await ilSec(page, frame, kutular[0], kutular[1], a);
  await ilSec(page, frame, kutular[2], kutular[3], b);
  const cevap = page.waitForResponse((r) => /CreateRoute/i.test(r.url()), { timeout: 90000 });
  await butonaBas(page, frame);
  adim('"ROTA OLUŞTUR"a basıldı, cevap bekleniyor…');
  const res = await cevap.catch(() => { throw new Error('Site 90 saniyede rota cevabı vermedi'); });
  const json = await res.json().catch(() => null);
  if (!json || json.success === false || !json.data) throw new Error(json?.message || `Beklenmeyen cevap (HTTP ${res.status()})`);
  const kayit = donustur(json);
  adim(`Cevap alındı: ${kayit.kalkis_il}/${kayit.kalkis_ilce} → ${kayit.varis_il}/${kayit.varis_ilce}, ${kayit.radar_sayisi} radar`);
  ilkAdim = false;
  return kayit;
}

async function calisan(browser, kuyruk) {
  const page = await browser.newPage();
  let form = await sayfaHazirla(page);
  while (kuyruk.length) {
    const { kalkis, hedefler } = kuyruk.shift();
    const tampon = [];
    for (const hedef of hedefler) {
      for (let deneme = 1; deneme <= 3; deneme++) {
        try {
          tampon.push(await rotaCek(page, form, kalkis, hedef));
          break;
        } catch (e) {
          console.warn(`\n  ! ${kalkis.ad} → ${hedef.ad} (deneme ${deneme}/3): ${e.message}`);
          if (deneme === 3) {
            hata++;
            if (hata === 1) await taniKaydet(page, `${kalkis.ad} → ${hedef.ad}: ${e.message}`);
            if (hata >= 5 && bitti < 10) {
              throw new Error('Art arda hata alınıyor; hata-raporu klasöründeki bilgileri gönderin.');
            }
            break;
          }
          await page.waitForTimeout(3000 * deneme);
          form = await sayfaHazirla(page).catch(() => form);
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
let durdu = false;
try {
  await Promise.all(Array.from({ length: Math.min(paralel, kuyruk.length) }, () => calisan(browser, kuyruk)));
} catch (e) {
  durdu = true;
  console.error(`\nDURDU: ${e.message}`);
  console.error('Lütfen bu penceredeki yazıları ve hata-raporu klasörünü (ekran.png, bilgi.json) gönderin.');
}
await browser.close().catch(() => {});
await bitir();
if (!durdu) console.log('Bitti. Değişiklikleri GitHub\'a göndermeyi unutmayın (git add iller_kucuk && git commit && git push).');
