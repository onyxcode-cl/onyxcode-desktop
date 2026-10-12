#!/usr/bin/env python3
"""GridCraft (`gridcraft-cli`, hoja de cálculo en Rust de storytold) para la skill xlsx.

Dos usos, sin shell, con tope de tiempo y con carpetas de datos propias (no toca la configuración del usuario):
- recalc(): valor calculado de cada celda con fórmula, leyendo `convert libro.xlsx salida.json` (el JSON trae
  precisión completa; el CSV solo 15 cifras).
- render_xlsx(): PDF de todas las hojas con `run --in libro.xlsx --cmd file.exportPdf=…` y un PNG por página
  (pypdfium2, como render.py).

Si GridCraft no está, falla, o no da un resultado fiable (fórmulas que derraman «spill», funciones de Excel 2010+ sin
prefijo `_xlfn.`, o #NAME? con una función que GridCraft conoce pero no calcula), devuelve None y el llamador usa
LibreOffice. Nunca escribe junto al libro original: todo sale a una carpeta temporal o a `outdir`.

Lo que cubre y lo que no frente a LibreOffice: docs/GUIA-CRAFT.md, sección «GridCraft: lo que cubre y lo que no».
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import tempfile

TIEMPO = 120  # segundos por llamada a gridcraft-cli
ERRORES = {"Div0": "#DIV/0!", "NA": "#N/A", "Name": "#NAME?", "Null": "#NULL!", "Num": "#NUM!",
           "Ref": "#REF!", "Value": "#VALUE!"}
NO_FIABLE = ("Spill",)  # GridCraft no da fiables los resultados que derraman (spill)
# Funciones de Excel 2010+ (y todas las con punto, p. ej. STDEV.S). En el archivo van con prefijo `_xlfn.`; sin él Excel
# muestra #NAME? aunque GridCraft las calcule. Lista parcial: lo que no esté aquí se decide por el propio resultado.
NECESITA_XLFN = {"CONCAT", "TEXTJOIN", "IFS", "SWITCH", "MAXIFS", "MINIFS", "XLOOKUP", "XMATCH", "FILTER", "SORT",
                 "SORTBY", "UNIQUE", "SEQUENCE", "LET", "IFNA", "DAYS", "ISOWEEKNUM", "AGGREGATE", "RANDARRAY", "XOR",
                 "ISFORMULA", "FORMULATEXT", "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT", "NUMBERVALUE",
                 "TEXTBEFORE", "TEXTAFTER", "TEXTSPLIT", "VSTACK", "HSTACK", "TOCOL", "TOROW", "WRAPCOLS", "WRAPROWS",
                 "TAKE", "DROP", "CHOOSECOLS", "CHOOSEROWS", "EXPAND", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL",
                 "LAMBDA", "GROUPBY", "PIVOTBY", "REGEXTEST", "REGEXEXTRACT", "REGEXREPLACE"}


class NoFiable(Exception):
    """GridCraft no puede dar un resultado fiable para este libro."""


def _ejecutable(ruta):
    return bool(ruta) and os.path.isfile(ruta) and os.access(ruta, os.X_OK)


def find_gridcraft():
    """`gridcraft-cli`, por orden: el que la app fijó al arrancar (LAZUNOX_GRIDCRAFT) → el que instaló después,
    en `$LAZUNOX_BIN_DIR/craft-*/*/gridcraft-cli`, solo si su carpeta tiene la marca installed-gridcraft.json."""
    ruta = os.environ.get("LAZUNOX_GRIDCRAFT")
    if _ejecutable(ruta):
        return ruta
    base = os.environ.get("LAZUNOX_BIN_DIR")
    if base:
        for d in sorted(glob.glob(os.path.join(base, "craft-*")), reverse=True):
            if not os.path.isfile(os.path.join(d, "installed-gridcraft.json")):
                continue
            for cand in sorted(glob.glob(os.path.join(d, "*", "gridcraft-cli")), reverse=True):
                if _ejecutable(cand):
                    return cand
    return None


def _run(args, tmp):
    """Ejecuta gridcraft-cli sin shell, con entorno mínimo y datos en `tmp` (se borra al terminar el llamador)."""
    home = os.path.join(tmp, "home")
    os.makedirs(home, exist_ok=True)
    env = {"PATH": "/usr/bin:/bin", "HOME": home, "XDG_CONFIG_HOME": home, "XDG_DATA_HOME": home,
           "XDG_CACHE_HOME": home, "XDG_STATE_HOME": home}
    return subprocess.run(args, capture_output=True, text=True, timeout=TIEMPO, env=env, cwd=tmp,
                          stdin=subprocess.DEVNULL)


def _celda(col0, fila0):
    letras, n = "", col0 + 1
    while n:
        n, resto = divmod(n - 1, 26)
        letras = chr(65 + resto) + letras
    return "%s%d" % (letras, fila0 + 1)


def _catalogo(exe, tmp):
    """Nombres de función que GridCraft conoce (`gridcraft-cli functions --json`), en mayúsculas."""
    r = _run([exe, "functions", "--json"], tmp)
    if r.returncode != 0:
        raise NoFiable("no se pudo leer el catálogo de funciones")
    return {str(f["name"]).upper() for f in json.loads(r.stdout)}


def _sin_xlfn(formula):
    """Función de Excel 2010+ escrita sin `_xlfn.`: Excel la mostraría como #NAME? (GridCraft la calcularía igual)."""
    for nombre in set(re.findall(r"([A-Za-z_][A-Za-z0-9_.]*)\s*\(", formula.upper())):
        if nombre.startswith("_XLFN."):
            continue
        if nombre in NECESITA_XLFN or "." in nombre:
            return nombre
    return None


def _valor(celda, catalogo, formula):
    """(valor, es_error) de una celda del JSON de GridCraft. NoFiable si el tipo o el error no se reconoce.

    #NAME? solo es fiable si la función no existe en el catálogo de GridCraft: si existe y no se calculó, puede ser
    una función que GridCraft no implementa y Excel sí, así que se usa LibreOffice."""
    v = celda.get("value") or {}
    t, x = v.get("t"), v.get("v")
    if t == "Error":
        if x in NO_FIABLE:
            raise NoFiable("GridCraft no calcula con fiabilidad esta fórmula (%s)" % x)
        if x not in ERRORES:
            raise NoFiable("código de error desconocido: %r" % x)
        if x == "Name":
            nombres = set(re.findall(r"([A-Za-z_][A-Za-z0-9_.]*)\s*\(", formula.upper()))
            if nombres & catalogo():
                raise NoFiable("GridCraft no implementa alguna función de la fórmula %s" % formula)
        return ERRORES[x], True
    if t == "Number" and isinstance(x, (int, float)) and not isinstance(x, bool):
        if float(x).is_integer() and abs(x) < 1e15:
            return int(x), False
        return float(x), False
    if t == "Text" and isinstance(x, str):
        return x, False
    if t == "Bool" and isinstance(x, bool):
        return x, False
    raise NoFiable("tipo de valor desconocido: %r" % (v,))


def recalc(xlsx_path, avisos=None):
    """Valores calculados por GridCraft: dict con el mismo formato de recalc_check (motor, formulas, errores, valores)
    o None si no está, falla o no es fiable. `valores` trae todas las celdas con fórmula, en orden de hoja y fila."""
    exe = find_gridcraft()
    if not exe:
        return None
    tmp = tempfile.mkdtemp(prefix="lazunox-grid-")
    try:
        salida = os.path.join(tmp, "valores.json")
        r = _run([exe, "convert", os.path.abspath(xlsx_path), salida], tmp)
        if r.returncode != 0 or not os.path.isfile(salida):
            raise NoFiable("gridcraft-cli no pudo leer el libro: %s" % (r.stderr or "").strip()[:200])
        with open(salida, encoding="utf-8") as f:
            datos = json.load(f)
        cache = {}

        def catalogo():
            if "nombres" not in cache:
                cache["nombres"] = _catalogo(exe, tmp)
            return cache["nombres"]

        valores, errores = [], []
        for hoja in datos["sheets"]:
            for banda in hoja["cells"]["bands"].values():
                for fila, celdas in sorted(banda["rows"].items(), key=lambda kv: int(kv[0])):
                    for col, celda in sorted(celdas.items(), key=lambda kv: int(kv[0])):
                        if not celda.get("formula"):
                            continue
                        formula = "=" + celda["formula"]["text"]
                        if _sin_xlfn(formula):
                            raise NoFiable("función sin prefijo _xlfn en %s: Excel mostraría #NAME?" % formula)
                        v, es_error = _valor(celda, catalogo, formula)
                        entrada = {"hoja": hoja["name"], "celda": _celda(int(col), int(fila)),
                                   "formula": formula, "valor": v}
                        valores.append(entrada)
                        if es_error:
                            errores.append(entrada)
        return {"motor": "gridcraft", "archivo": xlsx_path, "formulas": len(valores),
                "errores": errores, "valores": valores}
    except NoFiable as e:
        if avisos is not None:
            avisos.append("GridCraft no sirve para este libro (%s); se usa LibreOffice." % e)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError) as e:
        if avisos is not None:
            avisos.append("GridCraft no pudo recalcular (%s); se usa LibreOffice." % e)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return None


def render_xlsx(xlsx_path, outdir, max_pages=20, dpi=110, avisos=None):
    """PNG por página de todas las hojas, dibujados con GridCraft. Devuelve (lista_de_png, n_paginas) o None."""
    exe = find_gridcraft()
    if not exe:
        return None
    tmp = tempfile.mkdtemp(prefix="lazunox-grid-")
    try:
        pdf = os.path.join(tmp, "libro.pdf")
        cmd = "file.exportPdf=" + json.dumps({"path": pdf, "sheets": "all"})
        r = _run([exe, "run", "--in", os.path.abspath(xlsx_path), "--cmd", cmd], tmp)
        if r.returncode != 0 or not os.path.isfile(pdf):
            raise NoFiable("GridCraft no exportó el PDF: %s" % (r.stderr or r.stdout or "").strip()[:200])
        import pypdfium2 as pdfium

        os.makedirs(outdir, exist_ok=True)
        base = os.path.splitext(os.path.basename(xlsx_path))[0]
        doc = pdfium.PdfDocument(pdf)
        try:
            total = len(doc)
            pngs = []
            for i in range(min(total, max_pages)):
                img = doc[i].render(scale=dpi / 72.0).to_pil().convert("RGB")
                ruta = os.path.join(outdir, "%s-p%02d.png" % (base, i + 1))
                img.save(ruta)
                pngs.append(ruta)
        finally:
            doc.close()
        if not pngs:
            raise NoFiable("el PDF no tiene páginas")
        if total > max_pages and avisos is not None:
            avisos.append("el documento tiene %d páginas; solo se rasterizaron las primeras %d." % (total, max_pages))
        return pngs, total
    except Exception as e:  # noqa: BLE001 - PDF dañado, pypdfium2 ausente, etc.: siempre se cae a LibreOffice
        if avisos is not None:
            avisos.append("GridCraft no pudo dibujar el libro (%s); se usa LibreOffice." % e)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return None
