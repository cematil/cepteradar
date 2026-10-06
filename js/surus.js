// Cepte Radar — sürüş ekranı eklentileri (Faz 1):
//  • Hız kadranı: anlık GPS hızı; sınırın altında yeşil, yakınında sarı, aşınca kırmızı.
//  • HUD modu: siyah zeminde büyük hız/sınır/sıradaki uyarı; ön cama yansıtmak için aynalanabilir.
//  • Ortalama hız koridoru sayacı: girişten çıkışa geçen süre, kalan mesafe, ortalama ve en erken çıkış süresi.
//  • Ekran parlaması: sesli uyarılarla birlikte kenarlarda kısa renkli parlama.
// app.js sürüş modunu başlatınca Surus.start(), her konumda Surus.update(), bitince Surus.stop() çağırır.
(function () {
  'use strict';

  const R = Math.PI / 180;
  const km = (a, b) => Math.hypot((b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * R), b[0] - a[0]) * 111.32;
  const bearing = (a, b) => {
    const y = Math.sin((b[1] - a[1]) * R) * Math.cos(b[0] * R);
    const x = Math.cos(a[0] * R) * Math.sin(b[0] * R) - Math.sin(a[0] * R) * Math.cos(b[0] * R) * Math.cos((b[1] - a[1]) * R);
    return (Math.atan2(y, x) / R + 360) % 360;
  };
  const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const mmss = (sec) => { const s = Math.max(0, Math.round(sec)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const kmText = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)).toString().replace('.', ',');

  // p'nin [a,b] doğru parçasına uzaklığı (km) ve parça üzerindeki konumu (0..1)
  function project(p, a, b) {
    const k = Math.cos(p[0] * R);
    const ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
    const dx = (b[1] - p[1]) * k - ax, dy = b[0] - p[0] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    return { d: Math.hypot(ax + t * dx, ay + t * dy) * 111.32, t };
  }

  const FLASH = { kamera: '#f97316', koridor: '#facc15', radar: '#ef4444', kontrol: '#22d3ee', tren: '#ef4444', okul: '#f59e0b', tehlike: '#f59e0b', hiz: '#ef4444' };
  const MIRRORS = ['none', 'scaleY(-1)', 'scaleX(-1)'];
  const MIRROR_LABEL = ['Ayna: kapalı', 'Ayna: dikey', 'Ayna: yatay'];

  let opts = null;
  let el = {};
  let corridors = [];
  let active = null;      // girilmiş koridor
  let state = { speed: null, limit: null, next: null };
  let mirror = 0;
  try { mirror = +localStorage.getItem('cepteradar:hud-ayna') || 0; } catch (e) { /* gizli mod */ }

  // ------------------------------------------------------------------ arayüz
  function build() {
    const host = document.getElementById('map-container') || document.body;
    el.gauge = document.createElement('button');
    el.gauge.type = 'button';
    el.gauge.className = 'kadran hidden';
    el.gauge.setAttribute('aria-label', 'Hız kadranı — HUD moduna geçmek için dokunun');
    el.gauge.innerHTML = `
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <path class="k-bg" d="M24 96 A48 48 0 1 1 96 96"/>
        <path class="k-val" d="M24 96 A48 48 0 1 1 96 96"/>
      </svg>
      <b class="k-hiz">–</b><small class="k-birim">km/s</small><small class="k-sinir"></small><i class="k-hud">HUD</i>`;
    host.appendChild(el.gauge);
    el.arc = el.gauge.querySelector('.k-val');
    el.arcLen = el.arc.getTotalLength ? el.arc.getTotalLength() : 226;
    el.arc.style.strokeDasharray = `${el.arcLen}`;
    el.gauge.addEventListener('click', openHud);

    el.cor = document.createElement('div');
    el.cor.className = 'koridor-panel hidden';
    el.cor.setAttribute('aria-live', 'polite');
    host.appendChild(el.cor);

    el.flash = document.createElement('div');
    el.flash.className = 'ekran-flas';
    document.body.appendChild(el.flash);

    el.hud = document.createElement('div');
    el.hud.className = 'hud hidden';
    el.hud.innerHTML = `
      <div class="hud-ic">
        <div class="hud-ust"><span class="hud-sinir">–</span><span class="hud-sonraki"></span></div>
        <div class="hud-hiz">–</div>
        <div class="hud-birim">km/s</div>
        <div class="hud-koridor"></div>
      </div>
      <div class="hud-dugmeler">
        <button type="button" class="hud-ayna"></button>
        <button type="button" class="hud-kapat">Kapat ✕</button>
      </div>`;
    document.body.appendChild(el.hud);
    el.hud.querySelector('.hud-ayna').addEventListener('click', (e) => {
      e.stopPropagation();
      mirror = (mirror + 1) % MIRRORS.length;
      try { localStorage.setItem('cepteradar:hud-ayna', String(mirror)); } catch (err) { /* gizli mod */ }
      applyMirror();
    });
    el.hud.querySelector('.hud-kapat').addEventListener('click', closeHud);
    applyMirror();
  }

  function applyMirror() {
    el.hud.querySelector('.hud-ic').style.transform = MIRRORS[mirror] === 'none' ? '' : MIRRORS[mirror];
    el.hud.querySelector('.hud-ayna').textContent = MIRROR_LABEL[mirror];
  }

  function openHud() {
    el.hud.classList.remove('hidden');
    const fs = el.hud.requestFullscreen || el.hud.webkitRequestFullscreen;
    if (fs) try { fs.call(el.hud).catch(() => {}); } catch (e) { /* desteklenmiyor */ }
    render();
  }
  function closeHud() {
    el.hud.classList.add('hidden');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  // Hız durumu: yeşil (sınır altı), sarı (sınırın %0–10 üstü), kırmızı (%10'dan fazla); sınır yoksa mavi.
  function level(speed, limit) {
    if (speed == null || !limit) return 'yok';
    if (speed <= limit.value) return 'iyi';
    if (speed <= limit.value * 1.1) return 'dikkat';
    return 'asim';
  }

  function render() {
    if (!el.gauge) return;
    const { speed, limit, next } = state;
    const lv = level(speed, limit);
    const max = Math.max(140, limit ? limit.value * 1.4 : 0, speed || 0);
    el.gauge.dataset.level = lv;
    el.gauge.querySelector('.k-hiz').textContent = speed != null ? Math.round(speed) : '–';
    el.gauge.querySelector('.k-sinir').textContent = limit ? `Sınır ${limit.value}` : 'Sınır ?';
    el.arc.style.strokeDashoffset = `${el.arcLen * (1 - Math.min(1, (speed || 0) / max))}`;

    el.hud.dataset.level = lv;
    el.hud.querySelector('.hud-hiz').textContent = speed != null ? Math.round(speed) : '–';
    el.hud.querySelector('.hud-sinir').textContent = limit ? limit.value : '–';
    el.hud.querySelector('.hud-sinir').classList.toggle('bos', !limit);
    el.hud.querySelector('.hud-sonraki').textContent = next ? `${next.icon} ${next.what} · ${next.m >= 1000 ? `${kmText(next.m / 1000)} km` : `${Math.round(next.m / 10) * 10} m`}` : '';
    el.hud.querySelector('.hud-koridor').textContent = active ? el.cor.dataset.short || '' : '';
  }

  // ------------------------------------------------------------------ koridor sayacı
  function prepareCorridors(list) {
    corridors = (list || []).filter((c) => Array.isArray(c.coords) && c.coords.length > 1).map((c) => {
      const pts = c.coords;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + km(pts[i - 1], pts[i]));
      const total = cum[cum.length - 1];
      // Giriş yönü: başlangıçtan ~50 m sonrasındaki noktaya doğru
      let j = 1;
      while (j < pts.length - 1 && cum[j] < 0.05) j++;
      return { name: c.name || 'Hız koridoru', limit: +(c.speed_limit || c.speedLimit) || null, pts, cum, total, dir: bearing(pts[0], pts[j]) };
    }).filter((c) => c.total > 0.3 && c.limit);
  }

  function progressOn(c, p) {
    let best = { d: Infinity, prog: 0 };
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const { d, t } = project(p, c.pts[i], c.pts[i + 1]);
      if (d < best.d) best = { d, prog: c.cum[i] + t * (c.cum[i + 1] - c.cum[i]) };
    }
    return best;
  }

  function corridorStep(p, heading) {
    const now = Date.now();
    if (!active) {
      if (heading == null) return;
      const c = corridors.find((x) => km(p, x.pts[0]) < 0.08 && angleDiff(heading, x.dir) <= 45);
      if (!c) return;
      active = { c, t0: now, off: 0, warnedAvg: false };
      opts.speak(`Ortalama hız koridoruna girdiniz. Hız sınırı ${c.limit}. Uzunluk ${kmText(c.total)} kilometre.`);
      flash('koridor');
      return;
    }
    const { c } = active;
    const { d, prog } = progressOn(c, p);
    const elapsed = (now - active.t0) / 1000;
    if (d > 0.3) {
      if (!active.off) active.off = now;
      if (now - active.off > 30000) { opts.toast('⚡ Hız koridorundan ayrıldınız.'); end(); }
      return;
    }
    active.off = 0;
    active.prog = Math.max(active.prog || 0, prog);
    const avg = elapsed > 5 ? active.prog / (elapsed / 3600) : null;
    if (active.prog >= c.total - 0.05 || km(p, c.pts[c.pts.length - 1]) < 0.06) {
      const finalAvg = Math.round(c.total / (elapsed / 3600));
      opts.speak(`Hız koridorundan çıktınız. Ortalama hızınız ${finalAvg}.`);
      opts.toast(`⚡ Koridor bitti · ortalama ${finalAvg} km/s (sınır ${c.limit})`);
      end();
      return;
    }
    const minTotal = (c.total / c.limit) * 3600;          // sınırla geçişin en kısa süresi (sn)
    const left = Math.max(0, minTotal - elapsed);          // çıkışa en erken kalan süre
    const remaining = c.total - active.prog;
    const allowed = left > 1 ? Math.min(c.limit, remaining / (left / 3600)) : c.limit;
    const over = avg != null && avg > c.limit;
    if (over && !active.warnedAvg && avg > c.limit + 2) {
      active.warnedAvg = true;
      opts.speak('Koridorda ortalamanız sınırın üzerinde. Yavaşlayın.');
      flash('hiz');
    }
    el.cor.dataset.level = over ? 'asim' : 'iyi';
    el.cor.innerHTML = `
      <div class="kp-bas"><span class="kp-tabela">${c.limit}</span><b>Ortalama hız koridoru</b><span class="kp-sure">${mmss(elapsed)}</span></div>
      <div class="kp-satir"><span>Kalan <b>${kmText(remaining)} km</b></span><span>Ortalamanız <b>${avg != null ? Math.round(avg) : '–'}</b> km/s</span></div>
      <div class="kp-satir"><span>En erken çıkış <b>${mmss(left)}</b> sonra</span><span>Önerilen en fazla <b>${Math.round(allowed)}</b> km/s</span></div>`;
    el.cor.dataset.short = `⚡ ${c.limit} · ort. ${avg != null ? Math.round(avg) : '–'} · kalan ${kmText(remaining)} km · en erken ${mmss(left)}`;
    el.cor.classList.remove('hidden');
  }

  function end() {
    active = null;
    if (el.cor) { el.cor.classList.add('hidden'); el.cor.dataset.short = ''; }
  }

  // ------------------------------------------------------------------ dışa açık
  function flash(type) {
    if (!el.flash) return;
    el.flash.style.setProperty('--flas', FLASH[type] || '#f97316');
    el.flash.classList.remove('on');
    void el.flash.offsetWidth; // animasyonu yeniden başlat
    el.flash.classList.add('on');
  }

  function start(o) {
    opts = o;
    if (!el.gauge) build();
    prepareCorridors(o.corridors);
    state = { speed: null, limit: null, next: null };
    el.gauge.classList.remove('hidden');
    render();
  }

  function update(fix) {
    if (!opts) return;
    state = { speed: fix.speed, limit: fix.limit, next: fix.next };
    if (fix.lat != null && corridors.length) corridorStep([fix.lat, fix.lon], fix.heading);
    render();
  }

  function stop() {
    opts = null;
    end();
    if (el.gauge) el.gauge.classList.add('hidden');
    if (el.hud) closeHud();
  }

  window.Surus = { start, update, stop, flash };
})();
