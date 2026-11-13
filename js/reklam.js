// Cepte Radar — AdMob reklamları ve Google UMP izin ekranı (yalnızca Android uygulamasında çalışır).
// Sıra: önce UMP (Avrupa/İngiltere'de Google onaylı izin ekranı), izin uygunsa AdMob başlatılır.
// Reklam yalnızca Ana Sayfa ve Uyarılar ekranında; harita, sürüş modu, HUD ve açık pencerelerde gösterilmez.
(function () {
  'use strict';

  const CAP = window.Capacitor;
  if (!(CAP && CAP.isNativePlatform && CAP.isNativePlatform() && CAP.registerPlugin)) return;
  const AdMob = CAP.registerPlugin('AdMob');

  // Google'ın resmi TEST banner birimi. Gerçek birim, AdMob mağaza bağlantısı onaylanınca buraya yazılır
  // ve TEST false yapılır (uygulama kimliği scripts/android-hazirla.mjs içinde).
  const BANNER_ID = 'ca-app-pub-3940256099942544/6300978111';
  const TEST = true;
  const EKRANLAR = ['home', 'details'];
  const ALT_MENU_DP = 68;

  let hazir = false, gorunur = false, olustu = false, mesgul = false;

  async function izinAl() {
    try {
      let info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === 'REQUIRED') info = await AdMob.showConsentForm();
      const btn = document.getElementById('reklam-gizlilik');
      if (btn) btn.hidden = info.privacyOptionsRequirementStatus !== 'REQUIRED';
      return info.canRequestAds !== false;
    } catch (e) {
      return false; // izin durumu öğrenilemezse reklam istenmez
    }
  }

  function gosterilmeli() {
    const drive = document.getElementById('btn-drive');
    return EKRANLAR.includes(document.body.dataset.screen)
      && !(drive && drive.classList.contains('active'))
      && !document.querySelector('.modal:not(.hidden), .hud:not(.hidden)')
      && !document.body.classList.contains('pro');
  }

  async function guncelle() {
    if (!hazir || mesgul) return;
    const goster = gosterilmeli();
    if (goster === gorunur) return;
    mesgul = true;
    try {
      if (goster) {
        if (olustu) await AdMob.resumeBanner();
        else {
          await AdMob.showBanner({ adId: BANNER_ID, isTesting: TEST, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: ALT_MENU_DP });
          olustu = true;
        }
      } else await AdMob.hideBanner();
      gorunur = goster;
      document.body.classList.toggle('reklam-var', goster);
    } catch (e) { /* reklam yüklenemedi: sessizce geç */ }
    mesgul = false;
  }

  async function baslat() {
    const btn = document.getElementById('reklam-gizlilik');
    if (btn) btn.addEventListener('click', () => AdMob.showPrivacyOptionsForm().catch(() => {}));
    if (!(await izinAl())) return;
    try { await AdMob.initialize({}); } catch (e) { return; }
    hazir = true;
    new MutationObserver(guncelle).observe(document.body, { attributes: true, attributeFilter: ['data-screen', 'class'] });
    setInterval(guncelle, 1500);
    guncelle();
  }

  baslat();
})();
