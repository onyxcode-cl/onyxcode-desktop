#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Edita un .pptx existente creando una COPIA (el original nunca se toca).

Uso:
  edit_pptx.py ENTRADA.pptx SALIDA.pptx replace --find "viejo" --replace "nuevo" [--slide N]
  edit_pptx.py ENTRADA.pptx SALIDA.pptx add-slide --layout "Título y objeto" --title "T" [--bullets "a|b|c"] [--at N] [--notes "..."]
  edit_pptx.py ENTRADA.pptx SALIDA.pptx duplicate --slide N
  edit_pptx.py ENTRADA.pptx SALIDA.pptx delete --slide N
  edit_pptx.py ENTRADA.pptx SALIDA.pptx move --slide N --to M
  edit_pptx.py ENTRADA.pptx SALIDA.pptx add-image --slide N --image foto.png [--left 1 --top 1 --width 4]
  edit_pptx.py ENTRADA.pptx SALIDA.pptx notes --slide N --text "nuevas notas"
  edit_pptx.py ENTRADA.pptx SALIDA.pptx batch --ops ops.json   (lista de {"op": "replace", ...} aplicadas en orden)
Las diapositivas se numeran desde 1.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys

try:
    from pptx import Presentation
    from pptx.util import Emu, Inches
    from pptx.oxml.ns import qn
except ImportError as e:
    print("Falta python-pptx (%s). Ejecuta _shared/doctor.py." % e)
    sys.exit(2)

R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


class EditError(Exception):
    pass


def get_slide(prs, n):
    n = int(n)
    if n < 1 or n > len(prs.slides):
        raise EditError("la diapositiva %d no existe (hay %d)" % (n, len(prs.slides)))
    return prs.slides[n - 1]


def iter_shapes(shapes):
    for sh in shapes:
        yield sh
        if sh.shape_type is not None and "GROUP" in str(sh.shape_type):
            for c in iter_shapes(sh.shapes):
                yield c


def iter_paragraphs(slide, with_notes=False):
    frames = []
    for sh in iter_shapes(slide.shapes):
        if sh.has_text_frame:
            frames.append(sh.text_frame)
        if getattr(sh, "has_table", False) and sh.has_table:
            for row in sh.table.rows:
                for c in row.cells:
                    frames.append(c.text_frame)
    if with_notes and slide.has_notes_slide:
        frames.append(slide.notes_slide.notes_text_frame)
    for tf in frames:
        for p in tf.paragraphs:
            yield p


def replace_in_paragraph(p, find, repl):
    """Sustituye conservando el formato del primer fragmento afectado. Devuelve nº de cambios."""
    count = 0
    while True:
        runs = list(p.runs)
        full = "".join(r.text for r in runs)
        idx = full.find(find)
        if idx < 0:
            return count
        end = idx + len(find)
        pos, first = 0, True
        for r in runs:
            a, b = pos, pos + len(r.text)
            pos = b
            if b <= idx or a >= end:
                continue
            s, e = max(idx, a) - a, min(end, b) - a
            if first:
                r.text = r.text[:s] + repl + r.text[e:]
                first = False
            else:
                r.text = r.text[:s] + r.text[e:]
        count += 1
        if repl and find in repl:   # evita bucle infinito
            return count


def op_replace(prs, find, replace, slide=None, notes=False):
    if not find:
        raise EditError("falta --find")
    targets = [get_slide(prs, slide)] if slide else list(prs.slides)
    n = 0
    for s in targets:
        for p in iter_paragraphs(s, notes):
            n += replace_in_paragraph(p, find, replace)
    if n == 0:
        raise EditError("no se encontró el texto «%s»" % find)
    return "%d reemplazo(s)" % n


def find_layout(prs, layout):
    if layout is None:
        layout = 1
    if str(layout).isdigit():
        i = int(layout)
        if i >= len(prs.slide_layouts):
            raise EditError("layout %d no existe (hay %d)" % (i, len(prs.slide_layouts)))
        return prs.slide_layouts[i]
    for l in prs.slide_layouts:
        if l.name.lower() == str(layout).lower():
            return l
    raise EditError("layout «%s» no existe; disponibles: %s" % (layout, ", ".join(l.name for l in prs.slide_layouts)))


def move_slide(prs, old, new):
    lst = prs.slides._sldIdLst
    ids = list(lst)
    if not (1 <= old <= len(ids)) or not (1 <= new <= len(ids)):
        raise EditError("posición fuera de rango (1-%d)" % len(ids))
    el = ids[old - 1]
    lst.remove(el)
    lst.insert(new - 1, el)


def op_add_slide(prs, layout=None, title="", bullets=None, at=None, notes=None):
    lay = find_layout(prs, layout)
    s = prs.slides.add_slide(lay)
    if s.shapes.title is not None:
        s.shapes.title.text_frame.text = title or ""
    body = None
    for ph in s.placeholders:
        if ph.placeholder_format.idx != 0 and ph.has_text_frame and "TITLE" not in str(ph.placeholder_format.type):
            body = ph
            break
    items = [b for b in (bullets or []) if b]
    if body is not None and items:
        tf = body.text_frame
        tf.text = items[0]
        for t in items[1:]:
            tf.add_paragraph().text = t
    elif items:
        raise EditError("el layout «%s» no tiene cuerpo de texto; elige otro (ver inspect_pptx.py --layouts)" % lay.name)
    if notes:
        s.notes_slide.notes_text_frame.text = notes
    if at:
        move_slide(prs, len(prs.slides), int(at))
    return "diapositiva añadida (layout %s)" % lay.name


def op_duplicate(prs, slide):
    src = get_slide(prs, slide)
    new = prs.slides.add_slide(src.slide_layout)
    for sh in list(new.shapes):
        sh._element.getparent().remove(sh._element)
    skipped = 0
    rmap = {}
    for rel in src.part.rels.values():
        if rel.reltype.endswith("/image"):
            rmap[rel.rId] = new.part.relate_to(rel.target_part, rel.reltype)
    for el in src.shapes._spTree:
        if el.tag in (qn("p:nvGrpSpPr"), qn("p:grpSpPr")):
            continue
        if el.tag == qn("p:graphicFrame") and el.find(".//" + qn("c:chart")) is not None:
            skipped += 1
            continue
        c = copy.deepcopy(el)
        for node in c.iter():
            for att in (qn("r:embed"), qn("r:link")):
                v = node.get(att)
                if v in rmap:
                    node.set(att, rmap[v])
        new.shapes._spTree.append(c)
    bg = src._element.find(qn("p:cSld")).find(qn("p:bg"))
    if bg is not None:
        new._element.find(qn("p:cSld")).insert(0, copy.deepcopy(bg))
    if src.has_notes_slide:
        new.notes_slide.notes_text_frame.text = src.notes_slide.notes_text_frame.text
    move_slide(prs, len(prs.slides), int(slide) + 1)
    return "diapositiva %s duplicada%s" % (slide, " (se omitió %d gráfico: no se duplican, recréalo)" % skipped if skipped else "")


def op_delete(prs, slide):
    get_slide(prs, slide)
    lst = prs.slides._sldIdLst
    el = list(lst)[int(slide) - 1]
    prs.part.drop_rel(el.get(qn("r:id")))
    lst.remove(el)
    # renumera las partes para que una diapositiva nueva posterior no choque de nombre
    prs.part.rename_slide_parts([e.get(qn("r:id")) for e in lst])
    return "diapositiva %s borrada" % slide


def op_move(prs, slide, to):
    get_slide(prs, slide)
    move_slide(prs, int(slide), int(to))
    return "diapositiva %s movida a la posición %s" % (slide, to)


def op_add_image(prs, slide, image, left=None, top=None, width=None, height=None, base=None):
    from PIL import Image
    s = get_slide(prs, slide)
    p = image if os.path.isabs(image) or base is None else os.path.join(base, image)
    if not os.path.isfile(p):
        raise EditError("la imagen no existe: %s" % image)
    with Image.open(p) as im:
        iw, ih = im.size
    sw, sh_ = Emu(prs.slide_width).inches, Emu(prs.slide_height).inches
    w = float(width) if width else min(sw * 0.5, iw / 96.0)
    h = float(height) if height else w * ih / iw
    if not width and height:
        w = h * iw / ih
    l = float(left) if left is not None else (sw - w) / 2
    t = float(top) if top is not None else (sh_ - h) / 2
    s.shapes.add_picture(p, Inches(l), Inches(t), Inches(w), Inches(h))
    return "imagen añadida a la diapositiva %s (%.1f x %.1f pulgadas)" % (slide, w, h)


def op_notes(prs, slide, text):
    get_slide(prs, slide).notes_slide.notes_text_frame.text = text or ""
    return "notas de la diapositiva %s actualizadas" % slide


def apply_op(prs, op, base=None):
    k = op.get("op")
    if k == "replace":
        return op_replace(prs, op.get("find"), op.get("replace", ""), op.get("slide"), op.get("notes", False))
    if k == "add-slide":
        b = op.get("bullets")
        if isinstance(b, str):
            b = b.split("|")
        return op_add_slide(prs, op.get("layout"), op.get("title", ""), b, op.get("at"), op.get("notes"))
    if k == "duplicate":
        return op_duplicate(prs, op["slide"])
    if k == "delete":
        return op_delete(prs, op["slide"])
    if k == "move":
        return op_move(prs, op["slide"], op["to"])
    if k == "add-image":
        return op_add_image(prs, op["slide"], op["image"], op.get("left"), op.get("top"), op.get("width"), op.get("height"), base)
    if k == "notes":
        return op_notes(prs, op["slide"], op.get("text", ""))
    raise EditError("operación desconocida «%s»" % k)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Edita un .pptx creando una copia (ver cabecera del script).")
    ap.add_argument("entrada")
    ap.add_argument("salida")
    ap.add_argument("op", choices=["replace", "add-slide", "duplicate", "delete", "move", "add-image", "notes", "batch"])
    ap.add_argument("--find")
    ap.add_argument("--replace", default="")
    ap.add_argument("--slide", type=int)
    ap.add_argument("--notes-too", action="store_true", help="replace: incluye también las notas del orador")
    ap.add_argument("--layout")
    ap.add_argument("--title", default="")
    ap.add_argument("--bullets", help="viñetas separadas por |")
    ap.add_argument("--at", type=int, help="posición final de la diapositiva nueva")
    ap.add_argument("--to", type=int)
    ap.add_argument("--image")
    ap.add_argument("--left", type=float)
    ap.add_argument("--top", type=float)
    ap.add_argument("--width", type=float)
    ap.add_argument("--height", type=float)
    ap.add_argument("--text")
    ap.add_argument("--ops", help="batch: archivo JSON con la lista de operaciones")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.entrada):
        print("Error: el archivo no existe: %s" % a.entrada)
        return 1
    if os.path.exists(a.salida):
        print("Error: ya existe %s; usa un nombre nuevo (p. ej. -v2). El original no se modifica." % a.salida)
        return 1
    if os.path.abspath(a.entrada) == os.path.abspath(a.salida):
        print("Error: la salida debe ser distinta de la entrada.")
        return 1
    try:
        prs = Presentation(a.entrada)
        msgs = []
        if a.op == "batch":
            if not a.ops or not os.path.isfile(a.ops):
                raise EditError("falta --ops con un archivo JSON existente")
            with open(a.ops, encoding="utf-8") as f:
                ops = json.load(f)
            for i, op in enumerate(ops, 1):
                msgs.append("%d. %s" % (i, apply_op(prs, op, os.path.dirname(os.path.abspath(a.ops)))))
        else:
            op = {"op": a.op, "find": a.find, "replace": a.replace, "slide": a.slide, "notes": a.notes_too,
                  "layout": a.layout, "title": a.title, "bullets": a.bullets, "at": a.at, "to": a.to,
                  "image": a.image, "left": a.left, "top": a.top, "width": a.width, "height": a.height, "text": a.text}
            if a.op in ("duplicate", "delete", "move", "add-image", "notes") and not a.slide:
                raise EditError("falta --slide N")
            if a.op == "move" and not a.to:
                raise EditError("falta --to M")
            if a.op == "add-image" and not a.image:
                raise EditError("falta --image")
            msgs.append(apply_op(prs, op))
        prs.save(a.salida)
    except (EditError, KeyError) as e:
        print("Error: %s" % e)
        return 1
    except Exception as e:
        print("Error al editar: %s" % e)
        return 1
    print("Copia creada: %s (%d diapositivas)" % (a.salida, len(prs.slides)))
    for m in msgs:
        print("  - " + m)
    return 0


if __name__ == "__main__":
    sys.exit(main())
