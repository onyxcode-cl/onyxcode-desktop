"""Utilidades compartidas por los scripts de la skill docx (python-docx + lxml)."""
from __future__ import annotations

import copy
import datetime
import os
import re

from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

DEFAULT_THEME = {
    "font": "Calibri",
    "size": 11,
    "color": "262626",        # texto
    "accent": "1F3864",       # títulos y encabezado de tabla (azul marino sobrio)
    "table_header_bg": "1F3864",
    "table_header_fg": "FFFFFF",
    "total_bg": "E7E9EE",
    "zebra_bg": "F5F6F8",
    "border": "BFC4CC",
    "line_spacing": 1.15,
    "space_after_pt": 6,
}

ALIGN = {"left": WD_ALIGN_PARAGRAPH.LEFT, "right": WD_ALIGN_PARAGRAPH.RIGHT,
         "center": WD_ALIGN_PARAGRAPH.CENTER, "justify": WD_ALIGN_PARAGRAPH.JUSTIFY}

NUM_RE = re.compile(r"^[\s$€£]*[-+(]?\s*[$€£]?\s*\d[\d.,\s]*%?\)?\s*(CLP|UF|USD|EUR|UTM)?\s*$")


def fecha_es(d=None):
    d = d or datetime.date.today()
    return "%d de %s de %d" % (d.day, MESES[d.month - 1], d.year)


def fmt_num(v, decimals=None):
    """Formato es-CL: 1.234,5."""
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, int):
        s = "{:,}".format(v).replace(",", ".")
        if decimals:
            s += "," + "0" * decimals
        return s
    if isinstance(v, float):
        d = decimals if decimals is not None else (0 if v == int(v) else 2)
        s = "{:,.{d}f}".format(v, d=d)
        return s.replace(",", "X").replace(".", ",").replace("X", ".")
    return str(v)


def looks_numeric(s):
    return bool(NUM_RE.match(s)) and any(c.isdigit() for c in s)


def hex_color(h):
    h = h.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def set_run_font(rpr_owner_font, name):
    """Fija la tipografía en una `w:rFonts` quitando referencias a tema."""
    rf = rpr_owner_font
    for att in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
        k = qn("w:" + att)
        if k in rf.attrib:
            del rf.attrib[k]
    for att in ("ascii", "hAnsi", "eastAsia", "cs"):
        rf.set(qn("w:" + att), name)


def style_font(style, name=None, size=None, color=None, bold=None, italic=None):
    f = style.font
    if name:
        f.name = name
        rpr = style.element.get_or_add_rPr()
        rf = rpr.find(qn("w:rFonts"))
        if rf is None:
            rf = OxmlElement("w:rFonts")
            rpr.insert(0, rf)
        set_run_font(rf, name)
    if size:
        f.size = Pt(size)
    if color:
        f.color.rgb = hex_color(color)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic


def _set_lang(styles_el, lang="es-CL"):
    dd = styles_el.find(qn("w:docDefaults"))
    if dd is None:
        return
    rpr = dd.find(qn("w:rPrDefault") + "/" + qn("w:rPr"))
    if rpr is None:
        return
    lg = rpr.find(qn("w:lang"))
    if lg is None:
        lg = OxmlElement("w:lang")
        rpr.append(lg)
    lg.set(qn("w:val"), lang)
    lg.set(qn("w:eastAsia"), lang)


def apply_theme(doc, theme):
    t = dict(DEFAULT_THEME)
    t.update(theme or {})
    st = doc.styles
    fnt, sz, acc = t["font"], t["size"], t["accent"]
    style_font(st["Normal"], fnt, sz, t["color"])
    pf = st["Normal"].paragraph_format
    pf.space_after = Pt(t["space_after_pt"])
    pf.line_spacing = t["line_spacing"]
    spec = {  # estilo: (tamaño, color, negrita, antes, después)
        "Title": (26, acc, True, 0, 6),
        "Subtitle": (14, "595959", False, 0, 14),
        "Heading 1": (18, acc, True, 18, 6),
        "Heading 2": (14, acc, True, 14, 4),
        "Heading 3": (12, "404040", True, 10, 3),
    }
    for name, (s, c, b, before, after) in spec.items():
        try:
            style = st[name]
        except KeyError:
            continue
        style_font(style, fnt, s, c, b, False if name == "Subtitle" else None)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        if name == "Title":
            # quitar la línea inferior del Title de la plantilla por defecto
            ppr = style.element.get_or_add_pPr()
            for b_ in ppr.findall(qn("w:pBdr")):
                ppr.remove(b_)
    for name in ("List Bullet", "List Bullet 2", "List Number", "List Number 2"):
        try:
            style_font(st[name], fnt, sz, t["color"])
            st[name].paragraph_format.space_after = Pt(3)
        except KeyError:
            pass
    try:
        style_font(st["Caption"], fnt, 9, "595959", False, True)
        st["Caption"].paragraph_format.space_before = Pt(4)
        st["Caption"].paragraph_format.space_after = Pt(10)
    except KeyError:
        pass
    _set_lang(st.element)
    return t


def set_page(doc, size="letter", margin_cm=2.5, landscape=False):
    for s in doc.sections:
        w, h = (Cm(21.59), Cm(27.94)) if size == "letter" else (Cm(21.0), Cm(29.7))
        if landscape:
            w, h = h, w
        s.page_width, s.page_height = w, h
        s.orientation = 1 if landscape else 0
        for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
            setattr(s, side, Cm(margin_cm))


# ---------- texto con marcado **negrita** / *cursiva* ----------
TOKEN = re.compile(r"(\*\*[^*]+\*\*|(?<!\*)\*[^*\s][^*]*\*(?!\*)|`[^`]+`)")


def add_rich_text(paragraph, text, bold=None, color=None, size=None):
    for part in TOKEN.split(str(text)):
        if not part:
            continue
        b = i = False
        code = False
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            part, b = part[2:-2], True
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            part, i = part[1:-1], True
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            part, code = part[1:-1], True
        r = paragraph.add_run(part)
        if b or bold:
            r.bold = True
        if i:
            r.italic = True
        if code:
            r.font.name = "Courier New"
        if color:
            r.font.color.rgb = hex_color(color)
        if size:
            r.font.size = Pt(size)
    return paragraph


# ---------- campos ----------
def add_field(paragraph, instr, placeholder="1"):
    def fc(kind):
        r = paragraph.add_run()
        e = OxmlElement("w:fldChar")
        e.set(qn("w:fldCharType"), kind)
        r._r.append(e)
        return r
    fc("begin")
    r = paragraph.add_run()
    it = OxmlElement("w:instrText")
    it.set(qn("xml:space"), "preserve")
    it.text = " %s " % instr
    r._r.append(it)
    fc("separate")
    paragraph.add_run(placeholder)
    fc("end")


def add_toc(doc, levels=3, title="Contenido", headings=None, theme=None):
    """TOC como campo real de Word, con entradas en caché (sin nº de página)."""
    if title:
        p = doc.add_paragraph()
        r = p.add_run(title)
        r.bold = True
        r.font.size = Pt(16)
        if theme:
            r.font.color.rgb = hex_color(theme["accent"])
    p = doc.add_paragraph()
    run = p.add_run()
    b = OxmlElement("w:fldChar")
    b.set(qn("w:fldCharType"), "begin")
    b.set(qn("w:dirty"), "true")
    run._r.append(b)
    it = OxmlElement("w:instrText")
    it.set(qn("xml:space"), "preserve")
    it.text = ' TOC \\o "1-%d" \\h \\z \\u ' % levels
    p.add_run()._r.append(it)
    s = OxmlElement("w:fldChar")
    s.set(qn("w:fldCharType"), "separate")
    p.add_run()._r.append(s)
    first = True
    for lvl, txt in (headings or []):
        if not first:
            p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.6 * (lvl - 1))
        p.paragraph_format.space_after = Pt(2)
        p.add_run(txt)
        first = False
    if first:
        p.add_run("(Actualice el campo para ver el índice)")
    e = OxmlElement("w:fldChar")
    e.set(qn("w:fldCharType"), "end")
    p.add_run()._r.append(e)


def request_field_update(doc):
    settings = doc.settings.element
    if settings.find(qn("w:updateFields")) is None:
        u = OxmlElement("w:updateFields")
        u.set(qn("w:val"), "true")
        settings.append(u)


# ---------- tablas ----------
def _shade(cell, hex_):
    tcpr = cell._tc.get_or_add_tcPr()
    for s in tcpr.findall(qn("w:shd")):
        tcpr.remove(s)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_)
    tcpr.append(shd)


def _table_borders(table, color, header_color):
    tblPr = table._tbl.tblPr
    for b in tblPr.findall(qn("w:tblBorders")):
        tblPr.remove(b)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "bottom", "insideH"):
        e = OxmlElement("w:" + edge)
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), "4")
        e.set(qn("w:space"), "0")
        e.set(qn("w:color"), color)
        borders.append(e)
    for edge in ("left", "right", "insideV"):
        e = OxmlElement("w:" + edge)
        e.set(qn("w:val"), "nil")
        borders.append(e)
    tblPr.append(borders)
    mar = OxmlElement("w:tblCellMar")
    for edge, w in (("top", 60), ("left", 100), ("bottom", 60), ("right", 100)):
        e = OxmlElement("w:" + edge)
        e.set(qn("w:w"), str(w))
        e.set(qn("w:type"), "dxa")
        mar.append(e)
    tblPr.append(mar)


def build_table(doc, spec, theme=None, max_width_cm=16.59):
    """Crea una tabla al final del cuerpo y la devuelve.

    spec: columns (lista), rows (lista de listas), align (lista), widths_cm,
    total_row (bool), zebra (bool), decimals (int), caption (se añade fuera).
    """
    t = dict(DEFAULT_THEME)
    t.update(theme or {})
    cols = spec.get("columns") or []
    rows = spec.get("rows") or []
    ncols = len(cols) if cols else (max(len(r) for r in rows) if rows else 1)
    table = doc.add_table(rows=0, cols=ncols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    _table_borders(table, t["border"], t["accent"])
    aligns = list(spec.get("align") or [])
    decimals = spec.get("decimals")
    total = bool(spec.get("total_row"))
    # alineación automática por columna: numérica si casi todas las celdas lo son
    while len(aligns) < ncols:
        c = len(aligns)
        vals = [r[c] for r in rows if c < len(r) and r[c] not in ("", None)]
        num = vals and all(isinstance(v, (int, float)) or looks_numeric(str(v)) for v in vals)
        aligns.append("right" if num else "left")
    widths = spec.get("widths_cm")
    if not widths:
        widths = [max_width_cm / ncols] * ncols
    size = spec.get("font_size", max(t["size"] - 1, 8))

    def fill(row, values, header=False, is_total=False):
        for c in range(ncols):
            v = values[c] if c < len(values) else ""
            cell = row.cells[c]
            cell.width = Cm(widths[c])
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.0
            txt = fmt_num(v, decimals) if isinstance(v, (int, float)) else ("" if v is None else str(v))
            p.alignment = ALIGN.get(aligns[c], WD_ALIGN_PARAGRAPH.LEFT)
            if header:
                add_rich_text(p, txt, bold=True, color=t["table_header_fg"], size=size)
                _shade(cell, t["table_header_bg"])
            else:
                add_rich_text(p, txt, bold=True if is_total else None, size=size)
                if is_total:
                    _shade(cell, t["total_bg"])
                elif spec.get("zebra") and (len(table.rows) % 2 == 0):
                    _shade(cell, t["zebra_bg"])
            cell.vertical_alignment = 1  # centrado vertical

    if cols:
        row = table.add_row()
        fill(row, cols, header=True)
        trpr = row._tr.get_or_add_trPr()
        h = OxmlElement("w:tblHeader")
        trpr.append(h)
    for i, r in enumerate(rows):
        row = table.add_row()
        fill(row, r, is_total=(total and i == len(rows) - 1))
    for row in table.rows:
        trpr = row._tr.get_or_add_trPr()
        trpr.append(OxmlElement("w:cantSplit"))
    # anchos de columna también en la rejilla
    for c, col in enumerate(table.columns):
        col.width = Cm(widths[c])
    return table


# ---------- imágenes ----------
def add_image(doc, path, width_cm=None, caption=None, max_width_cm=16.59, align="center"):
    from PIL import Image
    with Image.open(path) as im:
        w_px, h_px = im.size
    width = width_cm or min(max_width_cm, 12)
    width = min(width, max_width_cm)
    p = doc.add_paragraph()
    p.alignment = ALIGN.get(align, WD_ALIGN_PARAGRAPH.CENTER)
    p.paragraph_format.keep_with_next = bool(caption)
    p.add_run().add_picture(path, width=Cm(width))
    cap = None
    if caption:
        try:
            cap = doc.add_paragraph(style="Caption")
        except KeyError:
            cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_rich_text(cap, caption)
    return p, cap


def move_after(anchor_el, *new_els):
    cur = anchor_el
    for el in new_els:
        cur.addnext(el)
        cur = el
    return cur


def restart_numbering(doc, paragraph, num_style_name="List Number"):
    """Hace que `paragraph` (y los siguientes con su mismo numId) empiecen en 1."""
    numbering = doc.part.numbering_part.numbering_definitions._numbering
    st = doc.styles[num_style_name].element
    numPr = st.find(qn("w:pPr") + "/" + qn("w:numPr"))
    if numPr is None:
        return None
    base = numPr.find(qn("w:numId")).get(qn("w:val"))
    num = numbering.add_num(int(_abstract_of(numbering, base)))
    ov = OxmlElement("w:lvlOverride")
    ov.set(qn("w:ilvl"), "0")
    so = OxmlElement("w:startOverride")
    so.set(qn("w:val"), "1")
    ov.append(so)
    num.append(ov)
    set_num(paragraph, num.numId)
    return num.numId


def set_num(paragraph, num_id):
    ppr = paragraph._p.get_or_add_pPr()
    for old in ppr.findall(qn("w:numPr")):
        ppr.remove(old)
    npr = OxmlElement("w:numPr")
    il = OxmlElement("w:ilvl")
    il.set(qn("w:val"), "0")
    ni = OxmlElement("w:numId")
    ni.set(qn("w:val"), str(num_id))
    npr.append(il)
    npr.append(ni)
    # numPr va justo después de pStyle/keepNext/... y antes de spacing/ind/jc
    anchor = ppr.find(qn("w:pStyle"))
    if anchor is not None:
        anchor.addnext(npr)
    else:
        ppr.insert(0, npr)


def _abstract_of(numbering, num_id):
    for n in numbering.findall(qn("w:num")):
        if n.get(qn("w:numId")) == str(num_id):
            return n.find(qn("w:abstractNumId")).get(qn("w:val"))
    raise KeyError(num_id)


def body_paragraphs(doc):
    """Todos los párrafos (cuerpo y dentro de tablas), en orden de documento."""
    return doc.element.body.xpath(".//w:p")


def para_text(p_el):
    return "".join(t.text or "" for t in p_el.xpath(".//w:t[not(ancestor::w:del)]"))
