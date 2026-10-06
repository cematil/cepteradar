// assets/logo.svg dosyasından PWA ve Android ikonlarını (PNG) üretir.
// Kullanım: node scripts/ikon-uret.mjs   (Playwright + Chromium gerekir)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'assets/logo.svg'), 'utf8')
  .replace(/<style>[\s\S]*?<\/style>/, ''); // animasyonsuz, sabit görüntü

const targets = [
  ['assets/icon-192.png', 192, 0],
  ['assets/icon-512.png', 512, 0],
  ['assets/icon-maskable-512.png', 512, 0.12],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, size, pad] of targets) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#0b1120;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')}</div></body></html>`);
  await page.screenshot({ path: path.join(ROOT, out), omitBackground: false });
  console.log('✓', out);
}
await browser.close();
