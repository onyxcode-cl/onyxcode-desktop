#!/usr/bin/env python3
"""Traduce un PDF CONSERVANDO su diseño: cada texto se reemplaza en el mismo lugar, con la misma fuente, tamaño y estilo.

Tres pasos (el modelo traduce en el del medio):
  1) extraer  doc.pdf -o segmentos.json            -> lista de textos con su posición
  2) (el modelo escribe traduccion.json: {"<id>": "texto traducido", ...})
  3) aplicar  doc.pdf -t traduccion.json -o doc-en.pdf [--informe informe.json]

Usa PyMuPDF (licencia AGPL-3.0, ver THIRD_PARTY_NOTICES.md). Logos, imágenes, líneas, bordes y numeración se dejan intactos.
Solo PDF con texto: un PDF escaneado no se puede traducir así (sin OCR).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from pdf_util import error, exigir_entrada, exigir_salida_nueva

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    error("falta PyMuPDF en este Python (pip install pymupdf).")

MARGEN_DER = 526.0     # tope derecho si no hay vecino (hoja carta/A4 con margen típico)
INTERLINEA = 1.18
TAM_MIN = 6.0

FUENTES = {
    "regular": ["/System/Library/Fonts/Supplemental/Arial.ttf", "C:/Windows/Fonts/arial.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"],
    "bold": ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "C:/Windows/Fonts/arialbd.ttf",
             "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"],
    "italic": ["/System/Library/Fonts/Supplemental/Arial Italic.ttf", "C:/Windows/Fonts/ariali.ttf",
               "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"],
}


def _fuente(estilo):
    for ruta in FUENTES[estilo]:
        if os.path.isfile(ruta):
            return fitz.Font(fontfile=ruta)
    return fitz.Font("helv" if estilo != "bold" else "hebo")  # Helvetica base: solo Latin-1


# ---------------------------------------------------------------- segmentación

def _rgb(color):
    return (((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255)


def _resaltados(pagina):
    """Rectángulos de resaltado: rellenos de color (ni blanco ni gris ni negro), bajos y anchos."""
    out = []
    for d in pagina.get_drawings():
        fill = d.get("fill")
        if not fill:
            continue
        r = d["rect"]
        if r.height > 24 or r.width < 3 or r.height < 2:
            continue
        if max(fill) - min(fill) < 0.25:   # blanco / gris / negro: no es un resaltado
            continue
        out.append((fitz.Rect(r), tuple(fill)))
    return out


def segmentos_de_pagina(pagina):
    """Párrafos de la página: líneas consecutivas del mismo bloque, misma sangría y estilo, sin línea en blanco entre ellas."""
    segs = []
    for b in pagina.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        lineas = []
        for l in b["lines"]:
            spans = [x for x in l["spans"] if x["text"].strip()]
            if not spans:
                continue
            todo_neg = all(x["flags"] & 16 for x in spans)
            alguna_neg = any(x["flags"] & 16 for x in spans)
            if alguna_neg and not todo_neg:
                partes = []
                for x in l["spans"]:
                    t = x["text"]
                    partes.append("<b>%s</b>" % t.strip() + (" " if t.endswith(" ") else "") if (x["flags"] & 16 and t.strip()) else t)
                txt = "".join(partes).strip()
            else:
                txt = "".join(x["text"] for x in l["spans"]).strip()
            s = spans[0] if todo_neg or not alguna_neg else next(x for x in spans if not x["flags"] & 16)
            lineas.append({"bbox": list(l["bbox"]), "text": txt, "bold": todo_neg,
                           "italic": bool(s["flags"] & 2), "size": s["size"], "color": s["color"]})
        if not lineas:
            continue
        maxx = max(l["bbox"][2] for l in lineas)
        cur = None
        for l in lineas:
            if cur:
                p = cur["lines"][-1]
                igual = (abs(p["bbox"][0] - l["bbox"][0]) < 3 and p["bold"] == l["bold"] and abs(p["size"] - l["size"]) < 0.3)
                hueco = l["bbox"][1] - p["bbox"][3]
                llena = p["bbox"][2] >= maxx - 8 and (maxx - l["bbox"][0]) > 150
                etiqueta = p["bold"] and l["bold"] and not p["text"].endswith(":")
                sigue = (l["text"][0].islower() and not p["text"].rstrip().endswith((".", ":", ";"))
                         and not p["bold"])   # la frase continúa en la línea siguiente
                if igual and hueco < 3 and (llena or etiqueta or sigue):
                    cur["lines"].append(l)
                    continue
            cur = {"lines": [l]}
            segs.append(cur)
    # una frase puede venir partida en bloques distintos: se unen los trozos contiguos que claramente continúan
    segs.sort(key=lambda g: (g["lines"][0]["bbox"][1], g["lines"][0]["bbox"][0]))
    fusion = []
    for sg in segs:
        l = sg["lines"][0]
        for prev in reversed(fusion[-6:]):
            p = prev["lines"][-1]
            ult = p["text"].rstrip()
            palabra = ult.split(" ")[-1]
            continua = (not ult.endswith((".", ":", ";", "?", "!")) and not p["bold"]
                        and (l["text"][0].islower() or (palabra.islower() and len(palabra) <= 3)))
            sangria = 3 if not re.match(r"^(•|-|\d+(\.\d+)*\.?)\s", prev["lines"][0]["text"]) else 18
            if (abs(p["bbox"][0] - l["bbox"][0]) < sangria and p["bold"] == l["bold"] and abs(p["size"] - l["size"]) < 0.3
                    and 0 <= l["bbox"][1] - p["bbox"][3] < 3 and continua):
                prev["lines"].extend(sg["lines"])
                break
        else:
            fusion.append(sg)
    segs = fusion
    segs.sort(key=lambda g: (g["lines"][0]["bbox"][1], g["lines"][0]["bbox"][0]))
    for sg in segs:
        bb = [l["bbox"] for l in sg["lines"]]
        sg["bbox"] = [min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb)]
        sg["text"] = " ".join(l["text"] for l in sg["lines"])
        pr = sg["lines"][0]
        sg["bold"], sg["italic"], sg["size"], sg["color"] = pr["bold"], pr["italic"], pr["size"], pr["color"]
        sg["multi"] = len(sg["lines"]) > 1
    return segs


def _info_resaltado(pagina, seg, hl):
    """None (sin resaltado), "todo" (casi todo el texto resaltado) o lista de las partes resaltadas."""
    if not hl:
        return None
    cubiertas = 0
    for l in seg["lines"]:
        cy = (l["bbox"][1] + l["bbox"][3]) / 2
        if any(r.y0 - 1 <= cy <= r.y1 + 1 and r.x0 - 2 <= l["bbox"][0] + 2 and r.x1 + 2 >= l["bbox"][2] - 2 for r, _ in hl):
            cubiertas += 1
    if cubiertas >= max(1, int(0.8 * len(seg["lines"]) + 0.999)):
        return "todo"
    partes = []
    for r, _c in hl:
        if not fitz.Rect(seg["bbox"]).intersects(r):
            continue
        pal = [w[4] for w in pagina.get_text("words") if r.x0 - 1 <= (w[0] + w[2]) / 2 <= r.x1 + 1 and r.y0 - 1 <= (w[1] + w[3]) / 2 <= r.y1 + 1]
        if pal:
            partes.append(" ".join(pal))
    return partes or None


def _traducible(texto):
    """Sin letras (números, fechas, folios, símbolos): no se traduce y se deja tal cual."""
    return bool(re.search(r"[^\W\d_]", texto))


# ---------------------------------------------------------------- extraer

def cmd_extraer(a):
    exigir_entrada(a.pdf)
    doc = fitz.open(a.pdf)
    if doc.needs_pass:
        error("el PDF tiene contraseña; este script no la maneja.")
    salida = []
    total_chars = 0
    for n, pag in enumerate(doc):
        hl = _resaltados(pag)
        for i, s in enumerate(segmentos_de_pagina(pag)):
            if not _traducible(s["text"]):
                continue
            item = {"id": "p%d-%d" % (n + 1, i), "pagina": n + 1, "texto": s["text"], "negrita": s["bold"]}
            marc = _info_resaltado(pag, s, hl)
            if marc:
                item["resaltado"] = marc
            salida.append(item)
            total_chars += len(s["text"])
    paginas_con_texto = {s["pagina"] for s in salida}
    if not salida:
        print("AVISO: el PDF no tiene texto extraíble (parece ESCANEADO). No hay OCR: no se puede traducir con este método.", file=sys.stderr)
        sys.exit(2)
    sin_texto = [n + 1 for n in range(len(doc)) if (n + 1) not in paginas_con_texto]
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump({"paginas": len(doc), "segmentos": salida}, f, ensure_ascii=False, indent=1)
    print("OK: %d textos a traducir (%d caracteres) en %d páginas -> %s" % (len(salida), total_chars, len(paginas_con_texto), a.salida))
    if sin_texto:
        print("AVISO: páginas sin texto (imágenes): %s. Quedarán tal cual, en el idioma original." % ",".join(map(str, sin_texto)))
    print("Traduce cada \"texto\" (id -> traducción) y guarda un JSON {\"p1-0\": \"...\"}. "
          "En los textos con \"resaltado\", envuelve en [[ ]] la parte traducida que corresponde a lo resaltado.")


# ---------------------------------------------------------------- aplicar

def _palabras(texto, negrita_base=False):
    """[(palabra, resaltada, negrita)] respetando los marcadores [[ ]] y las etiquetas <b> </b>."""
    out, hl, neg = [], False, negrita_base
    for tok in re.split(r"(\[\[|\]\]|</?b>)", texto):
        if tok == "[[":
            hl = True
        elif tok == "]]":
            hl = False
        elif tok == "<b>":
            neg = True
        elif tok == "</b>":
            neg = negrita_base
        else:
            out.extend((w, hl, neg) for w in tok.split())
    return out


def _ancho(f, t, sz):
    return f.text_length(t, fontsize=sz)


def _env(fuentes, w, sz):
    return fuentes["bold" if w[2] else "regular"], w


def _ancho_pal(fuentes, w, sz):
    return fuentes["bold" if w[2] else "regular"].text_length(w[0], fontsize=sz)


def _ancho_linea(fuentes, ln, sz):
    esp = fuentes["regular"].text_length(" ", fontsize=sz)
    return sum(_ancho_pal(fuentes, w, sz) for w in ln) + esp * (len(ln) - 1)


def _envolver(fuentes, palabras, sz, ancho):
    lineas, cur = [], []
    for w in palabras:
        if not cur or _ancho_linea(fuentes, cur + [w], sz) <= ancho:
            cur.append(w)
        else:
            lineas.append(cur)
            cur = [w]
    if cur:
        lineas.append(cur)
    return lineas


def cmd_aplicar(a):
    exigir_entrada(a.pdf)
    exigir_entrada(a.traduccion)
    exigir_salida_nueva(a.salida)
    with open(a.traduccion, encoding="utf-8") as f:
        tr = json.load(f)
    if isinstance(tr, dict) and "segmentos" in tr:   # aceptar también el JSON de extraer con "traduccion" por segmento
        tr = {s["id"]: s.get("traduccion", "") for s in tr["segmentos"] if s.get("traduccion")}
    doc = fitz.open(a.pdf)
    if doc.needs_pass:
        error("el PDF tiene contraseña; este script no la maneja.")
    fuentes = {"regular": _fuente("regular"), "bold": _fuente("bold")}
    informe = {"traducidos": 0, "sin_traduccion": [], "letra_reducida": [], "no_cabe": [], "caracteres_sin_fuente": []}
    usados = set()

    for n, pag in enumerate(doc):
        segs = segmentos_de_pagina(pag)
        hl = _resaltados(pag)
        trabajo = []
        for i, s in enumerate(segs):
            sid = "p%d-%d" % (n + 1, i)
            if not _traducible(s["text"]):
                continue
            if sid not in tr or not str(tr[sid]).strip():
                informe["sin_traduccion"].append(sid)
                continue
            usados.add(sid)
            if " ".join(str(tr[sid]).replace("[[", "").replace("]]", "").split()) == " ".join(re.sub(r"</?b>", "", s["text"]).split()):
                informe["iguales"] = informe.get("iguales", 0) + 1   # nombres propios, códigos, cifras: se dejan como están
                continue
            trabajo.append((sid, s))
        # 1) borrar el texto viejo (y los resaltados que lo cubrían; se vuelven a dibujar donde corresponda)
        hl_viejos = [(r, c) for (r, c) in hl if any(fitz.Rect(s["bbox"]).intersects(r) for _, s in trabajo)]
        # dos pasadas: si el rectángulo del resaltado se mezcla con los de las líneas de texto, PyMuPDF no lo da por «cubierto»
        for r, _c in hl_viejos:
            pag.add_redact_annot(r + (-1, -1, 1, 1), fill=False)
        if hl_viejos:
            pag.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
        for _, s in trabajo:
            for l in s["lines"]:
                pag.add_redact_annot(fitz.Rect(l["bbox"]), fill=False)
        pag.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        color_hl = hl_viejos[0][1] if hl_viejos else (1, 1, 0)
        # 2) escribir la traducción
        for sid, s in trabajo:
            texto = str(tr[sid])
            palabras = _palabras(texto, s["bold"])
            if not palabras:
                continue
            if _info_resaltado(pag, s, hl) == "todo" and not any(w[1] for w in palabras):
                palabras = [(w[0], True, w[2]) for w in palabras]
            f = fuentes["regular"]
            x0, y0, x1, y1 = s["bbox"]
            otros = [o for o in segs if o is not s]
            derechos = [o["bbox"][0] for o in otros
                        if o["bbox"][0] > x1 - 1 and o["bbox"][1] < y1 - 1 and o["bbox"][3] > y0 + 1 and o["bbox"][0] > x0 + 20]
            ancho_orig = x1 - x0
            plano_ancho = lambda sz_: _ancho_linea(fuentes, palabras, sz_)
            if derechos:
                derecha = min(derechos) - 8
            else:
                derecha = 526.0
            if not derechos and (s["multi"] or plano_ancho(s["size"]) > ancho_orig):
                derecha = max(x1, 506.0 if x0 > 150 else MARGEN_DER)
            derecha = max(min(derecha, MARGEN_DER if not derechos else derecha), x1)
            if not derechos and not s["multi"]:   # una sola línea sin nada a su derecha: no se parte, crece hasta el borde de la hoja
                derecha = max(derecha, min(pag.rect.width - 24, x0 + plano_ancho(s["size"]) + 2))
            w = derecha - x0
            # celda de tabla centrada (hay vecinos a ambos lados de la fila y el texto estaba entre ellos): se mantiene centrada
            izq = [o["bbox"][2] for o in otros if o["bbox"][2] < x0 + 1 and o["bbox"][1] < y1 - 1 and o["bbox"][3] > y0 + 1]
            centrada = False
            if derechos and izq and not s["multi"] and len(palabras) <= 4:
                cx = (x0 + x1) / 2
                semi = min(cx - max(izq), min(derechos) - cx) - 2.0
                if semi > 0 and 3 <= (x0 - max(izq)) and abs((x0 - max(izq)) - (min(derechos) - x1)) < 40:
                    centrada, w = True, 2 * semi
            debajo = [o["bbox"][1] for o in otros if o["bbox"][1] >= y1 - 2 and o["bbox"][0] < derecha and o["bbox"][2] > x0 and o["bbox"][1] > y0 + 2]
            libre = max((min(debajo) - y0 - 1) if debajo else (y1 - y0 + 40), y1 - y0)
            sz = s["size"]
            while True:
                lineas = _envolver(fuentes, palabras, sz, w)
                cabe_ancho = all(_ancho_pal(fuentes, p_, sz) <= w + 0.5 for p_ in palabras)   # ninguna palabra se sale de su espacio
                alto = (len(lineas) - 1) * sz * INTERLINEA + sz * 0.95
                if (cabe_ancho and alto <= libre - 1.0) or sz <= TAM_MIN:
                    break
                sz -= 0.2
            if not all(_ancho_pal(fuentes, p_, sz) <= w + 0.5 for p_ in palabras) or (len(lineas) - 1) * sz * INTERLINEA + sz * 0.95 > libre - 1.0 + 0.01:
                informe["no_cabe"].append(sid)
            if sz < s["size"] - 0.01:
                informe["letra_reducida"].append({"id": sid, "de": round(s["size"], 1), "a": round(sz, 1)})
            rgb = _rgb(s["color"])
            # solo se justifica lo que el original justificaba: todas sus líneas menos la última llegan al mismo borde derecho
            lx = [l_["bbox"][2] for l_ in s["lines"]]
            es_justificado = (not s["bold"]) and len(lx) >= 3 and max(lx[:-1]) - min(lx[:-1]) < 2.5
            y = y0 + sz * 0.86
            x_ini = (cx - _ancho_linea(fuentes, lineas[0], sz) / 2) if (centrada and len(lineas) == 1) else x0
            for k, ln in enumerate(lineas):
                justificar = es_justificado and k < len(lineas) - 1 and len(ln) > 1
                esp = fuentes["regular"].text_length(" ", fontsize=sz)
                gap = ((w - sum(_ancho_pal(fuentes, x, sz) for x in ln)) / (len(ln) - 1)) if justificar else esp
                x, tramo = x_ini if k == 0 else x0, None
                tw = fitz.TextWriter(pag.rect)
                for (wd, h, neg) in ln:
                    fw = fuentes["bold" if neg else "regular"]
                    ancho_w = fw.text_length(wd, fontsize=sz)
                    if h:
                        tramo = [x, x + ancho_w] if tramo is None else [tramo[0], x + ancho_w]
                    elif tramo is not None:
                        _resalta(pag, tramo, y, sz, color_hl)
                        tramo = None
                    tw.append((x, y), wd, font=fw, fontsize=sz)
                    x += ancho_w + gap
                if tramo is not None:
                    _resalta(pag, tramo, y, sz, color_hl)
                tw.write_text(pag, color=rgb)
                y += sz * INTERLINEA
            informe["traducidos"] += 1
    extra = sorted(set(tr) - usados)
    if extra:
        informe["ids_desconocidos"] = extra
    doc.save(a.salida, garbage=3, deflate=True)
    if a.informe:
        with open(a.informe, "w", encoding="utf-8") as f:
            json.dump(informe, f, ensure_ascii=False, indent=1)
    print("OK: %d textos traducidos -> %s" % (informe["traducidos"], a.salida))
    if informe["sin_traduccion"]:
        print("AVISO: %d textos sin traducir (quedan borrados NO: se dejaron en el idioma original): %s"
              % (len(informe["sin_traduccion"]), ", ".join(informe["sin_traduccion"][:12])))
    if informe["letra_reducida"]:
        print("AVISO: letra reducida en %d textos (la traducción es más larga)." % len(informe["letra_reducida"]))
    if informe["no_cabe"]:
        print("AVISO: no cabe aunque se redujo la letra: %s. Revisa esas páginas." % ", ".join(informe["no_cabe"]))
    sys.exit(0 if not informe["no_cabe"] else 3)


def _resalta(pag, tramo, y_base, sz, color):
    r = fitz.Rect(tramo[0] - 0.5, y_base - sz * 0.80, tramo[1] + 0.5, y_base + sz * 0.22)
    pag.draw_rect(r, color=None, fill=color, overlay=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extraer", help="lista los textos del PDF")
    e.add_argument("pdf")
    e.add_argument("-o", "--salida", required=True)
    e.set_defaults(fn=cmd_extraer)
    p = sub.add_parser("aplicar", help="escribe la traducción sobre el mismo PDF")
    p.add_argument("pdf")
    p.add_argument("-t", "--traduccion", required=True)
    p.add_argument("-o", "--salida", required=True)
    p.add_argument("--informe")
    p.set_defaults(fn=cmd_aplicar)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
