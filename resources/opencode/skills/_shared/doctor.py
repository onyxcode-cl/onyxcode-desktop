#!/usr/bin/env python3
"""Diagnóstico del entorno: Python, librerías permitidas y LibreOffice. Imprime JSON."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402  (misma carpeta: comparte la búsqueda de LibreOffice)

LIBS = [("python-docx", "docx"), ("openpyxl", "openpyxl"), ("python-pptx", "pptx"), ("pypdf", "pypdf"),
        ("pdfplumber", "pdfplumber"), ("reportlab", "reportlab"), ("pypdfium2", "pypdfium2"),
        ("pillow", "PIL"), ("lxml", "lxml")]
IMPRESCINDIBLES = {"python-docx", "openpyxl", "python-pptx", "pypdf", "pypdfium2", "pillow"}
SOFFICE_MAC = "/Applications/LibreOffice.app/Contents/MacOS/soffice"


def version_de(mod):
    for attr in ("__version__", "VERSION", "version"):
        v = getattr(mod, attr, None)
        if isinstance(v, str):
            return v
        if isinstance(v, tuple):
            return ".".join(str(x) for x in v)
    try:
        from importlib import metadata
        return metadata.version(mod.__name__.split(".")[0])
    except Exception:
        return "desconocida"


def main():
    libs = {}
    for nombre, modulo in LIBS:
        try:
            libs[nombre] = version_de(importlib.import_module(modulo))
        except Exception:
            libs[nombre] = None
    if libs.get("pillow") is None:
        pass
    soffice = render.buscar_soffice()
    lo_version = None
    if soffice:
        try:
            lo_version = subprocess.run([soffice, "--version"], capture_output=True, text=True,
                                        timeout=60).stdout.strip() or None
        except Exception:
            lo_version = None
    faltan = [n for n, v in libs.items() if v is None and n in IMPRESCINDIBLES]
    avisos = []
    deck, word = render.buscar_deckcraft(), render.buscar_wordcraft()
    if not soffice and not (deck and word):
        avisos.append("Ni LibreOffice ni ArtCraft encontrados: no habrá render visual (solo verificación estructural).")
    opcionales = [n for n, v in libs.items() if v is None and n not in IMPRESCINDIBLES]
    if opcionales:
        avisos.append("faltan librerías opcionales: " + ", ".join(opcionales))
    res = {"python": "%s (%s)" % (sys.version.split()[0], sys.executable), "librerias": libs,
           "libreoffice": soffice, "libreoffice_version": lo_version, "deckcraft": deck, "wordcraft": word, "faltan": faltan, "avisos": avisos}
    print(json.dumps(res, ensure_ascii=False))
    sys.exit(0 if not faltan and sys.version_info >= (3, 9) else 1)


if __name__ == "__main__":
    main()
