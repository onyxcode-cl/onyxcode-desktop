#!/usr/bin/env python3
"""Verifica una presentación HTML SIN el navegador integrado de la app (suele estar apagado): `python3 html_a_png.py presentacion.html carpeta_nueva`.

Imprime el HTML con el mismo Chromium sin ventana que usa `build_chat_pdf.py` (la skill pdf; modo impresión: una diapositiva por página, como pide
la guía) y convierte cada página en un PNG, más `miniaturas.png` con todas juntas: MÍRALAS con la herramienta de imágenes y corrige lo que falle.

Códigos: 0 ok · 1 error (el mensaje dice qué corregir) · 2 uso · 3 no hay navegador Chromium en el equipo (dilo en «Para revisar»; verificación solo estructural).
"""
import importlib.util
import os
import sys
import tempfile
import shutil

ANCHO_PX = 1280  # ancho de cada PNG; la altura sale de la proporción de la página


def cargar_pdf_chat():
    """Importa `build_chat_pdf.py` de la skill pdf (carpeta hermana de esta skill dentro de `skills/`)."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    ruta = os.path.normpath(os.path.join(aqui, "..", "..", "pdf", "scripts", "build_chat_pdf.py"))
    if not os.path.isfile(ruta):
        raise FileNotFoundError("no encuentro build_chat_pdf.py de la skill pdf (%s)" % ruta)
    spec = importlib.util.spec_from_file_location("build_chat_pdf", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv):
    if len(argv) != 3:
        print("Uso: html_a_png.py presentacion.html carpeta_nueva", file=sys.stderr)
        return 2
    html, salida = argv[1], os.path.abspath(argv[2])
    if os.path.lexists(salida) and os.listdir(salida) if os.path.isdir(salida) else os.path.lexists(salida):
        print("ERROR: %s ya existe y no está vacía: elige una carpeta nueva (no se sobrescribe)" % argv[2], file=sys.stderr)
        return 1
    try:
        pdfmod = cargar_pdf_chat()
    except (OSError, ImportError) as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 1
    if not pdfmod.buscar_navegador():
        print("Aviso: no hay un navegador Chromium en este equipo; no se puede renderizar el HTML (verificación solo estructural).", file=sys.stderr)
        return 3
    tmp = tempfile.mkdtemp(prefix="lazunox-html-png-")
    try:
        pdf = os.path.join(tmp, "p.pdf")
        codigo = pdfmod.main(["build_chat_pdf.py", html, pdf])
        if codigo != 0:
            return codigo
        try:
            import fitz  # PyMuPDF, incluido con el Python de la app
            from PIL import Image
        except ImportError as e:
            print("ERROR: falta una librería de Python (%s)" % e, file=sys.stderr)
            return 1
        os.makedirs(salida, exist_ok=True)
        base = os.path.splitext(os.path.basename(html))[0]
        paginas = []
        with fitz.open(pdf) as doc:
            if doc.page_count == 0:
                print("ERROR: el HTML no produjo ninguna página imprimible (revisa el CSS de impresión).", file=sys.stderr)
                return 1
            for i, pg in enumerate(doc, 1):
                zoom = ANCHO_PX / pg.rect.width
                ruta = os.path.join(salida, "%s-p%02d.png" % (base, i))
                pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(ruta)
                paginas.append(ruta)
        ims = [Image.open(p).convert("RGB") for p in paginas]
        w = 640
        ims = [im.resize((w, max(1, int(im.height * w / im.width)))) for im in ims]
        cols = 2 if len(ims) > 1 else 1
        filas = (len(ims) + cols - 1) // cols
        h = max(im.height for im in ims)
        hoja = Image.new("RGB", (cols * w + (cols - 1) * 8, filas * h + (filas - 1) * 8), "white")
        for n, im in enumerate(ims):
            hoja.paste(im, ((n % cols) * (w + 8), (n // cols) * (h + 8)))
        hoja.save(os.path.join(salida, "miniaturas.png"))
        print("Renderizado: %d página(s) en %s (miniaturas.png con todas)" % (len(paginas), argv[2]))
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
