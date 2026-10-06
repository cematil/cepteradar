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
//   node scripts/icisleri-cek.mjs --bekle 8             -> iki sorgu arası en az 8 saniye (varsayılan 6)
//   node scripts/icisleri-cek.mjs --engel-bekle 60      -> site sorguları engellerse 60 dk bekle (varsayılan 30)
//   node scripts/icisleri-cek.mjs --yeniden             -> var olan rotaları da yeniden indir
//   node scripts/icisleri-cek.mjs --gorunmez            -> tarayıcı penceresini gösterme
//   node scripts/icisleri-cek.mjs --iki-yon             -> ters yönü kayıtlı rotaları da indir
//
// Uygulama A→B rotası yoksa B→A verisini kullandığı için varsayılan olarak her il çiftinin
// tek yönü indirilir (sorgu sayısı yarıya iner).
//
// Site kısa sürede çok sorguya izin vermiyor; program yavaş ilerler, engel görünce bekleyip
// kendiliğinden devam eder. Bilgisayarı açık bırakmanız yeterli. Ctrl+C ile durdurup tekrar
// çalıştırırsanız kaldığı yerden devam eder. Önemli il çiftleri (büyük şehirler) önce indirilir.

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
const paralel = Math.max(1, Math.min(3, parseInt(arg('paralel', '1'), 10) || 1));
const yeniden = !!arg('yeniden', false);
const gorunmez = !!arg('gorunmez', false);
const ikiYon = !!arg('iki-yon', false);
const bekleme = (parseFloat(arg('bekle', '6')) || 6) * 1000;
const engelBekle = (parseFloat(arg('engel-bekle', '30')) || 30) * 60000;

// Önce büyük şehirler arasındaki rotalar indirilsin.
const ONCELIK = ['istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'konya', 'adana', 'gaziantep', 'sanliurfa',
  'kocaeli', 'mersin', 'diyarbakir', 'kayseri', 'eskisehir', 'samsun', 'denizli', 'trabzon', 'erzurum', 'malatya',
  'van', 'sakarya', 'manisa', 'balikesir', 'aydin', 'mugla', 'hatay', 'kahramanmaras', 'tekirdag', 'sivas', 'afyonkarahisar'];
const sira = (il) => { const i = ONCELIK.indexOf(il.id); return i < 0 ? 100 + il.plaka : i; };

// İş listesi: her kalkış ili için eksik varış illeri
const kayitli = new Set();
if (!yeniden) for (const il of ILLER) for (const r of loadCity(il.id)) kayitli.add(`${il.id}|${slug(r.varis_il)}`);
const planli = new Set();
const isler = ILLER.slice().sort((a, b) => sira(a) - sira(b))
  .filter((a) => !kalkisFiltre || kalkisFiltre.includes(a.id))
  .map((a) => {
    const hedefler = ILLER.slice().sort((x, y) => sira(x) - sira(y)).filter((b) => {
      if (b.id === a.id || (varisFiltre && !varisFiltre.includes(b.id))) return false;
      if (kayitli.has(`${a.id}|${b.id}`)) return false;
      if (!ikiYon && (kayitli.has(`${b.id}|${a.id}`) || planli.has(`${b.id}|${a.id}`))) return false;
      planli.add(`${a.id}|${b.id}`);
      return true;
    });
    return { kalkis: a, hedefler };
  })
  .filter((x) => x.hedefler.length);

const toplam = isler.reduce((n, x) => n + x.hedefler.length, 0);
if (!toplam) { console.log('İndirilecek eksik rota yok.'); process.exit(0); }
console.log(`${isler.length} kalkış ili, ${toplam} rota indirilecek (${paralel} sekme, sorgular arası ~${bekleme / 1000} sn).`);

class EngelHatasi extends Error {}
const saat = (ms) => new Date(Date.now() + ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

let bitti = 0, hata = 0;
const baslangic = Date.now();

let ilkAdim = true; // ilk rotada adımları ayrıntılı yaz
const adim = (m) => { if (ilkAdim) console.log(`  · ${m}`); };

// Sorun olursa ekran görüntüsü, sayfa kaynağı ve seçim kutusu özetini hata-raporu/ klasörüne yazar.
async function taniKaydet(page, neden) {
  // Tanı kaydı programı asla kilitlememeli: en fazla 20 sn
  return Promise.race([taniKaydetIc(page, neden), new Promise((r) => setTimeout(r, 20000))]);
}

async function taniKaydetIc(page, neden) {
  try {
    const dir = path.join(process.cwd(), 'hata-raporu');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'ekran.png'), timeout: 10000 }).catch(() => {});
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
  // Site hata mesajlarını alert() penceresiyle gösteriyor; mesaj okunup pencere kapatılır.
  if (!page._uyariDinleniyor) {
    page._uyariDinleniyor = true;
    page.on('dialog', (d) => {
      page._sonUyari = d.message();
      console.log(`   · Site uyarısı: ${d.message()}`);
      d.dismiss().catch(() => {});
    });
  }
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
  // Çerez çubuğu "ROTA OLUŞTUR" düğmesinin üstünü kapatıyor; kabul edip kapatılır.
  await frame.evaluate(() => {
    const kabul = document.querySelector('.acceptcookies');
    if (kabul) kabul.click();
    const cubuk = kabul && kabul.closest('.alert, .cookiealert, [class*=cookie]');
    if (cubuk) cubuk.style.display = 'none';
  }).catch(() => {});
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

// Düğmeye sitenin kendi tıklama işleyicisiyle basılır (fare koordinatı kullanılmaz,
// böylece üstte duran çerez çubuğu vb. tıklamayı yutamaz).
async function butonaBas(page, frame) {
  const sonuc = await frame.evaluate(() => {
    const el = document.querySelector('#createRouteBtn') ||
      [...document.querySelectorAll('button,a,input,[role=button]')]
        .find((e) => /rota oluştur/i.test((e.innerText || e.value || '').trim()));
    if (!el) return 'yok';
    el.disabled = false;
    el.scrollIntoView({ block: 'center' });
    if (window.jQuery) window.jQuery(el).trigger('click');
    else el.click();
    return 'tamam';
  });
  if (sonuc === 'yok') throw new Error('"ROTA OLUŞTUR" düğmesi bulunamadı');
}

async function rotaCek(page, form, a, b) {
  const { frame, kutular } = form;
  await ilSec(page, frame, kutular[0], kutular[1], a);
  await ilSec(page, frame, kutular[2], kutular[3], b);
  page._sonUyari = null;
  const cevap = page.waitForResponse((r) => /CreateRoute/i.test(r.url()), { timeout: 90000 });
  await butonaBas(page, frame);
  adim('"ROTA OLUŞTUR"a basıldı, cevap bekleniyor (en fazla 90 sn)…');
  const res = await cevap.catch(() => {
    const uyari = page._sonUyari;
    if (uyari && /seçim/i.test(uyari)) throw new Error(`Site: ${uyari}`);
    throw new EngelHatasi(uyari ? `Site uyarısı: ${uyari}` : 'Site 90 saniyede rota cevabı vermedi');
  });
  if ([403, 429, 503].includes(res.status())) throw new EngelHatasi(`Site sorguyu reddetti (HTTP ${res.status()})`);
  const json = await res.json().catch(() => null);
  if (!json || json.success === false || !json.data) {
    const mesaj = json?.message || `Beklenmeyen cevap (HTTP ${res.status()})`;
    // "Servis çağrılırken hata oluştu": site birkaç sorgudan sonra bunu veriyor (sorgu sınırı).
    if (/limit|fazla|çok|cok|sınır|sinir|captcha|doğrula|dogrula|bekle|deneyin|servis|hata oluştu/i.test(mesaj)) throw new EngelHatasi(mesaj);
    throw new Error(mesaj);
  }
  const kayit = donustur(json);
  adim(`Cevap alındı: ${kayit.kalkis_il}/${kayit.kalkis_ilce} → ${kayit.varis_il}/${kayit.varis_ilce}, ${kayit.radar_sayisi} radar`);
  ilkAdim = false;
  return kayit;
}

async function calisan(browser, kuyruk) {
  let page = await browser.newPage();
  let form = await sayfaHazirla(page);
  let engelSayisi = 0;
  let engelBaslangic = 0;
  let engelOncesiSorgu = 0;
  let sorgu = 0;
  const deneme = new Map();
  const yenidenAc = async () => {
    if (page.isClosed()) page = await browser.newPage();
    form = await sayfaHazirla(page);
  };
  while (kuyruk.length) {
    const { kalkis, hedefler } = kuyruk.shift();
    const tampon = [];
    for (let i = 0; i < hedefler.length; i++) {
      const hedef = hedefler[i];
      try {
        if (page.isClosed()) await yenidenAc();
        sorgu++;
        tampon.push(await rotaCek(page, form, kalkis, hedef));
        if (engelBaslangic) {
          console.log(`\n  ▶ Site yeniden cevap veriyor. Engel yaklaşık ${Math.round((Date.now() - engelBaslangic) / 60000)} dk sürdü; engelden önce ${engelOncesiSorgu} sorgu yapılabilmişti.`);
          engelBaslangic = 0;
          sorgu = 1;
        }
        engelSayisi = 0;
        bitti++;
      } catch (e) {
        if (/closed/i.test(e.message)) {
          console.warn('\n  ! Tarayıcı penceresi kapandı, yeniden açılıyor (durdurmak için Ctrl+C).');
          if (!browser.isConnected()) throw new Error('Tarayıcı kapatıldı');
          await yenidenAc().catch(() => {});
          i--; continue;
        }
        if (e instanceof EngelHatasi) {
          engelSayisi++;
          if (!engelBaslangic) { engelBaslangic = Date.now(); engelOncesiSorgu = sorgu - 1; }
          if (tampon.length) kaydet(tampon.splice(0));
          if (engelSayisi === 1) await taniKaydet(page, `${kalkis.ad} → ${hedef.ad}: ${e.message}`);
          // Bu rotanın kendisi bozuk olabilir: 3 kez engele denk gelirse atlanır.
          const n = (deneme.get(hedef.id) || 0) + 1;
          deneme.set(hedef.id, n);
          const ms = engelBekle * Math.min(engelSayisi, 4);
          console.warn(`\n  ⏸ ${e.message}. Site sorgu sınırına ulaşılmış olabilir; ${Math.round(ms / 60000)} dk bekleniyor (saat ${saat(ms)}'de devam).`);
          await new Promise((r) => setTimeout(r, ms));
          await yenidenAc().catch(() => {});
          if (n < 3) hedefler.push(hedef); // rota listenin sonunda tekrar denenir
          else { hata++; bitti++; console.warn(`\n  ! ${kalkis.ad} → ${hedef.ad}: 3 denemede alınamadı, atlandı.`); }
          continue;
        }
        hata++;
        bitti++;
        console.warn(`\n  ! ${kalkis.ad} → ${hedef.ad}: ${e.message}`);
        if (hata === 1) await taniKaydet(page, `${kalkis.ad} → ${hedef.ad}: ${e.message}`);
        if (hata >= 5 && bitti < 10) throw new Error('Art arda hata alınıyor; hata-raporu klasöründeki bilgileri gönderin.');
        await yenidenAc().catch(() => {});
      }
      if (tampon.length >= 3) kaydet(tampon.splice(0));
      const dk = (Date.now() - baslangic) / 60000;
      const kalan = bitti ? Math.round((dk / bitti) * (toplam - bitti)) : '?';
      process.stdout.write(`\r${bitti}/${toplam} rota · hata ${hata} · tahmini kalan ${kalan} dk   `);
      await page.waitForTimeout(bekleme + Math.random() * bekleme * 0.5).catch(() => {});
    }
    if (tampon.length) kaydet(tampon);
    console.log(`\n✓ ${kalkis.ad} tamamlandı`);
  }
  if (!page.isClosed()) await page.close();
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
