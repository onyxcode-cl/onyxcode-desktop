#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Revisión de calidad de un Word, Excel o PowerPoint ANTES de entregarlo (local, gratis, sin ArtCraft).

Uso:  verificar_office.py archivo.{docx,xlsx,pptx} [--json] [--arreglar SALIDA]
Imprime una lista corta «✔ / ✘» (lo que se comprobó y lo que falló). Salida: 0 todo bien, 1 hay fallos, 2 uso/no abre.

Word:       título con estilo Title/Heading · encabezados reales · viñetas con estilo de lista (no «•» escrito a mano) · tablas sin celdas vacías.
PowerPoint: cada diapositiva con marcador de título con texto · nada de texto, imagen, tabla o gráfico fuera de los bordes.
Excel:      totales con fórmula (no números pegados) · ninguna celda con error · fórmulas con valor calculado guardado.

`--arreglar SALIDA` (solo .pptx): escribe una COPIA donde el texto más grande de cada diapositiva sin título pasa a ser su marcador de título
(el aspecto no cambia; sirve al esquema, a la navegación y a los lectores de pantalla). Nunca sobrescribe el original.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore")

ERRORES = ("#DIV/0!", "#REF!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#NULL!")
ETIQUETA_TOTAL = re.compile(r"^\s*(total|subtotal|suma|promedio|media|total general)\b", re.I)
VINETA_A_MANO = re.compile(r"^\s*([•·▪●◦\-–*]|\d+[.)])\s+\S")


class Resultado:
    def __init__(self):
        self.items = []  # (ok, texto)

    def ok(self, texto):
        self.items.append((True, texto))

    def falla(self, texto):
        self.items.append((False, texto))

    def check(self, cond, bien, mal):
        (self.ok if cond else self.falla)(bien if cond else mal)

    @property
    def fallos(self):
        return [t for ok, t in self.items if not ok]


def _recorta(lista, n=5):
    return ", ".join(lista[:n]) + (" y %d más" % (len(lista) - n) if len(lista) > n else "")


# ---------------------------------------------------------------- Word
def revisa_docx(path):
    from docx import Document
    from docx.oxml.ns import qn

    r = Resultado()
    doc = Document(path)
    parrafos = [p for p in doc.paragraphs]
    con_texto = [p for p in parrafos if p.text.strip()]
    if not con_texto:
        r.falla("El documento no tiene texto")
        return r
    estilos = [(p.style.name if p.style is not None else "") for p in con_texto]
    titulo = [p for p, s in zip(con_texto, estilos) if s == "Title" or s.startswith("Heading")]
    primero = estilos[0]
    r.check(primero == "Title" or primero.startswith("Heading"),
            "El título usa un estilo de título («%s»)" % primero,
            "El primer párrafo («%s») está en estilo «%s», no Title/Heading: no entra al índice ni a la navegación" % (con_texto[0].text[:40], primero))
    n_head = sum(1 for s in estilos if s.startswith("Heading"))
    if len(con_texto) > 12:
        r.check(n_head > 0, "Tiene encabezados reales (%d)" % n_head,
                "Documento de %d párrafos sin encabezados Heading: usa estilos de encabezado, no texto grande en negrita" % len(con_texto))
    else:
        r.ok("Encabezados reales: %d" % n_head)
    # texto en negrita y grande que hace de encabezado sin estilo
    falsos = []
    for p, s in zip(con_texto, estilos):
        if s in ("Normal", "") and len(p.text) < 80 and p.runs and all(run.bold for run in p.runs if run.text.strip()):
            tam = [run.font.size.pt for run in p.runs if run.font.size]
            if tam and max(tam) >= 14:
                falsos.append(p.text[:30])
    r.check(not falsos, "Ningún encabezado falso (negrita grande en estilo Normal)",
            "Encabezados hechos a mano en estilo Normal: %s" % _recorta(falsos))
    # viñetas
    manual = [p.text[:30] for p, s in zip(con_texto, estilos)
              if not s.startswith(("List", "Heading", "Title")) and not p._p.xpath("./w:pPr/w:numPr") and VINETA_A_MANO.match(p.text)
              and not re.match(r"^\d+[.)]\s+\S{0,3}$", p.text)]
    r.check(not manual, "Las viñetas y listas usan estilo de lista",
            "%d párrafo(s) con viñeta o número escritos a mano sin estilo de lista: %s" % (len(manual), _recorta(manual)))
    # tablas
    vacias = []
    for i, t in enumerate(doc.tables, 1):
        if len(t.rows) < 2:
            continue
        for ri, fila in enumerate(t.rows):
            vistas = set()
            for ci, c in enumerate(fila.cells):
                if id(c._tc) in vistas:
                    continue  # celda combinada
                vistas.add(id(c._tc))
                if not c.text.strip():
                    vacias.append("tabla %d fila %d col %d" % (i, ri + 1, ci + 1))
    if doc.tables:
        r.check(not vacias, "Las %d tabla(s) no tienen celdas vacías" % len(doc.tables),
                "Celdas vacías en tablas: %s (pon el dato o «—»)" % _recorta(vacias))
    return r


# ---------------------------------------------------------------- PowerPoint
def _es_titulo(sh):
    try:
        return sh.is_placeholder and "TITLE" in str(sh.placeholder_format.type)
    except Exception:
        return False


def _tam_max(sh):
    tam = [run.font.size.pt for p in sh.text_frame.paragraphs for run in p.runs if run.font.size]
    return max(tam) if tam else 0


def candidato_titulo(slide, alto):
    """Forma de texto que hace de título: la de letra más grande entre las de la parte alta (35 % superior, letra ≥ 24 pt); si no hay,
    la de letra más grande de toda la diapositiva. Ignora formas sin texto."""
    cands = []
    for sh in slide.shapes:
        if _es_titulo(sh) or sh.is_placeholder or not sh.has_text_frame or not sh.text_frame.text.strip():
            continue
        cands.append((sh, _tam_max(sh), sh.top if sh.top is not None else 0))
    if not cands:
        return None
    altas = [c for c in cands if c[2] < alto * 0.35 and c[1] >= 24]
    pool = altas or cands
    return min(pool, key=lambda c: (-c[1], c[2]))[0]


def revisa_pptx(path):
    from pptx import Presentation
    from pptx.util import Emu

    r = Resultado()
    prs = Presentation(path)
    sw, sh_ = prs.slide_width, prs.slide_height
    sin_titulo, fuera = [], []
    tol = Emu(91440 // 4)
    for i, s in enumerate(prs.slides, 1):
        t = s.shapes.title
        if t is None or not t.has_text_frame or not t.text_frame.text.strip():
            sin_titulo.append(str(i))
        for sh in s.shapes:
            if sh.left is None or sh.width is None:
                continue
            # las formas decorativas sin texto pueden salirse a propósito
            relevante = (sh.has_text_frame and sh.text_frame.text.strip()) or getattr(sh, "has_table", False) or \
                getattr(sh, "has_chart", False) or "PICTURE" in str(sh.shape_type)
            if not relevante:
                continue
            if sh.left < -tol or sh.top < -tol or sh.left + sh.width > sw + tol or sh.top + sh.height > sh_ + tol:
                fuera.append("%d («%s»)" % (i, sh.name))
    n = len(prs.slides)
    if n == 0:
        r.falla("La presentación no tiene diapositivas")
        return r
    r.check(not sin_titulo, "Las %d diapositivas tienen marcador de título" % n,
            "%d diapositiva(s) sin marcador de título con texto (nº %s): sin él no hay esquema ni lectores de pantalla"
            % (len(sin_titulo), _recorta(sin_titulo, 12)))
    r.check(not fuera, "Nada fuera de los bordes", "Contenido fuera de los bordes en diapositiva %s" % _recorta(fuera))
    return r


def arregla_pptx(path, salida):
    from pptx import Presentation
    from pptx.oxml.ns import qn
    from lxml import etree

    if os.path.exists(salida):
        raise SystemExit("ERROR: la salida ya existe (no se sobrescribe): " + salida)
    prs = Presentation(path)
    cambios = 0
    for s in prs.slides:
        t = s.shapes.title
        if t is not None and t.has_text_frame and t.text_frame.text.strip():
            continue
        c = candidato_titulo(s, prs.slide_height)
        if c is None:
            continue
        nvpr = c._element.xpath("./p:nvSpPr/p:nvPr")
        if not nvpr:
            continue
        ph = etree.SubElement(nvpr[0], qn("p:ph"))
        ph.set("type", "title")
        nvpr[0].insert(0, ph)
        cambios += 1
    prs.save(salida)
    return cambios


# ---------------------------------------------------------------- Excel
def revisa_xlsx(path):
    from openpyxl import load_workbook

    r = Resultado()
    wf = load_workbook(path)
    wv = load_workbook(path, data_only=True)
    if not wf.worksheets:
        r.falla("El libro no tiene hojas")
        return r
    errores, sin_valor, pegados, formulas = [], [], [], 0
    for ws in wf.worksheets:
        wsv = wv[ws.title]
        for fila in ws.iter_rows():
            etiqueta = None
            for c in fila:
                if isinstance(c.value, str) and not c.value.startswith("=") and ETIQUETA_TOTAL.match(c.value):
                    etiqueta = c
                    break
            for c in fila:
                v = c.value
                vv = wsv[c.coordinate].value
                if isinstance(v, str) and v.startswith("="):
                    formulas += 1
                    if vv is None:
                        sin_valor.append("%s!%s" % (ws.title, c.coordinate))
                    if "#REF!" in v:
                        errores.append("%s!%s (%s)" % (ws.title, c.coordinate, "#REF!"))
                if isinstance(vv, str) and vv.strip() in ERRORES:
                    errores.append("%s!%s (%s)" % (ws.title, c.coordinate, vv.strip()))
                elif isinstance(v, str) and v.strip() in ERRORES:
                    errores.append("%s!%s (%s)" % (ws.title, c.coordinate, v.strip()))
                # total con número pegado
                if etiqueta is not None and c is not etiqueta and c.column > etiqueta.column and \
                        isinstance(v, (int, float)) and not isinstance(v, bool):
                    pegados.append("%s!%s" % (ws.title, c.coordinate))
    r.check(not errores, "Ninguna celda con error", "Celdas con error: %s" % _recorta(errores))
    r.check(not pegados, "Los totales son fórmulas vivas" if formulas else "Sin filas de total",
            "Fila de total con número pegado, no fórmula: %s" % _recorta(pegados))
    if formulas:
        r.check(not sin_valor, "Las %d fórmula(s) tienen valor calculado guardado" % formulas,
                "%d fórmula(s) sin valor recalculado (se verán vacías en visores que no calculan): %s. Recalcula con recalc_check.py o "
                "pasa `value` en la spec" % (len(sin_valor), _recorta(sin_valor)))
    else:
        r.ok("No hay fórmulas que recalcular")
    return r


def main(argv=None):
    ap = argparse.ArgumentParser(description="Revisión de calidad de un Office antes de entregarlo.")
    ap.add_argument("archivo")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--arreglar", metavar="SALIDA", help="solo .pptx: copia con marcadores de título")
    a = ap.parse_args(argv)
    if not os.path.isfile(a.archivo):
        print("ERROR: el archivo no existe: " + a.archivo, file=sys.stderr)
        return 2
    ext = os.path.splitext(a.archivo)[1].lower()
    fn = {".docx": revisa_docx, ".xlsx": revisa_xlsx, ".xlsm": revisa_xlsx, ".pptx": revisa_pptx}.get(ext)
    if fn is None:
        print("ERROR: solo .docx, .xlsx y .pptx", file=sys.stderr)
        return 2
    try:
        if a.arreglar:
            if ext != ".pptx":
                print("ERROR: --arreglar solo existe para .pptx", file=sys.stderr)
                return 2
            n = arregla_pptx(a.archivo, a.arreglar)
            print("Copia con %d marcador(es) de título nuevo(s): %s" % (n, a.arreglar))
            a.archivo = a.arreglar
        r = fn(a.archivo)
    except ImportError as e:
        print("ERROR: falta una librería (%s). Ejecuta _shared/doctor.py." % e, file=sys.stderr)
        return 2
    except Exception as e:
        print("ERROR: no se pudo abrir el archivo (%s)" % e, file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps({"archivo": a.archivo, "ok": not r.fallos, "items": [{"ok": o, "texto": t} for o, t in r.items]},
                         ensure_ascii=False, indent=1))
    else:
        print("Revisión de calidad: " + os.path.basename(a.archivo))
        for ok, t in r.items:
            print(("  ✔ " if ok else "  ✘ ") + t)
        print("RESULTADO: " + ("OK" if not r.fallos else "%d FALLO(S): corrígelos y vuelve a revisar antes de entregar" % len(r.fallos)))
    return 1 if r.fallos else 0


if __name__ == "__main__":
    sys.exit(main())
