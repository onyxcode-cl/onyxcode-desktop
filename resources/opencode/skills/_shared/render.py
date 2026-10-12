#!/usr/bin/env python3
"""Renderiza un documento a PNG por página. Imprime solo JSON.

pptx → DeckCraft, docx → WordCraft, xlsx → GridCraft (programas de ArtCraft, que instala la app); pdf → pypdfium2.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

AVISO_SIN_ARTCRAFT = ("El diseñador de documentos (ArtCraft) no está instalado: se hace solo la verificación estructural. "
                      "Díselo a la persona: se instala desde Ajustes › Tareas › Componentes opcionales.")


def _ejecutable(ruta):
    return bool(ruta) and os.path.isfile(ruta) and os.access(ruta, os.X_OK)


def exe_name(nombre):
    """Nombre del ejecutable de un programa de ArtCraft según la plataforma: `deckcraft-cli` → `deckcraft-cli.exe` en Windows."""
    return nombre + ".exe" if sys.platform == "win32" else nombre


def entorno_minimo(home):
    """Entorno mínimo y sin shell para ejecutar programas de ArtCraft. Todo apunta a la carpeta temporal `home` (no toca la
    configuración del usuario). macOS/Linux: PATH fijo y carpetas XDG. Windows: SystemRoot + System32 en el PATH y las carpetas
    de perfil (USERPROFILE, APPDATA, LOCALAPPDATA, TEMP, TMP) dentro de `home`."""
    if sys.platform == "win32":
        raiz = os.environ.get("SystemRoot") or os.environ.get("SYSTEMROOT") or "C:\\Windows"
        return {"SystemRoot": raiz, "PATH": raiz + "\\System32;" + raiz,
                "HOME": home, "USERPROFILE": home, "APPDATA": home, "LOCALAPPDATA": home, "TEMP": home, "TMP": home}
    return {"PATH": "/usr/bin:/bin", "HOME": home, "XDG_CONFIG_HOME": home, "XDG_DATA_HOME": home,
            "XDG_CACHE_HOME": home, "XDG_STATE_HOME": home}


def _buscar_craft(var, nombre, marcas):
    """Programa de ArtCraft (DeckCraft/WordCraft) que instaló la app: `$var` si el motor lo recibió al arrancar; si no (se instaló
    después), el de `$LAZUNOX_BIN_DIR/craft-*/*/<exe>` cuya carpeta tenga alguna de las `marcas` de instalación completa."""
    ruta = os.environ.get(var)
    if _ejecutable(ruta):
        return ruta
    base = os.environ.get("LAZUNOX_BIN_DIR")
    if base:
        for d in sorted(glob.glob(os.path.join(base, "craft-*")), reverse=True):
            if not any(os.path.isfile(os.path.join(d, m)) for m in marcas):
                continue
            for cand in sorted(glob.glob(os.path.join(d, "*", exe_name(nombre))), reverse=True):
                if _ejecutable(cand):
                    return cand
    return None


def buscar_deckcraft():
    return _buscar_craft("LAZUNOX_DECKCRAFT", "deckcraft-cli", ("installed-deckcraft.json", "installed.json"))


def buscar_wordcraft():
    return _buscar_craft("LAZUNOX_WORDCRAFT", "wordcraft-cli", ("installed-wordcraft.json",))


def buscar_gridcraft():
    return _buscar_craft("LAZUNOX_GRIDCRAFT", "gridcraft-cli", ("installed-gridcraft.json",))


def _craft_run(args, timeout=90):
    """Ejecuta un programa de ArtCraft sin shell, con carpetas de datos propias (no toca la configuración del usuario)."""
    home = tempfile.mkdtemp(prefix="lazunox-craft-")
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=entorno_minimo(home))
    finally:
        shutil.rmtree(home, ignore_errors=True)


def render_craft(origen, ext, outdir, max_pages, avisos):
    """PNG por página con ArtCraft: .pptx con DeckCraft y .docx con WordCraft. Devuelve (pngs, total) o None (con un aviso)."""
    base = os.path.splitext(os.path.basename(origen))[0]
    exe = buscar_deckcraft() if ext == ".pptx" else buscar_wordcraft()
    if not exe:
        avisos.append(AVISO_SIN_ARTCRAFT)
        return None
    pngs = []
    try:
        if ext == ".pptx":
            tmp = tempfile.mkdtemp(prefix="lazunox-craft-png-")
            try:
                r = _craft_run([exe, "render", origen, "--all", os.path.join(tmp, "s")])
                lista = sorted(glob.glob(os.path.join(tmp, "s", "slide-*.png")))
                if r.returncode != 0 or not lista:
                    avisos.append("DeckCraft no pudo renderizar el archivo: solo verificación estructural. %s"
                                  % (r.stderr or "").strip()[:200])
                    return None
                for i, f in enumerate(lista[:max_pages]):
                    ruta = os.path.join(outdir, "%s-p%02d.png" % (base, i + 1))
                    shutil.copyfile(f, ruta)
                    pngs.append(ruta)
                return pngs, len(lista)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        r = _craft_run([exe, "info", origen])
        try:
            total = int(json.loads(r.stdout)["pages"])
        except (ValueError, KeyError, TypeError):
            avisos.append("WordCraft no pudo leer el documento: solo verificación estructural. %s" % (r.stderr or "").strip()[:200])
            return None
        for i in range(1, min(total, max_pages) + 1):  # WordCraft numera las páginas desde 1
            ruta = os.path.join(outdir, "%s-p%02d.png" % (base, i))
            r = _craft_run([exe, "render", origen, ruta, "--page", str(i)])
            if r.returncode != 0 or not os.path.isfile(ruta):
                avisos.append("WordCraft no pudo dibujar la página %d: solo verificación estructural." % i)
                return None
            pngs.append(ruta)
        return pngs, total
    except (OSError, subprocess.TimeoutExpired) as e:
        avisos.append("No se pudo usar ArtCraft para revisar (%s): solo verificación estructural." % e)
    return None


def salida(res, codigo):
    print(json.dumps(res, ensure_ascii=False))
    sys.exit(codigo)


def main():
    ap = argparse.ArgumentParser(description="Renderiza docx/xlsx/pptx/pdf a PNG (una imagen por página).")
    ap.add_argument("archivo", help="archivo .docx, .xlsx, .pptx o .pdf")
    ap.add_argument("--outdir", required=True, help="carpeta de salida (se crea si no existe)")
    ap.add_argument("--dpi", type=int, default=110, help="resolución (por defecto 110)")
    ap.add_argument("--max-pages", type=int, default=20, help="máximo de páginas a rasterizar (por defecto 20)")
    try:
        a = ap.parse_args()
    except SystemExit as e:
        sys.exit(2 if e.code not in (0, None) else 0)

    avisos = []
    res = {"ok": False, "motor": None, "pdf": None, "pngs": [], "paginas": 0, "avisos": avisos}
    if not os.path.isfile(a.archivo):
        avisos.append("el archivo no existe: %s" % a.archivo)
        salida(res, 1)
    if a.dpi < 20 or a.max_pages < 1:
        print("uso incorrecto: --dpi debe ser >= 20 y --max-pages >= 1", file=sys.stderr)
        sys.exit(2)
    outdir = os.path.abspath(a.outdir)
    os.makedirs(outdir, exist_ok=True)
    origen = os.path.abspath(a.archivo)
    ext = os.path.splitext(origen)[1].lower()

    if ext in (".pptx", ".docx"):
        hecho = render_craft(origen, ext, outdir, a.max_pages, avisos)
        if not hecho:
            salida(res, 1)
        res["pngs"], res["paginas"] = hecho
        res["motor"] = "artcraft"
        if res["paginas"] > a.max_pages:
            avisos.append("el documento tiene %d páginas; solo se rasterizaron las primeras %d." % (res["paginas"], a.max_pages))
        res["ok"] = True
        salida(res, 0)
    if ext == ".xlsx":  # GridCraft (ArtCraft)
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import render_grid
        if not buscar_gridcraft():
            avisos.append(AVISO_SIN_ARTCRAFT)
            salida(res, 1)
        hecho = render_grid.render_xlsx(origen, outdir, a.max_pages, a.dpi, avisos)
        if not hecho:
            salida(res, 1)
        res.update(ok=True, pngs=hecho[0], paginas=hecho[1], motor="gridcraft")
        salida(res, 0)
    if ext != ".pdf":
        avisos.append("formato no soportado: %s (usa docx, xlsx, pptx o pdf)" % ext)
        salida(res, 1)
    pdf = origen
    res["pdf"] = pdf

    try:
        import pypdfium2 as pdfium
    except ImportError:
        avisos.append("falta la librería pypdfium2: no se pueden generar PNG.")
        salida(res, 1)
    try:
        doc = pdfium.PdfDocument(pdf)
        total = len(doc)
        res["paginas"] = total
        if total > a.max_pages:
            avisos.append("el documento tiene %d páginas; solo se rasterizaron las primeras %d." % (total, a.max_pages))
        base = os.path.splitext(os.path.basename(pdf))[0]
        for i in range(min(total, a.max_pages)):
            img = doc[i].render(scale=a.dpi / 72.0).to_pil().convert("RGB")
            ruta = os.path.join(outdir, "%s-p%02d.png" % (base, i + 1))
            img.save(ruta)
            res["pngs"].append(ruta)
        doc.close()
    except Exception as e:  # PDF dañado, etc.
        avisos.append("error al rasterizar el PDF: %s" % e)
        salida(res, 1)
    res["ok"] = bool(res["pngs"])
    if not res["ok"]:
        avisos.append("el PDF no tiene páginas.")
    salida(res, 0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
