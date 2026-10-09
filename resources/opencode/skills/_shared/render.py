#!/usr/bin/env python3
"""Renderiza un documento (docx/xlsx/pptx/pdf) a PNG por página. Imprime solo JSON."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

OFFICE = {".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".odt", ".ods", ".odp"}
SOFFICE_MAC = "/Applications/LibreOffice.app/Contents/MacOS/soffice"


def buscar_soffice():
    if os.path.isfile(SOFFICE_MAC) and os.access(SOFFICE_MAC, os.X_OK):
        return SOFFICE_MAC
    return shutil.which("soffice")


def salida(res, codigo):
    print(json.dumps(res, ensure_ascii=False))
    sys.exit(codigo)


def a_pdf(origen, outdir, avisos):
    soffice = buscar_soffice()
    if not soffice:
        avisos.append("LibreOffice no está instalado: no se puede renderizar este archivo de Office. "
                      "Haz solo la verificación estructural.")
        return None
    perfil = os.path.join(outdir, ".lo-profile")
    cmd = [soffice, "-env:UserInstallation=file://" + perfil, "--headless", "--norestore",
           "--convert-to", "pdf", "--outdir", outdir, origen]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        avisos.append("LibreOffice superó el tiempo límite de 120 s al convertir a PDF.")
        return None
    except OSError as e:
        avisos.append("No se pudo ejecutar LibreOffice: %s" % e)
        return None
    pdf = os.path.join(outdir, os.path.splitext(os.path.basename(origen))[0] + ".pdf")
    if not os.path.isfile(pdf):
        avisos.append("LibreOffice no generó el PDF (código %s). %s" % (r.returncode, (r.stderr or "").strip()[:300]))
        return None
    return pdf


def main():
    ap = argparse.ArgumentParser(description="Renderiza docx/xlsx/pptx/pdf a PNG (una imagen por página).")
    ap.add_argument("archivo", help="archivo .docx, .xlsx, .pptx o .pdf")
    ap.add_argument("--outdir", required=True, help="carpeta de salida (se crea si no existe)")
    ap.add_argument("--dpi", type=int, default=110, help="resolución (por defecto 110)")
    ap.add_argument("--max-pages", type=int, default=20, help="máximo de páginas a rasterizar (por defecto 20)")
    try:
        a = ap.parse_args()
    except SystemExit as e:
        sys.exit(2 if e.code not in (0, None) else 0)

    avisos = []
    res = {"ok": False, "pdf": None, "pngs": [], "paginas": 0, "avisos": avisos}
    if not os.path.isfile(a.archivo):
        avisos.append("el archivo no existe: %s" % a.archivo)
        salida(res, 1)
    if a.dpi < 20 or a.max_pages < 1:
        print("uso incorrecto: --dpi debe ser >= 20 y --max-pages >= 1", file=sys.stderr)
        sys.exit(2)
    outdir = os.path.abspath(a.outdir)
    os.makedirs(outdir, exist_ok=True)
    origen = os.path.abspath(a.archivo)
    ext = os.path.splitext(origen)[1].lower()

    if ext == ".pdf":
        pdf = origen
    elif ext in OFFICE:
        pdf = a_pdf(origen, outdir, avisos)
    else:
        avisos.append("formato no soportado: %s (usa docx, xlsx, pptx o pdf)" % ext)
        pdf = None
    if not pdf:
        salida(res, 1)
    res["pdf"] = pdf

    try:
        import pypdfium2 as pdfium
    except ImportError:
        avisos.append("falta la librería pypdfium2: no se pueden generar PNG.")
        salida(res, 1)
    try:
        doc = pdfium.PdfDocument(pdf)
        total = len(doc)
        res["paginas"] = total
        if total > a.max_pages:
            avisos.append("el documento tiene %d páginas; solo se rasterizaron las primeras %d." % (total, a.max_pages))
        base = os.path.splitext(os.path.basename(pdf))[0]
        for i in range(min(total, a.max_pages)):
            img = doc[i].render(scale=a.dpi / 72.0).to_pil().convert("RGB")
            ruta = os.path.join(outdir, "%s-p%02d.png" % (base, i + 1))
            img.save(ruta)
            res["pngs"].append(ruta)
        doc.close()
    except Exception as e:  # PDF dañado, etc.
        avisos.append("error al rasterizar el PDF: %s" % e)
        salida(res, 1)
    res["ok"] = bool(res["pngs"])
    if not res["ok"]:
        avisos.append("el PDF no tiene páginas.")
    salida(res, 0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
