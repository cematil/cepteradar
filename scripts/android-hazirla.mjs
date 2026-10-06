// `npx cap add android` sonrası Android projesine konum izinlerini ve uygulama ikonunu ekler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'android/app/src/main');
const manifestPath = path.join(MAIN, 'AndroidManifest.xml');

let manifest = fs.readFileSync(manifestPath, 'utf8');
const perms = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.WAKE_LOCK',
];
for (const p of perms) {
  if (!manifest.includes(p)) {
    manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  }
}
if (!manifest.includes('android.hardware.location.gps')) {
  manifest = manifest.replace('</manifest>', '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>');
}
fs.writeFileSync(manifestPath, manifest);
console.log('✓ AndroidManifest.xml: konum izinleri eklendi');

// İkon: uyarlanabilir ikon tanımlarını kaldırıp tüm yoğunluklara PNG ikonu kopyala.
const res = path.join(MAIN, 'res');
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
const icon = path.join(ROOT, 'assets/icon-512.png');
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('mipmap-'))) {
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const target = path.join(res, dir, name);
    if (fs.existsSync(target)) fs.copyFileSync(icon, target);
  }
}
console.log('✓ Uygulama ikonları güncellendi');
