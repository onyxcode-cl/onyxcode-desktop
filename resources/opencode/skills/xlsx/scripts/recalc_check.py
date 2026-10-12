#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Calcula y verifica las fórmulas de un .xlsx (openpyxl NO calcula fórmulas).

Con LibreOffice (soffice) convierte el libro a una copia recalculada en una carpeta temporal y
lee los valores. Detecta #DIV/0!, #REF!, #NAME?, #VALUE!, #N/A, #NUM!, #NULL! y fórmulas que
apuntan a celdas vacías. Sin LibreOffice lo dice claramente y hace solo una verificación sintáctica.

Uso:  python recalc_check.py libro.xlsx [--json] [--show N] [--workdir DIR]
Salida: 0 sin problemas, 1 hay errores/advertencias graves, 2 uso incorrecto.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import warnings

warnings.filterwarnings("ignore")
from openpyxl import load_workbook  # noqa: E402
from openpyxl.utils import column_index_from_string, range_boundaries

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_common import XLFN_FUNCTIONS  # noqa: E402

ERRORS = ("#DIV/0!", "#REF!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#NULL!")
SOFFICE_CANDIDATES = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice",
                      "/usr/local/bin/soffice", "/opt/homebrew/bin/soffice"]
KNOWN_FUNCS = set("""ABS AND AVERAGE AVERAGEIF AVERAGEIFS CEILING CHOOSE COLUMN COLUMNS CONCAT CONCATENATE COUNT COUNTA
COUNTBLANK COUNTIF COUNTIFS DATE DATEDIF DAY DAYS EDATE EOMONTH EXP FILTER FIND FLOOR HLOOKUP HOUR IF IFERROR IFNA IFS
INDEX INDIRECT INT ISBLANK ISERROR ISNA ISNUMBER ISTEXT LARGE LEFT LEN LN LOG LOG10 LOOKUP LOWER MATCH MAX MAXIFS MEDIAN
MID MIN MINIFS MINUTE MOD MONTH NETWORKDAYS NOT NOW OFFSET OR PI PMT POWER PRODUCT PROPER RANK RIGHT ROUND ROUNDDOWN
ROUNDUP ROW ROWS SEARCH SECOND SMALL SORT SQRT STDEV SUBSTITUTE SUBTOTAL SUM SUMIF SUMIFS SUMPRODUCT SWITCH TEXT TEXTJOIN
TODAY TRIM TRUE FALSE UNIQUE UPPER VALUE VLOOKUP WEEKDAY XLOOKUP XOR YEAR NPV IRR FV PV RATE VAR TRANSPOSE COUNTUNIQUE
ISERR ISEVEN ISODD N NA T TRUNC SIGN ROUNDUP REPT CHAR CODE CLEAN EXACT FIXED DOLLAR""".split())
KNOWN_FUNCS.update(XLFN_FUNCTIONS)  # las modernas con punto (STDEV.S…) también son válidas


def find_soffice():
    # En el Sandbox de Tareas LibreOffice aborta (y macOS muestra un aviso de problema): no se intenta.
    if os.environ.get("LAZUNOX_SANDBOX") == "1":
        return None
    p = os.environ.get("LAZUNOX_SOFFICE")
    if p and os.path.isfile(p) and os.access(p, os.X_OK):
        return p
    p = shutil.which("soffice")
    if p:
        return p
    for c in SOFFICE_CANDIDATES:
        if os.path.exists(c):
            return c
    return None


def recalc_copy(path, soffice, workdir):
    out = os.path.join(workdir, "recalc")
    os.makedirs(out, exist_ok=True)
    profile = os.path.join(workdir, "profile")
    src = os.path.join(workdir, "entrada.xlsx")
    shutil.copyfile(path, src)
    cmd = [soffice, "-env:UserInstallation=file://" + profile, "--headless", "--norestore",
           "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, src]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    files = glob.glob(os.path.join(out, "*.xlsx"))
    if not files:
        raise RuntimeError("LibreOffice no generó la copia recalculada: %s" % (r.stderr or r.stdout).strip()[:300])
    return files[0]


def cells_in_ref(ref):
    ref = ref.replace("$", "")
    try:
        c1, r1, c2, r2 = range_boundaries(ref)
    except Exception:  # noqa: BLE001
        return None
    if None in (c1, r1, c2, r2) or (c2 - c1 + 1) * (r2 - r1 + 1) > 5000:
        return None
    return c1, r1, c2, r2


REF_RE = re.compile(r"(?:(?:'([^']+)'|([A-Za-z_][\w\.]*))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)(?![\w(])")


def empty_refs(formula, wb, own_sheet):
    """Referencias (celda única o rango completo) cuyo contenido está vacío."""
    body = re.sub(r'"[^"]*"', '""', formula)
    found = []
    for m in REF_RE.finditer(body):
        sheet = m.group(1) or m.group(2) or own_sheet
        if sheet not in wb.sheetnames:
            continue
        box = cells_in_ref(m.group(3))
        if not box:
            continue
        c1, r1, c2, r2 = box
        ws = wb[sheet]
        if all(ws.cell(row=r, column=c).value is None for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)):
            found.append("%s!%s" % (sheet, m.group(3).replace("$", "")))
    return found


def syntax_issues(formula, wb):
    out = []
    body = re.sub(r'"[^"]*"', '""', formula)
    if formula.count('"') % 2:
        out.append("comillas sin cerrar")
    if body.count("(") != body.count(")"):
        out.append("paréntesis desbalanceados")
    for fn in re.findall(r"([A-Za-z_][A-Za-z0-9_\.]*)\(", body):
        u = fn.upper().replace("_XLFN.", "")
        if u not in KNOWN_FUNCS:
            out.append("función no reconocida %s (¿nombre en español o mal escrito? en el archivo van en inglés)" % fn)
    for m in re.finditer(r"(?:'([^']+)'|([A-Za-z_][\w\.]*))!", body):
        s = m.group(1) or m.group(2)
        if s not in wb.sheetnames:
            out.append("referencia a la hoja inexistente %r" % s)
    if "#REF!" in formula:
        out.append("contiene #REF!")
    return out


def analyse(path, soffice, workdir, show):
    wbf = load_workbook(path)  # fórmulas
    formulas = []
    for ws in wbf.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("=") and len(c.value) > 1:
                    formulas.append((ws.title, c.coordinate, c.value))
    res = {"archivo": path, "libreoffice": bool(soffice), "formulas": len(formulas), "errores": [],
           "vacias": [], "sintaxis": [], "valores": [], "avisos": []}
    values_wb = None
    if soffice:
        try:
            values_wb = load_workbook(recalc_copy(path, soffice, workdir), data_only=True)
        except Exception as e:  # noqa: BLE001
            res["avisos"].append("No se pudo recalcular con LibreOffice (%s); solo verificación sintáctica." % e)
            res["libreoffice"] = False
    elif os.environ.get("LAZUNOX_SANDBOX") == "1":
        res["avisos"].append("En modo Sandbox LibreOffice no puede ejecutarse: NO se calcularon los valores; solo verificación "
                             "sintáctica básica. Dile al usuario que los valores no están verificados y que con Control total del Mac "
                             "(o abriendo el archivo en Excel) puede comprobarlos.")
    else:
        res["avisos"].append("LibreOffice no está instalado: NO se calcularon los valores; solo verificación "
                             "sintáctica básica. Dile al usuario que los valores no están verificados.")
    for sheet, coord, f in formulas:
        for p in syntax_issues(f, wbf):
            res["sintaxis"].append({"hoja": sheet, "celda": coord, "formula": f, "problema": p})
        for e in empty_refs(f, wbf, sheet):
            res["vacias"].append({"hoja": sheet, "celda": coord, "formula": f, "referencia": e})
        if values_wb is not None:
            v = values_wb[sheet][coord].value
            if isinstance(v, str) and (v in ERRORS or v.startswith("Err:")):
                res["errores"].append({"hoja": sheet, "celda": coord, "formula": f, "valor": v})
            if len(res["valores"]) < show:
                res["valores"].append({"hoja": sheet, "celda": coord, "formula": f, "valor": v})
            elif v is None and not res["errores"]:
                pass
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description="Recalcula (LibreOffice) y verifica las fórmulas de un .xlsx.")
    ap.add_argument("archivo", help="libro .xlsx a verificar (no se modifica)")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    ap.add_argument("--show", type=int, default=15, help="cuántos valores calculados mostrar (def. 15)")
    ap.add_argument("--workdir", help="carpeta de trabajo temporal (def.: una carpeta temporal del sistema)")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.archivo):
        print("Error: el archivo no existe: %s" % a.archivo, file=sys.stderr)
        return 2
    soffice = find_soffice()
    base = a.workdir or tempfile.mkdtemp(prefix="xlsx-recalc-")
    os.makedirs(base, exist_ok=True)
    try:
        res = analyse(a.archivo, soffice, base, a.show)
    except Exception as e:  # noqa: BLE001
        print("Error al abrir el libro: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 2
    finally:
        if not a.workdir:
            shutil.rmtree(base, ignore_errors=True)
    bad = bool(res["errores"] or res["sintaxis"] or res["vacias"])
    res["ok"] = not bad
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
        return 1 if bad else 0
    print("Archivo: %s" % res["archivo"])
    print("Fórmulas: %d | Recalculado con LibreOffice: %s" % (res["formulas"], "sí" if res["libreoffice"] else "NO"))
    for av in res["avisos"]:
        print("AVISO: " + av)
    for e in res["errores"]:
        print("ERROR  %s!%s  %s  ->  %s" % (e["hoja"], e["celda"], e["formula"], e["valor"]))
    for e in res["sintaxis"]:
        print("SINTAXIS  %s!%s  %s  ->  %s" % (e["hoja"], e["celda"], e["formula"], e["problema"]))
    for e in res["vacias"]:
        print("VACÍA  %s!%s  %s  apunta a celdas vacías: %s" % (e["hoja"], e["celda"], e["formula"], e["referencia"]))
    if res["valores"]:
        print("Valores calculados (primeras %d):" % len(res["valores"]))
        for v in res["valores"]:
            print("  %s!%s  %s = %s" % (v["hoja"], v["celda"], v["formula"], v["valor"]))
    print("RESULTADO: " + ("sin problemas detectados" if not bad else "HAY PROBLEMAS: corrígelos y vuelve a ejecutar"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
