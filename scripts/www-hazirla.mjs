// Android (Capacitor) paketi için web dosyalarını www/ klasörüne kopyalar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');
const ITEMS = ['index.html', 'app.html', 'main.html', 'gizlilik.html', 'manifest.json', 'sw.js', 'css', 'js', 'vendor', 'assets', 'iller_kucuk'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const item of ITEMS) fs.cpSync(path.join(ROOT, item), path.join(OUT, item), { recursive: true });
// Android/iOS uygulaması mobil arayüzle (app.html) açılır; web sitesinin ana sayfası site.html olarak kalır.
// Web yayını için (--web) ana sayfa web sitesidir, mobil arayüz app.html adresindedir.
if (!process.argv.includes('--web')) {
  fs.renameSync(path.join(OUT, 'index.html'), path.join(OUT, 'site.html'));
  fs.copyFileSync(path.join(OUT, 'app.html'), path.join(OUT, 'index.html'));
}
console.log(`✓ www/ hazır (${ITEMS.join(', ')})`);
