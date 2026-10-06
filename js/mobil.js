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

  show(location.hash.slice(1));
})();
