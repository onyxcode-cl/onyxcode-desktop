#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verifica un .pptx: estructura, desbordes de texto (estimados), formas fuera del lienzo,
diapositivas sin título, imágenes dudosas; y lo renderiza con una hoja de miniaturas.

Uso: check_pptx.py archivo.pptx [--outdir DIR] [--no-render] [--json]
Salida: código 0 si no hay problemas, 1 si hay problemas, 2 si falta una librería.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pptx_common import text_height_in  # noqa: E402

try:
    from pptx import Presentation
    from pptx.util import Emu
except ImportError as e:
    print("Falta python-pptx (%s). Ejecuta _shared/doctor.py." % e)
    sys.exit(2)


def default_pt(sh):
    if sh.is_placeholder:
        t = str(sh.placeholder_format.type)
        if "TITLE" in t:
            return 32.0
    return 18.0


def frame_pt(sh):
    sizes = []
    for p in sh.text_frame.paragraphs:
        for r in p.runs:
            if r.font.size:
                sizes.append(r.font.size.pt)
    return max(sizes) if sizes else default_pt(sh)


def check_overflow(sh, slide_n, problems):
    tf = sh.text_frame
    text = tf.text
    if not text.strip() or not sh.width or not sh.height:
        return
    w = Emu(sh.width).inches - (Emu(tf.margin_left).inches + Emu(tf.margin_right).inches)
    h = Emu(sh.height).inches - (Emu(tf.margin_top).inches + Emu(tf.margin_bottom).inches)
    total = 0.0
    for p in tf.paragraphs:
        pt = max([r.font.size.pt for r in p.runs if r.font.size] or [frame_pt(sh)])
        sa = p.space_after.pt if p.space_after is not None else 0
        total += text_height_in("".join(r.text for r in p.runs) or " ", pt, w, sa)
    if total > h * 1.08 + 0.05:
        problems.append("Diapositiva %d: el texto de «%s» probablemente desborda su caja (necesita ~%.1f\" y hay %.1f\"): "
                        "reduce la letra, acorta el texto o divide la diapositiva." % (slide_n, sh.name, total, h))


def check(path):
    problems, warns = [], []
    prs = Presentation(path)
    sw, sh_ = prs.slide_width, prs.slide_height
    n = len(prs.slides)
    if n == 0:
        problems.append("La presentación no tiene diapositivas.")
    for i, s in enumerate(prs.slides, 1):
        title = s.shapes.title.text_frame.text.strip() if s.shapes.title is not None else ""
        if not title:
            warns.append("Diapositiva %d: sin título (accesibilidad y navegación)." % i)
        for sh in s.shapes:
            if sh.left is not None and sh.width is not None:
                tol = Emu(91440 // 4)
                if sh.left < -tol or sh.top < -tol or sh.left + sh.width > sw + tol or sh.top + sh.height > sh_ + tol:
                    problems.append("Diapositiva %d: la forma «%s» se sale del lienzo." % (i, sh.name))
            if sh.has_text_frame:
                check_overflow(sh, i, problems)
            if sh.shape_type is not None and "PICTURE" in str(sh.shape_type):
                wi, hi = Emu(sh.width).inches, Emu(sh.height).inches
                if wi < 0.4 or hi < 0.4:
                    warns.append("Diapositiva %d: la imagen «%s» es diminuta (%.1fx%.1f\")." % (i, sh.name, wi, hi))
                if wi > Emu(sw).inches * 1.05 or hi > Emu(sh_).inches * 1.05:
                    problems.append("Diapositiva %d: la imagen «%s» es más grande que el lienzo." % (i, sh.name))
                try:
                    px = sh.image.size
                    if px[0] / max(wi, 0.1) < 60:
                        warns.append("Diapositiva %d: la imagen «%s» tiene baja resolución (%d px a %.1f\")." % (i, sh.name, px[0], wi))
                except Exception:
                    pass
    return n, problems, warns


def contact_sheet(pngs, out, cols=3, thumb_w=520):
    from PIL import Image, ImageDraw
    ims = [Image.open(p).convert("RGB") for p in pngs]
    if not ims:
        return None
    ratio = ims[0].height / ims[0].width
    th = int(thumb_w * ratio)
    rows = (len(ims) + cols - 1) // cols
    pad, lab = 16, 22
    sheet = Image.new("RGB", (cols * (thumb_w + pad) + pad, rows * (th + lab + pad) + pad), (235, 235, 235))
    d = ImageDraw.Draw(sheet)
    for k, im in enumerate(ims):
        x = pad + (k % cols) * (thumb_w + pad)
        y = pad + (k // cols) * (th + lab + pad)
        sheet.paste(im.resize((thumb_w, th)), (x, y + lab))
        d.rectangle([x - 1, y + lab - 1, x + thumb_w, y + lab + th], outline=(150, 150, 150))
        d.text((x, y + 4), "Diapositiva %d" % (k + 1), fill=(40, 40, 40))
    sheet.save(out)
    return out


def render(path, outdir):
    r = os.path.join(HERE, "..", "..", "_shared", "render.py")
    r = os.path.normpath(r)
    if not os.path.isfile(r):
        return None, ["No se encontró _shared/render.py: se omite el render."]
    py = os.environ.get("LAZUNOX_PYTHON") or sys.executable
    try:
        cp = subprocess.run([py, r, path, "--outdir", outdir], capture_output=True, text=True, timeout=300)
        data = json.loads(cp.stdout.strip().splitlines()[-1])
    except Exception as e:
        return None, ["El render falló (%s)." % e]
    return data, data.get("avisos", [])


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verifica un .pptx y genera miniaturas de todas las diapositivas.")
    ap.add_argument("archivo")
    ap.add_argument("--outdir", help="carpeta para PNG/hoja de miniaturas (por defecto ./.lazunox/trabajo/check_pptx)")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.archivo):
        print("Error: el archivo no existe: %s" % a.archivo)
        return 1
    try:
        n, problems, warns = check(a.archivo)
    except Exception as e:
        print("Error: no se pudo abrir el .pptx (%s)" % e)
        return 1
    res = {"archivo": a.archivo, "diapositivas": n, "problemas": problems, "avisos": warns,
           "render": None, "hoja_miniaturas": None}
    if not a.no_render:
        outdir = a.outdir or os.path.join(".", ".lazunox", "trabajo", "check_pptx")
        os.makedirs(outdir, exist_ok=True)
        data, rw = render(a.archivo, outdir)
        warns.extend(rw)
        if data and data.get("ok") and data.get("pngs"):
            res["render"] = data["pngs"]
            res["hoja_miniaturas"] = contact_sheet(data["pngs"], os.path.join(outdir, "miniaturas.png"))
            if data.get("paginas") and data["paginas"] != n:
                problems.append("El render tiene %s páginas pero hay %d diapositivas." % (data["paginas"], n))
        elif data is not None:
            warns.append("No se pudo renderizar: solo hay verificación estructural.")
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=1))
    else:
        print("%s: %d diapositivas" % (a.archivo, n))
        for p in problems:
            print("PROBLEMA: " + p)
        for w in warns:
            print("Aviso: " + w)
        if res["hoja_miniaturas"]:
            print("Hoja de miniaturas (revísala con una herramienta de imagen): " + res["hoja_miniaturas"])
        print("Resultado: " + ("CON PROBLEMAS" if problems else "OK"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
