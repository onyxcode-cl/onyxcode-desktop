#!/usr/bin/env python3
"""Compara la ESTRUCTURA de un documento antes y después de traducirlo (o editarlo en copia): `comparar_estructura.py original traducido`.

Sirve para .docx, .xlsx/.xlsm y .pdf (por la extensión del original; ambos deben ser del mismo tipo). Solo estándar de Python (PDF: PyMuPDF si está).
Códigos: 0 estructura idéntica (puede traer AVISOS de formato), 1 la estructura cambió (el texto es lo único que debía cambiar), 2 uso/archivo ilegible.
  docx: mismos párrafos con el mismo estilo/alineación/lista/imágenes/enlaces, mismas tablas (filas × columnas), mismas secciones (tamaño y márgenes) y
        todas las partes que no son texto (estilos, numeración, tema, imágenes, configuración) idénticas byte a byte.
  xlsx: mismas hojas, mismas celdas (referencia, estilo, tipo y FÓRMULA idénticos), mismas combinaciones, anchos, filtros, validaciones, estilos y
        gráficos/imágenes; solo pueden cambiar los textos (cadenas compartidas, comentarios, textos de gráficos y de cuadros).
  pdf:  mismo número de páginas y tamaños, mismas imágenes, mismos dibujos, enlaces y anotaciones.
"""
import hashlib
import re
import sys
import zipfile
from xml.etree import ElementTree as ET


def _zip(ruta):
    try:
        return zipfile.ZipFile(ruta)
    except (zipfile.BadZipFile, OSError) as e:
        print("ERROR: no se pudo abrir %s: %s" % (ruta, e), file=sys.stderr)
        sys.exit(2)


def _canon(z, nombre):
    """Huella de una parte: XML canónico (da igual el orden de atributos, los espacios entre etiquetas o cómo la biblioteca reserializó el
    archivo; las relaciones y tipos de contenido se comparan sin importar el orden); el resto, por bytes."""
    datos = z.read(nombre)
    if nombre.endswith((".xml", ".rels", ".vml")):
        try:
            raiz = ET.fromstring(datos)
            if nombre.endswith(".rels") or nombre == "[Content_Types].xml":
                return hashlib.sha256("\n".join(sorted(ET.canonicalize(ET.tostring(e)) for e in raiz)).encode()).hexdigest()
            return hashlib.sha256(ET.canonicalize(ET.tostring(raiz), strip_text=False).encode()).hexdigest()
        except ET.ParseError:
            pass
    return hashlib.sha256(datos).hexdigest()


def _partes_fijas(za, zb, es_texto, dif, avisos):
    """Misma lista de partes y bytes idénticos en todas las que no son de texto."""
    na, nb = set(za.namelist()), set(zb.namelist())
    for n in sorted(na - nb):
        dif.append("falta la parte %s" % n)
    for n in sorted(nb - na):
        dif.append("sobra la parte %s" % n)
    for n in sorted(na & nb):
        if not es_texto(n) and _canon(za, n) != _canon(zb, n):
            dif.append("cambió la parte %s (no es de texto)" % n)


# ------------------------------------------------------------------ docx
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _val(el, tag):
    h = el.find(".//" + W + tag) if el is not None else None
    return None if h is None else h.get(W + "val")


def _on(rp, tag):
    """¿Está activa la propiedad (<w:b/> sí; <w:b w:val="0"/> no)?"""
    e = rp.find(W + tag)
    return e is not None and e.get(W + "val") not in ("0", "false", "off")


def _esqueleto_docx(xml):
    """Lista de elementos del cuerpo con todo lo que NO es el texto."""
    raiz = ET.fromstring(xml)
    sal, fmt = [], []

    def parrafo(p):
        ppr = p.find(W + "pPr")
        firma = (_val(ppr, "pStyle"), _val(ppr, "jc"), _val(ppr, "ilvl"), _val(ppr, "numId"),
                 len(list(p.iter(W + "drawing"))) + len(list(p.iter("{urn:schemas-microsoft-com:vml}imagedata"))),
                 len(list(p.iter(W + "hyperlink"))), len(list(p.iter(W + "br"))), len(list(p.iter(W + "tab"))))
        sal.append(("p",) + firma)
        runs = set()
        for r in p.iter(W + "r"):
            if not "".join(t.text or "" for t in r.iter(W + "t")).strip():
                continue
            rp = r.find(W + "rPr")
            f = rp.find(W + "rFonts") if rp is not None else None
            runs.add((_on(rp, "b"), _on(rp, "i"), _on(rp, "u"),
                      _val(rp, "color"), _val(rp, "sz"), None if f is None else f.get(W + "ascii")) if rp is not None else (False,) * 3 + (None,) * 3)
        fmt.append(runs)

    def recorrer(nodo):
        for h in nodo:
            if h.tag == W + "p":
                parrafo(h)
            elif h.tag == W + "tbl":
                filas = h.findall(W + "tr")
                sal.append(("tbl", len(filas), tuple(len(f.findall(W + "tc")) for f in filas)))
                for tr in filas:
                    for tc in tr.findall(W + "tc"):
                        recorrer(tc)
                sal.append(("/tbl",))
            elif h.tag == W + "sectPr":
                pg, mg = h.find(W + "pgSz"), h.find(W + "pgMar")
                sal.append(("sect", None if pg is None else tuple(sorted(pg.attrib.items())), None if mg is None else tuple(sorted(mg.attrib.items()))))
            elif h.tag in (W + "sdt", W + "sdtContent", W + "ins", W + "del", W + "smartTag"):
                recorrer(h)

    cuerpo = raiz.find(W + "body")
    if cuerpo is None:
        recorrer(raiz)
    else:
        recorrer(cuerpo)
    return sal, fmt


def comparar_docx(a, b):
    za, zb = _zip(a), _zip(b)
    dif, avisos = [], []
    texto = lambda n: bool(re.match(r"word/(document|header\d*|footer\d*|footnotes|endnotes|comments\w*)\.xml$", n))
    _partes_fijas(za, zb, texto, dif, avisos)
    n_par = 0
    for n in sorted(set(za.namelist()) & set(zb.namelist())):
        if not texto(n):
            continue
        ea, fa = _esqueleto_docx(za.read(n))
        eb, fb = _esqueleto_docx(zb.read(n))
        n_par += sum(1 for x in ea if x[0] == "p")
        if ea != eb:
            for i, (x, y) in enumerate(zip(ea, eb)):
                if x != y:
                    dif.append("%s: el elemento %d cambió (%s → %s)" % (n, i, x[:4], y[:4]))
                    break
            else:
                dif.append("%s: cambió el número de elementos (%d → %d)" % (n, len(ea), len(eb)))
        else:
            perdidos = sum(1 for x, y in zip(fa, fb) if x and y and x != y)
            if perdidos:
                avisos.append("%s: %d párrafos cambiaron de formato (negrita, color, fuente…): ¿la traducción no trajo las etiquetas?" % (n, perdidos))
    return dif, avisos, "%d párrafos" % n_par


# ------------------------------------------------------------------ xlsx
def _celdas_xlsx(xml):
    """Por hoja: celdas (ref, estilo, tipo, fórmula) y todo el XML sin los valores de texto (`<v>` de cadenas y `<is>` en línea)."""
    s = xml.decode("utf-8", "replace")
    celdas = []
    for m in re.finditer(r"<c\b([^>]*?)(/>|>(.*?)</c>)", s, re.S):
        at, cuerpo = m.group(1), m.group(3) or ""
        ref = re.search(r'\br="([^"]+)"', at)
        est = re.search(r'\bs="([^"]+)"', at)
        tipo = re.search(r'\bt="([^"]+)"', at)
        f = re.search(r"<f\b[^>]*?(?:/>|>(.*?)</f>)", cuerpo, re.S)
        t = tipo.group(1) if tipo else None
        celdas.append((ref.group(1) if ref else None, est.group(1) if est else None, "texto" if t in ("s", "inlineStr", "str") else t,
                       f.group(0) if f else None))
    # resto del XML sin el contenido de las celdas de texto: columnas, combinaciones, filtros, validaciones, etc.
    resto = re.sub(r"<is>.*?</is>", "<is/>", s, flags=re.S)
    resto = re.sub(r'(<c\b[^>]*\bt="s"[^>]*>)\s*<v>[^<]*</v>', r"\1<v/>", resto)
    resto = re.sub(r"(<c\b[^>]*\bt=\"str\"[^>]*>\s*<f\b.*?</f>)\s*<v>[^<]*</v>", r"\1", resto, flags=re.S)
    return celdas, resto


def comparar_xlsx(a, b):
    za, zb = _zip(a), _zip(b)
    dif, avisos = [], []
    texto = lambda n: bool(re.match(r"xl/(sharedStrings\.xml|comments(?:/[^/]*|\w*)\.xml|charts/chart\d+\.xml|drawings/drawing\d+\.xml)$", n)) or \
        bool(re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    _partes_fijas(za, zb, texto, dif, avisos)
    n_celdas = 0
    for n in sorted(set(za.namelist()) & set(zb.namelist())):
        if re.match(r"xl/worksheets/sheet\d+\.xml$", n):
            ca, ra = _celdas_xlsx(za.read(n))
            cb, rb = _celdas_xlsx(zb.read(n))
            n_celdas += len(ca)
            if ca != cb:
                for x, y in zip(ca, cb):
                    if x != y:
                        dif.append("%s: la celda %s cambió (estilo/tipo/fórmula)" % (n, x[0]))
                        break
                else:
                    dif.append("%s: cambió el número de celdas (%d → %d)" % (n, len(ca), len(cb)))
            elif ra != rb:
                dif.append("%s: cambió la estructura de la hoja (columnas, combinaciones, filtros, validaciones…)" % n)
        elif re.match(r"xl/sharedStrings\.xml$", n):
            ua = len(re.findall(r"<si\b", za.read(n).decode("utf-8", "replace")))
            ub = len(re.findall(r"<si\b", zb.read(n).decode("utf-8", "replace")))
            if ua != ub:
                dif.append("sharedStrings: cambió el número de textos (%d → %d)" % (ua, ub))
        elif re.match(r"xl/(charts/chart|drawings/drawing)\d+\.xml$", n):
            sa = re.sub(r"<a:t>[^<]*</a:t>|<c:v>[^<]*</c:v>", "", za.read(n).decode("utf-8", "replace"))
            sb = re.sub(r"<a:t>[^<]*</a:t>|<c:v>[^<]*</c:v>", "", zb.read(n).decode("utf-8", "replace"))
            sa, sb = re.sub(r"<a:r>.*?</a:r>", "", sa, flags=re.S), re.sub(r"<a:r>.*?</a:r>", "", sb, flags=re.S)
            if sa != sb:
                dif.append("%s: cambió algo que no es texto del gráfico o cuadro" % n)
    return dif, avisos, "%d celdas" % n_celdas


# ------------------------------------------------------------------ pdf
def comparar_pdf(a, b):
    try:
        import fitz  # PyMuPDF (el mismo que usa translate_pdf.py)
    except ImportError:
        print("ERROR: falta PyMuPDF para comparar PDF.", file=sys.stderr)
        sys.exit(2)
    try:
        da, db = fitz.open(a), fitz.open(b)
    except Exception as e:  # noqa: BLE001
        print("ERROR: no se pudo abrir el PDF: %s" % e, file=sys.stderr)
        sys.exit(2)
    dif, avisos = [], []
    if len(da) != len(db):
        dif.append("cambió el número de páginas (%d → %d)" % (len(da), len(db)))
    for i in range(min(len(da), len(db))):
        pa, pb = da[i], db[i]
        if tuple(round(x) for x in pa.rect) != tuple(round(x) for x in pb.rect):
            dif.append("página %d: cambió el tamaño" % (i + 1))
        for nombre, f in (("imágenes", lambda p: len(p.get_images())), ("dibujos", lambda p: len(p.get_drawings())),
                          ("anotaciones", lambda p: len(list(p.annots() or []))),
                          ("enlaces", lambda p: len(p.get_links()))):
            x, y = f(pa), f(pb)
            if x != y:
                (avisos if nombre == "enlaces" else dif).append("página %d: cambió el número de %s (%d → %d)" % (i + 1, nombre, x, y))
        ta, tb = len(pa.get_text("blocks")), len(pb.get_text("blocks"))
        if abs(ta - tb) > max(3, ta * 0.35):
            avisos.append("página %d: el número de bloques de texto cambió bastante (%d → %d); revisa la imagen" % (i + 1, ta, tb))
    return dif, avisos, "%d páginas" % len(da)


def comparar(a, b):
    ext = a.lower().rsplit(".", 1)[-1]
    if ext != b.lower().rsplit(".", 1)[-1] and not (ext in ("xlsx", "xlsm") and b.lower().rsplit(".", 1)[-1] in ("xlsx", "xlsm")):
        print("ERROR: los dos archivos deben ser del mismo tipo.", file=sys.stderr)
        sys.exit(2)
    if ext == "docx":
        return comparar_docx(a, b)
    if ext in ("xlsx", "xlsm"):
        return comparar_xlsx(a, b)
    if ext == "pdf":
        return comparar_pdf(a, b)
    print("ERROR: solo se comparan .docx, .xlsx y .pdf.", file=sys.stderr)
    sys.exit(2)


def main(argv):
    if len(argv) != 3:
        print("Uso: comparar_estructura.py original traducido", file=sys.stderr)
        return 2
    dif, avisos, resumen = comparar(argv[1], argv[2])
    for d in dif:
        print("DIFERENCIA: " + d)
    for v in avisos:
        print("AVISO: " + v)
    if dif:
        print("ESTRUCTURA: CAMBIÓ (%d diferencias). Solo el texto debía cambiar: revisa la traducción o el original." % len(dif))
        return 1
    print("ESTRUCTURA: idéntica (%s)%s" % (resumen, " con %d aviso(s)" % len(avisos) if avisos else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
