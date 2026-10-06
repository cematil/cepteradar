#!/usr/bin/env python3
"""İl JSON dosyalarının içeriğini inceler: kayıt sayısı, alanlar, hangi alanın ne kadar yer kapladığı.

Kullanım:
    python scripts/iller_incele.py "C:\\...\\iller\\adana.json" "C:\\...\\iller\\adiyaman.json"
    python scripts/iller_incele.py "C:\\...\\iller"            (klasördeki tüm .json dosyaları)

Sadece okur, hiçbir dosyayı değiştirmez. Çıktıyı kopyalayıp gönderebilirsiniz.
"""
import json
import os
import sys
from collections import Counter, defaultdict


def boyut(n):
    for birim in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {birim}" if birim == "B" else f"{n:.1f} {birim}"
        n /= 1024
    return f"{n:.1f} TB"


def koordinat_listesi_mi(v):
    """[[a, b], ...] ya da [{x, y}, ...] / [{lat, lon}, ...] biçiminde nokta listesi mi?"""
    if not isinstance(v, list) or len(v) < 2:
        return False
    ilk = v[0]
    if isinstance(ilk, list) and len(ilk) >= 2 and all(isinstance(t, (int, float)) for t in ilk[:2]):
        return True
    if isinstance(ilk, dict):
        k = set(ilk)
        return bool({"x", "y"} <= k or {"lat", "lon"} <= k or {"lat", "lng"} <= k)
    return False


def kisalt(v, derinlik=0):
    """Örnek kaydı ekrana sığacak şekilde kısaltır."""
    if isinstance(v, list):
        if koordinat_listesi_mi(v):
            return f"<{len(v)} nokta, ilk: {json.dumps(v[0], ensure_ascii=False)}>"
        if derinlik > 2:
            return f"<{len(v)} öğe>"
        return [kisalt(x, derinlik + 1) for x in v[:2]] + ([f"... +{len(v) - 2} öğe"] if len(v) > 2 else [])
    if isinstance(v, dict):
        if derinlik > 3:
            return "<nesne>"
        return {k: kisalt(x, derinlik + 1) for k, x in v.items()}
    if isinstance(v, str) and len(v) > 80:
        return v[:80] + "…"
    return v


def nokta_say(v):
    """Kayıttaki toplam koordinat noktası sayısı."""
    if koordinat_listesi_mi(v):
        return len(v)
    if isinstance(v, list):
        return sum(nokta_say(x) for x in v)
    if isinstance(v, dict):
        return sum(nokta_say(x) for x in v.values())
    return 0


def kayitlar(veri):
    if isinstance(veri, list):
        return veri
    if isinstance(veri, dict):
        for anahtar in ("data", "routes", "rotalar", "kayitlar"):
            if isinstance(veri.get(anahtar), list):
                return veri[anahtar]
        return [veri]
    return []


def incele(yol):
    print("=" * 70)
    print(f"DOSYA: {os.path.basename(yol)}   ({boyut(os.path.getsize(yol))})")
    try:
        with open(yol, encoding="utf-8-sig") as f:
            veri = json.load(f)
    except Exception as e:
        print(f"  ! Okunamadı: {e}")
        return
    liste = kayitlar(veri)
    print(f"  Üst yapı: {type(veri).__name__}, kayıt sayısı: {len(liste)}")
    if not liste:
        return

    alanlar = Counter()
    alan_boyut = defaultdict(int)
    toplam_nokta = 0
    for r in liste:
        if not isinstance(r, dict):
            continue
        toplam_nokta += nokta_say(r)
        for k, v in r.items():
            alanlar[k] += 1
            alan_boyut[k] += len(json.dumps(v, ensure_ascii=False, separators=(",", ":")))

    toplam = sum(alan_boyut.values()) or 1
    print(f"  Toplam koordinat noktası: {toplam_nokta:,}".replace(",", "."))
    print("  Alanlar (en çok yer kaplayandan):")
    for k, b in sorted(alan_boyut.items(), key=lambda x: -x[1]):
        print(f"    {k:<22} {alanlar[k]:>5} kayıtta   {boyut(b):>10}   %{b * 100 / toplam:.1f}")

    # Biçim tahmini
    ilk = next((r for r in liste if isinstance(r, dict)), {})
    if "kalkis_il" in ilk:
        print("  Biçim: uygulama kaydı (kalkis_il / varis_il ...)")
        varislar = Counter(str(r.get("varis_il")) for r in liste if isinstance(r, dict))
        kalkislar = Counter(str(r.get("kalkis_il")) for r in liste if isinstance(r, dict))
        print(f"  Kalkış: {dict(kalkislar)}")
        print(f"  Varış illeri ({len(varislar)}): {', '.join(sorted(varislar))[:400]}")
        tekrar = [k for k, n in varislar.items() if n > 1]
        if tekrar:
            print(f"  ! Aynı varış ili birden çok kez: {', '.join(tekrar[:20])}")
    elif "FromDistrict" in ilk or "data" in ilk:
        print("  Biçim: İçişleri sitesinin ham cevabı (FromDistrict / ToDistrict ...)")
    else:
        print(f"  Biçim: bilinmiyor, ilk kaydın alanları: {list(ilk)[:15]}")

    print("  Örnek kayıt (kısaltılmış):")
    print("    " + json.dumps(kisalt(ilk), ensure_ascii=False, indent=2).replace("\n", "\n    ")[:3000])


def main():
    try:  # Windows'ta çıktı dosyaya yönlendirilince Türkçe karakterler bozulmasın
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dosyalar = []
    for a in sys.argv[1:]:
        if os.path.isdir(a):
            dosyalar += [os.path.join(a, f) for f in sorted(os.listdir(a)) if f.lower().endswith(".json")]
        else:
            dosyalar.append(a)
    for d in dosyalar:
        incele(d)


if __name__ == "__main__":
    main()
