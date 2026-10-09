#!/usr/bin/env python3
"""Edita un .docx existente y guarda una COPIA nueva (nunca toca el original).

Operaciones (se aplican en el orden dado):
  --reemplazar BUSCAR POR      reemplaza TODAS las apariciones (cuerpo, tablas, encabezados, pies), conservando formato;
                               (aunque el texto esté partido en varios runs)
  --parrafo-despues ANCLA TEXTO [--estilo-nuevo ESTILO]   añade un párrafo tras el que contiene ANCLA
  --tabla-despues ANCLA tabla.json                        añade una tabla (JSON como el bloque "table" de build_docx)
  --imagen-despues ANCLA ruta.png [ancho_cm]              añade una imagen tras ANCLA (opcional ancho en cm)
  --borrar-parrafo TEXTO       borra el primer párrafo que contiene TEXTO
  --estilo TEXTO ESTILO        cambia el estilo del primer párrafo que contiene TEXTO
  --ops ops.json               lista JSON de operaciones: {"op":"reemplazar","buscar":..,"por":..} etc.
Uso:  python edit_docx.py entrada.docx salida.docx --reemplazar "2025" "2026" --borrar-parrafo "BORRADOR"
Códigos de salida: 0 ok, 1 una operación no encontró su objetivo (no se guarda), 2 uso.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _docxlib as L  # noqa: E402
from docx import Document  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.text.paragraph import Paragraph  # noqa: E402

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def replace_in_paragraph(p_el, old, new):
    """Reemplaza `old` por `new` en el párrafo conservando el formato del primer run afectado."""
    count = 0
    while True:
        nodes = p_el.xpath(".//w:t[not(ancestor::w:del)]")
        full = "".join(n.text or "" for n in nodes)
        pos = full.find(old)
        if pos < 0 or not old:
            return count
        end = pos + len(old)
        off, first = 0, True
        for n in nodes:
            txt = n.text or ""
            a, b = off, off + len(txt)
            off = b
            if b <= pos or a >= end:
                continue
            s, e = max(pos, a) - a, min(end, b) - a
            if first:
                n.text = txt[:s] + new + txt[e:]
                first = False
            else:
                n.text = txt[:s] + txt[e:]
            n.set(XML_SPACE, "preserve")
        count += 1
        # evitar bucle infinito si `new` contiene `old`: continuar tras el reemplazo
        if old in new:
            return count


def containers(doc):
    yield doc.element.body
    for s in doc.sections:
        for part in (s.header, s.footer, s.first_page_header, s.first_page_footer,
                     s.even_page_header, s.even_page_footer):
            try:
                if not part.is_linked_to_previous:
                    yield part._element
            except Exception:
                pass


def find_paragraph(doc, text):
    for p in doc.element.body.xpath(".//w:p"):
        if text in L.para_text(p):
            return p
    return None


def op_replace(doc, o):
    n = 0
    for root in containers(doc):
        for p in root.xpath(".//w:p"):
            n += replace_in_paragraph(p, o["buscar"], o["por"])
    return n, "reemplazadas %d aparición(es) de «%s»" % (n, o["buscar"])


def op_add_paragraph(doc, o):
    anchor = find_paragraph(doc, o["despues_de"])
    if anchor is None:
        return 0, None
    style = o.get("estilo")
    if not style:
        ps = anchor.find(qn("w:pPr") + "/" + qn("w:pStyle"))
        style = None
        if ps is not None:
            for s in doc.styles:
                if s.style_id == ps.get(qn("w:val")):
                    style = s.name
    p = doc.add_paragraph(style=style) if style else doc.add_paragraph()
    L.add_rich_text(p, o["texto"])
    L.move_after(anchor, p._p)
    return 1, "párrafo añadido tras «%s»" % o["despues_de"]


def op_add_table(doc, o):
    anchor = find_paragraph(doc, o["despues_de"])
    if anchor is None:
        return 0, None
    t = L.build_table(doc, o["tabla"], o.get("tema"))
    spacer = doc.add_paragraph()
    L.move_after(anchor, t._tbl, spacer._p)
    return 1, "tabla añadida tras «%s»" % o["despues_de"]


def op_add_image(doc, o):
    anchor = find_paragraph(doc, o["despues_de"])
    if anchor is None:
        return 0, None
    if not os.path.isfile(o["ruta"]):
        raise SystemExit("ERROR: la imagen no existe: " + o["ruta"])
    p, cap = L.add_image(doc, o["ruta"], o.get("ancho_cm"), o.get("pie"))
    L.move_after(anchor, *([p._p] + ([cap._p] if cap is not None else [])))
    return 1, "imagen añadida tras «%s»" % o["despues_de"]


def op_delete(doc, o):
    p = find_paragraph(doc, o["texto"])
    if p is None:
        return 0, None
    parent = p.getparent()
    if parent.tag == qn("w:tc") and len(parent.findall(qn("w:p"))) == 1:
        for t in p.xpath(".//w:t"):
            t.text = ""
    else:
        parent.remove(p)
    return 1, "párrafo borrado: «%s»" % o["texto"]


def op_style(doc, o):
    p = find_paragraph(doc, o["texto"])
    if p is None:
        return 0, None
    try:
        Paragraph(p, doc._body).style = doc.styles[o["estilo"]]
    except KeyError:
        names = sorted({s.name for s in doc.styles if s.type == 1})
        raise SystemExit("ERROR: el estilo «%s» no existe. Disponibles: %s" % (o["estilo"], ", ".join(names)))
    return 1, "estilo de «%s» → %s" % (o["texto"], o["estilo"])


OPS = {"reemplazar": op_replace, "parrafo_despues": op_add_paragraph, "tabla_despues": op_add_table,
       "imagen_despues": op_add_image, "borrar_parrafo": op_delete, "estilo": op_style}


class Acc(argparse.Action):
    def __call__(self, parser, ns, values, option_string=None):
        lst = getattr(ns, "ops", None) or []
        name = self.dest
        if name == "reemplazar":
            o = {"op": name, "buscar": values[0], "por": values[1]}
        elif name == "parrafo_despues":
            o = {"op": name, "despues_de": values[0], "texto": values[1]}
        elif name == "tabla_despues":
            try:
                with open(values[1], encoding="utf-8") as f:
                    o = {"op": name, "despues_de": values[0], "tabla": json.load(f)}
            except (OSError, ValueError) as e:
                parser.error("tabla.json inválido: %s" % e)
        elif name == "imagen_despues":
            o = {"op": name, "despues_de": values[0], "ruta": values[1]}
            if len(values) > 2:
                o["ancho_cm"] = float(values[2])
        elif name == "borrar_parrafo":
            o = {"op": name, "texto": values[0]}
        else:
            o = {"op": "estilo", "texto": values[0], "estilo": values[1]}
        lst.append(o)
        ns.ops = lst


def main():
    ap = argparse.ArgumentParser(description="Edita un .docx creando una copia nueva.",
                                 epilog="Ejemplo: edit_docx.py in.docx out-v2.docx --reemplazar 2025 2026")
    ap.add_argument("entrada")
    ap.add_argument("salida")
    ap.add_argument("--reemplazar", nargs=2, metavar=("BUSCAR", "POR"), action=Acc, help="reemplaza texto en todo el documento")
    ap.add_argument("--parrafo-despues", dest="parrafo_despues", nargs=2, metavar=("ANCLA", "TEXTO"), action=Acc)
    ap.add_argument("--estilo-nuevo", help="estilo del párrafo añadido con --parrafo-despues (aplica al último dado)")
    ap.add_argument("--tabla-despues", dest="tabla_despues", nargs=2, metavar=("ANCLA", "TABLA.JSON"), action=Acc)
    ap.add_argument("--imagen-despues", dest="imagen_despues", nargs="+", metavar="ANCLA RUTA [ANCHO_CM]", action=Acc)
    ap.add_argument("--borrar-parrafo", dest="borrar_parrafo", nargs=1, metavar="TEXTO", action=Acc)
    ap.add_argument("--estilo", nargs=2, metavar=("TEXTO", "ESTILO"), action=Acc, help="cambia el estilo del párrafo")
    ap.add_argument("--ops", dest="ops_file", help="archivo JSON con lista de operaciones")
    a = ap.parse_args()
    ops = []
    if a.ops_file:
        try:
            with open(a.ops_file, encoding="utf-8") as f:
                ops = list(json.load(f))
        except (OSError, ValueError) as e:
            print("ERROR: --ops inválido: %s" % e, file=sys.stderr)
            sys.exit(2)
    ops += list(getattr(a, "ops", None) or [])
    if a.estilo_nuevo:
        for o in reversed(ops):
            if o["op"] == "parrafo_despues":
                o["estilo"] = a.estilo_nuevo
                break
    if not os.path.isfile(a.entrada):
        print("ERROR: el archivo no existe: " + a.entrada, file=sys.stderr)
        sys.exit(2)
    if os.path.abspath(a.entrada) == os.path.abspath(a.salida) or os.path.exists(a.salida):
        print("ERROR: la salida debe ser un archivo NUEVO (p. ej. -v2): " + a.salida, file=sys.stderr)
        sys.exit(2)
    if not ops:
        print("ERROR: no se indicó ninguna operación (ver --help)", file=sys.stderr)
        sys.exit(2)
    doc = Document(a.entrada)
    fallos = 0
    for o in ops:
        fn = OPS.get(o.get("op"))
        if fn is None:
            print("ERROR: operación desconocida: %r" % o.get("op"), file=sys.stderr)
            sys.exit(2)
        n, msg = fn(doc, o)
        if n == 0:
            fallos += 1
            objetivo = o.get("buscar") or o.get("despues_de") or o.get("texto")
            print("NO ENCONTRADO: «%s» (operación %s). Revise con inspect_docx.py" % (objetivo, o["op"]), file=sys.stderr)
        else:
            print("OK: " + msg)
    if fallos:
        print("No se guardó la copia porque %d operación(es) fallaron." % fallos, file=sys.stderr)
        sys.exit(1)
    doc.save(a.salida)
    print("Copia guardada: " + a.salida)


if __name__ == "__main__":
    main()
