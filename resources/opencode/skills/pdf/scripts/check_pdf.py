#!/usr/bin/env python3
"""Verifica un PDF (abre, páginas, tamaño, texto, páginas en blanco) y lo renderiza a PNG."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_util import abrir_lector, error, exigir_entrada  # noqa: E402


def _en_blanco(pdfium_pagina):
    """True si el render es prácticamente todo blanco."""
    img = pdfium_pagina.render(scale=0.3).to_pil().convert("L")
    lo, hi = img.getextrema()
    return lo > 245


def main():
    ap = argparse.ArgumentParser(description="Verifica un PDF. Ejemplo: check_pdf.py informe.pdf --render --outdir png [--json]")
    ap.add_argument("pdf")
    ap.add_argument("--render", action="store_true", help="genera PNG por página (con _shared/render.py)")
    ap.add_argument("--outdir", help="carpeta de los PNG (por defecto ./.lazunox/trabajo/render)")
    ap.add_argument("--dpi", type=int, default=110)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--clave")
    a = ap.parse_args()
    exigir_entrada(a.pdf)

    lector = abrir_lector(a.pdf, a.clave)
    r = {"archivo": a.pdf, "ok": True, "bytes": os.path.getsize(a.pdf), "paginas": len(lector.pages),
         "tamanos": [], "sin_texto": [], "en_blanco": [], "avisos": [], "pngs": []}
    for i, pg in enumerate(lector.pages):
        w, h = float(pg.mediabox.width), float(pg.mediabox.height)
        r["tamanos"].append("%dx%d mm" % (round(w * 25.4 / 72), round(h * 25.4 / 72)))
        try:
            if len((pg.extract_text() or "").strip()) < 5:
                r["sin_texto"].append(i + 1)
        except Exception:  # noqa: BLE001
            r["sin_texto"].append(i + 1)
    if r["paginas"] == 0:
        r["ok"] = False
        r["avisos"].append("el PDF no tiene páginas")
    try:
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(a.pdf, password=a.clave) if lector.is_encrypted else pdfium.PdfDocument(a.pdf)
        for i in range(len(doc)):
            if _en_blanco(doc[i]):
                r["en_blanco"].append(i + 1)
    except Exception as e:  # noqa: BLE001
        r["avisos"].append("no se pudo comprobar páginas en blanco: %s" % e)
    if r["en_blanco"]:
        r["avisos"].append("páginas en blanco: %s" % r["en_blanco"])
    if r["sin_texto"] and len(r["sin_texto"]) == r["paginas"]:
        r["avisos"].append("ninguna página tiene texto extraíble (¿escaneado o solo imágenes?)")
    elif r["sin_texto"]:
        r["avisos"].append("páginas sin texto extraíble: %s" % r["sin_texto"])

    if a.render:
        render = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared", "render.py")
        outdir = a.outdir or os.path.join(".lazunox", "trabajo", "render")
        if not os.path.isfile(render):
            r["avisos"].append("no se encontró _shared/render.py: se omite el render (verificación solo estructural)")
        else:
            p = subprocess.run([sys.executable, render, a.pdf, "--outdir", outdir, "--dpi", str(a.dpi)],
                               capture_output=True, text=True)
            try:
                j = json.loads(p.stdout)
                r["pngs"] = j.get("pngs", [])
                r["avisos"] += j.get("avisos", [])
                if not j.get("ok"):
                    r["avisos"].append("el render falló")
            except ValueError:
                r["avisos"].append("render sin resultado legible: %s" % (p.stderr.strip()[:200]))

    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        print("Archivo: %s\nTamaño: %.1f KB | Páginas: %d | Formato(s): %s" % (
            a.pdf, r["bytes"] / 1024, r["paginas"], ", ".join(sorted(set(r["tamanos"])))))
        print("Texto extraíble: %s" % ("sí" if len(r["sin_texto"]) < r["paginas"] else "NO"))
        print("Páginas en blanco: %s" % (r["en_blanco"] or "ninguna"))
        for av in r["avisos"]:
            print("AVISO: " + av)
        for p in r["pngs"]:
            print("PNG: " + p)
        print("RESULTADO: " + ("correcto" if r["ok"] and not r["en_blanco"] else "revisar avisos"))
    sys.exit(0 if r["ok"] else 1)


if __name__ == "__main__":
    main()
