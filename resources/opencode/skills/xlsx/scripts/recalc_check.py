#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Recalcula localmente y compara con los valores guardados, sin modificar el libro.
Salida: 0 OK (puede haber fórmulas no soportadas avisadas), 1 defectos corregibles, 2 uso.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

import warnings

warnings.filterwarnings("ignore")
from openpyxl import load_workbook  # noqa: E402
from openpyxl.utils import range_boundaries
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared"))
import render_grid  # noqa: E402  GridCraft (ArtCraft)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from formula_cache import verify_cache

ERRORS = ("#DIV/0!", "#REF!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#NULL!")


def cells_in_ref(ref):
    ref = ref.replace("$", "")
    try:
        c1, r1, c2, r2 = range_boundaries(ref)
    except Exception:  # noqa: BLE001
        return None
    if None in (c1, r1, c2, r2) or (c2 - c1 + 1) * (r2 - r1 + 1) > 5000:
        return None
    return c1, r1, c2, r2


REF_RE = re.compile(r"(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w\.]*))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)(?![\w(])")


def empty_refs(formula, wb, own_sheet):
    """Referencias (celda única o rango completo) cuyo contenido está vacío."""
    body = re.sub(r'"[^"]*"', '""', formula)
    found = []
    for m in REF_RE.finditer(body):
        sheet = (m.group(1) or m.group(2) or own_sheet).replace("''", "'")
        sheet = next((name for name in wb.sheetnames if name.casefold() == sheet.casefold()), sheet)
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
    # Una función ausente de nuestra lista puede ser válida en Excel (o una UDF).
    # El cálculo la informa como no soportada: no convertir esa limitación en ✘.
    for m in re.finditer(r"(?:'((?:[^']|'')+)'|([A-Za-z_][\w\.]*))!", body):
        s = (m.group(1) or m.group(2)).replace("''", "'")
        if s.casefold() not in {name.casefold() for name in wb.sheetnames}:
            out.append("referencia a la hoja inexistente %r" % s)
    if "#REF!" in formula:
        out.append("contiene #REF!")
    return out


def analyse(path, show):
    wbf = load_workbook(path)  # fórmulas
    formulas = []
    for ws in wbf.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.data_type == "f":
                    formulas.append((ws.title, c.coordinate, c.value))
    res = {"archivo": path, "motor": None, "formulas": len(formulas), "errores": [],
           "vacias": [], "sintaxis": [], "valores": [], "avisos": []}
    checked = verify_cache(path, wbf)
    res["motor"] = "local"
    res["diferencias"] = checked["differences"]
    res["rangos"] = checked["ranges"]
    res["no_soportadas"] = checked["unsupported"]
    res["errores"] = checked["errors"]
    mapa = checked["values"]
    # GridCraft amplía la cobertura cuando está disponible, pero no es requisito.
    if checked["unsupported"] and render_grid.find_gridcraft():
        grid = render_grid.recalc(path, res["avisos"])
        if grid is not None:
            from formula_cache import same_value
            cached = load_workbook(path, data_only=True)
            grid_values = {(v["hoja"], v["celda"]): v["valor"] for v in grid["valores"]}
            pending = []
            for item in checked["unsupported"]:
                key = (item["hoja"], item["celda"])
                if key not in grid_values or grid_values[key] is None:
                    pending.append(item)
                    continue
                value = grid_values[key]
                mapa[key] = value
                if isinstance(value, str) and value in ERRORS:
                    res["errores"].append(dict(item, valor=value, problema="corrige la fórmula o sus datos de entrada"))
                elif not same_value(cached[key[0]][key[1]].value, value, wbf.epoch):
                    res["diferencias"].append(dict(item, valor=value, problema="valor guardado distinto; recalcula con el motor que admite esta fórmula y guarda una copia nueva"))
            cached.close()
            res["no_soportadas"] = pending
            res["motor"] = "local + gridcraft"
    for item in res["no_soportadas"]:
        res["avisos"].append("%s!%s: %s; valor NO verificado. Usa una fórmula soportada si necesitas el valor en todos los visores." %
                             (item["hoja"], item["celda"], item["problema"]))
    for sheet, coord, f in formulas:
        if not isinstance(f, str):
            continue
        for p in syntax_issues(f, wbf):
            res["sintaxis"].append({"hoja": sheet, "celda": coord, "formula": f, "problema": p})
        for e in empty_refs(f, wbf, sheet):
            res["vacias"].append({"hoja": sheet, "celda": coord, "formula": f, "referencia": e})
        if (sheet, coord) in mapa and len(res["valores"]) < show:
            res["valores"].append({"hoja": sheet, "celda": coord, "formula": f, "valor": mapa[(sheet, coord)]})
    wbf.close()
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description="Recalcula y compara valores guardados; cálculo local y verifica las fórmulas de un .xlsx.")
    ap.add_argument("archivo", help="libro .xlsx a verificar (no se modifica)")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    ap.add_argument("--show", type=int, default=15, help="cuántos valores calculados mostrar (def. 15)")
    ap.add_argument("--workdir", help="opción conservada por compatibilidad; el cálculo local no escribe archivos temporales")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.archivo):
        print("Error: el archivo no existe: %s" % a.archivo, file=sys.stderr)
        return 2
    try:
        res = analyse(a.archivo, a.show)
    except Exception as e:  # noqa: BLE001
        print("Error al abrir el libro: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 2
    bad = bool(res["errores"] or res["sintaxis"] or res["diferencias"] or res["rangos"])
    res["ok"] = not bad
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2, default=str))
        return 1 if bad else 0
    print("Archivo: %s" % res["archivo"])
    quien = res["motor"]
    print("Fórmulas: %d | Recalculado con: %s" % (res["formulas"], quien))
    for av in res["avisos"]:
        print("AVISO: " + av)
    for e in res["errores"]:
        print("ERROR  %s!%s  %s  ->  %s" % (e["hoja"], e["celda"], e.get("formula", ""), str(e["valor"]) + ": " + e["problema"]))
    for e in res["diferencias"] + res["rangos"]:
        print("✘ %s!%s: %s (calculado: %s; guardado: %s)" %
              (e["hoja"], e["celda"], e["problema"], e.get("valor", "—"), e.get("guardado", "—")))
    for e in res["sintaxis"]:
        print("SINTAXIS  %s!%s  %s  ->  %s" % (e["hoja"], e["celda"], e["formula"], e["problema"]))
    for e in res["vacias"]:
        print("VACÍA  %s!%s  %s  apunta a celdas vacías: %s" % (e["hoja"], e["celda"], e["formula"], e["referencia"]))
    if res["valores"]:
        print("Valores calculados (primeras %d):" % len(res["valores"]))
        for v in res["valores"]:
            print("  %s!%s  %s = %s" % (v["hoja"], v["celda"], v["formula"], v["valor"]))
    print("RESULTADO: " + ("OK" if not bad else "HAY PROBLEMAS: corrígelos y vuelve a ejecutar"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
