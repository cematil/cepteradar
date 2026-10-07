// Cepte Radar mobil uygulama kabuğu (app.html): ekranlar arası geçiş.
// Rota, harita, uyarılar ve sürüş modu app.js tarafından yönetilir; bu dosya sadece ekranları değiştirir.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SCREENS = ['welcome', 'home', 'map', 'details'];
  const WELCOME_KEY = 'cepteradar:hosgeldin';
  let current = null;
  let pendingBounds = null;

  const seenWelcome = () => { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch (e) { return true; } };
  const map = () => window.CepteRadar && window.CepteRadar.map;

  // Ekranlar Android geri tuşuyla da çalışsın diye adres çubuğundaki #ekran ile yönetilir.
  function go(name) {
    if (location.hash !== `#${name}`) location.hash = name;
    else show(name);
  }

  function show(name) {
    if (!SCREENS.includes(name)) name = seenWelcome() ? 'home' : 'welcome';
    SCREENS.forEach((s) => $(`scr-${s}`).classList.toggle('active', s === name));
    document.body.dataset.screen = name;
    document.querySelectorAll('#tabbar [data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
    current = name;
    if (name === 'map') {
      const m = map();
      if (!m) return;
      setTimeout(() => {
        const center = m.getCenter(), zoom = m.getZoom();
        m.invalidateSize(false);
        if (pendingBounds) { m.fitBounds(pendingBounds, { padding: [40, 40] }); pendingBounds = null; } else m.setView(center, zoom, { animate: false });
      }, 50);
    }
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // Rota çizildiğinde: harita ekranı açık değilse, açılınca rotaya yakınlaştır.
  document.addEventListener('cepteradar:rota', (e) => {
    if (current === 'map') {
      const m = map();
      setTimeout(() => { m.invalidateSize(false); m.fitBounds(e.detail.bounds, { padding: [40, 40] }); }, 50);
    } else pendingBounds = e.detail.bounds;
  });

  function createRoute() {
    $('btn-submit').click();
    go('map');
  }

  // Hoş geldiniz
  $('w-start').addEventListener('click', () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* gizli mod */ }
    go('home');
  });
  const how = $('how-modal');
  $('w-how').addEventListener('click', () => how.classList.remove('hidden'));
  $('how-close').addEventListener('click', () => how.classList.add('hidden'));
  how.addEventListener('click', (e) => { if (e.target === how) how.classList.add('hidden'); });

  // Ana sayfa
  $('t-route').addEventListener('click', createRoute);
  $('tab-plus').addEventListener('click', createRoute);
  $('t-drive').addEventListener('click', () => {
    go('map');
    setTimeout(() => { if (!$('btn-drive').classList.contains('active')) $('btn-drive').click(); }, 300);
  });
  $('recent-routes').addEventListener('click', (e) => { if (e.target.closest('[data-route]')) go('map'); });

  // Uyarı listesinde bir satıra dokununca o noktayı haritada göster (app.js haritayı oraya taşır)
  $('route-alerts').addEventListener('click', (e) => { if (e.target.closest('li[data-i]')) go('map'); });

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  // Harita kontrolleri (yakınlaştırma, lejant) alt kartın üstünde kalsın
  const sheet = document.querySelector('.sheet');
  const syncSheet = () => document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight + 8}px`);
  if (window.ResizeObserver) new ResizeObserver(syncSheet).observe(sheet);
  syncSheet();

  // Alt kart: küçült / büyüt. Sürüş başlayınca kendiliğinden küçülür, haritaya yer açılır.
  const toggleBtn = $('sheet-toggle');
  function setSheet(kucuk) {
    sheet.classList.toggle('kucuk', kucuk);
    toggleBtn.setAttribute('aria-expanded', String(!kucuk));
    // Özet satırındaki sayılar ana sayaçlardan kopyalanır
    sheet.querySelectorAll('[data-kaynak]').forEach((b) => { b.textContent = $(b.dataset.kaynak).textContent; });
    setTimeout(syncSheet, 30);
  }
  toggleBtn.addEventListener('click', () => setSheet(!sheet.classList.contains('kucuk')));
  $('sheet-mini').addEventListener('click', () => setSheet(false));
  // Kaydırma: tutamaktan aşağı çekince küçült, yukarı çekince büyüt
  let y0 = null;
  sheet.addEventListener('touchstart', (e) => { y0 = e.target.closest('.sheet-handle, .sheet-mini') ? e.touches[0].clientY : null; }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if (dy > 40) setSheet(true); else if (dy < -40) setSheet(false);
  }, { passive: true });
  const drive = $('btn-drive');
  new MutationObserver(() => setSheet(drive.classList.contains('active'))).observe(drive, { attributes: true, attributeFilter: ['class'] });

  // Ayarlar (ana sayfa): her biri body'ye bir sınıf ekler; cihazda saklanır.
  const AYAR_KEY = 'cepteradar:ayarlar';
  let ayar = {};
  try { ayar = JSON.parse(localStorage.getItem(AYAR_KEY) || '{}'); } catch (e) { ayar = {}; }
  document.querySelectorAll('[data-ayar]').forEach((cb) => {
    const k = cb.dataset.ayar;
    cb.checked = !!ayar[k];
    document.body.classList.toggle(k, cb.checked);
    cb.addEventListener('change', () => {
      ayar[k] = cb.checked;
      document.body.classList.toggle(k, cb.checked);
      try { localStorage.setItem(AYAR_KEY, JSON.stringify(ayar)); } catch (e) { /* gizli mod */ }
    });
  });
  $('ses-dene').addEventListener('click', () => {
    if (document.body.classList.contains('sessiz')) { window.CepteRadar.toast('Sesli uyarılar kapalı.'); return; }
    window.CepteRadar.speak('Sesli uyarılar çalışıyor. İyi yolculuklar.', true);
  });

  // Android geri tuşu: açık pencereyi kapat; ana sayfada değilse ana sayfaya dön; ana sayfadaysa uygulamadan çık.
  const CAP = window.Capacitor;
  if (CAP && CAP.isNativePlatform && CAP.isNativePlatform() && CAP.registerPlugin) {
    const CapApp = CAP.registerPlugin('App');
    CapApp.addListener('backButton', () => {
      const hud = document.querySelector('.hud:not(.hidden)');
      if (hud) { hud.querySelector('.hud-kapat').click(); return; }
      const modal = document.querySelector('.modal:not(.hidden)');
      if (modal) { const x = modal.querySelector('[data-close-legal], .bildir-iptal, #how-close, [data-cevap="0"]'); if (x) x.click(); else modal.classList.add('hidden'); return; }
      const fs = document.querySelector('.fullscreen-map');
      if (fs) { fs.classList.remove('fullscreen-map'); document.body.classList.remove('no-scroll'); setTimeout(() => map() && map().invalidateSize(), 200); return; }
      if (current !== 'home' && current !== 'welcome') { go('home'); return; }
      CapApp.exitApp();
    });
  }

  show(location.hash.slice(1));
})();
