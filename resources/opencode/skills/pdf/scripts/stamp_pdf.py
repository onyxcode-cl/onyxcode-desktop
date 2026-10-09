#!/usr/bin/env python3
"""Marca de agua de texto, numeración de páginas y metadatos. Salida siempre nueva."""
from __future__ import annotations

import argparse
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_util import abrir_lector, error, exigir_salida_nueva  # noqa: E402


def main():
    ap = argparse.ArgumentParser(
        description="Estampa un PDF. Ejemplo: stamp_pdf.py in.pdf -o out.pdf --marca BORRADOR --numerar --titulo \"Informe\" --autor \"Ana\"")
    ap.add_argument("pdf")
    ap.add_argument("-o", "--salida", required=True)
    ap.add_argument("--marca", help="texto de marca de agua diagonal")
    ap.add_argument("--opacidad", type=float, default=0.15)
    ap.add_argument("--numerar", action="store_true", help="agrega «Página X de N» abajo al centro")
    ap.add_argument("--formato-numero", default="Página {n} de {total}")
    ap.add_argument("--titulo")
    ap.add_argument("--autor")
    ap.add_argument("--clave")
    a = ap.parse_args()
    if not (a.marca or a.numerar or a.titulo or a.autor):
        error("indica al menos una acción: --marca, --numerar, --titulo o --autor")

    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas

    rd = abrir_lector(a.pdf, a.clave)
    w = PdfWriter(clone_from=rd)
    total = len(w.pages)
    for i, pg in enumerate(w.pages):
        if not (a.marca or a.numerar):
            break
        ancho, alto = float(pg.mediabox.width), float(pg.mediabox.height)
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(ancho, alto))
        if a.marca:
            c.saveState()
            c.setFillColorRGB(0.5, 0.5, 0.5)
            c.setFillAlpha(a.opacidad)
            tam = min(ancho, alto) / 7
            while c.stringWidth(a.marca, "Helvetica-Bold", tam) > (ancho ** 2 + alto ** 2) ** 0.5 * 0.7 and tam > 10:
                tam -= 2
            c.translate(ancho / 2, alto / 2)
            c.rotate(45)
            c.setFont("Helvetica-Bold", tam)
            c.drawCentredString(0, -tam / 3, a.marca)
            c.restoreState()
        if a.numerar:
            c.setFont("Helvetica", 9)
            c.setFillColorRGB(0.3, 0.3, 0.3)
            c.drawCentredString(ancho / 2, 20, a.formato_numero.format(n=i + 1, total=total))
        c.save()
        buf.seek(0)
        pg.merge_page(PdfReader(buf).pages[0])
    meta = {}
    if a.titulo:
        meta["/Title"] = a.titulo
    if a.autor:
        meta["/Author"] = a.autor
    if meta:
        w.add_metadata(meta)
    exigir_salida_nueva(a.salida)
    with open(a.salida, "wb") as f:
        w.write(f)
    print("Listo: %s (%d páginas)" % (a.salida, total))


if __name__ == "__main__":
    main()
