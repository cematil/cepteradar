#!/usr/bin/env python3
"""İl JSON dosyalarını, içindeki bilgileri koruyarak küçültür.

Radar / kontrol / koridor sayıları, il listeleri, koridor adları ve hız sınırları aynen kalır.
Sadece rota ve koridor çizgilerindeki gereksiz sık koordinat noktaları atılır
(Douglas-Peucker, ~20 m hassasiyet; haritada fark görünmez) ve sayılar 5 haneye yuvarlanır.
Orijinal dosyalara dokunulmaz; küçültülmüş kopyalar ayrı bir klasöre yazılır.

Kullanım:
    python scripts/iller_kucult.py "C:\\...\\iller"  "C:\\...\\iller_kucuk_yeni"
    python scripts/iller_kucult.py "C:\\...\\iller\\adiyaman.json"  "C:\\...\\iller_kucuk_yeni"

Ardından proje klasöründe birleştirmek için:
    node scripts/veri-birlestir.mjs "C:\\...\\iller_kucuk_yeni"
"""
import json
import os
import sys

TOLERANS = 0.0002  # derece (~20 m)


def nokta(p):
    """Noktayı (a, b) sayı çiftine çevirir; biçimi korunacağı için sadece hesap için kullanılır."""
    if isinstance(p, (list, tuple)) and len(p) >= 2:
        return float(p[0]), float(p[1])
    if isinstance(p, dict):
        if "x" in p and "y" in p:
            return float(p["y"]), float(p["x"])
        if "lat" in p:
            return float(p["lat"]), float(p.get("lon", p.get("lng", 0)))
    raise ValueError


def koordinat_listesi_mi(v):
    if not isinstance(v, list) or len(v) < 3:
        return False
    try:
        nokta(v[0])
        nokta(v[-1])
        return True
    except (ValueError, TypeError):
        return False


def sadelestir(liste, tol=TOLERANS):
    try:
        pts = [nokta(p) for p in liste]
    except (ValueError, TypeError):
        return liste
    n = len(pts)
    tut = [False] * n
    tut[0] = tut[-1] = True
    yigin = [(0, n - 1)]
    t2 = tol * tol
    while yigin:
        a, b = yigin.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        en, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            t = ((px - ax) * dx + (py - ay) * dy) / l2 if l2 else 0.0
            t = max(0.0, min(1.0, t))
            ex, ey = ax + t * dx - px, ay + t * dy - py
            d = ex * ex + ey * ey
            if d > en:
                en, idx = d, i
        if en > t2:
            tut[idx] = True
            yigin.append((a, idx))
            yigin.append((idx, b))
    return [p for p, k in zip(liste, tut) if k]


def yuvarla(v):
    if isinstance(v, float):
        return round(v, 5)
    if isinstance(v, list):
        if koordinat_listesi_mi(v):
            v = sadelestir(v)
        return [yuvarla(x) for x in v]
    if isinstance(v, dict):
        return {k: yuvarla(x) for k, x in v.items()}
    return v


def boyut(n):
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{n / 1024:.0f} KB"


def kucult(kaynak, hedef_klasor):
    ad = os.path.basename(kaynak)
    hedef = os.path.join(hedef_klasor, ad)
    try:
        with open(kaynak, encoding="utf-8-sig") as f:
            veri = json.load(f)
    except Exception as e:
        print(f"  ! {ad}: okunamadı ({e})")
        return 0, 0
    with open(hedef, "w", encoding="utf-8") as f:
        json.dump(yuvarla(veri), f, ensure_ascii=False, separators=(",", ":"))
    once, sonra = os.path.getsize(kaynak), os.path.getsize(hedef)
    uyari = "   ! hâlâ 25 MB'tan büyük" if sonra > 25 * 1048576 else ""
    print(f"  {ad:<24} {boyut(once):>10} -> {boyut(sonra):>10}{uyari}")
    return once, sonra


def main():
    try:  # Windows'ta çıktı dosyaya yönlendirilince Türkçe karakterler bozulmasın
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    kaynak, hedef = sys.argv[1], sys.argv[2]
    if os.path.abspath(kaynak) == os.path.abspath(hedef):
        print("Hedef klasör kaynakla aynı olamaz (orijinal dosyalar korunmalı).")
        sys.exit(1)
    os.makedirs(hedef, exist_ok=True)
    if os.path.isdir(kaynak):
        dosyalar = [os.path.join(kaynak, f) for f in sorted(os.listdir(kaynak))
                    if f.lower().endswith(".json") and f not in ("index.json", "koridorlar.json", "osm_radarlar.json")]
    else:
        dosyalar = [kaynak]
    t1 = t2 = 0
    for d in dosyalar:
        a, b = kucult(d, hedef)
        t1 += a
        t2 += b
    print(f"Toplam: {boyut(t1)} -> {boyut(t2)}  ({len(dosyalar)} dosya)  Küçültülmüş dosyalar: {hedef}")


if __name__ == "__main__":
    main()
