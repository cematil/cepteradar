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

// Sürüm ve imza (Google Play için). Ortam değişkenleri yoksa debug derlemesi aynen çalışır.
//   CEPTE_VERSION_CODE   : Play'e her yüklemede artan tam sayı (iş akışında çalıştırma numarası)
//   CEPTE_KEYSTORE_FILE  : yükleme anahtarı (.jks) dosyasının yolu
//   CEPTE_KEYSTORE_PASSWORD, CEPTE_KEY_ALIAS, CEPTE_KEY_PASSWORD
const gradlePath = path.join(ROOT, 'android/app/build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const versionCode = parseInt(process.env.CEPTE_VERSION_CODE || '1', 10);
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
if (process.env.CEPTE_KEYSTORE_FILE && !gradle.includes('signingConfigs {')) {
  gradle = gradle.replace(/(\n\s*)buildTypes \{/, `$1signingConfigs {
        release {
            storeFile file(System.getenv("CEPTE_KEYSTORE_FILE"))
            storePassword System.getenv("CEPTE_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CEPTE_KEY_ALIAS")
            keyPassword System.getenv("CEPTE_KEY_PASSWORD")
        }
    }$1buildTypes {`)
    .replace(/(release \{\s*\n\s*)minifyEnabled false/, '$1signingConfig signingConfigs.release\n            minifyEnabled false');
  console.log('✓ build.gradle: yayın imzası eklendi');
}
fs.writeFileSync(gradlePath, gradle);
console.log(`✓ build.gradle: sürüm ${pkg.version} (${versionCode})`);
