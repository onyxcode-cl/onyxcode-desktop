#!/usr/bin/env python3
"""Traduce un Word (.docx) CONSERVANDO su formato: cada párrafo se reescribe en su mismo lugar, con su estilo, fuente, tamaño, tablas,
encabezados, pies, listas e imágenes; solo cambia el texto.

Tres pasos (el modelo traduce en el del medio), igual que `translate_pdf.py`:
  1) extraer  doc.docx -o segmentos.json
  2) (el modelo escribe traduccion.json: {"d1-0": "texto traducido", ...})
  3) aplicar  doc.docx -t traduccion.json -o doc-en.docx [--informe informe.json]

Dentro de cada texto hay etiquetas que se deben conservar: <b>…</b> negrita, <i>…</i> cursiva, <u>…</u> subrayado, <c=#rrggbb>…</c> color
y <l=N>…</l> enlace. El tabulador va como \\t y el salto de línea como \\n. Usa python-docx (MIT).
Se omiten (y se informan) los párrafos con imágenes, campos, cuadros de texto o cambios controlados: no se pueden reescribir sin dañarlos.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import zipfile



def error(msg):
    print("ERROR: %s" % msg, file=sys.stderr)
    sys.exit(1)


def exigir_entrada(ruta):
    if not os.path.isfile(ruta):
        error("no existe el archivo %s" % ruta)


def exigir_salida_nueva(ruta):
    if os.path.exists(ruta):
        error("%s ya existe; elige otro nombre (no se sobrescribe)." % ruta)


try:
    import docx
    import docx.document
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    from docx.text.paragraph import Paragraph
    from docx.table import Table
except ImportError:  # pragma: no cover
    error("falta python-docx en este Python (pip install python-docx).")

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_SIN_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
TAGS = r"</?[biu]>|<c=#[0-9a-fA-F]{6}>|</c>|<l=\d+>|</l>"


def _traducible(texto):
    return bool(re.search(r"[^\W\d_]", texto))


# ---------------------------------------------------------------- recorrido del documento

def _parrafos_de(contenedor):
    """Párrafos de un contenedor (cuerpo, celda, encabezado) en orden, incluidas las tablas (recursivo)."""
    if isinstance(contenedor, docx.document.Document):
        elemento = contenedor.element.body
    else:
        elemento = contenedor._element
    for hijo in elemento.iterchildren():
        if hijo.tag == W + "p":
            yield Paragraph(hijo, contenedor)
        elif hijo.tag == W + "tbl":
            tabla = Table(hijo, contenedor)
            vistos = []   # se guardan los elementos (no sus id): un id puede reutilizarse tras liberarse el objeto
            for fila in tabla.rows:
                for celda in fila.cells:
                    if any(celda._tc is v for v in vistos):   # celdas combinadas aparecen varias veces
                        continue
                    vistos.append(celda._tc)
                    yield from _parrafos_de(celda)


def _partes(documento):
    """[(etiqueta, contenedor)] en el orden en que se leen: cuerpo, luego encabezados y pies de cada sección."""
    partes = [("cuerpo", documento)]
    vistos = set()
    for n, sec in enumerate(documento.sections, 1):
        for nombre, parte in (("encabezado", sec.header), ("pie", sec.footer), ("encabezado-1ª", sec.first_page_header),
                              ("pie-1ª", sec.first_page_footer), ("encabezado-par", sec.even_page_header), ("pie-par", sec.even_page_footer)):
            try:
                if parte.is_linked_to_previous or id(parte._element) in vistos:
                    continue
                vistos.add(id(parte._element))
                partes.append(("%s s%d" % (nombre, n), parte))
            except Exception:  # noqa: BLE001
                continue
    return partes


def _motivo_omision(p):
    """Por qué un párrafo no se puede reescribir sin dañarlo (None si se puede)."""
    el = p._p
    if el.xpath(".//w:drawing | .//w:pict | .//w:object"):
        return "imagen u objeto"
    if el.xpath(".//w:fldChar | .//w:fldSimple | .//w:instrText"):
        return "campo (número de página, índice, referencia…)"
    if el.xpath(".//w:txbxContent"):
        return "cuadro de texto"
    if el.xpath(".//w:ins | .//w:del | .//w:moveFrom | .//w:moveTo"):
        return "cambios controlados"
    if el.xpath(".//w:sdt") or el.xpath(".//w:commentReference | .//w:commentRangeStart | .//w:commentRangeEnd"):
        return "control de contenido o comentario"
    # contenedores de texto que `_runs_de` no recorre: reescribir el párrafo borraría su texto sin que el modelo lo viera
    if el.xpath(".//w:smartTag | .//w:customXml | .//w:bdo | .//w:dir | .//w:subDoc"):
        return "etiquetas inteligentes o XML personalizado"
    if el.xpath(".//w:footnoteReference | .//w:endnoteReference | .//w:sym | .//w:ptab | .//w:annotationRef"):
        return "nota al pie, símbolo o tabulador de posición"
    if el.xpath(".//w:br[@w:type='page' or @w:type='column']"):
        return "salto de página o de columna"
    if _props_mixtas(p):
        return "tipos de letra, tamaños, superíndices o estilos de carácter distintos dentro del párrafo"
    return None


# ---------------------------------------------------------------- texto <-> etiquetas

def _activo(e, apagados=("0", "false", "off")):
    return e is not None and e.get(W + "val") not in apagados


def _fmt_run(r):
    """(negrita, cursiva, subrayado, color) de un <w:r> (solo lo que él declara)."""
    rpr = r.find(W + "rPr")
    neg = cur = sub = False
    col = None
    if rpr is not None:
        neg = _activo(rpr.find(W + "b"))
        cur = _activo(rpr.find(W + "i"))
        sub = _activo(rpr.find(W + "u"), ("none", "0", "false", "off"))
        c = rpr.find(W + "color")
        if c is not None and c.get(W + "val") not in (None, "auto"):
            col = c.get(W + "val").lower()
    return neg, cur, sub, col


# propiedades de letra que NO se etiquetan: si cambian dentro de un párrafo, se deja sin traducir antes que perderlas
_PROPS_FIJAS = ("rStyle", "rFonts", "sz", "szCs", "vertAlign", "highlight", "shd", "caps", "smallCaps", "strike", "dstrike")


def _clave_props(r):
    rpr = r.find(W + "rPr")
    if rpr is None:
        return ()
    out = []
    for n in _PROPS_FIJAS:
        for e in rpr.findall(W + n):
            out.append((n, tuple(sorted(e.attrib.items()))))
    return tuple(out)


def _props_mixtas(p):
    claves = {_clave_props(r) for r, _ in _runs_de(p) if _texto_run(r) != ""}
    return len(claves) > 1


def _texto_run(r):
    out = []
    for h in r:
        if h.tag == W + "t":
            out.append(h.text or "")
        elif h.tag == W + "tab":
            out.append("\t")
        elif h.tag in (W + "br", W + "cr"):
            out.append("\n")
        elif h.tag == W + "noBreakHyphen":
            out.append("-")
    return "".join(out)


def _runs_de(p):
    """[(run_element, indice_enlace|None)] en orden, incluyendo los de dentro de hipervínculos."""
    out, k = [], -1
    for hijo in p._p.iterchildren():
        if hijo.tag == W + "r":
            out.append((hijo, None))
        elif hijo.tag == W + "hyperlink":
            k += 1
            for r in hijo.iterchildren(W + "r"):
                out.append((r, k))
    return out


def _hipervinculos(p):
    return [h for h in p._p.iterchildren(W + "hyperlink")]


def segmento_de(p):
    """Texto del párrafo con etiquetas: <b> <i> <u> <c=#…> por run y <l=N> por hipervínculo."""
    runs = [(r, k) for r, k in _runs_de(p) if _texto_run(r) != ""]
    if not runs:
        return ""
    partes = []
    for r, k in runs:
        neg, cur, sub, col = _fmt_run(r)
        t = _texto_run(r)
        if neg:
            t = "<b>%s</b>" % t
        if cur:
            t = "<i>%s</i>" % t
        if sub:
            t = "<u>%s</u>" % t
        if col:
            t = "<c=#%s>%s</c>" % (col, t)
        if k is not None:
            t = "<l=%d>%s</l>" % (k, t)
        partes.append(t)
    # unir etiquetas contiguas idénticas: «<b>a</b><b>b</b>» → «<b>ab</b>»
    txt = "".join(partes)
    prev = None
    while prev != txt:
        prev = txt
        txt = re.sub(r"</(b|i|u)><\1>", "", txt)
    return txt


def _tokens(texto):
    """Parte el texto etiquetado en [(trozo, negrita?, cursiva?, subrayado?, color|None, enlace|None)]."""
    out = []
    neg = cur = sub = False
    col = None
    lnk = None
    for tok in re.split("(%s)" % TAGS, texto):
        if tok == "":
            continue
        if tok == "<b>":
            neg = True
        elif tok == "</b>":
            neg = False
        elif tok == "<i>":
            cur = True
        elif tok == "</i>":
            cur = False
        elif tok == "<u>":
            sub = True
        elif tok == "</u>":
            sub = False
        elif tok.startswith("<c="):
            col = tok[4:10].lower()
        elif tok == "</c>":
            col = None
        elif tok.startswith("<l="):
            lnk = int(tok[3:-1])
        elif tok == "</l>":
            lnk = None
        else:
            out.append((tok, neg, cur, sub, col, lnk))
    return out


# ---------------------------------------------------------------- aplicar

def _poner_texto(run_el, texto):
    """Reemplaza el contenido de un run por `texto` (con \\t y \\n como tabulador y salto)."""
    for h in list(run_el):
        if h.tag != W + "rPr":
            run_el.remove(h)
    partes = re.split(r"(\t|\n)", texto)
    for parte in partes:
        if parte == "\t":
            run_el.append(OxmlElement("w:tab"))
        elif parte == "\n":
            run_el.append(OxmlElement("w:br"))
        elif parte != "":
            t = OxmlElement("w:t")
            t.text = parte
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            run_el.append(t)


# orden de los hijos de <w:rPr> según el esquema de Word (un orden distinto hace que Word lo repare o lo rechace)
_ORDEN_RPR = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint",
              "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u",
              "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"]


def _insertar_en_rpr(rpr, el):
    nombre = el.tag.replace(W, "")
    pos = _ORDEN_RPR.index(nombre) if nombre in _ORDEN_RPR else len(_ORDEN_RPR)
    for i, hijo in enumerate(list(rpr)):
        n = hijo.tag.replace(W, "")
        if (_ORDEN_RPR.index(n) if n in _ORDEN_RPR else len(_ORDEN_RPR)) > pos:
            rpr.insert(i, el)
            return
    rpr.append(el)


def _formatear(r, neg, cur, sub, col):
    rpr = r.find(W + "rPr")
    if rpr is None:
        rpr = OxmlElement("w:rPr")
        r.insert(0, rpr)
    if neg:
        _insertar_en_rpr(rpr, OxmlElement("w:b"))
    if cur:
        _insertar_en_rpr(rpr, OxmlElement("w:i"))
    if sub:
        u = OxmlElement("w:u")
        u.set(qn("w:val"), "single")
        _insertar_en_rpr(rpr, u)
    if col:
        c = OxmlElement("w:color")
        c.set(qn("w:val"), col)
        _insertar_en_rpr(rpr, c)


def reescribir(p, traduccion):
    """Reemplaza el texto del párrafo `p` por `traduccion` (con etiquetas). Cada trozo parte del primer run (fuente, tamaño…) sin
    negrita/cursiva/subrayado/color/idioma y recibe solo el formato que pide su etiqueta; los enlaces se conservan."""
    runs = [(r, k) for r, k in _runs_de(p) if _texto_run(r) != ""]
    if not runs:
        return False
    plantilla = copy.deepcopy(runs[0][0])
    rpr0 = plantilla.find(W + "rPr")
    if rpr0 is not None:
        # sin `w:lang`: el idioma original (p. ej. en-US) marcaría la traducción como mal escrita
        for n in ("b", "bCs", "i", "iCs", "u", "color", "lang"):
            for e in rpr0.findall(W + n):
                rpr0.remove(e)
    enlaces = _hipervinculos(p)
    # quitar lo viejo (runs, hipervínculos y marcas de ortografía) y conservar el resto (marcadores, propiedades del párrafo)
    for hijo in list(p._p):
        if hijo.tag in (W + "r", W + "hyperlink", W + "proofErr"):
            p._p.remove(hijo)
    contenedor_actual, indice_actual = p._p, None
    for trozo, neg, cur, sub, col, lnk in _tokens(traduccion):
        r = copy.deepcopy(plantilla)
        _poner_texto(r, trozo)
        _formatear(r, neg, cur, sub, col)
        if lnk is not None and lnk < len(enlaces):
            if indice_actual != lnk:
                h = OxmlElement("w:hyperlink")
                for atributo, valor in enlaces[lnk].attrib.items():
                    h.set(atributo, valor)
                p._p.append(h)
                contenedor_actual, indice_actual = h, lnk
            contenedor_actual.append(r)
        else:
            p._p.append(r)
            contenedor_actual, indice_actual = p._p, None
    return True


# ---------------------------------------------------------------- comandos

def _recorrer(documento):
    """Rinde (id, etiqueta_de_parte, párrafo) para cada párrafo con texto traducible, en orden de lectura."""
    n_parte = 0
    for etiqueta, contenedor in _partes(documento):
        n_parte += 1
        i = 0
        for p in _parrafos_de(contenedor):
            txt = segmento_de(p)
            if not txt or not _traducible(re.sub(TAGS, "", txt)):
                continue
            yield "d%d-%d" % (n_parte, i), etiqueta, p, txt
            i += 1


MAX_DESCOMPRIMIDO = 300 * 1024 * 1024   # un .docx normal pesa unos MB descomprimido; más que esto es una bomba de compresión
MAX_ENTRADAS = 5000


def _revisar_zip(ruta):
    if not zipfile.is_zipfile(ruta):
        error("no es un .docx válido (¿es un .doc antiguo? Guárdalo como .docx).")
    with zipfile.ZipFile(ruta) as z:
        info = z.infolist()
        total = sum(i.file_size for i in info)
        if len(info) > MAX_ENTRADAS or total > MAX_DESCOMPRIMIDO:
            error("el .docx es demasiado grande al descomprimirse (%d archivos, %d MB): no se traduce." % (len(info), total // 1048576))


def cmd_extraer(a):
    exigir_entrada(a.docx)
    _revisar_zip(a.docx)
    try:
        d = docx.Document(a.docx)
    except Exception as e:  # noqa: BLE001
        error("no se pudo abrir %s: %s" % (a.docx, e))
    salida, omitidos = [], {}
    chars = 0
    for sid, etiqueta, p, txt in _recorrer(d):
        motivo = _motivo_omision(p)
        if motivo:
            omitidos[motivo] = omitidos.get(motivo, 0) + 1
            continue
        salida.append({"id": sid, "pagina": 1, "parte": etiqueta, "texto": txt})
        chars += len(txt)
    if not salida:
        print("AVISO: el documento no tiene texto que traducir.", file=sys.stderr)
        sys.exit(2)
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump({"paginas": 1, "segmentos": salida, "omitidos": omitidos}, f, ensure_ascii=False, indent=1)
    print("OK: %d textos a traducir (%d caracteres) -> %s" % (len(salida), chars, a.salida))
    for m, n in omitidos.items():
        print("AVISO: %d párrafos con %s se dejan sin traducir (no se pueden reescribir sin dañarlos)." % (n, m))
    print('Traduce cada "texto" (id -> traducción) y guarda un JSON {"d1-0": "..."}; conserva las etiquetas <b> <i> <u> <c=#…> <l=N>.')


def cmd_aplicar(a):
    exigir_entrada(a.docx)
    exigir_entrada(a.traduccion)
    exigir_salida_nueva(a.salida)
    _revisar_zip(a.docx)
    with open(a.traduccion, encoding="utf-8") as f:
        tr = json.load(f)
    if isinstance(tr, dict) and "segmentos" in tr:
        tr = {s["id"]: s.get("traduccion", "") for s in tr["segmentos"] if s.get("traduccion")}
    d = docx.Document(a.docx)
    informe = {"traducidos": 0, "sin_traduccion": [], "iguales": 0, "omitidos": {}, "enlaces_quitados": 0, "formato_perdido": 0}
    usados = set()
    for sid, _etq, p, txt in _recorrer(d):
        motivo = _motivo_omision(p)
        if motivo:
            informe["omitidos"][motivo] = informe["omitidos"].get(motivo, 0) + 1
            continue
        if sid not in tr or not str(tr[sid]).strip():
            informe["sin_traduccion"].append(sid)
            continue
        usados.add(sid)
        nuevo = _SIN_CONTROL.sub("", str(tr[sid]))   # los caracteres de control no caben en XML: tumbarían todo el documento
        if re.sub(r"\s+", " ", re.sub(TAGS, "", nuevo)).strip() == re.sub(r"\s+", " ", re.sub(TAGS, "", txt)).strip():
            informe["iguales"] += 1   # nombres propios, cifras: se dejan como están
            continue
        # el modelo a veces se come etiquetas (<b>, <c=…>…): el texto se traduce igual, pero ese formato se pierde y se avisa
        etq = lambda t: sorted(re.findall(r"<(?:/?[biu]|c=#[0-9a-fA-F]{6}|/c)>", t))
        if len(etq(nuevo)) < len(etq(txt)):
            informe["formato_perdido"] += 1
        n_enlaces = len(_hipervinculos(p))
        try:
            hecho = reescribir(p, nuevo)
        except Exception:  # noqa: BLE001 — un párrafo malo no debe tumbar el documento entero
            informe["sin_traduccion"].append(sid)
            continue
        if hecho:
            informe["traducidos"] += 1
            usados_l = set(int(m) for m in re.findall(r"<l=(\d+)>", nuevo))
            informe["enlaces_quitados"] += max(0, n_enlaces - len(usados_l))
    extra = sorted(set(tr) - usados)
    if extra:
        informe["ids_desconocidos"] = extra
    d.save(a.salida)
    if a.informe:
        with open(a.informe, "w", encoding="utf-8") as f:
            json.dump(informe, f, ensure_ascii=False, indent=1)
    print("OK: %d textos traducidos -> %s" % (informe["traducidos"], a.salida))
    if informe["sin_traduccion"]:
        print("AVISO: %d textos sin traducir (quedan en el idioma original): %s" % (len(informe["sin_traduccion"]), ", ".join(informe["sin_traduccion"][:12])))
    for m, n in informe["omitidos"].items():
        print("AVISO: %d párrafos con %s quedaron sin traducir." % (n, m))
    if informe["formato_perdido"]:
        print("AVISO: %d textos perdieron parte de su formato (negrita, color…) porque la traducción no trajo las etiquetas." % informe["formato_perdido"])
    if informe["enlaces_quitados"]:
        print("AVISO: %d enlaces no se conservaron (faltó la etiqueta <l=N> en la traducción)." % informe["enlaces_quitados"])
    # verificación: la copia debe tener la MISMA estructura que el original (solo cambia el texto)
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared"))
    import comparar_estructura
    dif, avisos, resumen = comparar_estructura.comparar(a.docx, a.salida)
    for x in dif:
        print("DIFERENCIA: " + x)
    for x in avisos:
        print("AVISO: " + x)
    if dif:
        print("ESTRUCTURA: CAMBIÓ: no entregues %s; revisa la traducción (¿se rompió una etiqueta?) y repite con otro nombre." % a.salida)
        sys.exit(1)
    print("ESTRUCTURA: idéntica al original (%s)" % resumen)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extraer", help="lista los textos del Word")
    e.add_argument("docx")
    e.add_argument("-o", "--salida", required=True)
    e.set_defaults(fn=cmd_extraer)
    p = sub.add_parser("aplicar", help="escribe la traducción sobre el mismo Word")
    p.add_argument("docx")
    p.add_argument("-t", "--traduccion", required=True)
    p.add_argument("-o", "--salida", required=True)
    p.add_argument("--informe")
    p.set_defaults(fn=cmd_aplicar)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
