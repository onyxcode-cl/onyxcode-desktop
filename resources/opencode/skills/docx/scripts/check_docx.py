#!/usr/bin/env python3
"""Verifica un .docx: estructura y, si está WordCraft (ArtCraft), render a PNG con detección de páginas en blanco.

Uso:  python check_docx.py archivo.docx [--render] [--outdir DIR] [--json]
  --render  fuerza el render (por defecto se intenta si existe _shared/render.py)
  --no-render  solo estructura
Códigos de salida: 0 sin problemas (puede haber avisos), 1 hay problemas, 2 uso/no abre.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from docx import Document  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.table import Table  # noqa: E402

SHARED = os.path.normpath(os.path.join(HERE, "..", "..", "_shared"))


def structural(path, spec=None):
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
            if not text.strip():
                probs.append("título vacío (%s): escriba el título o elimine ese párrafo" % name)
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
            probs.append("tabla %d sin filas de datos: agregue encabezado y al menos una fila de datos" % (i + 1))
            continue
        if not any(c.text.strip() for row in t.rows[1:] for c in row.cells):
            probs.append("tabla %d con filas de datos vacías: complete los datos pedidos" % (i + 1))
        first = t.rows[0]._tr
        marked = bool(first.xpath("./w:trPr/w:tblHeader"))
        shaded = bool(first.xpath(".//w:tcPr/w:shd[@w:fill and @w:fill!='auto' and @w:fill!='FFFFFF']"))
        bold = bool(first.xpath(".//w:rPr/w:b"))
        if not (marked or shaded or bold):
            sin_enc += 1
            avisos.append("tabla %d sin fila de encabezado distinguible (ni repetida, ni sombreada, ni en negrita)" % (i + 1))
        if any(len(r.cells) != len(t.columns) for r in t.rows):
            avisos.append("tabla %d con celdas combinadas o filas irregulares" % (i + 1))

    if spec is not None:
        expected = [b for b in spec.get("blocks", []) if b.get("type") == "table"]
        if len(tablas) != len(expected):
            probs.append("se pidieron %d tablas y existen %d: restaure las tablas del contenido JSON" % (len(expected), len(tablas)))
        for i, (table, wanted) in enumerate(zip(tablas, expected), 1):
            count = len(wanted.get("rows", [])) + bool(wanted.get("columns"))
            if len(table.rows) < count:
                probs.append("tabla %d: se esperaban %d filas y hay %d; restaure las filas perdidas" % (i, count, len(table.rows)))
            if wanted.get("columns") and len(table.columns) != len(wanted["columns"]):
                probs.append("tabla %d: restaure las %d columnas pedidas" % (i, len(wanted["columns"])))
            elif wanted.get("columns") and table.rows:
                clean = lambda text: " ".join(re.sub(r"[*`]", "", str(text)).split()).casefold()
                if [clean(c.text) for c in table.rows[0].cells] != [clean(c) for c in wanted["columns"]]:
                    probs.append("tabla %d: los encabezados no coinciden con la tabla pedida; restaure sus columnas" % i)

    def has_page(footer):
        instructions = footer._element.xpath(".//w:instrText/text() | .//w:fldSimple/@w:instr")
        return any(re.match(r"^\s*PAGE(?:\s|$)", ins, re.I) for ins in instructions)

    report_cover = False
    if spec is not None:
        from _report_layout import prepare
        report_cover = prepare(spec).get("cover", False)

    for i, section in enumerate(doc.sections, 1):
        footers = [section.footer]
        # Una portada solicitada explícitamente o decidida por extensión conserva la primera página sin pie.
        cover = i == 1 and report_cover
        if section.different_first_page_header_footer and not cover:
            footers.append(section.first_page_footer)
        if doc.settings.odd_and_even_pages_header_footer:
            footers.append(section.even_page_footer)
        if not all(has_page(f) for f in footers):
            probs.append("sección %d sin campo PAGE en un pie activo: inserte un número de página automático (también junto al pie personalizado)" % i)

    # Los saltos explícitos sí pueden comprobarse sin motor de paginación.
    total_words = sum(len(p.text.split()) for p in doc.paragraphs)
    page_words, visual, page_index, saw_break = 0, False, 0, False
    for e in paras:
        if e.tag == qn("w:tbl"):
            visual = True
            continue
        if e.xpath(".//w:drawing | .//w:pict"):
            visual = True
        parts = re.split(r'(<w:br\b[^>]*w:type="page"[^>]*/>)', e.xml)
        for part in parts:
            if part.startswith("<w:br") or (part == parts[0] and e.xpath("./w:pPr/w:pageBreakBefore[not(@w:val='0' or @w:val='false')]") ):
                allowed_cover = page_index == 0 and (report_cover if spec is not None else total_words >= 1200) and any(n == "Title" for n, _ in headings)
                if page_words < 80 and not visual and not allowed_cover:
                    probs.append("página explícita %d casi vacía: quite el salto o una el contenido con la página siguiente" % (page_index + 1))
                page_words, visual = 0, False
                page_index += 1
                saw_break = True
            page_words += sum(len(t.split()) for t in re.findall(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', part, re.S))
    if saw_break and not page_words and not visual:
        probs.append("página final vacía: elimine el salto de página al final")

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


def sparse_pages(pngs):
    """Ignora encabezado/pie; una última página breve con texto es válida."""
    from PIL import Image
    blank, sparse, boxes = [], [], []
    for i, path in enumerate(pngs):
        with Image.open(path) as source:
            im = source.convert("L")
        w, h = im.size
        # Zona de cuerpo: excluye los pies que harían parecer llena una página vacía.
        body = im.crop((int(w * .08), int(h * .09), int(w * .92), int(h * .9)))
        mask = body.point(lambda p: 255 if p < 210 else 0)
        bbox = mask.getbbox()
        boxes.append((bbox, body.height))
        if bbox is None or sum(body.histogram()[:210]) / (body.width * body.height) < .0004:
            blank.append(i + 1)
        elif i < len(pngs) - 1 and bbox[3] - bbox[1] < body.height * .18:
            sparse.append(i + 1)
    if len(boxes) >= 2:
        last, height = boxes[-1]
        previous, prev_height = boxes[-2]
        if last and previous and last[3] - last[1] < height * .18:
            # Solo marca la última si el hueco anterior permite unir ambos cuerpos.
            if previous[3] / prev_height + (last[3] - last[1]) / height < .8:
                sparse.append(len(pngs))
    return blank, sparse


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
        res["aviso"] = "el render falló o no está WordCraft (ArtCraft) (%s); solo se verificó la estructura" % e
        return res
    res.update(data)
    pngs = data.get("pngs") or []
    blank, sparse = [], []
    try:
        blank, sparse = sparse_pages(pngs)
    except Exception as e:
        res.setdefault("avisos", []).append("no se pudo analizar páginas en blanco: %s" % e)
    res["paginas_en_blanco"] = blank
    res["paginas_casi_vacias"] = sparse
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
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--no-render", action="store_true", help="solo verificación estructural")
    mode.add_argument("--render", action="store_true", help="intentar renderizar (también es el valor por defecto)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--spec", help="JSON de construcción: comprueba que ninguna tabla ni fila pedida se perdió")
    a = ap.parse_args()
    if not os.path.isfile(a.archivo):
        print("ERROR: el archivo no existe: " + a.archivo, file=sys.stderr)
        sys.exit(2)
    try:
        spec = None
        if a.spec:
            with open(a.spec, encoding="utf-8") as f:
                spec = json.load(f)
        probs, avisos, info = structural(a.archivo, spec)
    except Exception as e:
        print("ERROR: no se pudo abrir el .docx (%s)" % e, file=sys.stderr)
        sys.exit(2)
    rend = {"intentado": False} if a.no_render else render(a.archivo, a.outdir)
    if rend.get("paginas_en_blanco"):
        probs.append("páginas en blanco: %s; quite saltos sobrantes o el párrafo final que desborda" % rend["paginas_en_blanco"])
    sparse = rend.get("paginas_casi_vacias", [])
    if spec:
        from _report_layout import prepare
        if prepare(spec).get("cover"):
            sparse = [p for p in sparse if p != 1]
    if sparse:
        probs.append("páginas casi vacías: %s; quite saltos evitables o keep_with_next que pega toda una tabla" % sparse)
    if rend.get("intentado") and rend.get("ok") is False:
        avisos.append("el render no terminó bien: %s" % "; ".join(rend.get("avisos", [])))
    if a.json:
        print(json.dumps({"problemas": probs, "avisos": avisos, "info": info, "render": rend}, ensure_ascii=False, indent=2))
    else:
        print("Archivo: %s" % a.archivo)
        print("Estructura: %d párrafos, %d tablas, %d imágenes, %d encabezados, %d sección(es)" % (
            info["parrafos"], info["tablas"], info["imagenes"], len(info["encabezados"]), info["secciones"]))
        if rend.get("ok"):
            print("Render: %s páginas (%s)" % (rend.get("paginas"), rend.get("motor") or "pdf"))
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
