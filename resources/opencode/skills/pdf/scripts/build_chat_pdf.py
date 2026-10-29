#!/usr/bin/env python3
"""PDF con el MISMO HTML y el mismo motor de impresión que el Chat: `python3 build_chat_pdf.py documento.html salida.pdf`.

En el Chat el modelo escribe UN bloque ```html (con `<style>` embebido) y la app lo imprime a PDF con Chromium (A4, con fondos, `@page` del propio
HTML manda). Aquí se hace lo mismo con el Chromium/Chrome/Edge/Brave que haya en el equipo (modo sin ventana), con las MISMAS reglas de contenido que
el Chat: sin red (solo imágenes `data:`), el HTML es DATO (se imprime, no se ejecuta nada con permisos: CSP idéntica a la del Chat, resolutor de nombres
apagado, perfil temporal propio) y la salida nunca sobrescribe un archivo existente.

Códigos: 0 ok · 1 error de contenido o del navegador (el mensaje dice qué corregir) · 2 uso · 3 no hay navegador Chromium en el equipo
(no insistas: sigue con `build_pdf.py`, diseño estándar con reportlab).
"""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

MAX_HTML_BYTES = 5 * 1024 * 1024  # el mismo tope que el Chat
# Misma política que `ARTIFACT_CSP` de la app (una prueba exige que sigan iguales).
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; "
       "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'")

CANDIDATOS = {
    "darwin": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
               "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
    "win32": [r"%ProgramFiles%\Google\Chrome\Application\chrome.exe", r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
              r"%LocalAppData%\Google\Chrome\Application\chrome.exe", r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
              r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe", r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"],
}


def buscar_navegador():
    """`$LAZUNOX_CHROMIUM` (ruta absoluta a un ejecutable) o el primer Chromium conocido instalado. `None` si no hay."""
    ruta = os.environ.get("LAZUNOX_CHROMIUM")
    if ruta and os.path.isabs(ruta) and os.path.isfile(ruta) and os.access(ruta, os.X_OK):
        return ruta
    for c in CANDIDATOS.get(sys.platform, []):
        c = os.path.expandvars(c)
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    for nombre in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        r = shutil.which(nombre)
        if r:
            return r
    return None


def preparar(html):
    """Como el Chat: antepone el <meta> CSP (y un `@page` A4 por defecto que el CSS del propio documento puede pisar)."""
    meta = '<meta http-equiv="Content-Security-Policy" content="%s">' % CSP
    base = "<style>@page{size:A4}</style>"
    if re.search(r"<html[\s>]", html, re.I) or re.search(r"<!doctype", html, re.I):
        m = re.match(r"\s*<!doctype[^>]*>", html, re.I)
        doctype = m.group(0) if m else ""
        resto = html[len(doctype):]
        # la base va justo tras el <head> (si existe) para que el CSS del documento, que viene después, la pise
        resto, n = re.subn(r"(<head[^>]*>)", lambda mm: mm.group(1) + base, resto, count=1, flags=re.I)
        return (doctype or "<!doctype html>") + meta + (resto if n else base + resto)
    return '<!doctype html><html lang="es"><head>%s<meta charset="utf-8">%s</head><body>%s</body></html>' % (meta, base, html)


def main(argv):
    if len(argv) != 3 or not argv[2].lower().endswith(".pdf"):
        print("Uso: build_chat_pdf.py documento.html salida.pdf", file=sys.stderr)
        return 2
    navegador = buscar_navegador()
    if not navegador:
        print("Aviso: no hay un navegador Chromium (Chrome, Edge, Brave o Chromium) en este equipo; usa build_pdf.py (diseño estándar).", file=sys.stderr)
        return 3
    salida = os.path.abspath(argv[2])
    try:
        if os.path.getsize(argv[1]) > MAX_HTML_BYTES:
            raise ValueError("el HTML supera 5 MB")
        with open(argv[1], encoding="utf-8") as f:
            html = f.read()
        if not html.strip():
            raise ValueError("el HTML está vacío")
        if not os.path.isdir(os.path.dirname(salida)):
            raise ValueError("la carpeta de salida no existe")
        if os.path.lexists(salida):
            raise ValueError("%s ya existe: elige otro nombre (no se sobrescribe)" % os.path.basename(salida))
    except (OSError, ValueError, UnicodeDecodeError) as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 1
    tmp = tempfile.mkdtemp(prefix="lazunox-chatpdf-")
    try:
        src = os.path.join(tmp, "documento.html")
        pdf = os.path.join(tmp, "documento.pdf")
        with open(src, "w", encoding="utf-8") as f:
            f.write(preparar(html))
        args = [navegador, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                "--disable-sync", "--disable-background-networking", "--user-data-dir=" + os.path.join(tmp, "perfil"),
                "--host-resolver-rules=MAP * ~NOTFOUND", "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
                "--virtual-time-budget=4000", "--print-to-pdf=" + pdf, "file://" + src.replace(os.sep, "/") if os.sep == "/" else "file:///" + src.replace(os.sep, "/")]
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired) as e:
            print("ERROR: el navegador no pudo imprimir el PDF: %s" % e, file=sys.stderr)
            return 1
        if not os.path.isfile(pdf) or open(pdf, "rb").read(4) != b"%PDF":
            print("ERROR: el navegador no generó el PDF (%s)" % (r.stderr or "sin detalle")[-300:], file=sys.stderr)
            return 1
        try:
            with open(pdf, "rb") as origen, open(os.open(salida, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644), "wb") as destino:
                shutil.copyfileobj(origen, destino)
        except OSError as e:
            print("ERROR: no se pudo escribir %s: %s" % (os.path.basename(salida), e), file=sys.stderr)
            return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("PDF creado: %s (HTML del Chat impreso con %s)" % (argv[2], os.path.basename(navegador)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
