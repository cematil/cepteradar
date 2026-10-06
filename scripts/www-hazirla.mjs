// Android (Capacitor) paketi için web dosyalarını www/ klasörüne kopyalar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');
const ITEMS = ['index.html', 'main.html', 'manifest.json', 'sw.js', 'css', 'js', 'vendor', 'assets', 'iller_kucuk'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const item of ITEMS) fs.cpSync(path.join(ROOT, item), path.join(OUT, item), { recursive: true });
console.log(`✓ www/ hazır (${ITEMS.join(', ')})`);
