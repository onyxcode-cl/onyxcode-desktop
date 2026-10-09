# -*- coding: utf-8 -*-
"""Utilidades compartidas: estimación de texto y medidas (sin dependencias externas)."""
from __future__ import annotations

import math

CHAR_W = 0.50   # ancho medio de un carácter, en "em" (conservador para Calibri/Carlito)
LINE_H = 1.2    # alto de línea, en múltiplos del tamaño de letra


def lines_needed(text, pt, width_in):
    """Líneas estimadas que ocupa `text` a `pt` puntos dentro de `width_in` pulgadas."""
    if width_in <= 0:
        return 999
    per_line = max(1.0, width_in * 72.0 / (pt * CHAR_W))
    total = 0
    for para in str(text).split("\n"):
        # simula ajuste por palabras
        cur, n = 0, 1
        for w in para.split(" "):
            wl = len(w)
            if cur == 0:
                cur = wl
            elif cur + 1 + wl <= per_line:
                cur += 1 + wl
            else:
                n += 1
                cur = wl
            while cur > per_line:   # palabra más larga que la línea
                n += 1
                cur -= per_line
        total += n
    return total


def text_height_in(text, pt, width_in, space_after_pt=0.0):
    n = lines_needed(text, pt, width_in)
    return (n * pt * LINE_H + space_after_pt) / 72.0


def fit_font(text, width_in, height_in, max_pt, min_pt, step=1):
    """Mayor tamaño (pt) entre max_pt y min_pt con que `text` cabe; si ninguno, devuelve (min_pt, False)."""
    pt = max_pt
    while pt >= min_pt:
        if text_height_in(text, pt, width_in) <= height_in:
            return pt, True
        pt -= step
    return min_pt, False
