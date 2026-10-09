#!/usr/bin/env python3
"""Vuelca la estructura de un .docx (párrafos con estilo, tablas, imágenes, comentarios, secciones).

Uso:  python inspect_docx.py archivo.docx [--json] [--max-chars 80]
Códigos de salida: 0 ok, 1 no se pudo abrir, 2 uso.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docx import Document  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.table import Table  # noqa: E402
from docx.text.paragraph import Paragraph  # noqa: E402

A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def run_format(p):
    flags = set()
    for r in p.runs:
        if not r.text.strip():
            continue
        if r.bold:
            flags.add("negrita")
        if r.italic:
            flags.add("cursiva")
        if r.underline:
            flags.add("subrayado")
    return sorted(flags)


def images_in(p, doc):
    out = []
    for blip in p._p.iter("{%s}blip" % A_NS):
        rid = blip.get("{%s}embed" % R_NS)
        name = None
        try:
            name = os.path.basename(str(doc.part.related_parts[rid].partname))
        except Exception:
            pass
        out.append(name or rid)
    return out


def describe_table(t):
    rows = []
    for r in t.rows:
        rows.append([c.text.replace("\n", " / ") for c in r.cells])
    hdr = False
    if t.rows:
        hdr = t.rows[0]._tr.xpath("./w:trPr/w:tblHeader") != []
    return {"filas": len(t.rows), "columnas": len(t.columns), "encabezado_repetido": hdr,
            "estilo": t.style.name if t.style is not None else None, "celdas": rows}


def inspect(path):
    doc = Document(path)
    data = {"archivo": path, "elementos": [], "secciones": [], "comentarios": [], "resumen": {}}
    pi = ti = 0
    n_img = 0
    for el in doc.element.body.iterchildren():
        if el.tag == qn("w:p"):
            p = Paragraph(el, doc)
            imgs = images_in(p, doc)
            n_img += len(imgs)
            item = {"tipo": "parrafo", "indice": pi, "estilo": p.style.name if p.style is not None else None,
                    "texto": p.text}
            fm = run_format(p)
            if fm:
                item["formato"] = fm
            if p.alignment is not None:
                item["alineacion"] = str(p.alignment).split(".")[-1].split(" ")[0].lower()
            if imgs:
                item["imagenes"] = imgs
            if el.xpath(".//w:br[@w:type='page']"):
                item["salto_de_pagina"] = True
            if el.xpath(".//w:numPr") or (p.style is not None and "List" in p.style.name):
                item["lista"] = True
            data["elementos"].append(item)
            pi += 1
        elif el.tag == qn("w:tbl"):
            t = Table(el, doc)
            item = {"tipo": "tabla", "indice": ti}
            item.update(describe_table(t))
            data["elementos"].append(item)
            ti += 1
    for i, s in enumerate(doc.sections):
        data["secciones"].append({
            "indice": i,
            "ancho_cm": round(s.page_width.cm, 2) if s.page_width else None,
            "alto_cm": round(s.page_height.cm, 2) if s.page_height else None,
            "orientacion": "horizontal" if s.page_width and s.page_height and s.page_width > s.page_height else "vertical",
            "margenes_cm": [round(x.cm, 2) if x is not None else None for x in
                            (s.top_margin, s.bottom_margin, s.left_margin, s.right_margin)],
            "encabezado": " | ".join(p.text for p in s.header.paragraphs if p.text),
            "pie": " | ".join(p.text for p in s.footer.paragraphs if p.text),
        })
    try:
        for c in doc.comments:
            data["comentarios"].append({"id": c.comment_id, "autor": c.author, "texto": c.text})
    except Exception:
        pass
    body = doc.element.body
    data["resumen"] = {
        "parrafos": pi, "tablas": ti, "imagenes": n_img, "secciones": len(doc.sections),
        "comentarios": len(data["comentarios"]),
        "cambios_registrados": len(body.xpath(".//w:ins | .//w:del")),
        "campos": len(body.xpath(".//w:fldSimple | .//w:instrText")),
        "estilos_usados": sorted({e["estilo"] for e in data["elementos"] if e.get("estilo")}),
    }
    return data


def render_text(d, maxc):
    out = ["Archivo: %s" % d["archivo"]]
    r = d["resumen"]
    out.append("Resumen: %d párrafos, %d tablas, %d imágenes, %d secciones, %d comentarios, %d cambios registrados, %d campos"
               % (r["parrafos"], r["tablas"], r["imagenes"], r["secciones"], r["comentarios"],
                  r["cambios_registrados"], r["campos"]))
    out.append("Estilos usados: " + ", ".join(r["estilos_usados"]))
    for s in d["secciones"]:
        out.append("Sección %d: %s x %s cm (%s), márgenes sup/inf/izq/der %s; encabezado=%r pie=%r"
                   % (s["indice"], s["ancho_cm"], s["alto_cm"], s["orientacion"], s["margenes_cm"], s["encabezado"], s["pie"]))
    out.append("--- Contenido ---")
    for e in d["elementos"]:
        if e["tipo"] == "parrafo":
            txt = e["texto"] if len(e["texto"]) <= maxc else e["texto"][:maxc] + "…"
            extra = []
            if e.get("formato"):
                extra.append("+".join(e["formato"]))
            if e.get("imagenes"):
                extra.append("imagen:" + ",".join(e["imagenes"]))
            if e.get("salto_de_pagina"):
                extra.append("salto de página")
            out.append("P%-3d [%s] %s%s" % (e["indice"], e["estilo"], txt or "(vacío)",
                                              ("  {" + "; ".join(extra) + "}") if extra else ""))
        else:
            out.append("T%-3d TABLA %dx%d estilo=%s encabezado_repetido=%s" % (
                e["indice"], e["filas"], e["columnas"], e["estilo"], e["encabezado_repetido"]))
            for row in e["celdas"][:6]:
                out.append("      | " + " | ".join(c[:maxc // 2] for c in row))
            if len(e["celdas"]) > 6:
                out.append("      … (%d filas más)" % (len(e["celdas"]) - 6))
    if d["comentarios"]:
        out.append("--- Comentarios ---")
        for c in d["comentarios"]:
            out.append("#%s %s: %s" % (c["id"], c["autor"], c["texto"]))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="Inspecciona la estructura de un .docx.")
    ap.add_argument("archivo")
    ap.add_argument("--json", action="store_true", help="salida JSON completa")
    ap.add_argument("--max-chars", type=int, default=100, help="largo máximo de texto por párrafo (modo texto)")
    a = ap.parse_args()
    if not os.path.isfile(a.archivo):
        print("ERROR: el archivo no existe: " + a.archivo, file=sys.stderr)
        sys.exit(2)
    try:
        d = inspect(a.archivo)
    except Exception as e:
        print("ERROR: no se pudo abrir como .docx (%s)" % e, file=sys.stderr)
        sys.exit(1)
    print(json.dumps(d, ensure_ascii=False, indent=2) if a.json else render_text(d, a.max_chars))


if __name__ == "__main__":
    main()
