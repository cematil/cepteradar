<div align="center">

  <!-- 🟢 CEPTE RADAR LOGO -->
  <img src="assets/logo.svg" alt="Cepte Radar Logosu" width="220" height="220">

  <h1>🛡️ Cepte Radar — Canlı Trafik, Radar & Yol Durumu Takip Sistemi</h1>

  <p>
    <b>Karayolları Genel Müdürlüğü (KGM) verilerine ve canlı coğrafi analizlere dayalı radar, hız koridoru, trafik denetim alanları ve yol çalışma takip platformu.</b>
  </p>

</div>

---

## 🌟 Proje Modülleri ve Logoları

Uygulama iki temel harita modülünden oluşmaktadır:

### 1. Cepte Radar Ana Modülü (`index.html`)
Canlı radar noktalarını, hız koridorlarını, trafik denetim alanlarını, hava durumunu, il bazlı denetim dağılımını ve sürücü risk skorunu sunan ana modül.

### 2. KGM Yol Bakım Onarım & Kapalı Yollar Modülü (`main.html`)
Karayolları Genel Müdürlüğü (KGM) canlı verileriyle Türkiye genelindeki aktif yol çalışmalarını, şantiyeleri ve kapalı geçitleri gösteren harita modülü.

<div align="center">
  <br>

  <!-- 🚧 KGM YOL BAKIM & ONARIM LOGO -->
  <img src="assets/logo-work.svg" alt="Yol Bakım Onarım Logosu" width="200" height="200">
  <br>
  <sub><i>KGM Canlı Yol Çalışmaları & Kapalı Yollar Modül Logosu</i></sub>
</div>

---

## 🚀 Öne Çıkan Özellikler

- 📸 **Canlı Radar & Kontrol Noktaları:** Güzergah üzerindeki sabit/mobil radarları ve polis/jandarma denetim noktalarını anlık harita üzerinde görselleştirme.
- ⚡ **Hız Koridorları & Limit Tabelaları:** Ortalama hız ihlal bölgelerini kesikli kırmızı hatlarla ve hız limiti tabelalarıyla gösterme.
- 🚧 **KGM Canlı Yol Çalışmaları & Kapalı Yollar:** Karayolları Genel Müdürlüğü (KGM) ArcGIS servis altyapısıyla Türkiye genelindeki aktif yol bakımlarını, onarım sahalarını ve kapalı yolları canlı sorgulama.
- 📡 **Kesintisiz Akıllı Konum Takibi:** GPS sinyali zayıfladığında Wi-Fi, hücresel veri ve IP yer tespiti altyapısıyla kilitlenmeden arka planda konum takibi.
- 🔊 **Sesli Yaklaşım İkazı (Web Speech API):** Güzergahtaki radar, kontrol noktaları, hız koridorları veya yol çalışmalarına **2 km** mesafe kaldığında Türkçe sesli ikaz verme.
- 🌤️ **Canlı Meteoroloji & Görüş Mesafesi:** Rota başlangıç, varış ve orta noktalarında anlık sıcaklık, rüzgar ve görüş mesafesi (km) analizi.
- ⚠️ **Güzergah Risk Skoru:** Seçilen rotadaki denetim ve radar yoğunluğuna göre %0 ile %100 arasında otomatik risk analizi.
- 🔍 **Tam SEO ve Sosyal Medya Entegrasyonu:** Open Graph, Twitter Cards, Schema.org (JSON-LD) ve bot dostu semantik metin yapıları.
- 🖥️ **Tam Ekran & Çift Tema Desteği:** Koyu tema destekli arayüz, gerçek karayolu katmanı ve tek tıkla tam ekran harita deneyimi (`ESC` tuşu entegrasyonlu).

---

## 🛠️ Kullanılan Teknolojiler

- **Frontend:** HTML5, CSS3, JavaScript (ES6+), Tailwind CSS
- **Harita & Coğrafi Veri:** Leaflet.js, ArcGIS API for JavaScript, Esri Leaflet, OpenStreetMap Tile Servisleri
- **Haritalama & Rota Servisi:** OSRM (Open Source Routing Machine) API
- **Hava Durumu API:** Open-Meteo API
- **Veri Kaynağı:** Karayolları Genel Müdürlüğü (KGM) MapServer Servisleri
- **Bildirim & Arayüz Elemanları:** SweetAlert2, Web Speech API (Sesli Okuma)

---

## 📱 Web Sitesi + Android Uygulaması

Uygulama artık tamamen tarayıcı tarafında çalışır (ayrı bir API sunucusu gerekmez):
rota OSRM'den, hava durumu Open-Meteo'dan, radar/kontrol/koridor sayıları `iller_kucuk/*.json` dosyalarından okunur.

- **Web:** Klasörü herhangi bir statik barındırmaya (GitHub Pages, Netlify, kendi sunucunuz) yükleyin ya da `npm start` ile `http://localhost:8000` adresinde açın.
- **Telefona kurulum (PWA):** Siteyi Chrome'da açıp "Ana ekrana ekle" deyin; uygulama gibi tam ekran açılır.
- **APK:** Her push'ta GitHub Actions (`.github/workflows/android-apk.yml`) APK üretir. Actions → son çalıştırma → *Artifacts* → `cepteradar-apk`.
  Yerelde derlemek için Android SDK + JDK 21 kurulu olmalı: `npm ci && npm run android:apk`.

## 🗂️ 81 İl Verisi (İçişleri Bakanlığı)

Kaynak: [İller Arası Radar ve Kontrol Noktası Uygulama Sayıları](https://www.icisleri.gov.tr/iller-arasi-radar-ve-kontrol-noktasi-uygulama-sayilari)

Arayüzde 81 ilin tamamı seçilebilir. Bir rota için veri yoksa harita ve hava durumu yine gösterilir, radar sayıları için "veri yok" uyarısı çıkar.
Varış listesinde **●** işaretli iller, seçilen kalkış ilinden verisi olan illerdir. Bir yönün verisi yoksa ters yönün verisi kullanılır.

**Tüm illeri otomatik indirmek için** (kendi bilgisayarınızda, Google Chrome kurulu olmalı):

```bash
npm install
npm run veri:cek                                   # 81 ilin eksik tüm rotaları
node scripts/icisleri-cek.mjs --kalkis izmir       # sadece bir kalkış ili
node scripts/icisleri-cek.mjs --paralel 3          # aynı anda 3 sekme
```

Program İçişleri sayfasını açar, her il çifti için "ROTA OLUŞTUR"a basar ve sitenin cevabını
`iller_kucuk/` klasörüne kaydeder. Ctrl+C ile durdurup tekrar çalıştırırsanız kaldığı yerden devam eder.
Bittiğinde `git add iller_kucuk && git commit -m "Rota verileri" && git push` ile gönderin.

Elle indirilen rota dosyalarını eklemek için:

```bash
node scripts/veri-birlestir.mjs indirilenler/     # klasördeki tüm .json'ları birleştirir
```

Her dosya tek bir rota nesnesi (`{kalkis_il, varis_il, radar_sayisi, ...}`) veya bunların dizisi olabilir.
Kayıtlar kalkış iline göre `iller_kucuk/<il>.json` dosyalarına eklenir, mevcut kayıtlar korunur ve `iller_kucuk/index.json` yeniden üretilir.

## 📁 Proje Dosya Yapısı

```struct
cepteradar/
├── assets/
│   ├── logo.svg            # Cepte Radar Ana Logosu
│   └── logo-work.svg       # KGM Yol Bakım & Onarım Logosu
├── iller_kucuk/            # İl bazında rota JSON verileri + index.json (veri dizini)
├── css/app.css             # Mobil öncelikli arayüz stilleri
├── js/                     # app.js (arayüz), veri.js (veri katmanı), iller.js (81 il), koruma.js
├── vendor/                 # Leaflet & Esri Leaflet (çevrimdışı/APK için yerel kopya)
├── scripts/                # veri-birlestir, ikon-uret, www-hazirla, android-hazirla
├── capacitor.config.json   # Android (APK) paket ayarları
├── index.html              # Cepte Radar Ana Sorgulama & Rota Sayfası
├── main.html               # KGM Canlı Yol Bakım Onarım & Kapalı Yollar Haritası
├── manifest.json           # PWA (Progressive Web App) Desteği
├── sw.js                   # Service Worker Servisi
├── server.js               # Yerel statik sunucu (npm start)
└── README.md               # Proje Dokümantasyonu
