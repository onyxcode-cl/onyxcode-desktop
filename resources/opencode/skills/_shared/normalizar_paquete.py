#!/usr/bin/env python3
"""Copia LIMPIA de un documento antes de traducirlo o editarlo (Word, Excel, PowerPoint y PDF): `normalizar_paquete.py entrada salida`.

Los archivos reales traen basura que no es del documento: la papelera de Word (`[trash]/0000.dat`), miniaturas, `__MACOSX/`, partes que ninguna
relación usa, entradas repetidas o con mayúsculas distintas, nombres con `\\`, entradas vacías, relaciones que apuntan a partes que no existen.
Las bibliotecas (python-docx, openpyxl, python-pptx) no vuelven a guardar nada de eso, y comparar la salida con el original acusaba «falta la
parte». Aquí se arma UNA copia normalizada y se trabaja (y se compara) sobre ella. El original de la persona no se toca nunca.

  OOXML (docx, xlsx, pptx y sus variantes con macros): solo quedan las partes alcanzables desde las relaciones, con el ZIP reescrito sin nombres
        raros ni duplicados; se quitan las relaciones rotas y los tipos de contenido de partes que ya no están. Macros, objetos OLE, tablas
        dinámicas, medios, comentarios y cambios controlados SON alcanzables y se conservan tal cual.
  PDF:  PyMuPDF lo abre (reparando lo que pueda) y lo vuelve a guardar sin objetos huérfanos, sin JavaScript ni miniaturas.
Uso desde otros scripts: `preparar(ruta)` → `Resultado(ruta, avisos)`; la carpeta temporal se borra sola al terminar el programa.
Solo estándar de Python (PDF: PyMuPDF). Códigos al usarlo como programa: 0 ok, 2 archivo ilegible.
"""
from __future__ import annotations

import atexit
import os
import re
import shutil
import sys
import tempfile
import zipfile
from urllib.parse import unquote
from xml.etree import ElementTree as ET

MAX_DESCOMPRIMIDO = 300 * 1024 * 1024   # más que esto es una bomba de compresión, no un documento
MAX_ENTRADAS = 5000
REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CT_PRINCIPAL = {
    # macros y plantillas → documento normal (python-docx/python-pptx rechazan esos tipos); solo con `quitar_macros`
    "application/vnd.ms-word.document.macroEnabled.main+xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "application/vnd.ms-word.template.macroEnabledTemplate.main+xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    "application/vnd.ms-powerpoint.template.macroEnabled.main+xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    "application/vnd.ms-excel.sheet.macroEnabled.main+xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "application/vnd.ms-excel.template.macroEnabled.main+xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
}


class PaqueteIlegible(Exception):
    """El archivo no se puede abrir como documento (el mensaje va en español simple para la persona)."""


class Resultado:
    def __init__(self, ruta, avisos, cambios):
        self.ruta = ruta
        self.avisos = avisos
        self.cambios = cambios


_temporales = []


def _carpeta_temporal():
    d = tempfile.mkdtemp(prefix="lzx-limpio-")
    _temporales.append(d)
    return d


@atexit.register
def _limpiar_temporales():
    for d in _temporales:
        shutil.rmtree(d, ignore_errors=True)


def limpiar_ahora():
    _limpiar_temporales()
    del _temporales[:]


# ------------------------------------------------------------------ nombres
def _nombre_limpio(n):
    """Nombre de parte normalizado (barras `/`, sin `./` ni `/` inicial) o None si no es un nombre aceptable."""
    if not n or any(ord(c) < 32 for c in n):
        return None
    n = n.replace("\\", "/")
    partes = []
    for p in n.split("/"):
        if p in ("", "."):
            continue
        if p == "..":
            return None   # intento de salirse de la carpeta (zip-slip): no es una parte del documento
        partes.append(p)
    if not partes or re.match(r"^[A-Za-z]:$", partes[0]):
        return None
    return "/".join(partes)


def _resolver(carpeta, destino):
    """Ruta de la parte a la que apunta una relación (`carpeta` es la de la parte dueña, con `/` final o vacía)."""
    destino = unquote(destino.split("#", 1)[0])
    if not destino:
        return None
    ruta = destino.lstrip("/") if destino.startswith("/") else carpeta + destino
    partes = []
    for p in ruta.replace("\\", "/").split("/"):
        if p == "..":
            if partes:
                partes.pop()
        elif p not in ("", "."):
            partes.append(p)
    return "/".join(partes)


def _rels_de(parte):
    if parte == "":
        return "_rels/.rels"
    carpeta, _, base = parte.rpartition("/")
    return (carpeta + "/" if carpeta else "") + "_rels/" + base + ".rels"


def _dueno_de_rels(rels):
    """Parte dueña de un archivo .rels ('' = el paquete); None si el nombre no sigue el patrón."""
    if rels == "_rels/.rels":
        return ""
    m = re.match(r"^(.*?)_rels/([^/]+)\.rels$", rels)
    if not m:
        return None
    return m.group(1) + m.group(2)


# ------------------------------------------------------------------ OOXML
def normalizar_ooxml(origen, destino, quitar_macros=False):
    """Escribe en `destino` la copia limpia de `origen`. Devuelve la lista de avisos (español simple). Lanza PaqueteIlegible."""
    avisos = []
    try:
        z = zipfile.ZipFile(origen)
    except (zipfile.BadZipFile, OSError) as e:
        raise PaqueteIlegible("el archivo no es un documento de Office válido (%s)." % e)
    with z:
        info = z.infolist()
        if len(info) > MAX_ENTRADAS or sum(i.file_size for i in info) > MAX_DESCOMPRIMIDO:
            raise PaqueteIlegible("el archivo es demasiado grande al descomprimirse (%d archivos): no se procesa." % len(info))
        # 1) nombres limpios; las entradas repetidas (o con otras mayúsculas) quedan agrupadas
        grupos = {}   # minúsculas → [(nombre limpio, ZipInfo)]
        raros = 0
        for i in info:
            if i.filename.endswith("/") or i.filename.replace("\\", "/").endswith("/"):
                continue   # carpetas
            n = _nombre_limpio(i.filename)
            if n is None:
                raros += 1
                continue
            if i.flag_bits & 0x1:
                raise PaqueteIlegible("el documento está protegido con contraseña: ábrelo y guárdalo sin protección.")
            grupos.setdefault(n.lower(), []).append((n, i))
        if raros:
            avisos.append("se descartaron %d entradas del archivo con nombres no válidos" % raros)
        indice = {k: v[-1][0] for k, v in grupos.items()}

        def leer(n_info):
            try:
                return z.read(n_info)
            except (zipfile.BadZipFile, RuntimeError, OSError, EOFError, NotImplementedError) as e:
                raise PaqueteIlegible("la parte «%s» del documento está dañada (%s)." % (n_info.filename, e))

        if "[content_types].xml" not in grupos:
            raise PaqueteIlegible("el archivo no es un documento de Office: falta [Content_Types].xml.")

        # 2) qué partes se alcanzan desde las relaciones (si las relaciones no se pueden leer, no se descarta nada)
        cache = {}   # minúsculas → bytes ya leídos (solo .rels y tipos de contenido)

        def datos_xml(k):
            if k not in cache:
                cache[k] = leer(grupos[k][-1][1])
            return cache[k]

        modificados = {}   # minúsculas → bytes nuevos (relaciones y tipos de contenido corregidos)
        if quitar_macros:
            ct0 = datos_xml("[content_types].xml").decode("utf-8", "replace")
            ct1 = ct0
            for viejo, nuevo in CT_PRINCIPAL.items():
                ct1 = ct1.replace(viejo, nuevo)
            if ct1 != ct0:
                cache["[content_types].xml"] = ct1.encode("utf-8")
                modificados["[content_types].xml"] = cache["[content_types].xml"]
                avisos.append("el documento era una plantilla o traía macros: la copia es un documento normal y las macros no se conservan")
                for rk in [x for x in grupos if x.endswith(".rels")]:
                    t = datos_xml(rk).decode("utf-8", "replace")
                    t2 = re.sub(r'<(?:\w+:)?Relationship\b[^>]*\bType="[^"]*/vbaProject(?:Signature)?"[^>]*?/>', "", t)
                    if t2 != t:
                        cache[rk] = t2.encode("utf-8")
                        modificados[rk] = cache[rk]

        alcanzadas, cola, exacto, rotas = set(), [""], {}, {}   # rotas: rels → [Id] sin destino
        confiable = "_rels/.rels" in grupos
        while cola and confiable:
            parte = cola.pop()
            if parte in alcanzadas:
                continue
            alcanzadas.add(parte)
            rk = _rels_de(parte).lower()
            if rk not in grupos:
                continue
            try:
                raiz = ET.fromstring(datos_xml(rk))
            except ET.ParseError:
                if parte == "":
                    confiable = False
                continue
            carpeta = parte.rpartition("/")[0]
            carpeta = carpeta + "/" if carpeta else ""
            for e in raiz:
                objetivo = e.get("Target")
                if e.get("TargetMode") == "External" or not objetivo:
                    continue
                ruta = _resolver(carpeta, objetivo)
                if ruta is None:
                    continue
                if ruta.lower() in grupos:
                    exacto.setdefault(ruta.lower(), ruta)
                    cola.append(exacto[ruta.lower()])
                elif not (e.get("Type") or "").endswith("/officeDocument"):
                    rotas.setdefault(rk, []).append(e.get("Id"))
        if not confiable:
            avisos.append("no se pudieron leer las relaciones del paquete: se conservan todas las partes tal como vienen")
        alc_k = {p.lower() for p in alcanzadas}

        def usada(k):
            if not confiable:
                return True
            if k == "[content_types].xml":
                return True
            dueno = _dueno_de_rels(indice[k]) if k.endswith(".rels") else None
            if dueno is not None:
                return dueno.lower() in alc_k
            return k in alc_k

        # 3) qué se queda
        finales = []   # (nombre final, ZipInfo elegido)
        huerfanas, repetidas = [], 0
        for k, lista in grupos.items():
            if len(lista) > 1:
                repetidas += len(lista) - 1
            if not usada(k):
                huerfanas.append(indice[k])
                continue
            # entre repetidas: la que tiene exactamente el nombre referenciado; si no, la última (lo que lee Python)
            ref = exacto.get(k)
            elegida = next((x for x in reversed(lista) if ref and x[0] == ref), lista[-1])
            nombre = ref or elegida[0]
            finales.append((nombre, elegida[1], k))
        if repetidas:
            avisos.append("el archivo traía %d entradas repetidas (o con otras mayúsculas): se dejó una de cada" % repetidas)
        if huerfanas:
            todas = sorted(huerfanas)
            avisos.append("se descartaron %d partes que el documento no usaba (%s%s)" % (len(todas), ", ".join(todas[:3]), "…" if len(todas) > 3 else ""))
        finales_k = {k for _n, _i, k in finales}

        # 4) relaciones rotas y tipos de contenido de partes que ya no existen
        for rk, ids in rotas.items():
            if rk not in finales_k:
                continue
            txt = datos_xml(rk).decode("utf-8", "replace")
            for rid in ids:
                txt = re.sub(r'<(?:\w+:)?Relationship\b(?=[^>]*\bId="%s")[^>]*?/>' % re.escape(rid or ""), "", txt)
            modificados[rk] = txt.encode("utf-8")
            avisos.append("se quitaron %d relaciones que apuntaban a partes que no existen (%s)" % (len(ids), indice[rk]))
        ct = datos_xml("[content_types].xml").decode("utf-8", "replace")

        def _override(m):
            p = re.search(r'\bPartName="([^"]*)"', m.group(0))
            return m.group(0) if (not p or p.group(1).lstrip("/").lower() in finales_k) else ""
        ct2 = re.sub(r"<(?:\w+:)?Override\b[^>]*?/>", _override, ct)
        if ct2 != ct:
            modificados["[content_types].xml"] = ct2.encode("utf-8")

        # 5) escribir: tipos de contenido y relaciones del paquete primero
        finales.sort(key=lambda x: (0 if x[2] == "[content_types].xml" else 1 if x[2] == "_rels/.rels" else 2))
        try:
            with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as zo:
                for nombre, i, k in finales:
                    datos = modificados[k] if k in modificados else leer(i)
                    nombre = "[Content_Types].xml" if k == "[content_types].xml" else nombre
                    zi = zipfile.ZipInfo(nombre, (1980, 1, 1, 0, 0, 0))
                    zi.compress_type = zipfile.ZIP_STORED if os.path.splitext(nombre)[1].lower() in (".png", ".jpg", ".jpeg", ".gif", ".mp3", ".mp4", ".m4a") else zipfile.ZIP_DEFLATED
                    zi.external_attr = 0o600 << 16
                    zo.writestr(zi, datos)
        except PaqueteIlegible:
            raise
        except OSError as e:
            raise PaqueteIlegible("no se pudo preparar la copia de trabajo: %s" % e)
    return avisos


# ------------------------------------------------------------------ PDF
def normalizar_pdf(origen, destino):
    try:
        import fitz   # PyMuPDF (el mismo de translate_pdf.py)
    except ImportError:
        raise PaqueteIlegible("falta PyMuPDF para preparar el PDF.")
    avisos = []
    try:
        doc = fitz.open(origen)
    except Exception as e:  # noqa: BLE001
        raise PaqueteIlegible("no se pudo abrir el PDF (%s)." % e)
    try:
        if doc.needs_pass:
            raise PaqueteIlegible("el PDF tiene contraseña; este paso no la maneja.")
        if getattr(doc, "is_repaired", False):
            avisos.append("el PDF venía con errores internos y se reparó al abrirlo")
        try:   # JavaScript, miniaturas y datos ocultos que no son del contenido visible; el texto, las imágenes y los enlaces no se tocan
            doc.scrub(metadata=False, xml_metadata=False, javascript=True, thumbnails=True, embedded_files=False, attached_files=False,
                      hidden_text=False, redactions=False, redact_images=0, remove_links=False, reset_fields=False, reset_responses=False,
                      clean_pages=False)
        except Exception:  # noqa: BLE001 — según la versión de PyMuPDF; es solo una limpieza extra
            pass
        try:   # acciones de JavaScript al abrir (en el catálogo): scrub no las alcanza en todas las versiones
            cat = doc.pdf_catalog()
            for clave in ("OpenAction", "AA"):
                v = doc.xref_get_key(cat, clave)
                if v[0] == "null":
                    continue
                texto = v[1]
                if v[1].endswith(" R"):
                    try:
                        texto = doc.xref_object(int(v[1].split()[0]))
                    except Exception:  # noqa: BLE001
                        texto = ""
                if "/JavaScript" in texto or "/JS" in texto:
                    doc.xref_set_key(cat, clave, "null")
                    avisos.append("se quitó un JavaScript que el PDF ejecutaba al abrirse")
        except Exception:  # noqa: BLE001
            pass
        try:
            doc.save(destino, garbage=3, deflate=True)
        except Exception as e:  # noqa: BLE001
            raise PaqueteIlegible("no se pudo preparar la copia del PDF (%s)." % e)
    finally:
        doc.close()
    return avisos


# ------------------------------------------------------------------ interfaz
def preparar(ruta, quitar_macros=False):
    """Copia limpia de `ruta` en una carpeta temporal (se borra al terminar el programa). Lanza PaqueteIlegible."""
    ext = ruta.lower().rsplit(".", 1)[-1] if "." in os.path.basename(ruta) else ""
    if quitar_macros:   # plantillas y macros pasan a documento normal: el resto de los scripts conoce solo estas extensiones
        ext = {"docm": "docx", "dotx": "docx", "dotm": "docx", "pptm": "pptx", "potx": "pptx", "potm": "pptx"}.get(ext, ext)
    ext = {"xltx": "xlsx", "xltm": "xlsm"}.get(ext, ext)
    destino = os.path.join(_carpeta_temporal(), "limpio." + (ext or "bin"))
    if ext == "pdf":
        avisos = normalizar_pdf(ruta, destino)
    else:
        avisos = normalizar_ooxml(ruta, destino, quitar_macros=quitar_macros)
    return Resultado(destino, avisos, bool(avisos))


def preparar_o_salir(ruta, error, quitar_macros=False, codigo=1):
    """Como `preparar`, pero un archivo ilegible termina el programa con `error(mensaje, codigo)` (cada script tiene el suyo)."""
    try:
        return preparar(ruta, quitar_macros=quitar_macros)
    except PaqueteIlegible as e:
        try:
            error(str(e), codigo)
        except TypeError:
            error(str(e))
        raise


def main(argv):
    if len(argv) != 3:
        print("Uso: normalizar_paquete.py entrada salida", file=sys.stderr)
        return 2
    if os.path.exists(argv[2]):
        print("ERROR: %s ya existe; elige otro nombre." % argv[2], file=sys.stderr)
        return 2
    try:
        r = preparar(argv[1])
    except PaqueteIlegible as e:
        print("ERROR: %s" % e, file=sys.stderr)
        return 2
    shutil.copyfile(r.ruta, argv[2])
    for a in r.avisos:
        print("AVISO: " + a)
    print("OK: copia limpia -> %s" % argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
