#!/usr/bin/env python3
"""Traduce un Excel (.xlsx) CONSERVANDO todo su diseño: solo cambian los textos; fórmulas, números, fechas, estilos, anchos, combinaciones,
filtros, validaciones, formato condicional, gráficos e imágenes quedan EXACTAMENTE como estaban (las demás partes del archivo se copian byte a byte).

Tres pasos (el modelo traduce en el del medio), igual que `translate_docx.py` y `translate_pdf.py`:
  1) extraer  libro.xlsx -o segmentos.json
  2) (el modelo escribe traduccion.json: {"s12": "texto traducido", ...})
  3) aplicar  libro.xlsx -t traduccion.json -o libro-en.xlsx [--informe informe.json]
Al aplicar se compara la estructura de la copia con el original (`_shared/comparar_estructura.py`): sin diferencias de celdas, estilos ni fórmulas.

Qué se traduce: textos de celdas (cadenas compartidas y en línea; texto con formato mixto lleva etiquetas <r1>…</r1><r2>…</r2> que se conservan),
comentarios, textos de gráficos (título, ejes) y de cuadros de texto. NO se traduce (se informa): nombres de hoja (aparecen en fórmulas), listas de
validación escritas en la propia regla, nombres definidos, y los textos que son resultado de una fórmula (se recalculan). El original NUNCA se toca:
la salida debe ser un archivo NUEVO. No usa openpyxl a propósito (al guardar perdería gráficos e imágenes): edita el XML del propio archivo.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from xml.sax.saxutils import escape

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "..", "_shared"))

MAX_ENTRADAS = 5000
MAX_DESCOMPRIMIDO = 300 * 1024 * 1024
_SIN_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
RUN_TAGS = re.compile(r"</?r\d+>")
ENT = re.compile(r"&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);")
NO_TRADUCIBLE = re.compile(r"^\s*(?:https?://\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+|[A-Za-z]:\\\S*|/\S+/\S*)\s*$")


def error(msg, codigo=1):
    print("ERROR: %s" % msg, file=sys.stderr)
    sys.exit(codigo)


def _desescapar(t):
    def r(m):
        e = m.group(1)
        if e[0] == "#":
            return chr(int(e[2:], 16) if e[1] in "xX" else int(e[1:]))
        return {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}[e]
    return ENT.sub(r, t)


def _traducible(texto):
    return bool(re.search(r"[^\W\d_]", texto)) and not NO_TRADUCIBLE.match(texto)


# ------------------------------------------------------------ unidades de texto (cadena, comentario, párrafo de dibujo)
def _spans(unidad, t_tag, saltar):
    """[(inicio, fin)] del CONTENIDO de cada <t> de la unidad que cuenta (fuera de los bloques `saltar`, p. ej. fonética <rPh>)."""
    huecos = [(m.start(), m.end()) for m in re.finditer(saltar, unidad, re.S)] if saltar else []
    out = []
    for m in re.finditer(r"<%s(?:\s[^>]*)?>(.*?)</%s>" % (t_tag, t_tag), unidad, re.S):
        if any(a <= m.start() < b for a, b in huecos):
            continue
        out.append((m.start(1), m.end(1)))
    return out


def _texto_de(unidad, spans):
    partes = [_desescapar(unidad[a:b]) for a, b in spans]
    if len(spans) <= 1:
        return "".join(partes)
    return "".join("<r%d>%s</r%d>" % (i + 1, p, i + 1) for i, p in enumerate(partes))


def _poner_texto(unidad, spans, nuevo, t_tag):
    """Reescribe los <t> de la unidad con `nuevo`. Devuelve (xml, simplificado)."""
    nuevo = _SIN_CONTROL.sub("", nuevo)
    n = len(spans)
    simplificado = False
    if n <= 1:
        valores = [RUN_TAGS.sub("", nuevo)]
    else:
        pares = dict((int(k), v) for k, v in re.findall(r"<r(\d+)>(.*?)</r\1>", nuevo, re.S))
        if sorted(pares) == list(range(1, n + 1)):
            valores = [pares[i] for i in range(1, n + 1)]
        else:  # el modelo se comió etiquetas: todo el texto va al primer tramo (se pierde el formato parcial) y se avisa
            valores = [RUN_TAGS.sub("", nuevo)] + [""] * (n - 1)
            simplificado = True
    out = unidad
    for (a, b), v in sorted(zip(spans, valores), key=lambda x: -x[0][0]):
        out = out[:a] + escape(v) + out[b:]
        if t_tag == "t" and v and (v != v.strip()):
            # espacios al borde: el <t> necesita xml:space="preserve"
            ini = out.rfind("<t", 0, a)
            etiqueta = out[ini:a]
            if "xml:space" not in etiqueta:
                out = out[:ini] + etiqueta.replace("<t", '<t xml:space="preserve"', 1) + out[a:]
    return out, simplificado


class Parte:
    """Una parte XML del libro con sus unidades de texto, en orden."""

    def __init__(self, nombre, xml, prefijo, unidad_re, t_tag, saltar=None):
        self.nombre, self.xml, self.prefijo = nombre, xml, prefijo
        self.t_tag, self.saltar = t_tag, saltar
        self.unidades = []  # (inicio, fin, spans relativos, texto, índice lógico)
        for i, m in enumerate(re.finditer(unidad_re, xml, re.S)):
            u = m.group(0)
            sp = _spans(u, t_tag, saltar)
            if not sp:
                self.unidades.append((m.start(), m.end(), [], "", i))
                continue
            self.unidades.append((m.start(), m.end(), sp, _texto_de(u, sp), i))


def _partes(z):
    """Las partes con texto traducible, en un orden estable."""
    nombres = sorted(z.namelist())
    out = []
    num = lambda n: int(re.search(r"(\d+)\.xml$", n).group(1))
    for n in nombres:
        if n == "xl/sharedStrings.xml":
            out.append(Parte(n, z.read(n).decode("utf-8"), "s", r"<si\b[^>]*>.*?</si>|<si\s*/>", "t", r"<rPh\b.*?</rPh>"))
        elif re.match(r"xl/worksheets/sheet\d+\.xml$", n):
            x = z.read(n).decode("utf-8")
            if "<is>" in x:
                out.append(Parte(n, x, "i%d-" % num(n), r"<is>.*?</is>", "t", r"<rPh\b.*?</rPh>"))
        elif re.match(r"xl/comments(/[^/]*|[^/]*)\.xml$", n):
            out.append(Parte(n, z.read(n).decode("utf-8"), "c%d-" % (num(n) if re.search(r"\d+\.xml$", n) else 1), r"<text>.*?</text>", "t", r"<rPh\b.*?</rPh>"))
        elif re.match(r"xl/(charts/chart|drawings/drawing)\d+\.xml$", n):
            x = z.read(n).decode("utf-8")
            if "<a:t>" in x:
                out.append(Parte(n, x, ("g" if "chart" in n else "d") + "%d-" % num(n), r"<a:p\b[^>]*>.*?</a:p>", "a:t"))
    return out


def _celdas_de_cadenas(z):
    """índice de cadena compartida → ['Hoja!A1', …] (para dar contexto al traducir y avisar de recortes)."""
    nombres = {}
    try:
        wb = z.read("xl/workbook.xml").decode("utf-8")
        rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
        destino = {m.group(1): m.group(2) for m in re.finditer(r'<Relationship\b[^>]*?\bId="([^"]+)"[^>]*?\bTarget="([^"]+)"', rels)}
        destino.update({m.group(2): m.group(1) for m in re.finditer(r'<Relationship\b[^>]*?\bTarget="([^"]+)"[^>]*?\bId="([^"]+)"', rels)})
        for m in re.finditer(r"<sheet\b([^>]*)/?>", wb):
            nom = re.search(r'\bname="([^"]*)"', m.group(1))
            rid = re.search(r'\br:id="([^"]*)"', m.group(1))
            if nom and rid and rid.group(1) in destino:
                t = destino[rid.group(1)].lstrip("/")
                nombres["xl/" + t if not t.startswith("xl/") else t] = _desescapar(nom.group(1))
    except KeyError:
        pass
    usos = {}
    for n in z.namelist():
        if re.match(r"xl/worksheets/sheet\d+\.xml$", n):
            hoja = nombres.get(n, n)
            for m in re.finditer(r'<c\b[^>]*?\br="([A-Z]+\d+)"[^>]*?\bt="s"[^>]*>\s*<v>(\d+)</v>', z.read(n).decode("utf-8")):
                usos.setdefault(int(m.group(2)), []).append("%s!%s" % (hoja, m.group(1)))
    return usos, list(nombres.values())


def _revisar_zip(ruta):
    if not zipfile.is_zipfile(ruta):
        error("no es un .xlsx válido (¿es un .xls antiguo? Guárdalo como .xlsx).")
    with zipfile.ZipFile(ruta) as z:
        info = z.infolist()
        total = sum(i.file_size for i in info)
        if len(info) > MAX_ENTRADAS or total > MAX_DESCOMPRIMIDO:
            error("el .xlsx es demasiado grande al descomprimirse (%d archivos, %d MB): no se traduce." % (len(info), total // 1048576))
        if "xl/workbook.xml" not in z.namelist():
            error("no parece un libro de Excel (.xlsx).")
        if "xl/workbook.xml" in z.namelist() and b"<fileSharing" in z.read("xl/workbook.xml") and b"reservationPassword" in z.read("xl/workbook.xml"):
            print("AVISO: el libro tiene protección de edición; la copia traducida la conserva.", file=sys.stderr)
        if any(n.startswith("xl/encrypted") or n == "EncryptedPackage" for n in z.namelist()):
            error("el libro está cifrado con contraseña: no se puede traducir.")


def _ids(parte):
    for (a, b, sp, texto, i) in parte.unidades:
        if sp and texto and _traducible(RUN_TAGS.sub("", texto)):
            yield "%s%d" % (parte.prefijo, i), (a, b, sp, texto)


def cmd_extraer(a):
    if not os.path.isfile(a.xlsx):
        error("no existe el archivo %s" % a.xlsx)
    _revisar_zip(a.xlsx)
    with zipfile.ZipFile(a.xlsx) as z:
        partes = _partes(z)
        usos, hojas = _celdas_de_cadenas(z)
        omitidos = {}
        for n in z.namelist():
            if re.match(r"xl/worksheets/sheet\d+\.xml$", n):
                x = z.read(n).decode("utf-8")
                k = len(re.findall(r"<formula1>\s*&quot;[^<]*[A-Za-zÀ-ÿ][^<]*&quot;\s*</formula1>", x))
                if k:
                    omitidos["listas de validación escritas en la regla (%s)" % n.split("/")[-1]] = k
        segs, chars = [], 0
        for p in partes:
            for sid, (_a, _b, _sp, texto) in _ids(p):
                s = {"id": sid, "texto": texto}
                if p.prefijo == "s":
                    s["celdas"] = usos.get(int(sid[1:]), [])[:3]
                    if len(usos.get(int(sid[1:]), [])) > 3:
                        s["celdas"].append("…")
                else:
                    s["parte"] = {"i": "texto en línea", "c": "comentario", "g": "texto de gráfico", "d": "texto de cuadro"}[p.prefijo[0]]
                segs.append(s)
                chars += len(texto)
    if not segs:
        print("AVISO: el libro no tiene texto que traducir.", file=sys.stderr)
        sys.exit(2)
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump({"segmentos": segs, "nombres_de_hoja_no_traducidos": hojas, "omitidos": omitidos}, f, ensure_ascii=False, indent=1)
    print("OK: %d textos a traducir (%d caracteres) -> %s" % (len(segs), chars, a.salida))
    if hojas:
        print("AVISO: los nombres de hoja (%s) NO se traducen (las fórmulas los usan); díselo a la persona." % ", ".join(hojas[:8]))
    for m, n in omitidos.items():
        print("AVISO: %d %s quedan sin traducir." % (n, m))
    print('Traduce cada "texto" y guarda un JSON {"s0": "..."} con el mismo id; conserva las etiquetas <r1>…</r1> si el texto las trae; '
          'no traduzcas nombres propios, códigos ni cifras.')


def _ancho_columnas(z, nombre):
    x = z.read(nombre).decode("utf-8")
    anchos = {}
    for m in re.finditer(r"<col\b([^>]*)/?>", x):
        at = m.group(1)
        mn, mx, w = (re.search(r'\b%s="([\d.]+)"' % k, at) for k in ("min", "max", "width"))
        if mn and mx and w:
            for c in range(int(mn.group(1)), min(int(mx.group(1)), 200) + 1):
                anchos[c] = float(w.group(1))
    return anchos


def _col_num(ref):
    letras = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letras:
        n = n * 26 + ord(ch) - 64
    return n


def cmd_aplicar(a):
    for r in (a.xlsx, a.traduccion):
        if not os.path.isfile(r):
            error("no existe el archivo %s" % r)
    if os.path.lexists(a.salida):
        error("%s ya existe; elige otro nombre (no se sobrescribe)." % a.salida)
    _revisar_zip(a.xlsx)
    with open(a.traduccion, encoding="utf-8") as f:
        tr = json.load(f)
    if isinstance(tr, dict) and "segmentos" in tr:
        tr = {s["id"]: s.get("traduccion", "") for s in tr["segmentos"] if s.get("traduccion")}
    informe = {"traducidos": 0, "sin_traduccion": [], "iguales": 0, "formato_simplificado": [], "posible_recorte": []}
    cambios = {}  # nombre de parte → xml nuevo
    usados = set()
    with zipfile.ZipFile(a.xlsx) as z:
        usos, hojas = _celdas_de_cadenas(z)
        originales = {}
        for p in _partes(z):
            nuevo = p.xml
            # de atrás hacia delante para no desplazar posiciones
            for (ini, fin, sp, texto, i) in reversed(p.unidades):
                sid = "%s%d" % (p.prefijo, i)
                originales[sid] = RUN_TAGS.sub("", texto)
                if not sp or not texto or not _traducible(RUN_TAGS.sub("", texto)):
                    continue
                if sid not in tr or not str(tr[sid]).strip():
                    informe["sin_traduccion"].append(sid)
                    continue
                usados.add(sid)
                t_nuevo = str(tr[sid])
                if re.sub(r"\s+", " ", RUN_TAGS.sub("", t_nuevo)).strip() == re.sub(r"\s+", " ", RUN_TAGS.sub("", texto)).strip():
                    informe["iguales"] += 1
                    continue
                unidad, simple = _poner_texto(p.xml[ini:fin], sp, t_nuevo, p.t_tag)
                nuevo = nuevo[:ini] + unidad + nuevo[fin:]
                informe["traducidos"] += 1
                if simple:
                    informe["formato_simplificado"].append(sid)
            cambios[p.nombre] = nuevo
        # recortes: texto traducido más largo que el ancho de su columna cuando el original sí cabía
        informe["posible_recorte"] = _recortes(z, tr, usos, originales)
    extra = sorted(set(tr) - usados - set(informe["sin_traduccion"]))
    if extra:
        informe["ids_desconocidos"] = extra
    # escribir la copia: mismas partes, mismo orden, bytes idénticos salvo las de texto cambiadas
    with zipfile.ZipFile(a.xlsx) as zi, zipfile.ZipFile(a.salida, "x", compression=zipfile.ZIP_DEFLATED) as zo:
        for info in zi.infolist():
            datos = cambios[info.filename].encode("utf-8") if info.filename in cambios else zi.read(info.filename)
            zo.writestr(info, datos, compress_type=info.compress_type)
    if a.informe:
        with open(a.informe, "w", encoding="utf-8") as f:
            json.dump(informe, f, ensure_ascii=False, indent=1)
    print("OK: %d textos traducidos -> %s" % (informe["traducidos"], a.salida))
    if informe["sin_traduccion"]:
        print("AVISO: %d textos sin traducir (quedan en el idioma original): %s" % (len(informe["sin_traduccion"]), ", ".join(informe["sin_traduccion"][:12])))
    if informe["formato_simplificado"]:
        print("AVISO: %d textos con formato mixto (negrita parcial…) quedaron con el formato del primer tramo: la traducción no trajo las etiquetas <rN>." % len(informe["formato_simplificado"]))
    if informe["posible_recorte"]:
        print("AVISO: la traducción es más larga que el ancho de la columna en %d celdas (no se cambian los anchos para no alterar el diseño): %s. "
              "Acórtalas o díselo a la persona." % (len(informe["posible_recorte"]), ", ".join(informe["posible_recorte"][:10])))
    if hojas:
        print("AVISO: los nombres de hoja no se traducen: %s." % ", ".join(hojas[:8]))
    # verificación obligatoria: la estructura debe ser idéntica
    import comparar_estructura  # noqa: E402
    dif, avisos, resumen = comparar_estructura.comparar(a.xlsx, a.salida)
    for d in dif:
        print("DIFERENCIA: " + d)
    if dif:
        os.remove(a.salida)  # la copia que acabamos de crear no sirve: no se entrega un libro con la estructura cambiada
        print("ESTRUCTURA: CAMBIÓ: se descartó la copia nueva; revisa la traducción y repite con otro nombre.")
        sys.exit(1)
    print("ESTRUCTURA: idéntica al original (%s)" % resumen)


def _recortes(z, tr, usos, originales):
    """Celdas de cadena compartida cuya traducción (en una línea) no cabe en el ancho de su columna aunque el original sí cabía.
    Aproximación: solo ancho de columna contra largo del texto (no mira si la celda ajusta el texto a varias líneas)."""
    nombres = {}
    try:
        wb = z.read("xl/workbook.xml").decode("utf-8")
        rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
        dest = {}
        for m in re.finditer(r"<Relationship\b([^>]*)/?>", rels):
            i, t = re.search(r'\bId="([^"]+)"', m.group(1)), re.search(r'\bTarget="([^"]+)"', m.group(1))
            if i and t:
                dest[i.group(1)] = t.group(1).lstrip("/")
        for m in re.finditer(r"<sheet\b([^>]*)/?>", wb):
            nom, rid = re.search(r'\bname="([^"]*)"', m.group(1)), re.search(r'\br:id="([^"]*)"', m.group(1))
            if nom and rid and rid.group(1) in dest:
                t = dest[rid.group(1)]
                nombres[_desescapar(nom.group(1))] = t if t.startswith("xl/") else "xl/" + t
    except KeyError:
        return []
    anchos = {h: _ancho_columnas(z, n) for h, n in nombres.items() if n in z.namelist()}
    salida = []
    for idx, refs in usos.items():
        t = tr.get("s%d" % idx)
        if not t:
            continue
        nuevo = len(RUN_TAGS.sub("", str(t)).split("\n")[0])
        viejo = len(originales.get("s%d" % idx, "").split("\n")[0])
        for ref in refs[:30]:
            hoja, celda = ref.rsplit("!", 1)
            w = anchos.get(hoja, {}).get(_col_num(celda), 8.43)
            if viejo <= w * 1.05 < nuevo:
                salida.append(ref)
    return salida


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extraer", help="lista los textos del Excel")
    e.add_argument("xlsx")
    e.add_argument("-o", "--salida", required=True)
    e.set_defaults(fn=cmd_extraer)
    p = sub.add_parser("aplicar", help="escribe la traducción en una COPIA del Excel")
    p.add_argument("xlsx")
    p.add_argument("-t", "--traduccion", required=True)
    p.add_argument("-o", "--salida", required=True)
    p.add_argument("--informe")
    p.set_defaults(fn=cmd_aplicar)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
