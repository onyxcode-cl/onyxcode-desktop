#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Edita un .xlsx existente guardando el resultado en una COPIA (nunca sobrescribe el original).

Uso:
  python edit_xlsx.py original.xlsx --ops ops.json [-o original-v2.xlsx]
  python edit_xlsx.py original.xlsx --ops-json '[{"op":"set_cells","sheet":"Ventas","cells":{"B2":100}}]'
  python edit_xlsx.py --help-ops          # lista de operaciones

El archivo de operaciones es una lista JSON; se aplican en orden. Se conservan estilos, anchos, otras
hojas, filtros, validaciones y gráficos que openpyxl sabe leer. Se avisa de lo que openpyxl no conserva
(tablas dinámicas, macros, segmentaciones, algunas extensiones de formato condicional).
Salida: 0 ok, 1 error al aplicar, 2 uso incorrecto.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
warnings.filterwarnings("ignore")

from openpyxl import load_workbook  # noqa: E402
from openpyxl.styles import Alignment, Border, Font, Side  # noqa: E402
from openpyxl.utils import column_index_from_string, get_column_letter  # noqa: E402

from xlsx_common import (DATE_KINDS, SpecError, add_chart, autosize, col_letter, fill,  # noqa: E402
                         is_formula, number_format, parse_date, style_header_cell, thin_border)

OPS_HELP = """Operaciones ("op"), todas con "sheet" salvo add_sheet:
 set_cells    {cells:{"B2":100,"C2":"=B2*2"}, [format]}         escribe celdas sueltas
 set_range    {start:"A10", values:[[..],[..]], [format]}        escribe una matriz desde start
 append_rows  {rows:[[..]], [formats:{"B":"clp"}]}               añade filas tras la última (copia estilo de la fila previa)
 add_column   {header:"IVA", [values:[..]|formula:"=C{r}*0,19"], [col:"E"], [format], [header_row:1]}
 add_sheet    {name:"Notas", [rows:[[..]]], [header:true]}
 format       {range:"A1:C1"|"B", [bold,italic,fill,font_color,number_format,align,wrap,border,size]}
 set_width    {column:"B"|"Ventas", width:18}   |  {autosize:true}
 freeze       {cell:"A2"}        autofilter {range:"A1:F20"}
 rename_sheet {name:"Nuevo"}     move_sheet {position:0}
 add_chart    {type:column|bar|line|pie, title, x_title, y_title, categories:"A2:A6", series:["B1:B6","C1:C6"],
               [data_sheet], [anchor:"H2"], [width, height]}  (series incluyen la celda de encabezado como nombre)
Fórmulas: cadenas con '='; {r} = nº de fila. Fechas ISO (AAAA-MM-DD) se convierten si el formato es de fecha."""


def sheet_of(wb, op):
    name = op.get("sheet")
    if name not in wb.sheetnames:
        raise SpecError("la hoja %r no existe; hojas: %s" % (name, ", ".join(wb.sheetnames)))
    return wb[name]


def prep(v, fmt, row=None):
    if fmt and str(fmt).lower() in DATE_KINDS:
        v = parse_date(v)
    if is_formula(v) and row:
        v = v.replace("{r}", str(row))
    return v


def put(ws, coord, v, fmt=None):
    c = ws[coord]
    c.value = prep(v, fmt, c.row)
    if fmt:
        c.number_format = number_format(fmt)
    return c


def op_set_cells(wb, op):
    ws = sheet_of(wb, op)
    for k, v in op["cells"].items():
        put(ws, k, v, op.get("format"))


def op_set_range(wb, op):
    ws = sheet_of(wb, op)
    m = re.fullmatch(r"([A-Za-z]+)(\d+)", op["start"])
    if not m:
        raise SpecError("'start' debe ser una celda como A10")
    c0, r0 = column_index_from_string(m.group(1).upper()), int(m.group(2))
    for i, row in enumerate(op["values"]):
        for j, v in enumerate(row):
            put(ws, "%s%d" % (get_column_letter(c0 + j), r0 + i), v, op.get("format"))


def copy_style(src, dst):
    if src.has_style:
        dst._style = copy.copy(src._style)


def op_append_rows(wb, op):
    ws = sheet_of(wb, op)
    last = ws.max_row
    fc = ws.cell(row=last, column=1).value
    if isinstance(fc, str) and fc.strip().lower().startswith("total"):
        print("AVISO: la última fila de %r parece una fila de total; las filas nuevas quedan DEBAJO. "
              "Mejor usa set_range en la fila del total y reescribe el total con la fórmula ampliada." % ws.title)
    for k, row in enumerate(op["rows"], 1):
        r = last + k
        for j, v in enumerate(row, 1):
            c = ws.cell(row=r, column=j)
            copy_style(ws.cell(row=last, column=j), c)
            L = get_column_letter(j)
            fmt = (op.get("formats") or {}).get(L)
            c.value = prep(v, fmt, r)
            if fmt:
                c.number_format = number_format(fmt)
    if ws.auto_filter.ref:
        m = re.fullmatch(r"([A-Z]+\d+):([A-Z]+)(\d+)", ws.auto_filter.ref)
        if m and int(m.group(3)) == last:
            ws.auto_filter.ref = "%s:%s%d" % (m.group(1), m.group(2), last + len(op["rows"]))


def op_add_column(wb, op):
    ws = sheet_of(wb, op)
    hr = int(op.get("header_row", 1))
    col = column_index_from_string(op["col"].upper()) if op.get("col") else ws.max_column + 1
    L = get_column_letter(col)
    hdr = ws.cell(row=hr, column=col, value=op["header"])
    prev = ws.cell(row=hr, column=col - 1) if col > 1 else None
    if prev is not None and prev.has_style:
        copy_style(prev, hdr)
    else:
        style_header_cell(hdr)
    last = ws.max_row
    first_cell = ws.cell(row=last, column=1).value
    if not op.get("values") and isinstance(first_cell, str) and first_cell.strip().lower().startswith("total"):
        last -= 1  # la columna nueva no incluye la fila de total
    vals = op.get("values")
    n = len(vals) if vals else last - hr
    fmt = op.get("format")
    for i in range(n):
        r = hr + 1 + i
        c = ws.cell(row=r, column=col)
        src = ws.cell(row=r, column=col - 1) if col > 1 else None
        if src is not None and src.has_style:
            copy_style(src, c)
            c.number_format = "General"
        v = vals[i] if vals else op.get("formula")
        c.value = prep(v, fmt, r)
        if fmt:
            c.number_format = number_format(fmt)
    ws.column_dimensions[L].width = float(op.get("width", max(12, len(str(op["header"])) + 4)))
    if ws.auto_filter.ref:
        m = re.fullmatch(r"([A-Z]+\d+):([A-Z]+)(\d+)", ws.auto_filter.ref)
        if m and column_index_from_string(m.group(2)) == col - 1:
            ws.auto_filter.ref = "%s:%s%s" % (m.group(1), L, m.group(3))


def op_add_sheet(wb, op):
    if op["name"] in wb.sheetnames:
        raise SpecError("ya existe una hoja llamada %r" % op["name"])
    ws = wb.create_sheet(op["name"][:31])
    for i, row in enumerate(op.get("rows") or [], 1):
        for j, v in enumerate(row, 1):
            c = ws.cell(row=i, column=j, value=prep(v, None, i))
            if i == 1 and op.get("header", True):
                style_header_cell(c)
    if op.get("rows"):
        autosize(ws, 1, ws.max_row)
        if op.get("header", True):
            ws.freeze_panes = "A2"


def op_format(wb, op):
    ws = sheet_of(wb, op)
    rng = op["range"]
    if re.fullmatch(r"[A-Za-z]{1,3}", rng):  # columna entera de datos
        rng = "%s1:%s%d" % (rng.upper(), rng.upper(), ws.max_row)
    cells = ws[rng]
    flat = [c for row in (cells if isinstance(cells, tuple) and cells and isinstance(cells[0], tuple) else [cells if isinstance(cells, tuple) else (cells,)]) for c in (row if isinstance(row, tuple) else (row,))]
    for c in flat:
        f = copy.copy(c.font)
        kw = dict(name=f.name, size=op.get("size", f.size), bold=op.get("bold", f.bold), italic=op.get("italic", f.italic),
                  color=op.get("font_color", f.color), underline=f.underline)
        c.font = Font(**kw)
        if op.get("fill"):
            c.fill = fill(op["fill"])
        if op.get("number_format"):
            c.number_format = number_format(op["number_format"])
        if op.get("align") or op.get("wrap") is not None:
            a = c.alignment
            c.alignment = Alignment(horizontal=op.get("align", a.horizontal), vertical=a.vertical or "center",
                                    wrap_text=op.get("wrap", a.wrap_text))
        if op.get("border"):
            c.border = thin_border()


def op_set_width(wb, op):
    ws = sheet_of(wb, op)
    if op.get("autosize"):
        autosize(ws, 1, ws.max_row)
        return
    key = op["column"]
    if not re.fullmatch(r"[A-Za-z]{1,3}", str(key)):
        key = col_letter(key, ws=ws, header_row=int(op.get("header_row", 1)))
    ws.column_dimensions[key.upper()].width = float(op["width"])


def parse_ref(ref, ws):
    """'B1:B6' -> (col_idx, min_row, max_row)"""
    m = re.fullmatch(r"\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?", ref.replace("'", ""))
    if not m:
        raise SpecError("rango %r inválido (usa el formato B1:B6)" % ref)
    return column_index_from_string(m.group(1).upper()), int(m.group(2)), int(m.group(4) or m.group(2))


def op_add_chart(wb, op):
    ws = sheet_of(wb, op)
    data = wb[op["data_sheet"]] if op.get("data_sheet") else ws
    cc, cr1, cr2 = parse_ref(op["categories"], data)
    series = []
    for s in op["series"]:
        c, r1, r2 = parse_ref(s, data)
        series.append((c, r1, r2))
    add_chart(ws, op, data, (cc, cr1, cr2), series, default_anchor=op.get("anchor", "H2"))


def op_freeze(wb, op):
    sheet_of(wb, op).freeze_panes = op.get("cell", "A2")


def op_autofilter(wb, op):
    sheet_of(wb, op).auto_filter.ref = op["range"]


def op_rename(wb, op):
    sheet_of(wb, op).title = op["name"][:31]


def op_move(wb, op):
    ws = sheet_of(wb, op)
    wb.move_sheet(ws, offset=int(op["position"]) - wb.sheetnames.index(ws.title))


OPS = {"set_cells": op_set_cells, "set_range": op_set_range, "append_rows": op_append_rows, "add_column": op_add_column,
       "add_sheet": op_add_sheet, "format": op_format, "set_width": op_set_width, "add_chart": op_add_chart,
       "freeze": op_freeze, "autofilter": op_autofilter, "rename_sheet": op_rename, "move_sheet": op_move}


def default_output(path):
    base, ext = os.path.splitext(path)
    cand = base + "-v2" + ext
    n = 2
    while os.path.exists(cand):
        n += 1
        cand = "%s-v%d%s" % (base, n, ext)
    return cand


def main(argv=None):
    ap = argparse.ArgumentParser(description="Edita un .xlsx guardando una copia.")
    ap.add_argument("archivo", nargs="?", help="libro original (no se modifica)")
    ap.add_argument("--ops", help="archivo JSON con la lista de operaciones")
    ap.add_argument("--ops-json", help="lista de operaciones como texto JSON")
    ap.add_argument("-o", "--output", help="copia de salida (def.: <original>-v2.xlsx)")
    ap.add_argument("--help-ops", action="store_true", help="muestra las operaciones disponibles")
    a = ap.parse_args(argv)
    if a.help_ops:
        print(OPS_HELP)
        return 0
    if not a.archivo or not (a.ops or a.ops_json):
        ap.error("faltan el archivo original y --ops ARCHIVO.json (o --ops-json '[...]')")
    if not os.path.isfile(a.archivo):
        print("Error: el archivo no existe: %s" % a.archivo, file=sys.stderr)
        return 2
    try:
        ops = json.load(open(a.ops, encoding="utf-8")) if a.ops else json.loads(a.ops_json)
    except (OSError, json.JSONDecodeError) as e:
        print("Error: no pude leer las operaciones (%s)" % e, file=sys.stderr)
        return 2
    if isinstance(ops, dict):
        ops = ops.get("ops", [ops])
    out = a.output or default_output(a.archivo)
    if os.path.abspath(out) == os.path.abspath(a.archivo):
        print("Error: la salida no puede ser el mismo archivo original; usa otro nombre (p. ej. -v2).", file=sys.stderr)
        return 2
    if os.path.exists(out):
        print("Error: ya existe %s; elige otro nombre con -o." % out, file=sys.stderr)
        return 2
    import zipfile
    names = zipfile.ZipFile(a.archivo).namelist()
    keep_vba = a.archivo.lower().endswith(".xlsm")
    warns = []
    if any("pivotTable" in n for n in names):
        warns.append("el libro tiene tablas dinámicas: openpyxl puede perder su formato/actualización")
    if any("slicer" in n.lower() for n in names):
        warns.append("el libro tiene segmentaciones: se perderán")
    if keep_vba and not out.lower().endswith(".xlsm"):
        warns.append("el original es .xlsm: guarda la copia como .xlsm para conservar macros")
    try:
        wb = load_workbook(a.archivo, keep_vba=keep_vba)
        for i, op in enumerate(ops, 1):
            name = op.get("op")
            if name not in OPS:
                raise SpecError("operación %d: %r desconocida; usa --help-ops" % (i, name))
            try:
                OPS[name](wb, op)
            except KeyError as e:
                raise SpecError("operación %d (%s): falta el campo %s" % (i, name, e))
        wb.save(out)
    except SpecError as e:
        print("Error: %s" % e, file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001
        print("Error al editar: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 1
    print("Copia creada: %s (%d operación(es) aplicada(s)); el original no se tocó." % (out, len(ops)))
    for w in warns:
        print("AVISO: " + w)
    print("Siguiente paso: python recalc_check.py %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
