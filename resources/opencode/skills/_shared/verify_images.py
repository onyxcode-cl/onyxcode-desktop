#!/usr/bin/env python3
"""Heurística de calidad visual sobre PNG de páginas (solo Pillow). Imprime JSON."""
from __future__ import annotations

import argparse
import json
import os
import sys

BLANCO = 245          # un canal >= 245 cuenta como blanco
UMBRAL_EN_BLANCO = 0.995
MARGEN_MIN = 0.02     # 2 % del ancho/alto


def analizar(ruta):
    from PIL import Image
    avisos = []
    img = Image.open(ruta).convert("L")
    w, h = img.size
    # Máscara de píxeles con contenido (no blancos)
    mask = img.point(lambda v: 255 if v < BLANCO else 0)
    hist = mask.histogram()
    contenido = hist[255]
    total = w * h
    frac_blanco = 1 - contenido / float(total)
    info = {"archivo": ruta, "ancho": w, "alto": h, "porcentaje_blanco": round(frac_blanco * 100, 2),
            "avisos": avisos}
    if frac_blanco > UMBRAL_EN_BLANCO:
        avisos.append("página en blanco (más del 99,5 % de píxeles blancos)")
        return info
    bbox = mask.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        mizq, msup = x0 / float(w), y0 / float(h)
        mder, minf = (w - x1) / float(w), (h - y1) / float(h)
        info["margenes_pct"] = {"izq": round(mizq * 100, 1), "arr": round(msup * 100, 1),
                                "der": round(mder * 100, 1), "abajo": round(minf * 100, 1)}
        lados = [n for n, m in (("izquierdo", mizq), ("superior", msup), ("derecho", mder), ("inferior", minf))
                 if m < MARGEN_MIN]
        if lados:
            avisos.append("el contenido toca o casi toca el borde %s (margen < 2 %%): posible desborde o recorte"
                          % ", ".join(lados))
        # desborde: contenido pegado al borde en una franja de 1 px
        for nombre, caja in (("izquierdo", (0, 0, 1, h)), ("derecho", (w - 1, 0, w, h)),
                             ("superior", (0, 0, w, 1)), ("inferior", (0, h - 1, w, h))):
            franja = mask.crop(caja).histogram()[255]
            largo = h if nombre in ("izquierdo", "derecho") else w
            if franja > 0.05 * largo:
                avisos.append("posible contenido cortado en el borde %s" % nombre)
    return info


def main():
    ap = argparse.ArgumentParser(description="Heurística de calidad visual para PNG de páginas.")
    ap.add_argument("pngs", nargs="+", help="imágenes PNG a revisar")
    try:
        a = ap.parse_args()
    except SystemExit as e:
        sys.exit(2 if e.code not in (0, None) else 0)
    try:
        import PIL  # noqa: F401
    except ImportError:
        print(json.dumps({"ok": False, "paginas": [], "avisos": ["falta la librería Pillow"]}, ensure_ascii=False))
        sys.exit(1)
    paginas, errores = [], []
    for p in a.pngs:
        if not os.path.isfile(p):
            errores.append("el archivo no existe: %s" % p)
            continue
        try:
            paginas.append(analizar(p))
        except Exception as e:
            errores.append("no se pudo leer %s: %s" % (p, e))
    con_avisos = sum(1 for p in paginas if p["avisos"])
    res = {"ok": not errores and con_avisos == 0, "paginas": paginas, "paginas_con_avisos": con_avisos,
           "errores": errores}
    print(json.dumps(res, ensure_ascii=False))
    sys.exit(1 if errores and not paginas else 0)


if __name__ == "__main__":
    main()
