#!/usr/bin/env python3
"""Extrae texto (por página) y tablas de un PDF. Avisa si es un PDF escaneado (sin texto)."""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_util import abrir_lector, error, exigir_entrada, parsear_rango  # noqa: E402

UMBRAL_TEXTO = 15  # caracteres mínimos para considerar que una página tiene texto


def _texto_pagina(pagina):
    """Texto en orden de lectura: agrupa palabras por línea (arriba->abajo, izquierda->derecha)."""
    try:
        t = pagina.extract_text(x_tolerance=2, y_tolerance=3) or ""
    except Exception:  # noqa: BLE001
        t = ""
    return t.strip()


def main():
    ap = argparse.ArgumentParser(
        description="Extrae texto y tablas de un PDF. Ejemplo: extract_pdf.py informe.pdf --formato json --tablas -o salida.json")
    ap.add_argument("pdf", help="PDF de entrada")
    ap.add_argument("--formato", choices=["texto", "json", "csv"], default="texto",
                    help="texto (por defecto), json (texto+tablas) o csv (una tabla por archivo, requiere --outdir)")
    ap.add_argument("-o", "--salida", help="archivo de salida (texto/json). Si falta, imprime por pantalla")
    ap.add_argument("--outdir", help="carpeta para los CSV de tablas (formato csv)")
    ap.add_argument("--paginas", help="rango, p. ej. 1-3,5 (por defecto todas)")
    ap.add_argument("--tablas", action="store_true", help="extraer también tablas (siempre activo en json/csv)")
    ap.add_argument("--clave", help="contraseña si el PDF está protegido")
    a = ap.parse_args()

    exigir_entrada(a.pdf)
    import pdfplumber

    lector = abrir_lector(a.pdf, a.clave)
    total = len(lector.pages)
    indices = parsear_rango(a.paginas, total) if a.paginas else list(range(total))
    con_tablas = a.tablas or a.formato in ("json", "csv")

    paginas, sin_texto = [], []
    try:
        pdf = pdfplumber.open(a.pdf, password=a.clave or None)
    except Exception as e:  # noqa: BLE001
        error("no se pudo leer %s: %s" % (a.pdf, e))
    with pdf:
        for i in indices:
            pag = pdf.pages[i]
            texto = _texto_pagina(pag)
            tablas = []
            if con_tablas:
                try:
                    for t in pag.extract_tables():
                        filas = [[(c or "").replace("\n", " ").strip() for c in fila] for fila in t]
                        if filas and any(any(c for c in f) for f in filas):
                            tablas.append(filas)
                except Exception:  # noqa: BLE001
                    pass
            if len(texto) < UMBRAL_TEXTO:
                sin_texto.append(i + 1)
            paginas.append({"pagina": i + 1, "texto": texto, "tablas": tablas})

    escaneado = len(sin_texto) == len(paginas)
    if escaneado:
        print("AVISO: este PDF parece ESCANEADO (imágenes sin texto). OCR no está disponible en esta "
              "skill: no se puede leer el contenido y no se inventará. Dilo en «Para revisar» y pide "
              "una versión con texto o que el usuario transcriba/lea las imágenes.", file=sys.stderr)
    elif sin_texto:
        print("AVISO: páginas sin texto extraíble (posibles imágenes/escaneos): %s. Su contenido NO "
              "está en la salida." % ", ".join(map(str, sin_texto)), file=sys.stderr)

    if a.formato == "csv":
        if not a.outdir:
            error("para --formato csv indica --outdir CARPETA")
        os.makedirs(a.outdir, exist_ok=True)
        n = 0
        for p in paginas:
            for k, tabla in enumerate(p["tablas"], 1):
                ruta = os.path.join(a.outdir, "tabla_p%d_%d.csv" % (p["pagina"], k))
                if os.path.exists(ruta):
                    error("ya existe %s (usa otra carpeta)" % ruta)
                with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
                    csv.writer(f).writerows(tabla)
                print("Tabla guardada: " + ruta)
                n += 1
        print("%d tabla(s) extraída(s) de %d página(s)." % (n, len(paginas)))
        if n == 0:
            print("No se detectaron tablas con líneas/alineación clara.")
    else:
        if a.formato == "json":
            salida = json.dumps({"archivo": a.pdf, "total_paginas": total, "escaneado": escaneado,
                                 "paginas_sin_texto": sin_texto, "paginas": paginas},
                                ensure_ascii=False, indent=2)
        else:
            partes = []
            for p in paginas:
                partes.append("=== Página %d ===\n%s" % (p["pagina"], p["texto"]))
                for k, t in enumerate(p["tablas"], 1):
                    partes.append("--- Tabla %d (página %d) ---\n%s" % (
                        k, p["pagina"], "\n".join(" | ".join(f) for f in t)))
            salida = "\n\n".join(partes) + "\n"
        if a.salida:
            if os.path.exists(a.salida):
                error("el archivo de salida ya existe: %s" % a.salida)
            with open(a.salida, "w", encoding="utf-8") as f:
                f.write(salida)
            print("Guardado en %s (%d página(s))." % (a.salida, len(paginas)))
        else:
            sys.stdout.write(salida)
    sys.exit(2 if escaneado else 0)


if __name__ == "__main__":
    main()
