#!/usr/bin/env python3
"""Diagnóstico del entorno: Python, librerías permitidas y programas de ArtCraft (DeckCraft, WordCraft, GridCraft). Imprime JSON."""
from __future__ import annotations

import importlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402  (misma carpeta: comparte la búsqueda de los programas de ArtCraft)

LIBS = [("python-docx", "docx"), ("openpyxl", "openpyxl"), ("python-pptx", "pptx"), ("pypdf", "pypdf"),
        ("pdfplumber", "pdfplumber"), ("reportlab", "reportlab"), ("pypdfium2", "pypdfium2"),
        ("pillow", "PIL"), ("lxml", "lxml")]
IMPRESCINDIBLES = {"python-docx", "openpyxl", "python-pptx", "pypdf", "pypdfium2", "pillow"}


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
    faltan = [n for n, v in libs.items() if v is None and n in IMPRESCINDIBLES]
    avisos = []
    deck, word, grid = render.buscar_deckcraft(), render.buscar_wordcraft(), render.buscar_gridcraft()
    sin = [n for n, ruta in (("DeckCraft (.pptx)", deck), ("WordCraft (.docx)", word), ("GridCraft (.xlsx)", grid)) if not ruta]
    if len(sin) == 3:
        avisos.append(render.AVISO_SIN_ARTCRAFT)
    elif sin:
        avisos.append("ArtCraft no encontrado para: " + ", ".join(sin) + " (sin ese programa solo hay verificación estructural).")
    opcionales = [n for n, v in libs.items() if v is None and n not in IMPRESCINDIBLES]
    if opcionales:
        avisos.append("faltan librerías opcionales: " + ", ".join(opcionales))
    res = {"python": "%s (%s)" % (sys.version.split()[0], sys.executable), "librerias": libs,
           "deckcraft": deck, "wordcraft": word, "gridcraft": grid, "faltan": faltan, "avisos": avisos}
    print(json.dumps(res, ensure_ascii=False))
    sys.exit(0 if not faltan and sys.version_info >= (3, 9) else 1)


if __name__ == "__main__":
    main()
