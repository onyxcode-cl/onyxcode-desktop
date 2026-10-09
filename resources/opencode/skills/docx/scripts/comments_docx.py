#!/usr/bin/env python3
"""Añade o lista comentarios de Word (requiere python-docx >= 1.2).

Uso:
  python comments_docx.py listar entrada.docx
  python comments_docx.py añadir entrada.docx salida.docx --texto-ancla "frase" --comentario "texto" [--autor Lazunox]
  (--texto-ancla/--comentario se pueden repetir en pares)
Códigos de salida: 0 ok, 1 error (ancla no encontrada...), 2 uso.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docx import Document  # noqa: E402


def runs_covering(paragraph, needle):
    """Runs (de nivel directo) que cubren la primera aparición de `needle`."""
    runs = paragraph.runs
    full = "".join(r.text for r in runs)
    pos = full.find(needle)
    if pos < 0:
        return None
    end = pos + len(needle)
    out, off = [], 0
    for r in runs:
        a, b = off, off + len(r.text)
        if b > pos and a < end and r.text:
            out.append(r)
        off = b
    return out


def all_paragraphs(doc):
    for p in doc.paragraphs:
        yield p
    for t in doc.tables:
        for row in t.rows:
            for c in row.cells:
                for p in c.paragraphs:
                    yield p


def listar(path):
    doc = Document(path)
    if not hasattr(doc, "comments"):
        print("ERROR: esta versión de python-docx no soporta comentarios (requiere >= 1.2)", file=sys.stderr)
        return 1
    n = 0
    for c in doc.comments:
        n += 1
        print("#%s | %s | %s" % (c.comment_id, c.author, c.text.replace("\n", " ")))
    print("Total: %d comentario(s)" % n)
    return 0


def anadir(src, dst, pares, autor, iniciales):
    doc = Document(src)
    if not hasattr(doc, "add_comment"):
        print("ERROR: python-docx >= 1.2 es necesario para añadir comentarios", file=sys.stderr)
        return 1
    errores = 0
    for ancla, texto in pares:
        done = False
        for p in all_paragraphs(doc):
            runs = runs_covering(p, ancla)
            if runs:
                doc.add_comment(runs, text=texto, author=autor, initials=iniciales)
                print("Comentario añadido sobre «%s»" % ancla)
                done = True
                break
        if not done:
            print("ERROR: no se encontró el texto ancla: «%s»" % ancla, file=sys.stderr)
            errores += 1
    if errores:
        print("No se guardó nada: corrija las anclas y reintente.", file=sys.stderr)
        return 1
    doc.save(dst)
    print("Guardado: " + dst)
    return 0


def main():
    ap = argparse.ArgumentParser(description="Comentarios de Word: listar o añadir.")
    sub = ap.add_subparsers(dest="cmd")
    s1 = sub.add_parser("listar", help="lista los comentarios existentes")
    s1.add_argument("entrada")
    s2 = sub.add_parser("añadir", aliases=["anadir"], help="añade comentarios creando una copia")
    s2.add_argument("entrada")
    s2.add_argument("salida")
    s2.add_argument("--texto-ancla", action="append", default=[], help="texto del documento a comentar")
    s2.add_argument("--comentario", action="append", default=[], help="texto del comentario")
    s2.add_argument("--autor", default="Lazunox")
    s2.add_argument("--iniciales", default="LZ")
    a = ap.parse_args()
    if not a.cmd:
        ap.print_help()
        sys.exit(2)
    if not os.path.isfile(a.entrada):
        print("ERROR: el archivo no existe: " + a.entrada, file=sys.stderr)
        sys.exit(2)
    if a.cmd == "listar":
        sys.exit(listar(a.entrada))
    if len(a.texto_ancla) != len(a.comentario) or not a.texto_ancla:
        print("ERROR: indique pares --texto-ancla/--comentario (misma cantidad)", file=sys.stderr)
        sys.exit(2)
    if os.path.exists(a.salida):
        print("ERROR: la salida ya existe, use otro nombre: " + a.salida, file=sys.stderr)
        sys.exit(2)
    sys.exit(anadir(a.entrada, a.salida, list(zip(a.texto_ancla, a.comentario)), a.autor, a.iniciales))


if __name__ == "__main__":
    main()
