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
import zipfile
import posixpath
from urllib.parse import unquote
from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pptx_common import text_height_in  # noqa: E402

try:
    from pptx import Presentation
    from pptx.util import Emu
    from pptx.oxml.ns import qn
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


def check_frame(tf, width, height, slide_n, name, problems, default=18):
    if not tf.text.strip():
        return
    w = Emu(width).inches - (Emu(tf.margin_left).inches + Emu(tf.margin_right).inches)
    h = Emu(height).inches - (Emu(tf.margin_top).inches + Emu(tf.margin_bottom).inches)
    total = 0.0
    for p in tf.paragraphs:
        pt = max([r.font.size.pt for r in p.runs if r.font.size] or [p.font.size.pt if p.font.size else default])
        sa = p.space_after.pt if p.space_after is not None else 0
        sb = p.space_before.pt if p.space_before is not None else 0
        # Sangría real de viñetas; p.text incluye saltos y campos (a:fld).
        props = p._p.find(qn('a:pPr'))
        indent = int(props.get('marL', '0'))/914400 if props is not None else 0
        total += text_height_in(p.text or " ", pt, w-indent, sa+sb)
    if total > h * 1.08 + 0.05:
        problems.append("Diapositiva %d: el texto de «%s» probablemente desborda su caja (necesita ~%.1f\" y hay %.1f\")." % (slide_n, name, total, h))


def package_problems(path):
    """python-pptx tolera algunos duplicados: revisarlos ANTES de que los oculte."""
    problems = []
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            problems.append("El ZIP contiene partes duplicadas.")
        known = set(names)
        for name in names:
            if not name.endswith('.rels'):
                continue
            root = ET.fromstring(z.read(name))
            ids = [r.get('Id') for r in root]
            if len(ids) != len(set(ids)):
                problems.append("Relaciones duplicadas en %s." % name)
            base = posixpath.dirname(posixpath.dirname(name))
            for rel in root:
                if rel.get('TargetMode') == 'External':
                    continue
                target = unquote(rel.get('Target', ''))
                resolved = posixpath.normpath(posixpath.join(base, target)).lstrip('/')
                if resolved not in known:
                    problems.append("Relación sin destino en %s: %s." % (name, target))
    return problems


def contrast(a, b):
    def lum(h):
        vals = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
        vals = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in vals]
        return sum(a*b for a, b in zip(vals, (.2126, .7152, .0722)))
    x, y = sorted((lum(a), lum(b)))
    return (y+.05)/(x+.05)


def theme_colors(slide):
    part = next(r.target_part for r in slide.slide_layout.slide_master.part.rels.values() if r.reltype.endswith('/theme'))
    root = ET.fromstring(part.blob)
    colors = {}
    for node in root.find('.//' + qn('a:clrScheme')):
        c = node[0]
        colors[node.tag.rsplit('}', 1)[-1]] = c.get('val') if c.tag == qn('a:srgbClr') else c.get('lastClr')
    cmap = slide.slide_layout.slide_master._element.find(qn('p:clrMap'))
    if cmap is not None:
        for key, value in cmap.attrib.items():
            colors[key] = colors.get(value)
    return colors


def color_value(node, colors):
    if node is None:
        return None
    for c in node:
        if c.tag == qn('a:srgbClr'):
            val = c.get('val')
        elif c.tag == qn('a:schemeClr'):
            val = colors.get(c.get('val'))
        elif c.tag == qn('a:sysClr'):
            val = c.get('lastClr')
        else:
            continue
        if not val:
            return None
        rgb = [int(val[i:i+2], 16) for i in (0, 2, 4)]
        for mod in c:
            m = int(mod.get('val', '100000'))/100000
            if mod.tag in (qn('a:tint'), qn('a:lumOff')):
                rgb = [v+(255-v)*m if mod.tag == qn('a:tint') else v+255*m for v in rgb]
            elif mod.tag in (qn('a:shade'), qn('a:lumMod')):
                rgb = [v*m for v in rgb]
            elif mod.tag == qn('a:alpha') and m < 1:
                return None
        return ''.join('%02X' % max(0, min(255, round(v))) for v in rgb)
    return None


def solid_color(element, colors):
    if element is None:
        return None
    return color_value(element.find(qn('a:solidFill')), colors)


def background_color(slide, colors):
    for obj in (slide, slide.slide_layout, slide.slide_layout.slide_master):
        bg = obj._element.find('.//' + qn('p:bgPr'))
        col = solid_color(bg, colors)
        if col:
            return col
    return colors.get('bg1', 'FFFFFF')


def shape_background(shape, shapes, bg, colors):
    # Fondo de la propia forma o de la última forma sólida que la contiene.
    own = solid_color(shape._element.find(qn('p:spPr')), colors)
    if own:
        return own
    for other in reversed(shapes):
        if other == shape:
            continue
        if (other.left <= shape.left and other.top <= shape.top and
                other.left+other.width >= shape.left+shape.width and
                other.top+other.height >= shape.top+shape.height):
            col = solid_color(other._element.find(qn('p:spPr')), colors)
            if col:
                return col
    return bg


def check_contrast(frame, bg, colors, slide_n, name, problems, fallback='000000'):
    for p in frame.paragraphs:
        for r in p.runs:
            if not r.text.strip():
                continue
            col = solid_color(r._r.find(qn('a:rPr')), colors)
            if not col:
                col = solid_color(p._p.find('./' + qn('a:pPr') + '/' + qn('a:defRPr')), colors) or fallback
            size = r.font.size.pt if r.font.size else (p.font.size.pt if p.font.size else 18)
            minimum = 3 if size >= 24 or (size >= 18 and r.font.bold) else 4.5
            ratio = contrast(col, bg)
            if ratio < minimum:
                problems.append("Diapositiva %d: contraste insuficiente en «%s» (%.2f:1; mínimo %.1f:1)." % (slide_n, name, ratio, minimum))
                return


def walk_shapes(shapes):
    for shape in shapes:
        yield shape
        if shape.shape_type is not None and 'GROUP' in str(shape.shape_type):
            yield from walk_shapes(shape.shapes)


def check_table(shape, slide_n, problems, colors, bg):
    table = shape.table
    for ri, row in enumerate(table.rows):
        for ci, cell in enumerate(row.cells):
            if cell.is_spanned:
                continue
            w = sum(table.columns[j].width for j in range(ci, ci+cell.span_width))
            h = sum(table.rows[j].height for j in range(ri, ri+cell.span_height))
            label = '%s [%d,%d]' % (shape.name, ri+1, ci+1)
            check_frame(cell.text_frame, w, h, slide_n, label, problems)
            cbg = solid_color(cell._tc.find(qn('a:tcPr')), colors) or bg
            check_contrast(cell.text_frame, cbg, colors, slide_n, label, problems, colors.get('tx1', '000000'))


def check_chart(shape, slide_n, problems, colors, bg):
    chart = shape.chart
    _ = [list(series.values) for series in chart.series]
    root = chart._chartSpace
    bg = solid_color(root.find(qn('c:spPr')), colors) or bg
    for node in root.iter():
        if node.tag not in (qn('a:rPr'), qn('a:defRPr')):
            continue
        col = solid_color(node, colors)
        if not col:
            continue
        size = int(node.get('sz', '1800')) / 100
        minimum = 3 if size >= 24 or (size >= 18 and node.get('b') == '1') else 4.5
        ratio = contrast(col, bg)
        if ratio < minimum:
            problems.append("Diapositiva %d: contraste insuficiente en el gráfico «%s» (%.2f:1; mínimo %.1f:1)." %
                            (slide_n, shape.name, ratio, minimum))
            break


def check(path):
    problems, warns = package_problems(path), []
    if hasattr(path, "seek"):
        path.seek(0)
    prs = Presentation(path)
    sw, sh_ = prs.slide_width, prs.slide_height
    n = len(prs.slides)
    if n == 0:
        problems.append("La presentación no tiene diapositivas.")
    for i, s in enumerate(prs.slides, 1):
        title = s.shapes.title.text_frame.text.strip() if s.shapes.title is not None else ""
        if not title:
            problems.append("Diapositiva %d: sin título (accesibilidad y navegación)." % i)
        colors = theme_colors(s)
        bg = background_color(s, colors)
        prior = []
        # Leer notas y diseños también: python-pptx abre algunas partes de forma diferida.
        if s.has_notes_slide:
            _ = s.notes_slide.notes_text_frame.text
        for sh in walk_shapes(s.shapes):
            relevant = ((sh.has_text_frame and sh.text.strip()) or sh.is_placeholder or sh.has_table or sh.has_chart or 'PICTURE' in str(sh.shape_type))
            if relevant and sh.left is not None and sh.width is not None:
                tol = Emu(91440 // 4)
                if sh.left < -tol or sh.top < -tol or sh.left + sh.width > sw + tol or sh.top + sh.height > sh_ + tol:
                    problems.append("Diapositiva %d: la forma «%s» se sale del lienzo." % (i, sh.name))
            if sh.has_text_frame:
                if sh.is_placeholder and not sh.text.strip():
                    problems.append("Diapositiva %d: marcador vacío «%s»." % (i, sh.name))
                check_frame(sh.text_frame, sh.width, sh.height, i, sh.name, problems, default_pt(sh))
                sbg = shape_background(sh, prior, bg, colors)
                check_contrast(sh.text_frame, sbg, colors, i, sh.name, problems, colors.get('tx1', '000000'))
            if sh.has_table:
                check_table(sh, i, problems, colors, bg)
            if sh.has_chart:
                check_chart(sh, i, problems, colors, bg)
            prior.append(sh)
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
