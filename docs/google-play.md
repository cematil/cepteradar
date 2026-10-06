# Cepte Radar — Google Play Yayın Rehberi

Bu rehber uygulamayı Google Play'e yüklemek için gereken her şeyi sırasıyla anlatır.
Google'ın kuralları sık değişir; her adımda Play Console'da gördüğünüz güncel metin esastır.

---

## 1. Yükleme anahtarı (bir kez)

Play'e yüklenen dosya sizin **yükleme anahtarınızla** imzalanır. Anahtarı kaybederseniz Play Console'dan
sıfırlatabilirsiniz, ama yine de **yedekleyin ve kimseyle paylaşmayın**.

1. Java kurulu değilse kurun: <https://adoptium.net> → "Temurin 21 (LTS)" → Windows `.msi`.
2. PowerShell'i açıp anahtarı oluşturun (şifreleri bir yere not edin):
   ```powershell
   keytool -genkeypair -v -keystore cepteradar-upload.jks -alias cepteradar -keyalg RSA -keysize 2048 -validity 10000
   ```
   Ad-soyad, şehir vb. sorulara cevap verin; sonunda `cepteradar-upload.jks` dosyası oluşur.
3. Dosyayı GitHub'a eklenebilir metne çevirin (panoya kopyalar):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("cepteradar-upload.jks")) | Set-Clipboard
   ```
4. GitHub → depo → **Settings → Secrets and variables → Actions → New repository secret**:

   | Ad | Değer |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | 3. adımda kopyalanan metin |
   | `ANDROID_KEYSTORE_PASSWORD` | anahtar deposu şifresi |
   | `ANDROID_KEY_ALIAS` | `cepteradar` |
   | `ANDROID_KEY_PASSWORD` | anahtar şifresi (keytool ayrı sormadıysa depo şifresiyle aynı) |

> `.jks` dosyasını ve şifreleri sohbete, e-postaya veya depoya **koymayın**; sadece GitHub gizli değerlerine.

## 2. İmzalı paket (.aab) üretme

GitHub → **Actions → "Android Play Sürümü" → Run workflow**. Bitince çalıştırmanın altındaki
**Artifacts → `cepteradar-play-aab`** içinde `app-release.aab` olur. Her çalıştırmada sürüm kodu otomatik artar.
Yeni sürüm adı için `package.json` içindeki `"version"` değerini değiştirin (ör. `1.0.1`).

## 3. Play Console'da uygulama oluşturma

<https://play.google.com/console> → **Uygulama oluştur**: ad "Cepte Radar", varsayılan dil Türkçe, Uygulama, Ücretsiz.

### Uygulama içeriği (App content) cevapları

| Bölüm | Cevap |
|---|---|
| Gizlilik politikası | `https://cematil.github.io/cepteradar/gizlilik.html` (iletişim: mikurin83@gmail.com) |
| Uygulama erişimi | Tüm işlevler özel erişim gerektirmez (giriş yok) |
| Reklamlar | Hayır, reklam içermiyor |
| İçerik derecelendirmesi | Anketi doldurun: şiddet, kumar, kullanıcı etkileşimi vb. yok → genelde "3+" çıkar |
| Hedef kitle | **18 ve üzeri** (sürücülere yönelik; çocuk politikalarına girmemek için) |
| Haber uygulaması | Hayır |
| Devlet uygulaması / hükümetle bağlantı | **Hayır**, bir devlet kurumuyla bağlantılı değil (açıklamaya 5. bölümdeki notu koyun) |
| Finans, sağlık özellikleri | Yok |

### Veri güvenliği (Data safety) formu

Sürüşte konumun çevresi OpenStreetMap (Overpass) servisine, il koordinatları rota/hava servislerine iletilir.
Kullanıcı "Bildir" ile topluluk bildirimi bırakırsa bildirim (tür, konum, zaman, anonim kimlik) Firebase'de 1 saat saklanır
ve diğer kullanıcılara gösterilir. Temkinli ve doğru beyan:

| Soru | Cevap |
|---|---|
| Uygulama gerekli kullanıcı verilerini topluyor veya paylaşıyor mu? | **Evet** |
| Aktarılan tüm veriler şifreleniyor mu? | **Evet** (tüm bağlantılar HTTPS) |
| Kullanıcılar verilerinin silinmesini isteyebilir mi? | Veri sunucuda saklanmadığı için "veriler otomatik/anında silinir" seçeneğini işaretleyin; gizlilik politikasındaki açıklamayı kullanın |
| **Konum → Yaklaşık konum** | Toplanıyor: Evet · Paylaşılıyor: Evet · Geçici işleniyor: **Hayır** (bildirimler 1 saat saklanır) · Zorunlu değil (kullanıcı seçer) · Amaç: **Uygulama işlevselliği** |
| **Konum → Hassas konum** | Aynı cevaplar |
| **Uygulama etkinliği → Diğer kullanıcı tarafından oluşturulan içerik** | Toplanıyor: Evet (topluluk bildirimleri ve oylar) · Paylaşılıyor: Hayır (yalnızca uygulama içinde diğer kullanıcılara gösterilir) · Zorunlu değil · Amaç: Uygulama işlevselliği |
| **Cihaz veya diğer kimlikler** | Toplanıyor: Evet (Firebase anonim oturum kimliği) · Paylaşılıyor: Hayır · Zorunlu değil · Amaç: Uygulama işlevselliği, **Sahtekarlık önleme, güvenlik** |
| Kişisel bilgi, finans, iletişim, fotoğraf, dosya | **Hayır** |

**Kullanıcı tarafından oluşturulan içerik (UGC) kuralı:** Bildirimler serbest metin içermez (yalnızca 6 sabit tür), 1 saatte
kaybolur ve diğer sürücüler "Artık yok" oyuyla kaldırabilir. Bu, Play'in UGC kurallarındaki denetim ve şikâyet şartını karşılar;
Uygulama içeriği bölümünde UGC sorusu çıkarsa bu açıklamayı kullanın.

### Konum izni

Uygulama yalnızca **ön planda** (açıkken) konum kullanır; arka plan konum beyan formu gerekmez.
Konum istenmeden önce uygulama içinde açıklama ekranı gösterilir (Play'in "belirgin açıklama" kuralı).

## 4. Mağaza girişi (Store listing)

**Uygulama adı** (en fazla 30): `Cepte Radar: Radar ve Kamera`

**Kısa açıklama** (en fazla 80):
```
Rotandaki radar, kamera, hız koridoru ve tehlikeleri gör; yolda sesli uyarı al.
```

**Tam açıklama** (en fazla 4000):
```
Cepte Radar, iller arası yolculukta güzergahınızdaki radar denetimlerini, trafik kontrol noktalarını, ortalama hız koridorlarını ve hız kameralarını yola çıkmadan önce gösterir; yolda sizi önceden sesli olarak uyarır.

ROTANIZI SORGULAYIN
• 81 il arasında Nereden – Nereye seçin, rotanızdaki radar, kontrol noktası, hız koridoru ve kamera sayısını görün.
• Güzergah Uyarıları listesinde tüm noktalar kilometre sırasıyla.
• Geçilen illerin denetim dağılımı, güzergah risk skoru, kalkış ve varışta hava durumu.

SÜRÜŞ MODU
• Kameralara ve hız koridorlarına 1 km, 500 m ve 200 m kala sesli uyarı ve ekran parlaması.
• Hemzemin geçit, okul geçidi ve tehlikeli noktalarda (heyelan, tehlikeli viraj…) uyarı.
• Bulunduğunuz yolun hız sınırı ve büyük hız kadranı: sınırı aşınca kırmızıya döner.
• Ortalama hız koridoru sayacı: geçen süre, kalan mesafe, ortalamanız ve sınırı aşmadan çıkışa en erken ne zaman varacağınız.
• HUD modu: gece telefonunuzu torpidoya koyun, hız ve uyarılar ön cama yansısın.

HARİTA
• Hız kameralarının gerçek konumları, yanıp sönen uyarı işaretleri ve açıklamalı lejant.
• Karayolları yol çalışması ve kapalı yol katmanı.

Üyelik yok, reklam yok. Konumunuz kaydedilmez.

ÖNEMLİ: Cepte Radar resmi bir devlet uygulaması değildir ve herhangi bir kamu kurumuyla bağlantısı yoktur. Radar ve kontrol noktası sayıları kamuya açık kaynaklardan (T.C. İçişleri Bakanlığı "İller Arası Radar ve Kontrol Noktası Uygulama Sayıları" sayfası: https://www.icisleri.gov.tr/iller-arasi-radar-ve-kontrol-noktasi-uygulama-sayilari) derlenir; kamera, hız sınırı ve tehlike noktaları OpenStreetMap katkıcılarına (© OpenStreetMap, ODbL) aittir; yol çalışmaları Karayolları Genel Müdürlüğü harita servisinden alınır. Bilgiler eksik veya gecikmeli olabilir. Trafik kurallarına ve yol işaretlerine uymak sürücünün sorumluluğundadır; sürüş sırasında telefonu elde kullanmayın.
```

**Kategori:** Harita ve Navigasyon · **Etiketler:** navigasyon, trafik, sürüş

**Görseller** (depoda hazır):
- Uygulama simgesi 512×512: `assets/play/simge-512.png`
- Öne çıkan görsel 1024×500: `assets/play/one-cikan-gorsel-1024x500.png`
- **Telefon ekran görüntüleri** (en az 2, önerilen 4–8): Kendi telefonunuzda gerçek harita görünürken alın —
  Hoş geldiniz, Ana sayfa, rota haritası, Sürüş modu (hız kadranı), HUD, Güzergah uyarıları.

## 5. Neden açıklamada kaynak yazıyor?

Google Play, devlet kaynaklı bilgi sunan ama resmi olmayan uygulamaların **açıklamasında** resmi olmadığını ve
verinin kaynağını bağlantısıyla belirtmesini istiyor. Uygulamanın içinde kurum adı geçmiyor; bu not yalnızca
mağaza açıklamasında. Notu çıkarmak uygulamanın "yanıltıcı" bulunup reddedilmesine yol açabilir.

## 6. Gizlilik politikası adresi

`gizlilik.html` sitenin kökünde yayınlanmalı. GitHub Pages için: değişiklikleri `main` dalına alın,
**Settings → Pages → Source: GitHub Actions** seçin; adres `https://<kullanıcı>.github.io/cepteradar/gizlilik.html` olur.
Kendi alan adınız varsa (ör. cepteradar.com) oradaki adresi kullanın.

## 7. Test ve yayın

1. **Dahili test** ile kendiniz deneyin (AAB'yi yükleyin, telefonunuza kurun).
2. Yeni **kişisel** geliştirici hesaplarında üretime çıkmadan önce **kapalı test** zorunludur
   (son kurala göre en az 12 testçi, 14 gün kesintisiz). Testçilerin Gmail adreslerini bir listeye ekleyin.
3. Kapalı test tamamlanınca Play Console'dan **üretime erişim** başvurusu yapın, sonra üretim sürümünü yayınlayın.
4. İlk inceleme birkaç gün sürebilir.

## 8. Firebase kurulumu (topluluk bildirimleri)

1. **Firestore Database → Create database**: konum **europe-west3 (Frankfurt)**, **Production mode**.
2. **Firestore → Rules**: depodaki `firestore.rules` dosyasının tamamını yapıştırın → **Publish**.
3. **Authentication → Get started → Sign-in method → Anonymous → Enable**.
4. **Firestore → TTL (Yaşam süresi)** → iki politika ekleyin (süresi dolan veriler otomatik silinsin):
   - Koleksiyon grubu `bildirimler`, zaman alanı `bitis`
   - Koleksiyon grubu `oylar`, zaman alanı `silinme`
5. **Proje ayarları → Genel → Web uygulaması ekle** → çıkan `firebaseConfig` değerlerini `js/firebase-ayar.js` dosyasına yazın
   (değerler gizli değildir). Dosya `null` kalırsa bildirim özelliği gizli kalır.
6. Önerilen: **Authentication → Settings → Authorized domains** listesine sitenizin alan adını ekleyin
   (`cematil.github.io`; Android uygulaması için `localhost` zaten listededir).

Ücretsiz Spark planı başlangıç için yeterlidir (günlük okuma/yazma kotaları). Kullanıcı sayısı artınca
Firebase konsolundaki **Kullanım** sekmesinden takip edin.
