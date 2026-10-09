#!/usr/bin/env python3
"""Crea un PDF profesional (reportlab) desde un JSON o un Markdown simple. Formato es-CL."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_util import error, exigir_entrada, exigir_salida_nueva  # noqa: E402

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]
ES_NUM = re.compile(r"^[\s$€%()+\-−–]*\d[\d.,\s]*(%|\s?(CLP|UF|USD|UTM|kg|m|km))?\s*$")
AZUL = "#1F3A5F"


def fecha_larga(d=None):
    import datetime
    d = d or datetime.date.today()
    return "%d de %s de %d" % (d.day, MESES[d.month - 1], d.year)


def _inline(t):
    """Escapa y convierte **negrita** y *cursiva* a marcado de reportlab."""
    t = str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", t)
    return t.replace("\n", "<br/>")


def parsear_markdown(texto):
    """Markdown simple -> dict con 'bloques'. Soporta #, ##, ###, listas, tablas |, imágenes, ---."""
    doc = {"bloques": []}
    bl = doc["bloques"]
    lineas = texto.splitlines()
    i, par = 0, []

    def cerrar():
        if par:
            bl.append({"tipo": "parrafo", "texto": " ".join(par)})
            par.clear()

    while i < len(lineas):
        ln = lineas[i].rstrip()
        s = ln.strip()
        m = re.match(r"^(#{1,3})\s+(.*)$", s)
        if not s:
            cerrar()
        elif m:
            cerrar()
            nivel = len(m.group(1))
            if nivel == 1 and "titulo" not in doc and not bl:
                doc["titulo"] = m.group(2)
            else:
                bl.append({"tipo": "titulo", "nivel": max(1, nivel - 1) if "titulo" in doc else nivel, "texto": m.group(2)})
        elif re.match(r"^(-{3,}|\*{3,})$", s):
            cerrar()
            bl.append({"tipo": "salto"})
        elif re.match(r"^[-*]\s+", s) or re.match(r"^\d+[.)]\s+", s):
            cerrar()
            ordenada = bool(re.match(r"^\d+[.)]\s+", s))
            items = []
            while i < len(lineas) and re.match(r"^\s*([-*]|\d+[.)])\s+", lineas[i]):
                items.append(re.sub(r"^\s*([-*]|\d+[.)])\s+", "", lineas[i]).strip())
                i += 1
            bl.append({"tipo": "lista", "ordenada": ordenada, "items": items})
            continue
        elif s.startswith("|"):
            cerrar()
            filas = []
            while i < len(lineas) and lineas[i].strip().startswith("|"):
                celdas = [c.strip() for c in lineas[i].strip().strip("|").split("|")]
                if not all(re.match(r"^:?-{2,}:?$", c) for c in celdas):
                    filas.append(celdas)
                i += 1
            if filas:
                bl.append({"tipo": "tabla", "encabezado": filas[0], "filas": filas[1:]})
            continue
        elif re.match(r"^!\[(.*)\]\((.+)\)$", s):
            cerrar()
            mm = re.match(r"^!\[(.*)\]\((.+)\)$", s)
            bl.append({"tipo": "imagen", "ruta": mm.group(2), "pie": mm.group(1)})
        else:
            par.append(s)
        i += 1
    cerrar()
    return doc


def construir(doc, salida, base_dir="."):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_JUSTIFY, TA_RIGHT, TA_CENTER
    from reportlab.lib.pagesizes import A4, LETTER
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, ListFlowable, ListItem,
                                    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)
    from reportlab.platypus.tableofcontents import TableOfContents

    color = colors.HexColor(doc.get("color", AZUL))
    tam = LETTER if str(doc.get("pagina", "A4")).lower() in ("carta", "letter") else A4
    titulo = doc.get("titulo", "Documento")
    encabezado = doc.get("encabezado", titulo)
    pie = doc.get("pie", "")
    portada = bool(doc.get("portada", False))

    base = ParagraphStyle("base", fontName="Helvetica", fontSize=10.5, leading=15, textColor=colors.HexColor("#222222"))
    est = {
        "p": ParagraphStyle("p", parent=base, alignment=TA_JUSTIFY, spaceAfter=7),
        "h1": ParagraphStyle("H1", parent=base, fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=color,
                             spaceBefore=16, spaceAfter=8, keepWithNext=1),
        "h2": ParagraphStyle("H2", parent=base, fontName="Helvetica-Bold", fontSize=13.5, leading=17, textColor=color,
                             spaceBefore=12, spaceAfter=6, keepWithNext=1),
        "h3": ParagraphStyle("H3", parent=base, fontName="Helvetica-Bold", fontSize=11.5, leading=15,
                             spaceBefore=8, spaceAfter=4, keepWithNext=1),
        "cel": ParagraphStyle("cel", parent=base, fontSize=9, leading=11.5),
        "celd": ParagraphStyle("celd", parent=base, fontSize=9, leading=11.5, alignment=TA_RIGHT),
        "cab": ParagraphStyle("cab", parent=base, fontSize=9, leading=11.5, fontName="Helvetica-Bold", textColor=colors.white),
        "cabd": ParagraphStyle("cabd", parent=base, fontSize=9, leading=11.5, fontName="Helvetica-Bold",
                               textColor=colors.white, alignment=TA_RIGHT),
        "pie": ParagraphStyle("pieimg", parent=base, fontSize=8.5, leading=11, alignment=TA_CENTER,
                              textColor=colors.HexColor("#555555"), spaceAfter=10),
    }
    mi = 2.2 * cm
    ancho_util = tam[0] - 2 * mi

    class Doc(BaseDocTemplate):
        def afterFlowable(self, fl):
            if isinstance(fl, Paragraph) and fl.style.name in ("H1", "H2"):
                nivel = 0 if fl.style.name == "H1" else 1
                self.notify("TOCEntry", (nivel, fl.getPlainText(), self.page))

    class Numerado(rl_canvas.Canvas):
        def __init__(self, *a, **k):
            rl_canvas.Canvas.__init__(self, *a, **k)
            self._paginas = []

        def showPage(self):
            self._paginas.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._paginas)
            for estado in self._paginas:
                self.__dict__.update(estado)
                self._decorar(total)
                rl_canvas.Canvas.showPage(self)
            rl_canvas.Canvas.save(self)

        def _decorar(self, total):
            n = self._pageNumber
            if portada and n == 1:
                return
            self.setFont("Helvetica", 8.5)
            self.setFillColor(colors.HexColor("#666666"))
            self.drawString(mi, tam[1] - 1.3 * cm, encabezado)
            self.setStrokeColor(color)
            self.setLineWidth(0.6)
            self.line(mi, tam[1] - 1.5 * cm, tam[0] - mi, tam[1] - 1.5 * cm)
            self.line(mi, 1.6 * cm, tam[0] - mi, 1.6 * cm)
            self.drawString(mi, 1.05 * cm, pie)
            self.drawRightString(tam[0] - mi, 1.05 * cm, "Página %d de %d" % (n, total))

    d = Doc(salida, pagesize=tam, leftMargin=mi, rightMargin=mi, topMargin=2.4 * cm, bottomMargin=2.2 * cm,
            title=titulo, author=doc.get("autor", ""), subject=doc.get("subtitulo", ""))
    d.addPageTemplates([PageTemplate(id="p", frames=[Frame(mi, 2.2 * cm, ancho_util, tam[1] - 4.6 * cm, id="f",
                                                         leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)])])
    hist = []
    if portada:
        pt = ParagraphStyle("pt", parent=base, fontName="Helvetica-Bold", fontSize=30, leading=36, textColor=color)
        ps = ParagraphStyle("ps", parent=base, fontSize=15, leading=20, textColor=colors.HexColor("#555555"))
        pm = ParagraphStyle("pm", parent=base, fontSize=11, leading=16, textColor=colors.HexColor("#333333"))
        hist += [Spacer(1, 6.5 * cm), Paragraph(_inline(titulo), pt), Spacer(1, 0.5 * cm)]
        if doc.get("subtitulo"):
            hist.append(Paragraph(_inline(doc["subtitulo"]), ps))
        hist.append(Spacer(1, 4 * cm))
        if doc.get("autor"):
            hist.append(Paragraph(_inline(doc["autor"]), pm))
        hist.append(Paragraph(_inline(doc.get("fecha") or fecha_larga()), pm))
        hist.append(PageBreak())
    elif doc.get("titulo"):
        pt = ParagraphStyle("pt2", parent=base, fontName="Helvetica-Bold", fontSize=22, leading=27, textColor=color, spaceAfter=4)
        hist.append(Paragraph(_inline(titulo), pt))
        if doc.get("subtitulo"):
            hist.append(Paragraph(_inline(doc["subtitulo"]), ParagraphStyle("s2", parent=base, fontSize=12, textColor=colors.HexColor("#555555"), spaceAfter=4)))
        meta = " · ".join(x for x in [doc.get("autor"), doc.get("fecha") or fecha_larga()] if x)
        hist.append(Paragraph(_inline(meta), ParagraphStyle("m2", parent=base, fontSize=9.5, textColor=colors.HexColor("#777777"), spaceAfter=10)))
    if doc.get("indice"):
        toc = TableOfContents()
        toc.levelStyles = [ParagraphStyle("t0", parent=base, fontName="Helvetica-Bold", leftIndent=0, spaceBefore=4, leading=15),
                           ParagraphStyle("t1", parent=base, leftIndent=16, leading=14)]
        hist += [Paragraph("Índice", est["h1"].clone("IndiceTit")), toc, PageBreak()]

    def celda_num(t):
        return bool(ES_NUM.match(str(t))) and any(ch.isdigit() for ch in str(t))

    for b in doc.get("bloques", []):
        tipo = b.get("tipo")
        if tipo == "titulo":
            hist.append(Paragraph(_inline(b["texto"]), est["h%d" % min(max(int(b.get("nivel", 1)), 1), 3)]))
        elif tipo == "parrafo":
            hist.append(Paragraph(_inline(b["texto"]), est["p"]))
        elif tipo == "lista":
            items = [ListItem(Paragraph(_inline(x), est["p"]), leftIndent=18) for x in b.get("items", [])]
            kw = {"bulletType": "1", "bulletFormat": "%s."} if b.get("ordenada") else {"bulletType": "bullet", "start": "•"}
            hist.append(ListFlowable(items, leftIndent=18, bulletFontName="Helvetica", bulletFontSize=10, **kw))
            hist.append(Spacer(1, 6))
        elif tipo == "tabla":
            enc = b.get("encabezado") or []
            filas = b.get("filas", [])
            ncol = max([len(enc)] + [len(f) for f in filas] or [1])
            numcol = [bool(filas) and all(celda_num(f[j]) for f in filas if j < len(f) and str(f[j]).strip()) and
                      any(j < len(f) and str(f[j]).strip() for f in filas) for j in range(ncol)]
            datos = []
            if enc:
                datos.append([Paragraph(_inline(c), est["cabd" if numcol[j] else "cab"]) for j, c in enumerate(enc)])
            for f in filas:
                f = list(f) + [""] * (ncol - len(f))
                datos.append([Paragraph(_inline(c), est["celd" if numcol[j] else "cel"]) for j, c in enumerate(f)])
            anchos = None
            if b.get("anchos"):
                tot = float(sum(b["anchos"]))
                anchos = [ancho_util * x / tot for x in b["anchos"]]
            t = Table(datos, colWidths=anchos, repeatRows=1 if enc else 0)
            sty = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                   ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                   ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#CCCCCC")),
                   ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#999999"))]
            if enc:
                sty.append(("BACKGROUND", (0, 0), (-1, 0), color))
            for r in range(1 if enc else 0, len(datos)):
                if (r % 2) == 0:
                    sty.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#F2F5F9")))
            t.setStyle(TableStyle(sty))
            t.hAlign = "LEFT"
            hist += [t, Spacer(1, 10)]
        elif tipo == "imagen":
            ruta = b["ruta"] if os.path.isabs(b["ruta"]) else os.path.join(base_dir, b["ruta"])
            if not os.path.isfile(ruta):
                error("la imagen no existe: %s" % ruta)
            from PIL import Image as PI
            with PI.open(ruta) as im:
                w, h = im.size
            ancho = min(float(b.get("ancho_cm", 14)) * cm, ancho_util)
            alto = min(ancho * h / w, 20 * cm)
            ancho = alto * w / h
            bloque = [Image(ruta, width=ancho, height=alto)]
            if b.get("pie"):
                bloque.append(Spacer(1, 3))
                bloque.append(Paragraph(_inline(b["pie"]), est["pie"]))
            hist.append(KeepTogether(bloque))
        elif tipo == "salto":
            hist.append(PageBreak())
        else:
            error("tipo de bloque desconocido: %r (usa titulo, parrafo, lista, tabla, imagen, salto)" % tipo)

    exigir_salida_nueva(salida)
    d.multiBuild(hist, canvasmaker=Numerado)


def main():
    ap = argparse.ArgumentParser(
        description="Crea un PDF desde JSON o Markdown. Ejemplo: build_pdf.py contenido.json -o informe.pdf",
        epilog="JSON: {titulo, subtitulo, autor, fecha, portada:bool, indice:bool, encabezado, pie, pagina:'A4'|'carta', color:'#1F3A5F',\n"
               "  bloques:[{tipo:'titulo',nivel:1,texto}, {tipo:'parrafo',texto}, {tipo:'lista',ordenada:false,items:[..]},\n"
               "  {tipo:'tabla',encabezado:[..],filas:[[..]],anchos:[3,1,1]}, {tipo:'imagen',ruta,ancho_cm,pie}, {tipo:'salto'}]}\n"
               "Texto admite **negrita** y *cursiva*. Markdown: # título del doc, ##/### secciones, listas, tablas |, ![pie](ruta), --- salto.",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrada", help="archivo .json o .md")
    ap.add_argument("-o", "--salida", required=True, help="PDF de salida (nuevo)")
    ap.add_argument("--portada", action="store_true")
    ap.add_argument("--indice", action="store_true")
    ap.add_argument("--autor")
    ap.add_argument("--pie")
    a = ap.parse_args()
    exigir_entrada(a.entrada)
    try:
        with open(a.entrada, encoding="utf-8") as f:
            txt = f.read()
        doc = json.loads(txt) if a.entrada.lower().endswith(".json") else parsear_markdown(txt)
    except ValueError as e:
        error("el JSON no es válido: %s" % e)
    for k in ("portada", "indice"):
        if getattr(a, k):
            doc[k] = True
    if a.autor:
        doc["autor"] = a.autor
    if a.pie:
        doc["pie"] = a.pie
    construir(doc, a.salida, os.path.dirname(os.path.abspath(a.entrada)))
    print("Listo: %s" % a.salida)


if __name__ == "__main__":
    main()
