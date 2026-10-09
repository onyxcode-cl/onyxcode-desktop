#!/usr/bin/env python3
"""Une, extrae, rota, reordena y elimina páginas de PDF. Siempre escribe un archivo NUEVO."""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_util import abrir_lector, error, exigir_salida_nueva, parsear_rango  # noqa: E402


def _guardar(escritor, salida, extra=""):
    exigir_salida_nueva(salida)
    with open(salida, "wb") as f:
        escritor.write(f)
    print("Listo: %s (%d páginas)%s" % (salida, len(escritor.pages), extra))


def main():
    ap = argparse.ArgumentParser(description="Operaciones de páginas sobre PDF (salida siempre nueva).",
                                 epilog="Ejemplos:\n  merge_split_pdf.py unir a.pdf b.pdf -o junto.pdf\n"
                                        "  merge_split_pdf.py extraer a.pdf --paginas 2-4 -o parte.pdf\n"
                                        "  merge_split_pdf.py rotar a.pdf --paginas 1,3 --grados 90 -o rot.pdf\n"
                                        "  merge_split_pdf.py reordenar a.pdf --orden 3,1,2 -o orden.pdf\n"
                                        "  merge_split_pdf.py eliminar a.pdf --paginas 2 -o sin2.pdf\n"
                                        "  merge_split_pdf.py dividir a.pdf --outdir partes   (una página por archivo)",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for nombre in ("unir", "extraer", "rotar", "reordenar", "eliminar", "dividir"):
        p = sub.add_parser(nombre)
        if nombre == "unir":
            p.add_argument("pdfs", nargs="+", help="PDFs a unir, en orden")
        else:
            p.add_argument("pdf")
        if nombre in ("extraer", "rotar", "eliminar"):
            p.add_argument("--paginas", required=True, help="rango, p. ej. 1-3,5,8-")
        if nombre == "rotar":
            p.add_argument("--grados", type=int, choices=[90, 180, 270], default=90)
        if nombre == "reordenar":
            p.add_argument("--orden", required=True, help="nuevo orden completo, p. ej. 3,1,2")
        if nombre == "dividir":
            p.add_argument("--outdir", required=True)
            p.add_argument("--prefijo", default="pagina")
        else:
            p.add_argument("-o", "--salida", required=True, help="PDF de salida (nuevo)")
        p.add_argument("--clave", help="contraseña si el PDF está protegido")
    a = ap.parse_args()

    from pypdf import PdfWriter

    if a.cmd == "unir":
        if len(a.pdfs) < 2:
            error("unir necesita al menos 2 PDFs")
        w = PdfWriter()
        for r in a.pdfs:
            rd = abrir_lector(r, a.clave)
            for pg in rd.pages:
                w.add_page(pg)
        return _guardar(w, a.salida, " a partir de %d archivos" % len(a.pdfs))

    rd = abrir_lector(a.pdf, a.clave)
    total = len(rd.pages)
    w = PdfWriter()
    if a.cmd == "extraer":
        for i in parsear_rango(a.paginas, total):
            w.add_page(rd.pages[i])
    elif a.cmd == "rotar":
        sel = set(parsear_rango(a.paginas, total))
        for i, pg in enumerate(rd.pages):
            w.add_page(pg)
            if i in sel:
                w.pages[-1].rotate(a.grados)
    elif a.cmd == "reordenar":
        orden = parsear_rango(a.orden, total)
        if sorted(orden) != list(range(total)):
            error("--orden debe nombrar cada una de las %d páginas exactamente una vez" % total)
        for i in orden:
            w.add_page(rd.pages[i])
    elif a.cmd == "eliminar":
        quitar = set(parsear_rango(a.paginas, total))
        if len(quitar) >= total:
            error("no se pueden eliminar todas las páginas")
        for i, pg in enumerate(rd.pages):
            if i not in quitar:
                w.add_page(pg)
    elif a.cmd == "dividir":
        os.makedirs(a.outdir, exist_ok=True)
        for i, pg in enumerate(rd.pages):
            ww = PdfWriter()
            ww.add_page(pg)
            _guardar(ww, os.path.join(a.outdir, "%s-%03d.pdf" % (a.prefijo, i + 1)))
        return
    _guardar(w, a.salida)


if __name__ == "__main__":
    main()
