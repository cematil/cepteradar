// Yerel geliştirme / kendi sunucunda barındırma için basit statik sunucu.
// Uygulama tamamen tarayıcı tarafında çalışır (rota: OSRM, hava: Open-Meteo,
// radar verileri: iller_kucuk/*.json); bu yüzden ayrı bir API gerekmez.
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

// Rota verileri sık güncellenir; tarayıcı her seferinde sunucuya sorsun.
app.use('/iller_kucuk', express.static(path.join(ROOT, 'iller_kucuk'), { maxAge: 0, etag: true }));
app.use(express.static(ROOT, { index: 'index.html', dotfiles: 'ignore' }));

app.listen(PORT, () => console.log(`🚀 Cepte Radar çalışıyor: http://localhost:${PORT}`));
