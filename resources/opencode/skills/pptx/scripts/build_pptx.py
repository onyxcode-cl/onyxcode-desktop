#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crea una presentación 16:9 profesional (.pptx) desde un JSON.

Uso:  build_pptx.py spec.json salida.pptx [--theme sobrio|oscuro|claro] [--json]
Tipos de diapositiva: cover, section, bullets, two_col, image_text, table, chart, quote, stat, closing.
"""
from __future__ import annotations

import argparse
import io
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pptx_common import fit_font, text_height_in  # noqa: E402

try:
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData
    from pptx.dml.color import RGBColor
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.oxml.ns import qn
    from pptx.util import Emu, Inches, Pt
    from lxml import etree
except ImportError as e:  # pragma: no cover
    print("Falta una librería de Python (%s). Ejecuta _shared/doctor.py para ver qué instalar." % e)
    sys.exit(2)

SW, SH = 13.333, 7.5      # lienzo 16:9 en pulgadas
M = 0.7                   # margen lateral
TITLE_TOP, TITLE_H = 0.45, 1.0
BODY_TOP, BODY_BOTTOM = 1.75, 6.75
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]

with open(os.path.join(os.path.dirname(__file__), "..", "themes", "native.json"), encoding="utf-8") as f:
    THEMES = json.load(f)


def rgb(h):
    return RGBColor.from_string(h)


def fecha_es(d=None):
    d = d or datetime.date.today()
    return "%d de %s de %d" % (d.day, MESES[d.month - 1], d.year)


class Builder:
    def __init__(self, spec, base_dir, theme_name):
        self.spec = spec
        self.base = base_dir
        self.t = dict(THEMES[theme_name])
        self.theme_name = theme_name
        self.prs = Presentation()
        self.prs.slide_width = Inches(SW)
        self.prs.slide_height = Inches(SH)
        self._theme_and_layouts()
        self.numbers = spec.get("slide_numbers", True)
        self.footer = spec.get("footer", "")
        self.warnings = []

    def _theme_and_layouts(self):
        """Tema Office real y diseños reutilizables; sin fabricar relaciones del ZIP."""
        theme = next(r.target_part for r in self.prs.slide_master.part.rels.values() if r.reltype.endswith("/theme"))
        root = etree.fromstring(theme.blob)
        colors = root.find(".//" + qn("a:clrScheme"))
        values = dict(dk1=self.t["fg"], lt1=self.t["bg"], dk2=self.t["cover_bg"], lt2=self.t["soft"])
        values.update({"accent%d" % (i + 1): c for i, c in enumerate(self.t["palette"])})
        for key, val in values.items():
            node = colors.find(qn("a:" + key))
            for c in list(node):
                node.remove(c)
            etree.SubElement(node, qn("a:srgbClr")).set("val", val)
        for kind in ("majorFont", "minorFont"):
            root.find(".//" + qn("a:" + kind) + "/" + qn("a:latin")).set("typeface", self.t["font"])
        theme._blob = etree.tostring(root)
        for idx in (0, 1, 2, 3, 5):
            layout = self.prs.slide_layouts[idx]
            dark = idx in (0, 2)
            layout.background.fill.solid()
            layout.background.fill.fore_color.rgb = rgb(self.t["cover_bg"] if dark else self.t["bg"])
            for ph in layout.placeholders:
                typ = str(ph.placeholder_format.type)
                title = "TITLE" in typ
                if typ.startswith(("DATE", "FOOTER", "SLIDE_NUMBER")):
                    continue
                if title:
                    box = (1, 2 if idx == 0 else 2.3, SW-2, 2) if dark else (M, TITLE_TOP, SW-2*M, TITLE_H)
                elif dark:
                    box = (1, 4.45 if idx == 0 else 4.7, SW-2, 1.1)
                elif idx == 3:
                    cw = (SW - 2*M - .6)/2
                    box = (M + (ph.placeholder_format.idx - 1)*(cw + .6), BODY_TOP, cw, BODY_BOTTOM-BODY_TOP)
                else:
                    box = (M, BODY_TOP, SW - 2*M, BODY_BOTTOM-BODY_TOP)
                ph.left, ph.top, ph.width, ph.height = [Inches(v) for v in box]
                if ph.has_text_frame:
                    for para in ph.text_frame.paragraphs:
                        para.font.name = self.t["font"]
                        para.font.size = Pt((54 if idx == 0 else 48) if dark and title else 36 if title else 24)
                        para.font.color.rgb = rgb((self.t["cover_fg"] if title else self.t["cover_sub"]) if dark else self.t["fg"])

    def content_box(self, slide, l, t, w, h):
        """Usa los marcadores del diseño antes de agregar cajas libres."""
        for ph in slide.placeholders:
            if ph != slide.shapes.title and not ph.text.strip():
                ph.left, ph.top, ph.width, ph.height = [Inches(v) for v in (l, t, w, h)]
                return ph
        return slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))

    # ---------- utilidades de texto ----------
    def _style_run(self, run, size, color, bold=False, italic=False):
        f = run.font
        f.name = self.t["font"]
        f.size = Pt(size)
        f.bold = bold
        f.italic = italic
        f._rPr.set("cap", "none")
        f.color.rgb = rgb(color)

    def textbox(self, slide, l, t, w, h, text, size, color=None, bold=False, italic=False,
                align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, content=False):
        tb = self.content_box(slide, l, t, w, h) if content else slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
        tb.text_frame.clear()
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        tf.vertical_anchor = anchor
        parts = str(text).split("\n")
        for i, part in enumerate(parts):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            p.line_spacing = 1.2
            etree.SubElement(p._p.get_or_add_pPr(), qn("a:buNone"))
            r = p.add_run()
            r.text = part
            self._style_run(r, size, color or self.t["fg"], bold, italic)
        return tb

    def set_title(self, slide, text, l=M, t=TITLE_TOP, w=SW - 2 * M, h=TITLE_H, max_pt=36, min_pt=28,
                  color=None, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE, italic=False):
        pt, ok = fit_font(text, w, h, max_pt, min_pt)
        if not ok:
            self.warnings.append("Título demasiado largo, acórtalo: «%s»" % text[:60])
        ph = slide.shapes.title
        ph.left, ph.top, ph.width, ph.height = Inches(l), Inches(t), Inches(w), Inches(h)
        tf = ph.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        tf.vertical_anchor = anchor
        tf.text = text
        p = tf.paragraphs[0]
        p.alignment = align
        self._style_run(p.runs[0], pt, color or self.t["fg"], bold=not italic, italic=italic)
        return ph

    def rect(self, slide, l, t, w, h, color):
        s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(h))
        s.fill.solid()
        s.fill.fore_color.rgb = rgb(color)
        s.line.fill.background()
        s.shadow.inherit = False
        return s

    def bullets_frame(self, slide, l, t, w, h, items, pt):
        """items: lista de (texto, nivel). Escribe viñetas reales con sangría."""
        tb = self.content_box(slide, l, t, w, h)
        tf = tb.text_frame
        tf.clear()
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        for i, (text, lvl) in enumerate(items):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            size = pt if lvl == 0 else max(18, round(pt * 0.85))
            p.space_after = Pt(round(pt * 0.5))
            p.line_spacing = 1.2
            pPr = p._p.get_or_add_pPr()
            pPr.set("marL", str(int(Inches(0.32 + 0.35 * lvl))))
            pPr.set("indent", str(-int(Inches(0.32))))
            clr = etree.SubElement(pPr, qn("a:buClr"))
            sc = etree.SubElement(clr, qn("a:srgbClr"))
            sc.set("val", self.t["accent"] if lvl == 0 else self.t["muted"])
            bu = etree.SubElement(pPr, qn("a:buChar"))
            bu.set("char", "•" if lvl == 0 else "–")
            r = p.add_run()
            r.text = text
            self._style_run(r, size, self.t["fg"] if lvl == 0 else self.t["muted"])
        return tb

    @staticmethod
    def flatten(bullets):
        out = []
        for b in bullets or []:
            if isinstance(b, dict):
                out.append((str(b.get("text", "")), 0))
                for s in b.get("sub", []) or []:
                    out.append((str(s), 1))
            else:
                out.append((str(b), 0))
        return out

    def item_height(self, text, lvl, pt, w):
        size = pt if lvl == 0 else max(18, round(pt * 0.85))
        indent = 0.32 + 0.35 * lvl
        return text_height_in(text, size, w - indent, space_after_pt=round(pt * 0.5))

    def total_height(self, items, pt, w):
        return sum(self.item_height(tx, lv, pt, w) for tx, lv in items)

    def fit_items(self, items, w, h, max_pt=28, min_pt=18):
        for pt in range(max_pt, min_pt - 1, -1):
            if self.total_height(items, pt, w) <= h:
                return pt, True
        return min_pt, False

    def split_items(self, items, w, h, min_pt=20):
        """Reparte las viñetas en varias diapositivas si no caben a un tamaño legible."""
        if self.fit_items(items, w, h, 26, min_pt)[1]:
            return [items]
        chunks, cur = [], []
        for it in items:
            trial = cur + [it]
            if cur and not self.fit_items(trial, w, h, min_pt, min_pt)[1] and it[1] == 0:
                chunks.append(cur)
                cur = [it]
            else:
                cur = trial
        if cur:
            chunks.append(cur)
        return chunks

    # ---------- marco común ----------
    def new_slide(self, notes=None, dark_cover=False, layout=5):
        s = self.prs.slides.add_slide(self.prs.slide_layouts[layout])
        s.background.fill.solid()
        s.background.fill.fore_color.rgb = rgb(self.t["cover_bg"] if dark_cover else self.t["bg"])
        if notes:
            s.notes_slide.notes_text_frame.text = str(notes)
        return s

    def chrome(self, slide, title, title_color=None):
        self.set_title(slide, title, color=title_color)
        self.rect(slide, 0, 0, SW, 0.08, self.t["accent"])
        self.rect(slide, M, TITLE_TOP + TITLE_H + 0.08, 1.2, 0.06, self.t["accent2"])
        if self.footer:
            self.textbox(slide, M, 7.0, 8, 0.25, self.footer, 11, self.t["muted"])
        if self.numbers:
            self.add_slide_number(slide)

    def add_slide_number(self, slide):
        tb = self.textbox(slide, SW - M - 1.0, 7.0, 1.0, 0.25, "", 11, self.t["muted"], align=PP_ALIGN.RIGHT)
        p = tb.text_frame.paragraphs[0]
        for r in list(p._p.findall(qn("a:r"))):
            p._p.remove(r)
        fld = etree.SubElement(p._p, qn("a:fld"))
        fld.set("id", "{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}")
        fld.set("type", "slidenum")
        rpr = etree.SubElement(fld, qn("a:rPr"))
        rpr.set("lang", "es-CL")
        rpr.set("sz", "1100")
        fill = etree.SubElement(rpr, qn("a:solidFill"))
        etree.SubElement(fill, qn("a:srgbClr")).set("val", self.t["muted"])
        etree.SubElement(rpr, qn("a:latin")).set("typeface", self.t["font"])
        etree.SubElement(fld, qn("a:t")).text = str(len(self.prs.slides))
        # el campo debe ir antes de a:endParaRPr si existe
        end = p._p.find(qn("a:endParaRPr"))
        if end is not None:
            p._p.remove(end)
            p._p.append(end)

    # ---------- tipos de diapositiva ----------
    def s_cover(self, d):
        s = self.new_slide(d.get("notes"), dark_cover=True, layout=0)
        t = self.t
        self.rect(s, 0, 0, 0.35, SH, t["accent2"])
        self.set_title(s, d.get("title", "Presentación"), l=1.0, t=2.0, w=SW - 2.0, h=2.0, max_pt=54, min_pt=30,
                       color=t["cover_fg"], anchor=MSO_ANCHOR.BOTTOM)
        self.rect(s, 1.0, 4.2, 1.2, 0.07, t["accent2"])
        if d.get("subtitle"):
            sub = d["subtitle"]
            pt, _ = fit_font(sub, SW - 2.0, 1.0, 26, 16)
            self.textbox(s, 1.0, 4.45, SW - 2.0, 1.0, sub, pt, t["cover_sub"], content=True)
        meta = " · ".join([x for x in [d.get("author"), self._date(d.get("date"))] if x])
        if meta:
            self.textbox(s, 1.0, 6.4, SW - 2.0, 0.4, meta, 16, t["cover_sub"])
        return s

    def _date(self, v):
        if not v:
            return ""
        return fecha_es() if v == "auto" else str(v)

    def s_closing(self, d):
        s = self.new_slide(d.get("notes"), dark_cover=True, layout=0)
        t = self.t
        self.rect(s, 0, 0, 0.35, SH, t["accent2"])
        self.set_title(s, d.get("title", "Gracias"), l=1.0, t=2.4, w=SW - 2.0, h=1.6, max_pt=54, min_pt=30,
                       color=t["cover_fg"], anchor=MSO_ANCHOR.BOTTOM)
        self.rect(s, 1.0, 4.2, 1.2, 0.07, t["accent2"])
        if d.get("subtitle"):
            self.textbox(s, 1.0, 4.45, SW - 2.0, 1.5, d["subtitle"], 22, t["cover_sub"], content=True)
        return s

    def s_bullets(self, d):
        items = self.flatten(d.get("bullets"))
        w, h = SW - 2 * M, BODY_BOTTOM - BODY_TOP
        chunks = self.split_items(items, w, h) if items else [[]]
        base = d.get("title", "")
        out = None
        for i, ch in enumerate(chunks):
            title = base if len(chunks) == 1 else "%s (%d/%d)" % (base, i + 1, len(chunks))
            s = self.new_slide(d.get("notes"), layout=1)
            self.chrome(s, title)
            if ch:
                pt, ok = self.fit_items(ch, w, h, 34 if len(ch) <= 4 else 28, 18)
                if not ok:
                    self.warnings.append("Viñetas muy largas en «%s»: divide el texto" % base[:50])
                used = self.total_height(ch, pt, w)
                top = BODY_TOP + max(0, (h - used) * .35)
                self.bullets_frame(s, M, top, w, BODY_BOTTOM-top, ch, pt)
            out = out or s
        return out

    def s_two_col(self, d):
        s = self.new_slide(d.get("notes"), layout=3)
        self.chrome(s, d.get("title", ""))
        gap = 0.5
        cw = (SW - 2 * M - gap) / 2
        for i, key in enumerate(("left", "right")):
            col = d.get(key) or {}
            x = M + i * (cw + gap)
            top = BODY_TOP
            if col.get("heading"):
                self.rect(s, x, top + .62, cw, .025, self.t["accent2"])
                self.textbox(s, x, top, cw, 0.6, col["heading"], 26, self.t["accent"], bold=True,
                             anchor=MSO_ANCHOR.MIDDLE)
                top += 0.95
            items = self.flatten(col.get("bullets"))
            if col.get("text") and not items:
                items = [(col["text"], -1)]
            h = BODY_BOTTOM - top
            if items:
                pt, ok = self.fit_items([(a, max(b, 0)) for a, b in items], cw, h, 30 if len(items) <= 3 else 26, 18)
                if not ok:
                    self.warnings.append("Columna «%s» muy larga en «%s»" % (key, d.get("title", "")[:40]))
                if items[0][1] == -1:
                    self.textbox(s, x, top, cw, h, items[0][0], pt, content=True)
                else:
                    self.bullets_frame(s, x, top, cw, h, items, pt)
        return s

    def _picture(self, slide, path, l, t, w, h):
        from PIL import Image
        p = path if os.path.isabs(path) else os.path.join(self.base, path)
        if not os.path.exists(p):
            raise FileNotFoundError("la imagen no existe: %s" % p)
        with Image.open(p) as im:
            iw, ih = im.size
        scale = min(w / iw, h / ih)
        pw, ph = iw * scale, ih * scale
        return slide.shapes.add_picture(p, Inches(l + (w - pw) / 2), Inches(t + (h - ph) / 2), Inches(pw), Inches(ph))

    def s_image_text(self, d):
        s = self.new_slide(d.get("notes"))
        self.chrome(s, d.get("title", ""))
        gap = 0.5
        iw = 6.0
        tw = SW - 2 * M - iw - gap
        h = BODY_BOTTOM - BODY_TOP - (0.4 if d.get("caption") else 0)
        left_img = d.get("image_side", "left") == "left"
        ix = M if left_img else M + tw + gap
        tx = M + iw + gap if left_img else M
        self._picture(s, d["image"], ix, BODY_TOP, iw, h)
        items = self.flatten(d.get("bullets"))
        if d.get("text") and not items:
            pt, _ = fit_font(d["text"], tw, h, 24, 18)
            self.textbox(s, tx, BODY_TOP, tw, h, d["text"], pt, content=True)
        elif items:
            pt, ok = self.fit_items(items, tw, h, 24, 18)
            if not ok:
                self.warnings.append("Texto largo junto a la imagen en «%s»" % d.get("title", "")[:40])
            self.bullets_frame(s, tx, BODY_TOP, tw, h, items, pt)
        if d.get("caption"):
            self.textbox(s, ix, BODY_BOTTOM + 0.05, iw, 0.3, d["caption"], 11, self.t["muted"], italic=True)
        return s

    @staticmethod
    def _is_num(v):
        v = str(v).strip().replace(".", "").replace(",", ".").replace("%", "").replace("$", "").replace(" ", "")
        try:
            float(v)
            return True
        except ValueError:
            return False

    def s_table(self, d):
        cols = [str(c) for c in d.get("columns", [])]
        rows = [[str(c) for c in r] for r in d.get("rows", [])]
        if not cols:
            raise ValueError("la tabla necesita 'columns'")
        per = d.get("rows_per_slide", 7)
        pages = [rows[i:i + per] for i in range(0, len(rows), per)] or [[]]
        first = None
        for pi, page in enumerate(pages):
            title = d.get("title", "") if len(pages) == 1 else "%s (%d/%d)" % (d.get("title", ""), pi + 1, len(pages))
            s = self.new_slide(d.get("notes"))
            self.chrome(s, title)
            w = SW - 2 * M
            n = len(page) + 1
            rh = min(1.15, (BODY_BOTTOM - BODY_TOP) / n)
            pt = 24 if n <= 4 and len(cols) <= 4 else 20 if n <= 7 else 18
            gf = s.shapes.add_table(n, len(cols), Inches(M), Inches(BODY_TOP), Inches(w), Inches(rh * n))
            tbl = gf.table
            weights = [max(len(c), max([len(r[i]) if i < len(r) else 0 for r in page] or [0]), 4) for i, c in enumerate(cols)]
            tot = float(sum(weights))
            for i, wt in enumerate(weights):
                tbl.columns[i].width = Inches(w * wt / tot)
            heights = []
            for ri in range(n):
                texts = cols if ri == 0 else page[ri-1]
                need = max(text_height_in(texts[ci] if ci < len(texts) else "", pt,
                           Emu(tbl.columns[ci].width).inches - .24) + .16 for ci in range(len(cols)))
                heights.append(max(.8 if n <= 4 else .55, need))
            if sum(heights) > BODY_BOTTOM - BODY_TOP:
                raise ValueError("la tabla no cabe a 18 pt; reduce rows_per_slide o divide sus columnas")
            scale = max(1, min(1.6, (BODY_BOTTOM-BODY_TOP)/sum(heights)))
            for r, height in zip(tbl.rows, heights):
                r.height = Inches(height * scale)
            for ri in range(n):
                for ci in range(len(cols)):
                    cell = tbl.cell(ri, ci)
                    txt = cols[ci] if ri == 0 else (page[ri - 1][ci] if ci < len(page[ri - 1]) else "")
                    cell.fill.solid()
                    if ri == 0:
                        cell.fill.fore_color.rgb = rgb(self.t["cover_bg"])
                    else:
                        cell.fill.fore_color.rgb = rgb(self.t["soft"] if ri % 2 == 0 else self.t["bg"])
                    cell.margin_left = cell.margin_right = Inches(0.12)
                    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
                    tf = cell.text_frame
                    tf.word_wrap = True
                    tf.text = txt
                    p = tf.paragraphs[0]
                    numeric = ri > 0 and self._is_num(txt)
                    p.alignment = PP_ALIGN.RIGHT if numeric or (ri == 0 and self._col_numeric(page, ci)) else PP_ALIGN.LEFT
                    if p.runs:
                        self._style_run(p.runs[0], pt, self.t["cover_fg"] if ri == 0 else self.t["fg"], bold=(ri == 0))
            first = first or s
        return first

    def _col_numeric(self, page, ci):
        vals = [r[ci] for r in page if ci < len(r) and r[ci].strip()]
        return bool(vals) and all(self._is_num(v) for v in vals)

    def s_chart(self, d):
        s = self.new_slide(d.get("notes"))
        self.chrome(s, d.get("title", ""))
        kind = d.get("chart_type", "bar")
        types = {"bar": XL_CHART_TYPE.COLUMN_CLUSTERED, "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
                 "hbar": XL_CHART_TYPE.BAR_CLUSTERED, "line": XL_CHART_TYPE.LINE_MARKERS,
                 "pie": XL_CHART_TYPE.PIE}
        if kind not in types:
            raise ValueError("chart_type debe ser bar, hbar, line o pie (recibí «%s»)" % kind)
        cd = CategoryChartData()
        cd.categories = [str(c) for c in d.get("categories", [])]
        series = d.get("series", [])
        if not series:
            raise ValueError("el gráfico necesita 'series'")
        for se in series:
            vals = [float(v) for v in se["values"]]
            if len(vals) != len(cd.categories):
                raise ValueError("la serie «%s» tiene %d valores y hay %d categorías" % (se.get("name"), len(vals), len(cd.categories)))
            cd.add_series(se.get("name", "Serie"), vals)
        h = BODY_BOTTOM - BODY_TOP - (0.4 if d.get("caption") else 0)
        gf = s.shapes.add_chart(types[kind], Inches(M), Inches(BODY_TOP), Inches(SW - 2 * M), Inches(h), cd)
        ch = gf.chart
        ch.font.size = Pt(16)
        ch.font.name = self.t["font"]
        ch.font.color.rgb = rgb(self.t["fg"])
        ch.has_title = False
        pal = self.t["palette"]
        plot = ch.plots[0]
        if kind == "pie":
            ch.has_legend = True
            ch.legend.position = XL_LEGEND_POSITION.RIGHT
            ch.legend.include_in_layout = False
            plot.has_data_labels = True
            plot.data_labels.number_format = '0.0%' if d.get("percent", True) else 'General'
            plot.data_labels.number_format_is_linked = False
            plot.data_labels.show_percentage = d.get("percent", True)
            plot.data_labels.show_value = not d.get("percent", True)
            plot.data_labels.font.size = Pt(14)
            plot.data_labels.font.color.rgb = rgb(self.t["fg"])
            from pptx.enum.chart import XL_DATA_LABEL_POSITION
            plot.data_labels.position = XL_DATA_LABEL_POSITION.OUTSIDE_END
            for i in range(len(cd.categories)):
                pt = plot.series[0].points[i]
                pt.format.fill.solid()
                pt.format.fill.fore_color.rgb = rgb(pal[i % len(pal)])
        else:
            multi = len(series) > 1
            ch.has_legend = multi
            if multi:
                ch.legend.position = XL_LEGEND_POSITION.BOTTOM
                ch.legend.include_in_layout = False
            for i, ser in enumerate(plot.series):
                col = rgb(pal[i % len(pal)])
                if kind == "line":
                    ser.format.line.color.rgb = col
                    ser.format.line.width = Pt(3)
                    ser.smooth = False
                    ser.marker.format.fill.solid()
                    ser.marker.format.fill.fore_color.rgb = col
                else:
                    ser.format.fill.solid()
                    ser.format.fill.fore_color.rgb = col
            if kind != "line" and not (len(series) > 1):
                plot.gap_width = 80
            if len(series) == 1 and len(cd.categories) <= 12:
                plot.has_data_labels = True
                plot.data_labels.font.size = Pt(14)
                plot.data_labels.font.color.rgb = rgb(self.t["fg"])
                if "number_format" in d:
                    plot.data_labels.number_format = d["number_format"]
                    plot.data_labels.number_format_is_linked = False
            va = ch.value_axis
            va.major_gridlines.format.line.color.rgb = rgb(self.t["soft"] if self.theme_name != "oscuro" else "3A4150")
            va.format.line.fill.background()
            if d.get("y_title"):
                va.has_title = True
                va.axis_title.text_frame.text = d["y_title"]
                va.axis_title.text_frame.paragraphs[0].runs[0].font.size = Pt(14)
                va.axis_title.text_frame.paragraphs[0].runs[0].font.color.rgb = rgb(self.t["muted"])
        if d.get("caption"):
            self.textbox(s, M, BODY_BOTTOM - 0.3, SW - 2 * M, 0.3, d["caption"], 12, self.t["muted"], italic=True)
        return s

    def s_quote(self, d):
        s = self.new_slide(d.get("notes"))
        t = self.t
        text = d.get("text", d.get("title", ""))
        self.rect(s, M, 1.6, 0.12, 3.6, t["accent2"])
        self.set_title(s, "«%s»" % text, l=M + 0.6, t=1.4, w=SW - 2 * M - 1.2, h=4.0, max_pt=40, min_pt=22,
                       color=t["fg"], anchor=MSO_ANCHOR.MIDDLE, italic=True)
        if d.get("author"):
            self.textbox(s, M + 0.6, 5.6, SW - 2 * M - 1.2, 0.5, "— " + d["author"], 20, t["accent"], bold=True)
        if self.numbers:
            self.add_slide_number(s)
        return s

    def s_stat(self, d):
        s = self.new_slide(d.get("notes"))
        t = self.t
        self.chrome(s, d.get("title", d.get("label", "")))
        val = str(d.get("value", ""))
        pt, _ = fit_font(val, SW - 2 * M, 2.4, 110, 48)
        self.rect(s, M, 2.0, SW - 2*M, 2.6, t["soft"])
        self.textbox(s, M, 2.1, SW - 2 * M, 2.4, val, pt, t["accent"], bold=True, align=PP_ALIGN.CENTER,
                     anchor=MSO_ANCHOR.MIDDLE)
        if d.get("label"):
            self.textbox(s, M, 4.7, SW - 2 * M, 0.6, d["label"], 26, t["fg"], align=PP_ALIGN.CENTER)
        if d.get("text"):
            pt2, _ = fit_font(d["text"], 9.5, 1.0, 22, 18)
            self.textbox(s, (SW - 9.5) / 2, 5.5, 9.5, 1.0, d["text"], pt2, t["muted"], align=PP_ALIGN.CENTER)
        return s

    def s_content(self, d):
        s = self.new_slide(d.get("notes"), layout=1)
        self.chrome(s, d["title"])
        text = d.get("text", "")
        w, h = SW-2*M, BODY_BOTTOM-BODY_TOP
        pt, ok = fit_font(text, w, h, 32, 18)
        if not ok:
            raise ValueError("el contenido no cabe a 18 pt; divide la diapositiva")
        self.textbox(s, M, BODY_TOP, w, h, text, pt, content=True)
        return s

    def s_section(self, d):
        s = self.new_slide(d.get("notes"), dark_cover=True, layout=2)
        self.rect(s, 0, 0, .35, SH, self.t["accent2"])
        if d.get("eyebrow"):
            self.textbox(s, 1, 1.3, 11.3, .6, d["eyebrow"], 22, self.t["cover_sub"])
        self.set_title(s, d["title"], l=1, t=2.3, w=11.3, h=2.0, max_pt=48, min_pt=32, color=self.t["cover_fg"])
        if d.get("subtitle"):
            self.textbox(s, 1, 4.7, 11.3, 1.1, d["subtitle"], 24, self.t["cover_sub"], content=True)
        return s

    def build(self):
        kinds = {"cover": self.s_cover, "section": self.s_section, "content": self.s_content, "bullets": self.s_bullets, "two_col": self.s_two_col,
                 "image_text": self.s_image_text, "table": self.s_table, "chart": self.s_chart,
                 "quote": self.s_quote, "stat": self.s_stat, "closing": self.s_closing}
        slides = self.spec.get("slides")
        if not slides:
            raise ValueError("el JSON necesita una lista 'slides' con al menos una diapositiva")
        for i, d in enumerate(slides, 1):
            k = d.get("type")
            if k is None:
                k = ("chart" if d.get("series") and d.get("categories") else
                     "table" if d.get("columns") else "two_col" if d.get("left") or d.get("right") else
                     "stat" if "value" in d else "image_text" if d.get("image") else
                     "cover" if i == 1 and d.get("subtitle") else "bullets" if d.get("bullets") else
                     "content" if d.get("text") else "section")
            if k not in kinds:
                raise ValueError("diapositiva %d: tipo «%s» desconocido (usa: %s)" % (i, k, ", ".join(kinds)))
            if k not in ("cover", "closing", "quote") and not str(d.get("title", "")).strip():
                raise ValueError("diapositiva %d: necesita un título" % i)
            if k == "bullets" and not any(tx.strip() for tx, _ in self.flatten(d.get("bullets"))):
                raise ValueError("diapositiva %d: no tiene contenido; usa section para un separador" % i)
            try:
                kinds[k](d)
            except KeyError as e:
                raise ValueError("diapositiva %d (%s): falta el campo %s" % (i, k, e))
        # No dejar los marcadores opcionales del diseño sin contenido.
        for slide in self.prs.slides:
            for ph in list(slide.placeholders):
                if ph.has_text_frame and not ph.text.strip():
                    ph._element.getparent().remove(ph._element)
        cp = self.prs.core_properties
        cp.title = self.spec.get("title", "")
        cp.author = self.spec.get("author", "")
        return self.prs


def main(argv=None):
    ap = argparse.ArgumentParser(description="Crea una presentación .pptx 16:9 desde un JSON (ver SKILL.md).")
    ap.add_argument("spec", help="archivo JSON con la descripción")
    ap.add_argument("salida", help="archivo .pptx a crear (debe ser nuevo)")
    ap.add_argument("--theme", choices=sorted(THEMES), help="tema (por defecto el del JSON o 'sobrio')")
    ap.add_argument("--json", action="store_true", help="imprime el resultado como JSON")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.spec):
        print("Error: el archivo JSON no existe: %s" % a.spec)
        return 1
    if os.path.exists(a.salida):
        print("Error: ya existe %s; usa un nombre nuevo (p. ej. -v2)." % a.salida)
        return 1
    try:
        with open(a.spec, encoding="utf-8") as f:
            spec = json.load(f)
        theme = a.theme or spec.get("theme", "sobrio")
        if theme not in THEMES:
            raise ValueError("tema desconocido «%s» (usa: %s)" % (theme, ", ".join(THEMES)))
        b = Builder(spec, os.path.dirname(os.path.abspath(a.spec)), theme)
        prs = b.build()
        buf = io.BytesIO()
        prs.save(buf)
        from check_pptx import check
        _, problems, _ = check(io.BytesIO(buf.getvalue()))
        if problems:
            raise ValueError("; ".join(problems))
        with open(a.salida, "xb") as out:
            out.write(buf.getvalue())
    except (ValueError, OSError, json.JSONDecodeError) as e:
        print("Error: %s" % e)
        return 1
    res = {"ok": True, "archivo": a.salida, "diapositivas": len(prs.slides), "tema": theme, "avisos": b.warnings}
    if a.json:
        print(json.dumps(res, ensure_ascii=False))
    else:
        print("Presentación creada: %s (%d diapositivas, tema %s)" % (a.salida, len(prs.slides), theme))
        for w in b.warnings:
            print("  Aviso: " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
