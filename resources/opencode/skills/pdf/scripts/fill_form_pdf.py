#!/usr/bin/env python3
"""Lista y rellena campos de formulario (AcroForm) de un PDF; aplanado opcional."""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_util import abrir_lector, error, exigir_salida_nueva  # noqa: E402


def _campos(lector):
    try:
        return lector.get_fields() or {}
    except Exception:  # noqa: BLE001
        return {}


def main():
    ap = argparse.ArgumentParser(
        description="Formularios PDF. Ejemplos:\n  fill_form_pdf.py listar ficha.pdf [--json]\n"
                    "  fill_form_pdf.py rellenar ficha.pdf --campo nombre=\"Ana Pérez\" --campo acepta=Sí -o ficha-v2.pdf\n"
                    "  fill_form_pdf.py rellenar ficha.pdf --datos datos.json --aplanar -o ficha-final.pdf",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("listar")
    l.add_argument("pdf")
    l.add_argument("--json", action="store_true")
    l.add_argument("--clave")
    r = sub.add_parser("rellenar")
    r.add_argument("pdf")
    r.add_argument("--datos", help="JSON {campo: valor}")
    r.add_argument("--campo", action="append", default=[], help="nombre=valor (repetible)")
    r.add_argument("--aplanar", action="store_true", help="convierte los campos en texto fijo (ya no editable)")
    r.add_argument("-o", "--salida", required=True)
    r.add_argument("--clave")
    a = ap.parse_args()

    lector = abrir_lector(a.pdf, a.clave)
    campos = _campos(lector)
    if not campos:
        print("AVISO: este PDF no tiene campos de formulario (AcroForm). No se puede rellenar como "
              "formulario. Alternativa: generar el documento con build_pdf.py o estampar texto en "
              "posiciones concretas (indícalo en «Para revisar»).", file=sys.stderr)
        sys.exit(2)

    if a.cmd == "listar":
        info = []
        for nombre, c in campos.items():
            info.append({"nombre": nombre, "tipo": str(c.get("/FT", "")), "valor": str(c.get("/V", "")) if c.get("/V") is not None else "",
                         "opciones": [str(o) for o in c.get("/_States_", [])] if c.get("/_States_") else []})
        if a.json:
            print(json.dumps(info, ensure_ascii=False, indent=2))
        else:
            tipos = {"/Tx": "texto", "/Btn": "casilla/botón", "/Ch": "lista", "/Sig": "firma"}
            print("%d campo(s):" % len(info))
            for c in info:
                extra = (" opciones=%s" % c["opciones"]) if c["opciones"] else ""
                print("- %s [%s] valor=%r%s" % (c["nombre"], tipos.get(c["tipo"], c["tipo"]), c["valor"], extra))
        return

    valores = {}
    if a.datos:
        try:
            with open(a.datos, encoding="utf-8") as f:
                valores.update(json.load(f))
        except (OSError, ValueError) as e:
            error("no se pudo leer --datos: %s" % e)
    for par in a.campo:
        if "=" not in par:
            error("--campo debe ser nombre=valor, recibí «%s»" % par)
        k, v = par.split("=", 1)
        valores[k] = v
    if not valores:
        error("no indicaste valores (usa --campo nombre=valor o --datos archivo.json)")
    desconocidos = [k for k in valores if k not in campos]
    if desconocidos:
        error("campos que no existen: %s. Disponibles: %s" % (", ".join(desconocidos), ", ".join(campos)))

    from pypdf import PdfWriter
    w = PdfWriter(clone_from=lector)
    valores = {k: str(v) for k, v in valores.items()}
    for pg in w.pages:
        w.update_page_form_field_values(pg, valores, auto_regenerate=False, flatten=a.aplanar)
    if not a.aplanar:
        w.set_need_appearances_writer(True)
    exigir_salida_nueva(a.salida)
    with open(a.salida, "wb") as f:
        w.write(f)
    print("Listo: %s (%d campo(s) rellenado(s)%s)" % (a.salida, len(valores), ", aplanado" if a.aplanar else ""))


if __name__ == "__main__":
    main()
