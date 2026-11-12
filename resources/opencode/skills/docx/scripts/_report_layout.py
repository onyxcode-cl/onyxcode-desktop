"""Política de informes sin dependencias de Office; plantilla compartida con Chat."""
import copy
import json
import math
import os
import re

with open(os.path.join(os.path.dirname(__file__), "..", "templates", "report.json"), encoding="utf-8") as f:
    TEMPLATE = json.load(f)


def column_widths(columns, rows, requested=None, usable=None):
    usable = usable or TEMPLATE["usable_width_cm"]
    n = len(columns) or max((len(r) for r in rows), default=1)
    weights = [max(8, min(60, max(len(str(r[c] if r[c] is not None else "")) for r in [columns] + rows if c < len(r)))) ** 0.5 for c in range(n)]
    weights = [usable * w / sum(weights) for w in weights]
    if requested:
        if any(isinstance(w, bool) or not isinstance(w, (int, float)) or not math.isfinite(w) or w <= 0 for w in requested):
            raise ValueError("widths_cm: indique anchos positivos")
        weights = [requested[c] if c < len(requested) else w for c, w in enumerate(weights)]
    return [usable * w / sum(weights) for w in weights]


def count_items(items):
    count = 0
    for item in items:
        if isinstance(item, list):
            count += count_items(item)
        elif isinstance(item, dict):
            count += len(str(item.get("text", "")).split()) + count_items(item.get("items", []))
        else:
            count += len(str(item).split())
    return count


def prepare(spec):
    """Decisiones deterministas: sin portada/índice cortos, títulos y tablas coherentes."""
    s = copy.deepcopy(spec)
    if not isinstance(s, dict) or not isinstance(s.get("blocks"), list):
        raise ValueError("blocks: indique una lista de bloques")
    units, sections = 0, 0
    counters, previous = [0, 0, 0], 0
    for b in s["blocks"]:
        if not isinstance(b, dict):
            raise ValueError("blocks: cada bloque debe ser un objeto")
        if b.get("type") == "heading":
            raw = b.get("level", 1)
            if raw not in (1, 2, 3):
                raise ValueError("heading.level: use 1, 2 o 3")
            level = min(raw, previous + 1)
            text = re.sub(r"^\s*\d{1,3}(?:\.\d+)*[.)]?\s+", "", str(b.get("text", ""))).strip()
            if not text:
                raise ValueError("heading.text: escriba un título no vacío")
            counters[level - 1] += 1
            counters[level:] = [0] * (3 - level)
            b.update(level=level, text=".".join(map(str, counters[:level])) + " " + text)
            previous = level
            sections += level == 1
        elif b.get("type") == "table":
            cols, rows = b.get("columns", []), b.get("rows", [])
            if not rows or not any(any(v not in (None, "") for v in r) for r in rows):
                raise ValueError("table.rows: agregue al menos una fila con datos")
            n = len(cols) or max(map(len, rows))
            if any(len(r) != n for r in rows):
                raise ValueError("table.rows: cada fila debe tener una celda por columna")
            units += len(rows) * TEMPLATE["table_row_units"]
        units += len(str(b.get("text", "")).split())
        if b.get("type") in ("bullets", "numbered"):
            units += count_items(b.get("items", []))
    s["cover"] = bool(s.get("cover") and s.get("title") and units >= TEMPLATE["long_units"])
    s["toc"] = bool(s.get("toc", True) and units >= TEMPLATE["toc_units"] and sections >= TEMPLATE["toc_sections"])
    return s
