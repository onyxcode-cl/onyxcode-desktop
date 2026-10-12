#!/usr/bin/env python3
"""Word con WordCraft: `python3 build_word_craft.py contenido.json salida.docx` — el MISMO JSON que `build_docx.py`.

Es la ruta rápida y de diseño cuidado cuando la app instaló WordCraft (programa de código abierto que descarga la app, bajo demanda).
Si no está instalado, sale con código 3 y hay que usar `build_docx.py`. Cubre: title, subtitle, author, date, header, footer,
page_numbers, toc, y los bloques heading, paragraph (con **negrita** y *cursiva*), bullets, numbered, table (zebra, total_row, align,
widths_cm, decimals, caption), image, page_break. Las listas anidadas se aplanan. `page` y `theme` (salvo la fuente) se ignoran.
Fuente: Arial (existe en todos los equipos; una fuente ausente se sustituye por una serif en otros programas).
El contenido es DATO: va como valor JSON dentro de cada comando; no se interpreta nada del JSON como comando ni ruta fuera de su carpeta.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import datetime

# Copias de `_docxlib.fecha_es/fmt_num/looks_numeric` (aquí no hace falta python-docx; una prueba exige que sigan iguales).
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
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

ACCENT, TH_FG, ZEBRA, TOTAL = "1F3864", "FFFFFF", "F2F4F8", "E7E9EE"
MAX_BLOCKS, MAX_TEXT, MAX_ROWS = 400, 5000, 300
BLOCKS = ["heading", "paragraph", "bullets", "numbered", "table", "image", "page_break"]
INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*)")


class SpecError(Exception):
    pass


def bad(path, why):
    raise SpecError(f"{path}: {why}")


def text(v, path, required=True):
    if v is None or v == "":
        if required:
            bad(path, "falta el texto")
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if not isinstance(v, str):
        bad(path, "debe ser texto")
    if len(v) > MAX_TEXT:
        bad(path, f"demasiado largo ({len(v)} > {MAX_TEXT} caracteres)")
    return v


def find_wordcraft():
    """`$LAZUNOX_WORDCRAFT` si la app lo pasó al arrancar el motor; si no (se instaló DESPUÉS de arrancar), la copia administrada
    de la app en `$LAZUNOX_BIN_DIR/craft-<versión>/…/wordcraft-cli` con su marca de instalación completa."""
    p = os.environ.get("LAZUNOX_WORDCRAFT", "")
    if p and os.path.isfile(p):
        return p
    base = os.environ.get("LAZUNOX_BIN_DIR", "")
    if base and os.path.isdir(base):
        found = []
        for d in sorted(glob.glob(os.path.join(base, "craft-*"))):
            if os.path.isfile(os.path.join(d, "installed-wordcraft.json")):
                found += [f for f in sorted(glob.glob(os.path.join(d, "*", "wordcraft-cli"))) if os.access(f, os.X_OK)]
        if found:
            return found[-1]
    return ""


def build_commands(spec, base_dir):
    """JSON de la skill docx → lista de comandos `id={json}` de WordCraft. Lanza SpecError."""
    if not isinstance(spec, dict):
        bad("spec", "debe ser un objeto")
    blocks = spec.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        bad("blocks", "debe ser una lista con al menos un bloque")
    if len(blocks) > MAX_BLOCKS:
        bad("blocks", f"demasiados bloques ({len(blocks)} > {MAX_BLOCKS})")
    c = []

    def a(i, p=None):
        c.append(i if p is None else i + "=" + json.dumps(p, ensure_ascii=False, separators=(",", ":")))

    def inline(t):
        """Texto con **negrita** y *cursiva*: alterna el formato alrededor de cada tramo."""
        for seg in INLINE.split(t):
            if not seg:
                continue
            if seg.startswith("**") and seg.endswith("**") and len(seg) > 4:
                a("format.bold", {"value": True}); a("text.insert", {"text": seg[2:-2]}); a("format.bold", {"value": False})
            elif seg.startswith("*") and seg.endswith("*") and len(seg) > 2:
                a("format.italic", {"value": True}); a("text.insert", {"text": seg[1:-1]}); a("format.italic", {"value": False})
            else:
                a("text.insert", {"text": seg})

    def par(t, style=None, align=None):
        if style:
            a("para.style", {"style": style})
        a("para.align", {"value": align or "left"})
        inline(t)
        a("text.newParagraph")

    a("design.themeFonts", {"heading": "Arial", "body": "Arial"})
    # Encabezado y pie: cada comando deja el cursor DENTRO de él (el cuerpo se ve atenuado); `insert.closeHeader` vuelve al cuerpo.
    if spec.get("header"):
        a("insert.header", {"text": text(spec["header"], "header")})
        a("insert.closeHeader")
    if spec.get("footer"):
        a("insert.footer", {"text": text(spec["footer"], "footer")})
        a("insert.closeHeader")
    elif spec.get("page_numbers", True):
        a("insert.footer", {"preset": "pageNumber"})
        a("insert.closeHeader")
    if spec.get("title"):
        par(text(spec["title"], "title"), "Title", "center")
    if spec.get("subtitle"):
        par(text(spec["subtitle"], "subtitle"), "Subtitle", "center")
    meta = [x for x in (text(spec.get("author"), "author", False), "" if not spec.get("date") else
                        (fecha_es() if spec.get("date") == "hoy" else text(spec["date"], "date"))) if x]
    if meta:
        par(" · ".join(meta), "Normal", "center")
    if spec.get("toc"):
        a("references.toc", {"levels": 3})
        a("caret.docEnd")
    a("para.style", {"style": "Normal"})

    numbered_seen = False
    for i, b in enumerate(blocks):
        p = f"blocks[{i}]"
        if not isinstance(b, dict):
            bad(p, "debe ser un objeto")
        t = b.get("type")
        if t not in BLOCKS:
            bad(f"{p}.type", "debe ser uno de: " + ", ".join(BLOCKS))
        if t == "heading":
            lvl = b.get("level", 1)
            if lvl not in (1, 2, 3):
                bad(f"{p}.level", "debe ser 1, 2 o 3")
            a(f"para.heading{lvl}")
            a("para.align", {"value": "left"})
            a("text.insert", {"text": text(b.get("text"), f"{p}.text")})
            a("text.newParagraph")
            a("para.style", {"style": "Normal"})
        elif t == "paragraph":
            al = b.get("align", "left")
            if al not in ("left", "right", "center", "justify"):
                bad(f"{p}.align", "debe ser left, right, center o justify")
            par(text(b.get("text"), f"{p}.text"), "Normal", al)
        elif t in ("bullets", "numbered"):
            if not isinstance(b.get("items"), list) or not b["items"]:
                bad(f"{p}.items", "debe ser una lista con elementos")
            flat = []
            for k, it in enumerate(b["items"]):
                if isinstance(it, list):
                    flat += [text(x, f"{p}.items[{k}]") for x in it]
                else:
                    flat.append(text(it, f"{p}.items[{k}]"))
            if t == "numbered":
                a("para.numbering", {"kind": "numbered"})
            else:
                a("para.bullets")
            for k, it in enumerate(flat):
                inline(it)
                if t == "numbered" and k == 0 and numbered_seen:
                    a("para.restartNumbering")  # cada bloque numbered reinicia en 1 (solo se puede con el cursor ya dentro de la lista)
                a("text.newParagraph")
            if t == "numbered":
                numbered_seen = True
            if t == "numbered":
                a("para.numbering", {"off": True})
            else:
                a("para.bullets", {"off": True})
            a("para.style", {"style": "Normal"})
        elif t == "table":
            cols, rows = b.get("columns"), b.get("rows")
            if not isinstance(cols, list) or not cols:
                bad(f"{p}.columns", "debe ser una lista con las columnas")
            if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
                bad(f"{p}.rows", f"debe tener entre 1 y {MAX_ROWS} filas")
            n = len(cols)
            dec = b.get("decimals")
            align = b.get("align") or []
            widths = b.get("widths_cm") or []
            cells = [[text(x, f"{p}.columns[{k}]") for k, x in enumerate(cols)]]
            for r, row in enumerate(rows):
                if not isinstance(row, list) or len(row) != n:
                    bad(f"{p}.rows[{r}]", f"debe tener {n} celdas")
                cells.append([fmt_num(v, dec) if isinstance(v, (int, float)) and not isinstance(v, bool)
                              else ("" if v is None else text(v, f"{p}.rows[{r}][{k}]", False)) for k, v in enumerate(row)])
            a("insert.table", {"rows": len(cells), "cols": n})
            for r, row in enumerate(cells):
                total = bool(b.get("total_row")) and r == len(cells) - 1
                for k, v in enumerate(row):
                    if r == 0:
                        a("table.shading", {"color": ACCENT})
                        a("format.bold", {"value": True}); a("format.color", {"color": TH_FG})
                        if k < len(widths) and isinstance(widths[k], (int, float)) and 1 <= widths[k] <= 40:
                            a("table.columnWidth", {"width": round(widths[k] * 28.35, 1)})
                    elif total:
                        a("table.shading", {"color": TOTAL}); a("format.bold", {"value": True})
                    elif b.get("zebra", True) and r % 2 == 0:
                        a("table.shading", {"color": ZEBRA})
                    al = align[k] if k < len(align) and align[k] in ("left", "right", "center") else (
                        "right" if r > 0 and looks_numeric(v) else "left")
                    a("para.align", {"value": al})
                    a("text.insert", {"text": v})
                    if r == 0:
                        a("format.bold", {"value": False}); a("format.color", {"color": "auto"})
                    elif total:
                        a("format.bold", {"value": False})
                    if not (r == len(cells) - 1 and k == n - 1):
                        a("text.tab")
            a("caret.docEnd")
            a("para.style", {"style": "Normal"})
            if b.get("caption"):
                a("format.italic", {"value": True})
                par(text(b["caption"], f"{p}.caption"), "Normal", "center")
                a("format.italic", {"value": False})
        elif t == "image":
            rel = text(b.get("path"), f"{p}.path")
            full = os.path.realpath(os.path.join(base_dir, rel))
            root = os.path.realpath(base_dir)
            if not (full == root or full.startswith(root + os.sep)):
                bad(f"{p}.path", "la imagen debe estar dentro de la carpeta del JSON")
            if not os.path.isfile(full):
                bad(f"{p}.path", f"no existe la imagen {rel}")
            width = b.get("width_cm", 12)
            if not isinstance(width, (int, float)) or not 1 <= width <= 40:
                bad(f"{p}.width_cm", "debe estar entre 1 y 40")
            a("para.align", {"value": "center"})
            a("insert.picture", {"path": full, "width": round(width * 28.35, 1), "alt": text(b.get("caption"), f"{p}.caption", False)})
            a("caret.docEnd")  # la imagen queda seleccionada: sin esto el texto siguiente la reemplaza
            a("text.newParagraph")
            if b.get("caption"):
                a("format.italic", {"value": True})
                par(text(b["caption"], f"{p}.caption"), "Normal", "center")
                a("format.italic", {"value": False})
        else:
            a("text.pageBreak")
    return c


def main(argv):
    if len(argv) != 3 or not argv[2].lower().endswith(".docx"):
        print("Uso: build_word_craft.py contenido.json salida.docx", file=sys.stderr)
        return 2
    binary = find_wordcraft()
    if not binary:
        print("Aviso: WordCraft no está instalado; usa build_docx.py (diseño estándar).", file=sys.stderr)
        return 3
    try:
        with open(argv[1], encoding="utf-8") as f:
            spec = json.load(f)
        cmds = build_commands(spec, os.path.dirname(os.path.abspath(argv[1])))
    except (OSError, ValueError, SpecError) as e:
        print(f"ERROR en el contenido: {e}", file=sys.stderr)
        return 1
    out = os.path.abspath(argv[2])
    args = [binary, "run", "--save", out]
    for cmd in cmds:
        args += ["--cmd", cmd]
    home = tempfile.mkdtemp(prefix="lazunox-craft-")
    env = {"PATH": "/usr/bin:/bin", "HOME": home, "XDG_CONFIG_HOME": home, "XDG_DATA_HOME": home, "XDG_CACHE_HOME": home, "XDG_STATE_HOME": home}
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=60, env=env)
    except subprocess.TimeoutExpired:
        print("ERROR: WordCraft tardó más de 60 s", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(home, ignore_errors=True)
    if r.returncode != 0:
        print("ERROR: WordCraft falló: " + (r.stderr or "")[:400], file=sys.stderr)
        return 1
    n_img = sum(1 for b in spec["blocks"] if b.get("type") == "image")
    print(f"Documento creado: {argv[2]} ({len(spec['blocks'])} bloques, {n_img} imágenes, diseño WordCraft)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
