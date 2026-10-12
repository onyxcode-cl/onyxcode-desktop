#!/usr/bin/env python3
"""Presentación con diseño «dots» (oscuro, premium) usando DeckCraft: `python3 build_dots.py contenido.json salida.pptx`.

Solo el CONTENIDO va en el JSON (nunca comandos ni rutas). La plantilla es la misma que `src/main/office/craft/deck-builder.ts`
(hay una prueba que exige que ambas generen los MISMOS comandos). Necesita el programa `deckcraft-cli`: la app lo instala bajo
demanda (y pasa su ruta en `$LAZUNOX_DECKCRAFT`, o se busca en `$LAZUNOX_BIN_DIR`). Si no está, sale con código 3 y hay que usar `build_pptx.py`.
Medido: la presentación sale en ~30 ms (el tiempo del modelo es escribir el JSON).
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

# Búsqueda del programa y entorno mínimo compartidos con la skill _shared (render.py).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared"))
import render  # noqa: E402

BG, EDGE, VI, VIL, WH, MU = "07070C", "25253A", "8B5CF6", "C4B5FD", "F5F5FA", "A1A1B5"
GLOW, BLUEG = "1F1640", "0F1A3A"
DOTS = ["3B82F6", "22C55E", "F59E0B", "EC4899", "8B5CF6"]
LIM = {"slides": 30, "text": 400, "short": 80}
KINDS = ["cover", "stat", "timeline", "grid", "steps", "compare", "rows", "quad", "stats", "closing"]


class SpecError(Exception):
    pass


def _bad(path, why):
    raise SpecError(f"{path}: {why}")


def _str(v, path, mx, required=True):
    if v is None or v == "":
        if required:
            _bad(path, "falta el texto")
        return ""
    if not isinstance(v, str):
        _bad(path, "debe ser texto")
    if len(v) > mx:
        _bad(path, f"demasiado largo ({len(v)} > {mx} caracteres)")
    return v


def _items(v, path, mn, mx):
    if not isinstance(v, list):
        _bad(path, "debe ser una lista")
    if not mn <= len(v) <= mx:
        _bad(path, f"debe tener entre {mn} y {mx} elementos (tiene {len(v)})")
    for i, x in enumerate(v):
        if not isinstance(x, dict):
            _bad(f"{path}[{i}]", "debe ser un objeto")
    return v


def _obj(v, path):
    if not isinstance(v, dict):
        _bad(path, "debe ser un objeto")
    return v


def _item_list(v, path, mn, mx, body=True):
    return [
        {"title": _str(o.get("title"), f"{path}[{i}].title", LIM["short"]),
         "body": _str(o.get("body"), f"{path}[{i}].body", LIM["text"], False) if body else ""}
        for i, o in enumerate(_items(v, path, mn, mx))
    ]


def validate(spec):
    """Devuelve la lista de diapositivas limpia (solo campos conocidos). Lanza SpecError."""
    root = _obj(spec, "spec")
    out = []
    for i, s in enumerate(_items(root.get("slides"), "slides", 1, LIM["slides"])):
        p = f"slides[{i}]"
        t = s.get("type")
        if t not in KINDS:
            _bad(f"{p}.type", "debe ser uno de: " + ", ".join(KINDS))
        d = {"type": t, "title": _str(s.get("title"), f"{p}.title", LIM["short"]), "kicker": _str(s.get("kicker"), f"{p}.kicker", 40, False)}
        if t == "cover":
            d.update(subtitle=_str(s.get("subtitle"), f"{p}.subtitle", 120, False), note=_str(s.get("note"), f"{p}.note", 120, False),
                     badge=_str(s.get("badge"), f"{p}.badge", 40, False))
        elif t == "stat":
            d.update(stat=_str(s.get("stat"), f"{p}.stat", 10), statLabel=_str(s.get("statLabel"), f"{p}.statLabel", 120),
                     items=_item_list(s.get("items"), f"{p}.items", 2, 2))
        elif t == "timeline":
            d.update(items=_item_list(s.get("items"), f"{p}.items", 3, 3), callout=_str(s.get("callout"), f"{p}.callout", 90, False))
        elif t == "grid":
            d.update(items=_item_list(s.get("items"), f"{p}.items", 4, 4), footnote=_str(s.get("footnote"), f"{p}.footnote", 120, False))
        elif t == "steps":
            d.update(items=_item_list(s.get("items"), f"{p}.items", 4, 4, False))
        elif t == "compare":
            def panel(v, pp):
                o = _obj(v, pp)
                return {"label": _str(o.get("label"), f"{pp}.label", 40, False), "text": _str(o.get("text"), f"{pp}.text", 160),
                        "foot": _str(o.get("foot"), f"{pp}.foot", 140, False)}
            d.update(left=panel(s.get("left"), f"{p}.left"), right=panel(s.get("right"), f"{p}.right"))
        elif t == "rows":
            d.update(rows=[{"label": _str(o.get("label"), f"{p}.rows[{k}].label", 60), "value": _str(o.get("value"), f"{p}.rows[{k}].value", 40),
                            "note": _str(o.get("note"), f"{p}.rows[{k}].note", 70, False)}
                           for k, o in enumerate(_items(s.get("rows"), f"{p}.rows", 2, 4))])
        elif t == "quad":
            d.update(items=_item_list(s.get("items"), f"{p}.items", 4, 4))
        elif t == "stats":
            d.update(stat=_str(s.get("stat"), f"{p}.stat", 10), statLabel=_str(s.get("statLabel"), f"{p}.statLabel", 80),
                     items=[{"value": _str(o.get("value"), f"{p}.items[{k}].value", 5), "label": _str(o.get("label"), f"{p}.items[{k}].label", 60)}
                            for k, o in enumerate(_items(s.get("items"), f"{p}.items", 3, 3))])
        else:
            d.update(text=_str(s.get("text"), f"{p}.text", 160, False), sources=_str(s.get("sources"), f"{p}.sources", 120, False))
        out.append(d)
    return out


def fit_size(text, base, fits):
    """Reduce la letra si el texto es largo (mínimo 55 % de la base). Igual que `fitSize` del módulo TypeScript."""
    if len(text) <= fits:
        return base
    return max(math.floor(base * 0.55 + 0.5), math.floor(base * fits / len(text)))


def cover_size(title):
    """Título de portada: enorme si es corto; baja para que quepa en UNA línea. Igual que `coverSize` del módulo TypeScript."""
    if len(title) <= 8:
        return 190
    if len(title) <= 14:
        return 110
    return max(40, math.floor(110 * 14 * 0.9 / len(title)))


def build_commands(slides):
    c = []

    def a(i, p=None):
        c.append(i if p is None else i + "=" + json.dumps(p, ensure_ascii=False, separators=(",", ":")))

    def bgslide(glows=()):
        a("slide.new", {"layout": "blank"})
        a("design.background", {"color": "#" + BG})
        for x, y, d, col in glows:
            a("shape.insert", {"preset": "ellipse", "rect": [x, y, d, d]})
            a("shape.fill", {"gradient": {"stops": [[0, "#" + col], [0.62, "#" + BG], [1, "#" + BG]], "kind": "radial"}})
            a("shape.line", {"none": True})

    def rect(x, y, w, h, col):
        a("shape.insert", {"preset": "rect", "rect": [x, y, w, h]})
        a("shape.fill", {"color": "#" + col})
        a("shape.line", {"none": True})

    def ring(x, y, d, col):
        a("shape.insert", {"preset": "ellipse", "rect": [x, y, d, d]})
        a("shape.fill", {"none": True})
        a("shape.line", {"color": "#" + col, "width": 2})

    def dot(x, y, d, col):
        a("shape.insert", {"preset": "ellipse", "rect": [x, y, d, d]})
        a("shape.fill", {"color": "#" + col})
        a("shape.line", {"none": True})

    def dotrow(x, y, d, gap):
        for i, col in enumerate(DOTS):
            dot(x + i * (d + gap), y, d, col)

    def txt(x, y, w, h, t, size, color=WH, bold=False, align="left", spacing=None):
        a("insert.textBox", {"rect": [x, y, w, h], "text": t})
        a("format.size", {"size": size})
        a("format.color", {"color": "#" + color})
        a("format.bold", {"on": bold})
        a("format.align", {"align": align})
        if spacing is not None:
            a("format.spacing", {"pt": spacing})

    def pill(x, y, w, h, t, size, fill=None):
        a("shape.insert", {"preset": "roundRect", "rect": [x, y, w, h], "text": t})
        a("shape.fill", {"color": "#" + fill} if fill else {"none": True})
        a("shape.line", {"color": "#" + VI, "width": 1.5})
        a("format.size", {"size": size})
        a("format.color", {"color": "#" + WH})
        a("format.bold", {"on": True})
        a("format.align", {"align": "center"})
        a("format.anchor", {"anchor": "middle"})

    def header(n, title, kicker):
        bgslide([(680, -250, 500, GLOW)])
        if kicker:
            txt(60, 34, 600, 24, kicker.upper(), 13, VI, True, "left", 3)
        txt(60, 62, 840, 64, title, fit_size(title, 40, 36), WH, True, "left", -1)
        dotrow(60, 506, 8, 6)
        txt(820, 500, 80, 24, f"{n:02d}", 13, MU, False, "right")

    a("file.new")
    # Arial en todo: Inter (la del tema) no está en todos los equipos y LibreOffice/PowerPoint la sustituyen por una serif.
    a("design.fonts", {"major": "Arial", "minor": "Arial"})
    for idx, s in enumerate(slides):
        n, t = idx + 1, s["type"]
        if t == "cover":
            bgslide([(380, -300, 900, "4A2C96"), (-220, 300, 560, "14285E")])
            dotrow(60, 88, 34, 20)
            txt(44, 146, 860, 230, s["title"], cover_size(s["title"]), WH, True, "left", -8 if cover_size(s["title"]) >= 110 else -2)
            if s["subtitle"]:
                txt(64, 384, 760, 50, s["subtitle"], 28)
            if s["note"]:
                txt(64, 430, 760, 30, s["note"], 18, MU)
            if s["badge"]:
                pill(64, 476, min(420, 40 + len(s["badge"]) * 9), 36, s["badge"], 14)
        elif t == "stat":
            header(n, s["title"], s["kicker"])
            txt(52, 150, 480, 180, s["stat"], fit_size(s["stat"], 128, 6), VI, True, "left", -4)
            txt(64, 344, 380, 70, s["statLabel"], 20, MU)
            rect(510, 150, 1, 300, EDGE)
            for i, it in enumerate(s["items"]):
                y = 160 + i * 170
                dot(546, y + 12, 16, DOTS[i])
                txt(578, y, 340, 40, it["title"], fit_size(it["title"], 26, 20), WH, True)
                if it["body"]:
                    txt(578, y + 44, 340, 100, it["body"], 19, MU)
                if i == 0:
                    rect(546, y + 150, 354, 1, EDGE)
        elif t == "timeline":
            header(n, s["title"], s["kicker"])
            rect(60, 250, 840, 2, EDGE)
            for i, it in enumerate(s["items"]):
                x, col = 60 + i * 300, DOTS[2 + i]
                ring(x - 9, 241, 38, col)
                dot(x, 250, 20, col)
                txt(x, 206, 240, 30, f"0{i + 1}", 15, col, True, "left", 2)
                txt(x, 290, 260, 40, it["title"], fit_size(it["title"], 26, 18), WH, True)
                if it["body"]:
                    txt(x, 336, 250, 90, it["body"], 18, MU)
            if s["callout"]:
                pill(60, 432, 840, 56, s["callout"], 18, "1A1332")
        elif t == "grid":
            header(n, s["title"], s["kicker"])
            for i, it in enumerate(s["items"]):
                x, y, col = 60 + (i % 2) * 440, 146 + (i // 2) * 150, DOTS[[0, 2, 1, 3][i]]
                rect(x, y, 400, 1, EDGE)
                ring(x, y + 24, 72, col)
                dot(x + 22, y + 46, 28, col)
                txt(x + 102, y + 22, 300, 40, it["title"], fit_size(it["title"], 28, 17), WH, True)
                if it["body"]:
                    txt(x + 102, y + 66, 300, 60, it["body"], 19, MU)
            if s["footnote"]:
                txt(60, 448, 840, 34, s["footnote"], 18, MU)
        elif t == "steps":
            header(n, s["title"], s["kicker"])
            rect(60, 286, 840, 2, EDGE)
            for i, it in enumerate(s["items"]):
                x = 60 + i * 220
                txt(x - 4, 160, 200, 100, f"{i + 1:02d}", 72, DOTS[i], True, "left", -2)
                dot(x, 279, 16, DOTS[i])
                txt(x, 326, 200, 30, f"Paso {i + 1}", 14, MU, True, "left", 1)
                txt(x, 352, 200, 100, it["title"], fit_size(it["title"], 24, 26), WH, True)
        elif t == "compare":
            header(n, s["title"], s["kicker"])
            L, R = s["left"], s["right"]
            if L["label"]:
                txt(60, 150, 400, 30, L["label"].upper(), 13, MU, True, "left", 2)
            txt(60, 184, 410, 190, L["text"], 32, WH, True, "left", -0.5)
            if L["foot"]:
                txt(60, 392, 400, 60, L["foot"], 18, MU)
            rect(500, 150, 1, 300, EDGE)
            a("shape.insert", {"preset": "roundRect", "rect": [530, 150, 370, 320]})
            a("shape.fill", {"gradient": {"stops": [[0, "#" + VI], [1, "#" + DOTS[0]]], "angle": 45}})
            a("shape.line", {"none": True})
            a("shape.insert", {"preset": "roundRect", "rect": [532, 152, 366, 316]})
            a("shape.fill", {"color": "#150E28"})
            a("shape.line", {"none": True})
            if R["label"]:
                txt(566, 180, 310, 30, R["label"].upper(), 13, VIL, True, "left", 2)
            txt(566, 214, 310, 170, R["text"], 26, WH, True)
            if R["foot"]:
                txt(566, 396, 310, 60, R["foot"], 17, "D8D0F5")
        elif t == "rows":
            header(n, s["title"], s["kicker"])
            for i, r in enumerate(s["rows"]):
                y = 146 + i * 84
                rect(60, y, 840, 1, EDGE)
                dot(60, y + 30, 14, DOTS[i])
                txt(90, y + 20, 350, 44, r["label"], 21, WH, True)
                txt(460, y + 20, 200, 50, r["value"], 20, VIL, True)
                if r["note"]:
                    txt(680, y + 20, 220, 56, r["note"], 16, MU)
            rect(60, 146 + len(s["rows"]) * 84, 840, 1, EDGE)
        elif t == "quad":
            header(n, s["title"], s["kicker"])
            for i, it in enumerate(s["items"]):
                x, y = 60 + (i % 2) * 440, 150 + (i // 2) * 170
                rect(x, y, 5, 130, DOTS[i])
                txt(x + 28, y + 4, 395, 40, it["title"], fit_size(it["title"], 24, 28), WH, True)
                if it["body"]:
                    txt(x + 28, y + 52, 380, 80, it["body"], 19, MU)
        elif t == "stats":
            header(n, s["title"], s["kicker"])
            txt(56, 150, 460, 170, s["stat"], fit_size(s["stat"], 120, 6), VI, True, "left", -4)
            txt(64, 326, 420, 40, s["statLabel"], 22)
            rect(520, 150, 1, 300, EDGE)
            for i, it in enumerate(s["items"]):
                y = 146 + i * 108
                txt(556, y, 140, 100, it["value"], fit_size(it["value"], 76, 2), DOTS[1 + i], True, "left", -2)
                txt(716, y + 26, 200, 70, it["label"], 19, MU)
                if i < 2:
                    rect(556, y + 100, 344, 1, EDGE)
        else:
            bgslide([(120, -40, 720, "2E1D66"), (-200, 380, 420, BLUEG)])
            dotrow(364, 116, 32, 22)
            txt(60, 184, 840, 100, s["title"], fit_size(s["title"], 62, 26), WH, True, "center", -2)
            if s["text"]:
                txt(120, 298, 720, 60, s["text"], 22, MU, False, "center")
            if s["sources"]:
                txt(60, 468, 840, 30, s["sources"], 14, MU, False, "center")
    a("slide.delete", {"index": 0})  # `file.new` deja una diapositiva vacía al inicio
    return c


def find_deckcraft():
    """Ruta de `deckcraft-cli` (`deckcraft-cli.exe` en Windows): `$LAZUNOX_DECKCRAFT` si la app la pasó al arrancar el motor; si no
    (se instaló DESPUÉS de arrancar), la copia administrada en `$LAZUNOX_BIN_DIR/craft-<versión>/…/` con su marca de instalación."""
    return render.buscar_deckcraft() or ""


def main(argv):
    if len(argv) != 3 or not argv[2].lower().endswith(".pptx"):
        print("Uso: build_dots.py contenido.json salida.pptx", file=sys.stderr)
        return 2
    binary = find_deckcraft()
    if not binary:
        print("Aviso: DeckCraft no está instalado; usa build_pptx.py (diseño estándar).", file=sys.stderr)
        return 3
    try:
        with open(argv[1], encoding="utf-8") as f:
            slides = validate(json.load(f))
    except (OSError, ValueError, SpecError) as e:
        print(f"ERROR en el contenido: {e}", file=sys.stderr)
        return 1
    out = os.path.abspath(argv[2])
    args = [binary, "run", "--save", out]
    for cmd in build_commands(slides):
        args += ["--cmd", cmd]
    home = tempfile.mkdtemp(prefix="lazunox-craft-")
    env = render.entorno_minimo(home)
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=30, env=env)
    except subprocess.TimeoutExpired:
        print("ERROR: DeckCraft tardó más de 30 s", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(home, ignore_errors=True)
    if r.returncode != 0:
        print("ERROR: DeckCraft falló: " + (r.stderr or "")[:400], file=sys.stderr)
        return 1
    print(f"Presentación creada: {argv[2]} ({len(slides)} diapositivas, diseño dots)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
