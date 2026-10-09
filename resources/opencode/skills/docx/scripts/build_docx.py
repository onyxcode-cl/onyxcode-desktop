#!/usr/bin/env python3
"""Crea un documento Word profesional a partir de un archivo de contenido JSON.

Uso:  python build_docx.py contenido.json salida.docx
Esquema del JSON: ver SKILL.md. Códigos de salida: 0 ok, 1 error de contenido, 2 uso.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _docxlib as L  # noqa: E402
from docx import Document  # noqa: E402
from docx.enum.text import WD_BREAK, WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.shared import Pt  # noqa: E402


def fail(msg, code=1):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(code)


def add_list(doc, items, numbered, level=1, numid=None):
    base = "List Number" if numbered else "List Bullet"
    for it in items:
        if isinstance(it, (list, tuple)):
            add_list(doc, it, numbered, level + 1)
            continue
        text, sub = (it.get("text", ""), it.get("items")) if isinstance(it, dict) else (it, None)
        style = base if level == 1 else "%s %d" % (base, min(level, 3))
        try:
            p = doc.add_paragraph(style=style)
        except KeyError:
            p = doc.add_paragraph(style=base)
        L.add_rich_text(p, text)
        if numbered and level == 1:
            if numid is None:
                numid = L.restart_numbering(doc, p, base)
            else:
                L.set_num(p, numid)
        if sub:
            add_list(doc, sub, numbered, level + 1)


def collect_headings(blocks):
    return [(min(max(int(b.get("level", 1)), 1), 3), b.get("text", ""))
            for b in blocks if b.get("type") == "heading"]


def header_footer(doc, spec, theme):
    sec = doc.sections[0]
    if spec.get("header"):
        p = sec.header.paragraphs[0]
        p.text = ""
        r = p.add_run(spec["header"])
        r.font.size = Pt(9)
        r.font.color.rgb = L.hex_color("7F7F7F")
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    foot = spec.get("footer")
    numbers = spec.get("page_numbers", True)
    if foot or numbers:
        p = sec.footer.paragraphs[0]
        p.text = ""
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if foot:
            r = p.add_run(foot + ("   |   " if numbers else ""))
            r.font.size = Pt(9)
            r.font.color.rgb = L.hex_color("7F7F7F")
        if numbers:
            before = len(p.runs)
            p.add_run("Página ")
            L.add_field(p, "PAGE", "1")
            p.add_run(" de ")
            L.add_field(p, "NUMPAGES", "1")
            for r in p.runs[before:]:
                r.font.size = Pt(9)
                r.font.color.rgb = L.hex_color("7F7F7F")


def build(spec, out_path, base_dir):
    doc = Document()
    theme = L.apply_theme(doc, spec.get("theme"))
    page = spec.get("page", {})
    L.set_page(doc, page.get("size", "letter"), page.get("margin_cm", 2.5), page.get("landscape", False))
    cp = doc.core_properties
    cp.title = spec.get("title", "") or ""
    cp.author = spec.get("author", "") or ""
    cp.language = "es-CL"
    blocks = spec.get("blocks", [])
    usable = (doc.sections[0].page_width - doc.sections[0].left_margin - doc.sections[0].right_margin) / 360000.0

    if spec.get("title"):
        doc.add_paragraph(spec["title"], style="Title")
    if spec.get("subtitle"):
        doc.add_paragraph(spec["subtitle"], style="Subtitle")
    meta = []
    if spec.get("author"):
        meta.append(spec["author"])
    d = spec.get("date")
    if d:
        meta.append(L.fecha_es() if d == "hoy" else d)
    if meta:
        p = doc.add_paragraph()
        r = p.add_run("  ·  ".join(meta))
        r.font.size = Pt(10)
        r.font.color.rgb = L.hex_color("7F7F7F")
    if spec.get("toc"):
        L.add_toc(doc, 3, spec.get("toc_title", "Contenido"), collect_headings(blocks), theme)
        L.request_field_update(doc)
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    n_img = 0
    for i, b in enumerate(blocks):
        t = b.get("type")
        where = "bloque %d (%s)" % (i + 1, t)
        if t == "heading":
            lvl = min(max(int(b.get("level", 1)), 1), 3)
            doc.add_paragraph(b.get("text", ""), style="Heading %d" % lvl)
        elif t == "paragraph":
            p = doc.add_paragraph()
            L.add_rich_text(p, b.get("text", ""))
            if b.get("align"):
                p.alignment = L.ALIGN[b["align"]]
        elif t in ("bullets", "numbered"):
            add_list(doc, b.get("items", []), t == "numbered")
        elif t == "table":
            if not b.get("rows") and not b.get("columns"):
                fail(where + ": la tabla no tiene 'columns' ni 'rows'")
            if b.get("caption_above") and b.get("caption"):
                cp_ = doc.add_paragraph(style="Caption")
                cp_.paragraph_format.keep_with_next = True
                L.add_rich_text(cp_, b["caption"])
            L.build_table(doc, b, theme, usable)
            if b.get("caption") and not b.get("caption_above"):
                cp_ = doc.add_paragraph(style="Caption")
                L.add_rich_text(cp_, b["caption"])
            else:
                sp = doc.add_paragraph()
                sp.paragraph_format.space_after = Pt(4)
        elif t == "image":
            path = b.get("path", "")
            full = path if os.path.isabs(path) else os.path.join(base_dir, path)
            if not os.path.isfile(full):
                fail(where + ": la imagen no existe: " + full)
            L.add_image(doc, full, b.get("width_cm"), b.get("caption"), usable)
            n_img += 1
        elif t == "page_break":
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        else:
            fail(where + ": tipo desconocido '%s' (use heading, paragraph, bullets, numbered, table, image, page_break)" % t)
    header_footer(doc, spec, theme)
    doc.save(out_path)
    return {"bloques": len(blocks), "imagenes": n_img}


def main():
    ap = argparse.ArgumentParser(description="Crea un .docx profesional desde un JSON de contenido.")
    ap.add_argument("contenido", help="archivo JSON con el contenido (esquema en SKILL.md)")
    ap.add_argument("salida", help="ruta del .docx NUEVO a crear")
    ap.add_argument("--force", action="store_true", help="permitir sobrescribir la salida si existe")
    a = ap.parse_args()
    if not os.path.isfile(a.contenido):
        fail("el archivo de contenido no existe: " + a.contenido, 2)
    if os.path.exists(a.salida) and not a.force:
        fail("la salida ya existe (use otro nombre, p. ej. -v2): " + a.salida, 2)
    try:
        with open(a.contenido, encoding="utf-8") as f:
            spec = json.load(f)
    except ValueError as e:
        fail("JSON inválido: %s" % e)
    info = build(spec, a.salida, os.path.dirname(os.path.abspath(a.contenido)))
    print("Documento creado: %s (%d bloques, %d imágenes)" % (a.salida, info["bloques"], info["imagenes"]))


if __name__ == "__main__":
    main()
