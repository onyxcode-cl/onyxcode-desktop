#!/usr/bin/env python3
"""Verifica un .docx: estructura y, si hay LibreOffice, render a PNG con detección de páginas en blanco.

Uso:  python check_docx.py archivo.docx [--render] [--outdir DIR] [--json]
  --render  fuerza el render (por defecto se intenta si existe _shared/render.py)
  --no-render  solo estructura
Códigos de salida: 0 sin problemas (puede haber avisos), 1 hay problemas, 2 uso/no abre.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from docx import Document  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.table import Table  # noqa: E402

SHARED = os.path.normpath(os.path.join(HERE, "..", "..", "_shared"))


def structural(path):
    probs, avisos, info = [], [], {}
    doc = Document(path)
    body = doc.element.body
    paras = [e for e in body.iterchildren() if e.tag in (qn("w:p"), qn("w:tbl"))]
    style_ids = {s.style_id for s in doc.styles}
    style_by_id = {s.style_id: s.name for s in doc.styles}

    headings = []
    empty_run = 0
    empties = 0
    missing = set()
    for e in paras:
        if e.tag == qn("w:tbl"):
            empty_run = 0
            continue
        sid = e.xpath("string(./w:pPr/w:pStyle/@w:val)")
        if sid and sid not in style_ids:
            missing.add(sid)
        text = "".join(t.text or "" for t in e.xpath(".//w:t"))
        special = e.xpath(".//w:drawing | .//w:pict | .//w:br[@w:type='page'] | .//w:sectPr | .//w:fldChar | .//w:fldSimple")
        if not text.strip() and not special:
            empty_run += 1
            if empty_run == 2:
                empties += 1
        else:
            empty_run = 0
        name = style_by_id.get(sid, "")
        if name.startswith("Heading ") or name == "Title":
            headings.append((name, text))
    if empties:
        avisos.append("%d lugar(es) con párrafos vacíos consecutivos (usar espaciado de estilo, no Enter repetidos)" % empties)
    if missing:
        probs.append("estilos usados pero no definidos: " + ", ".join(sorted(missing)))
    # saltos de nivel de encabezado
    prev = 0
    for name, text in headings:
        if name.startswith("Heading "):
            lvl = int(name.split()[1])
            if prev and lvl > prev + 1:
                avisos.append("salto de nivel de encabezado (H%d → H%d) en «%s»" % (prev, lvl, text[:40]))
            prev = lvl
    if not any(n.startswith("Heading") for n, _ in headings) and len(paras) > 25:
        avisos.append("documento largo sin encabezados reales (Heading 1-3): no habrá navegación ni índice")

    tablas = [Table(t, doc) for t in body.iterchildren(qn("w:tbl"))]
    sin_enc = 0
    for i, t in enumerate(tablas):
        if len(t.rows) < 2:
            continue
        first = t.rows[0]._tr
        marked = bool(first.xpath("./w:trPr/w:tblHeader"))
        shaded = bool(first.xpath(".//w:tcPr/w:shd[@w:fill and @w:fill!='auto' and @w:fill!='FFFFFF']"))
        bold = bool(first.xpath(".//w:rPr/w:b"))
        if not (marked or shaded or bold):
            sin_enc += 1
            avisos.append("tabla %d sin fila de encabezado distinguible (ni repetida, ni sombreada, ni en negrita)" % (i + 1))
        if any(len(r.cells) != len(t.columns) for r in t.rows):
            avisos.append("tabla %d con celdas combinadas o filas irregulares" % (i + 1))

    imgs = body.xpath(".//w:drawing")
    sin_alt = sum(1 for d in imgs if not d.xpath(".//wp:docPr/@descr"))
    info = {"parrafos": len(paras) - len(tablas), "tablas": len(tablas), "imagenes": len(imgs),
            "encabezados": [{"estilo": n, "texto": t} for n, t in headings],
            "secciones": len(doc.sections), "cambios_registrados": len(body.xpath(".//w:ins | .//w:del"))}
    if info["cambios_registrados"]:
        avisos.append("el documento contiene %d cambios registrados (control de cambios) sin resolver" % info["cambios_registrados"])
    if not info["parrafos"] and not tablas:
        probs.append("el documento está vacío")
    return probs, avisos, info


def render(path, outdir):
    rpy = os.path.join(SHARED, "render.py")
    res = {"intentado": False}
    if not os.path.isfile(rpy):
        res["aviso"] = "no existe _shared/render.py: se omite el render"
        return res
    res["intentado"] = True
    os.makedirs(outdir, exist_ok=True)
    py = os.environ.get("LAZUNOX_PYTHON") or sys.executable
    try:
        cp = subprocess.run([py, rpy, path, "--outdir", outdir], capture_output=True, text=True, timeout=240)
        data = json.loads(cp.stdout.strip().splitlines()[-1])
    except Exception as e:
        res["aviso"] = "el render falló o no hay LibreOffice (%s); solo se verificó la estructura" % e
        return res
    res.update(data)
    pngs = data.get("pngs") or []
    blank = []
    try:
        from PIL import Image
        for i, p in enumerate(pngs):
            im = Image.open(p).convert("L")
            hist = im.histogram()
            dark = sum(hist[:235])
            if dark / float(im.size[0] * im.size[1]) < 0.0004:
                blank.append(i + 1)
    except Exception as e:
        res.setdefault("avisos", []).append("no se pudo analizar páginas en blanco: %s" % e)
    res["paginas_en_blanco"] = blank
    vi = os.path.join(SHARED, "verify_images.py")
    if pngs and os.path.isfile(vi):
        try:
            cp = subprocess.run([py, vi] + pngs, capture_output=True, text=True, timeout=120)
            if cp.returncode == 0 and cp.stdout.strip():
                res["verify_images"] = cp.stdout.strip()[:2000]
        except Exception:
            pass
    return res


def main():
    ap = argparse.ArgumentParser(description="Verificación estructural y visual de un .docx.")
    ap.add_argument("archivo")
    ap.add_argument("--outdir", default=os.path.join(".lazunox", "trabajo", "render-docx"),
                    help="carpeta para PDF/PNG del render (por defecto ./.lazunox/trabajo/render-docx)")
    ap.add_argument("--no-render", action="store_true", help="solo verificación estructural")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not os.path.isfile(a.archivo):
        print("ERROR: el archivo no existe: " + a.archivo, file=sys.stderr)
        sys.exit(2)
    try:
        probs, avisos, info = structural(a.archivo)
    except Exception as e:
        print("ERROR: no se pudo abrir el .docx (%s)" % e, file=sys.stderr)
        sys.exit(2)
    rend = {"intentado": False} if a.no_render else render(a.archivo, a.outdir)
    if rend.get("paginas_en_blanco"):
        avisos.append("páginas en blanco o casi vacías: %s" % rend["paginas_en_blanco"])
    if rend.get("intentado") and rend.get("ok") is False:
        avisos.append("el render no terminó bien: %s" % "; ".join(rend.get("avisos", [])))
    if a.json:
        print(json.dumps({"problemas": probs, "avisos": avisos, "info": info, "render": rend}, ensure_ascii=False, indent=2))
    else:
        print("Archivo: %s" % a.archivo)
        print("Estructura: %d párrafos, %d tablas, %d imágenes, %d encabezados, %d sección(es)" % (
            info["parrafos"], info["tablas"], info["imagenes"], len(info["encabezados"]), info["secciones"]))
        if rend.get("pdf"):
            print("Render: %s páginas -> %s" % (rend.get("paginas"), rend["pdf"]))
            for p in rend.get("pngs", []):
                print("  imagen de página: " + p)
            print("  (abra las imágenes y mírelas antes de entregar)")
            if rend.get("verify_images"):
                print(rend["verify_images"])
        elif rend.get("aviso"):
            print("Render omitido: " + rend["aviso"])
        for pr in probs:
            print("PROBLEMA: " + pr)
        for av in avisos:
            print("AVISO: " + av)
        print("RESULTADO: " + ("CON PROBLEMAS" if probs else ("OK con %d aviso(s)" % len(avisos) if avisos else "OK")))
    sys.exit(1 if probs else 0)


if __name__ == "__main__":
    main()
