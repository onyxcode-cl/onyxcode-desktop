#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vuelca el contenido de un .pptx: diapositivas, layouts, formas, texto, notas e imágenes.

Uso: inspect_pptx.py archivo.pptx [--json] [--layouts]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

try:
    from pptx import Presentation
    from pptx.util import Emu
except ImportError as e:
    print("Falta python-pptx (%s). Ejecuta _shared/doctor.py." % e)
    sys.exit(2)


def inch(v):
    return round(Emu(v or 0).inches, 2)


def shape_info(sh):
    d = {"id": sh.shape_id, "nombre": sh.name, "tipo": str(sh.shape_type).split(".")[-1].split(" ")[0] if sh.shape_type else "PLACEHOLDER?",
         "pos": [inch(sh.left), inch(sh.top), inch(sh.width), inch(sh.height)]}
    if sh.is_placeholder:
        d["placeholder"] = str(sh.placeholder_format.type).split(".")[-1].split(" ")[0]
    if sh.has_text_frame and sh.text_frame.text.strip():
        d["texto"] = sh.text_frame.text
    if getattr(sh, "has_table", False) and sh.has_table:
        d["tabla"] = [[c.text for c in r.cells] for r in sh.table.rows]
    if getattr(sh, "has_chart", False) and sh.has_chart:
        ch = sh.chart
        d["grafico"] = {"tipo": str(ch.chart_type).split(".")[-1].split(" ")[0],
                        "categorias": [str(c) for c in ch.plots[0].categories],
                        "series": [{"nombre": s.name, "valores": list(s.values)} for s in ch.plots[0].series]}
    if sh.shape_type is not None and "PICTURE" in str(sh.shape_type):
        try:
            img = sh.image
            d["imagen"] = {"formato": img.ext, "px": list(img.size), "bytes": len(img.blob)}
        except Exception:
            pass
    if sh.shape_type is not None and "GROUP" in str(sh.shape_type):
        d["hijos"] = [shape_info(c) for c in sh.shapes]
    return d


def inspect(path):
    prs = Presentation(path)
    out = {"archivo": path, "tam_pulgadas": [inch(prs.slide_width), inch(prs.slide_height)],
           "layouts": [{"indice": i, "nombre": l.name} for i, l in enumerate(prs.slide_layouts)],
           "diapositivas": []}
    for i, s in enumerate(prs.slides, 1):
        notes = s.notes_slide.notes_text_frame.text if s.has_notes_slide else ""
        title = s.shapes.title.text_frame.text if s.shapes.title is not None else ""
        out["diapositivas"].append({"n": i, "layout": s.slide_layout.name, "titulo": title, "notas": notes,
                                    "formas": [shape_info(sh) for sh in s.shapes]})
    return out


def show(sh, ind="    "):
    extra = ""
    if "placeholder" in sh:
        extra = " [%s]" % sh["placeholder"]
    print("%s- #%d %s (%s)%s en %s" % (ind, sh["id"], sh["nombre"], sh["tipo"], extra, sh["pos"]))
    if "texto" in sh:
        for ln in sh["texto"].split("\n"):
            print("%s    | %s" % (ind, ln))
    if "tabla" in sh:
        for r in sh["tabla"]:
            print("%s    | %s" % (ind, " | ".join(r)))
    if "grafico" in sh:
        g = sh["grafico"]
        print("%s    gráfico %s, categorías %s" % (ind, g["tipo"], g["categorias"]))
        for se in g["series"]:
            print("%s    serie %s: %s" % (ind, se["nombre"], se["valores"]))
    if "imagen" in sh:
        print("%s    imagen %s %spx %d bytes" % (ind, sh["imagen"]["formato"], "x".join(map(str, sh["imagen"]["px"])), sh["imagen"]["bytes"]))
    for c in sh.get("hijos", []):
        show(c, ind + "    ")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Inspecciona un .pptx (diapositivas, formas, texto, notas, imágenes).")
    ap.add_argument("archivo")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    ap.add_argument("--layouts", action="store_true", help="lista también los layouts disponibles")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.archivo):
        print("Error: el archivo no existe: %s" % a.archivo)
        return 1
    try:
        data = inspect(a.archivo)
    except Exception as e:
        print("Error: no se pudo abrir como .pptx (%s)" % e)
        return 1
    if a.json:
        print(json.dumps(data, ensure_ascii=False, indent=1, default=str))
        return 0
    print("%s: %d diapositivas, lienzo %s x %s pulgadas" % (data["archivo"], len(data["diapositivas"]), *data["tam_pulgadas"]))
    if a.layouts:
        print("Layouts: " + ", ".join("%d=%s" % (l["indice"], l["nombre"]) for l in data["layouts"]))
    for s in data["diapositivas"]:
        print("\nDiapositiva %d  (layout: %s)  título: %s" % (s["n"], s["layout"], s["titulo"] or "(sin título)"))
        for sh in s["formas"]:
            show(sh)
        if s["notas"]:
            print("    Notas: " + s["notas"].replace("\n", " / "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
