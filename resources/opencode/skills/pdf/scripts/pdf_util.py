"""Utilidades comunes de los scripts de la skill pdf (rangos de páginas, avisos, salida)."""
from __future__ import annotations

import os
import sys


def error(msg, code=1):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(code)


def exigir_entrada(ruta):
    if not os.path.isfile(ruta):
        error("el archivo no existe: %s" % ruta)
    return ruta


def exigir_salida_nueva(ruta):
    """La salida siempre es un archivo NUEVO: no se sobrescribe nada."""
    if os.path.exists(ruta):
        error("el archivo de salida ya existe: %s (usa otro nombre, p. ej. -v2)" % ruta)
    carpeta = os.path.dirname(os.path.abspath(ruta))
    if not os.path.isdir(carpeta):
        os.makedirs(carpeta, exist_ok=True)
    return ruta


def abrir_lector(ruta, clave=None):
    """Abre un PDF con pypdf; da mensajes claros si está protegido o dañado."""
    from pypdf import PdfReader
    exigir_entrada(ruta)
    try:
        lector = PdfReader(ruta)
    except Exception as e:  # noqa: BLE001
        error("no se pudo abrir %s: %s" % (ruta, e))
    if lector.is_encrypted:
        ok = 0
        try:
            ok = lector.decrypt(clave or "")
        except Exception:  # noqa: BLE001
            ok = 0
        if not ok:
            error("el PDF está protegido con contraseña (%s). Pide la contraseña al usuario "
                  "y pásala con --clave; no se puede saltar la protección." % ruta)
    return lector


def parsear_rango(texto, total):
    """'1-3,5,8-' -> lista de índices base 0 (conserva el orden dado, admite repetidos)."""
    indices = []
    for trozo in str(texto).replace(" ", "").split(","):
        if not trozo:
            continue
        try:
            if "-" in trozo:
                a, b = trozo.split("-", 1)
                ini = int(a) if a else 1
                fin = int(b) if b else total
                paso = 1 if ini <= fin else -1
                rango = list(range(ini, fin + paso, paso))
            else:
                rango = [int(trozo)]
        except ValueError:
            error("rango de páginas no válido: «%s» (ejemplo correcto: 1-3,5,8-)" % trozo)
        for p in rango:
            if p < 1 or p > total:
                error("la página %d no existe (el PDF tiene %d páginas)" % (p, total))
            indices.append(p - 1)
    if not indices:
        error("el rango de páginas está vacío")
    return indices
