# -*- coding: utf-8 -*-
"""Banco de documentos DIFÍCILES, fabricados con código (sin datos de nadie): reproducen las rarezas internas de archivos reales que hacían
fallar la traducción o la edición. Cada documento parte de uno válido hecho con las propias bibliotecas (python-docx, openpyxl, python-pptx,
PyMuPDF) y se le aplican rarezas a nivel del ZIP/PDF.

Uso (desde las pruebas): `banco_docx(carpeta)` → {nombre: ruta}; igual `banco_xlsx`, `banco_pptx` y `banco_pdf`.
Las rarezas imitan a: la papelera de Word (`[trash]/0000.dat`), Word de Mac (`__MACOSX`, `.DS_Store`, carpetas vacías), Google Docs (sin
`docProps`, destinos absolutos), LibreOffice (`webSettings`, tipos de contenido al final), WPS (`customXml`, miniatura, fuentes incrustadas),
comentarios, control de cambios, objetos OLE, macros (.docm/.xlsm/.pptm), entradas repetidas o con otras mayúsculas, entradas vacías, nombres
con barra invertida, relaciones rotas, tablas dinámicas de Excel y medios de PowerPoint.
"""
import os
import re
import warnings
import zipfile

NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
BASURA = bytes(range(256)) * 8
PNG_1X1 = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?"
           b"\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82")


# ------------------------------------------------------------------ utilidades de ZIP
def leer(ruta):
    with zipfile.ZipFile(ruta) as z:
        return [[i.filename, z.read(i)] for i in z.infolist()]


def escribir(ruta, entradas):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")   # «Duplicate name»: justo lo que se quiere fabricar
        with zipfile.ZipFile(ruta, "w", zipfile.ZIP_DEFLATED) as z:
            for nombre, datos in entradas:
                z.writestr(nombre, datos)
    return ruta


def _buscar(entradas, nombre):
    for e in entradas:
        if e[0] == nombre:
            return e
    raise KeyError(nombre)


def _txt(entradas, nombre):
    return _buscar(entradas, nombre)[1].decode("utf-8")


def _poner(entradas, nombre, texto):
    _buscar(entradas, nombre)[1] = texto.encode("utf-8")


def ct_default(entradas, ext, tipo):
    t = _txt(entradas, "[Content_Types].xml")
    if 'Extension="%s"' % ext not in t:
        _poner(entradas, "[Content_Types].xml", t.replace("</Types>", '<Default Extension="%s" ContentType="%s"/></Types>' % (ext, tipo)))


def ct_override(entradas, parte, tipo):
    t = _txt(entradas, "[Content_Types].xml")
    _poner(entradas, "[Content_Types].xml", t.replace("</Types>", '<Override PartName="/%s" ContentType="%s"/></Types>' % (parte, tipo)))


def rels_nombre(parte):
    carpeta, _, base = parte.rpartition("/")
    return (carpeta + "/" if carpeta else "") + "_rels/" + base + ".rels"


def rel_agregar(entradas, parte_duena, rid, tipo, destino, externo=False):
    nombre = "_rels/.rels" if parte_duena == "" else rels_nombre(parte_duena)
    nueva = '<Relationship Id="%s" Type="%s" Target="%s"%s/>' % (rid, tipo, destino, ' TargetMode="External"' if externo else "")
    try:
        _poner(entradas, nombre, _txt(entradas, nombre).replace("</Relationships>", nueva + "</Relationships>"))
    except KeyError:
        entradas.append([nombre, ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="%s">%s</Relationships>'
                                  % (NS_PKG_REL, nueva)).encode("utf-8")])


# ------------------------------------------------------------------ rarezas comunes a todos los formatos OOXML
def r_trash(e, c):
    e.append(["[trash]/0000.dat", BASURA])


def r_huerfanas(e, c):
    e.append([c["dir"] + "/huerfana.xml", b'<?xml version="1.0"?><x>nadie me usa</x>'])
    e.append(["customXml/item9.xml", b"<datos>sin relacion</datos>"])
    e.append(["docProps/miniatura_vieja.jpeg", BASURA[:300]])
    e.append([c["dir"] + "/media/sin_uso.png", PNG_1X1])


def r_mac(e, c):
    e.append(["__MACOSX/._[Content_Types].xml", BASURA[:120]])
    e.append(["__MACOSX/%s/._%s" % (c["dir"], c["principal"].rsplit("/", 1)[-1]), BASURA[:120]])
    e.append([".DS_Store", BASURA[:200]])
    e.append([c["dir"] + "/", b""])      # carpetas (Word de Mac las escribe)
    e.append(["docProps/", b""])
    try:
        _poner(e, "docProps/app.xml", re.sub(r"<Application>[^<]*</Application>", "<Application>Microsoft Macintosh Word</Application>", _txt(e, "docProps/app.xml")))
    except KeyError:
        pass


def r_google(e, c):
    """Google Docs/Hojas/Presentaciones: sin docProps y con destinos absolutos («/word/styles.xml»)."""
    e[:] = [x for x in e if not x[0].startswith("docProps/")]
    for x in e:
        if x[0].endswith(".rels"):
            t = x[1].decode("utf-8")
            t = re.sub(r'<Relationship [^>]*Type="[^"]*(?:core-properties|extended-properties|custom-properties|thumbnail)"[^>]*/>', "", t)
            x[1] = t.encode("utf-8")
    t = _txt(e, "[Content_Types].xml")
    _poner(e, "[Content_Types].xml", re.sub(r'<Override PartName="/docProps/[^"]*"[^>]*/>', "", t))
    rels = rels_nombre(c["principal"])
    t = _txt(e, rels)
    base = c["dir"] + "/"
    _poner(e, rels, re.sub(r'Target="(?!/|http)([^"]+)"', lambda m: 'Target="/%s%s"' % (base, m.group(1)), t))


def r_libreoffice(e, c):
    """LibreOffice: docProps propios y `[Content_Types].xml` al final del ZIP (válido, pero otro orden)."""
    try:
        _poner(e, "docProps/app.xml", re.sub(r"<Application>[^<]*</Application>", "<Application>LibreOffice/24.8$Linux_X86_64</Application>", _txt(e, "docProps/app.xml")))
    except KeyError:
        pass
    e.append(["docProps/custom.xml", b'<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>'])
    ct_override(e, "docProps/custom.xml", "application/vnd.openxmlformats-officedocument.custom-properties+xml")
    rel_agregar(e, "", "rId90", NS_REL + "/custom-properties", "docProps/custom.xml")
    ct = _buscar(e, "[Content_Types].xml")
    e.remove(ct)
    e.append(ct)


def _sin(e, *nombres):
    """Quita entradas que ya existan (la plantilla de python-docx ya trae algunas) para no fabricar repetidas sin querer."""
    e[:] = [x for x in e if x[0] not in nombres]


def r_wps(e, c):
    """WPS: miniatura, propiedades personalizadas, `customXml` con sus propiedades y fuentes incrustadas."""
    if not any(x[0] == "docProps/thumbnail.jpeg" for x in e):
        e.append(["docProps/thumbnail.jpeg", BASURA[:400]])
        ct_default(e, "jpeg", "image/jpeg")
        rel_agregar(e, "", "rId91", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail", "docProps/thumbnail.jpeg")
    _sin(e, "docProps/custom.xml")
    e.append(["docProps/custom.xml", b'<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" '
              b'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="KSOProductBuildVer"><vt:lpwstr>2052-11.1.0</vt:lpwstr></property></Properties>'])
    ct_override(e, "docProps/custom.xml", "application/vnd.openxmlformats-officedocument.custom-properties+xml")
    rel_agregar(e, "", "rId92", NS_REL + "/custom-properties", "docProps/custom.xml")
    _sin(e, "customXml/item1.xml", "customXml/itemProps1.xml", "customXml/_rels/item1.xml.rels")
    e.append(["customXml/item1.xml", b'<?xml version="1.0" encoding="UTF-8"?><wps:meta xmlns:wps="urn:wps"><wps:v>1</wps:v></wps:meta>'])
    e.append(["customXml/itemProps1.xml", b'<?xml version="1.0" encoding="UTF-8"?><ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{11111111-2222-3333-4444-555555555555}"/>'])
    e.append(["customXml/_rels/item1.xml.rels", ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="%s"><Relationship Id="rId1" '
              'Type="%s/customXmlProps" Target="itemProps1.xml"/></Relationships>' % (NS_PKG_REL, NS_REL)).encode()])
    ct_override(e, "customXml/itemProps1.xml", "application/vnd.openxmlformats-officedocument.customXmlProperties+xml")
    rel_agregar(e, c["principal"], "rId93", NS_REL + "/customXml", "../customXml/item1.xml")
    ct_default(e, "odttf", "application/vnd.openxmlformats-officedocument.obfuscatedFont")
    e.append([c["dir"] + "/fonts/font1.odttf", BASURA])
    rel_agregar(e, c["dir"] + "/fontTable.xml", "rId1", NS_REL + "/font", "fonts/font1.odttf")


def r_duplicadas(e, c):
    """La misma parte dos veces (una versión vieja primero) y una copia con otras mayúsculas."""
    principal = _buscar(e, c["principal"])
    e.insert(0, [principal[0], principal[1].replace(c["marca"].encode(), b"TEXTO VIEJO")])   # Python (y Word) leen la última
    e.append([c["principal"].upper(), b"<basura/>"])


def r_vacias(e, c):
    e.append([c["dir"] + "/vacia.xml", b""])
    e.append([c["dir"] + "/media/cero.png", b""])
    e.append(["docProps/vacio.bin", b""])


def r_barras(e, c):
    """Algunas herramientas de Windows guardan los nombres con `\\`."""
    for x in e:
        if x[0] not in ("[Content_Types].xml", "_rels/.rels") and "/" in x[0]:
            x[0] = x[0].replace("/", "\\")


def r_mayusculas(e, c):
    """Una parte guardada con otras mayúsculas que las de sus referencias (el paquete las trata como iguales)."""
    for x in e:
        if x[0] in (c["dir"] + "/styles.xml", c["dir"] + "/sharedStrings.xml", c["dir"] + "/presProps.xml"):
            x[0] = c["dir"].capitalize() + "/" + x[0].split("/", 1)[1].upper()
            return


def r_rota(e, c):
    """Una relación que apunta a una parte que no existe y su tipo de contenido huérfano."""
    rel_agregar(e, c["principal"], "rId99", NS_REL + "/image", "media/no_existe.png")
    ct_override(e, c["dir"] + "/no_existe.xml", "application/xml")
    rel_agregar(e, c["principal"], "rId98", NS_REL + "/hyperlink", "https://example.com/", externo=True)


def r_comentarios_extra(e, c):
    """Una parte de personas/comentarios modernos (alcanzable): debe conservarse tal cual."""
    e.append([c["dir"] + "/people.xml", b'<?xml version="1.0" encoding="UTF-8"?><ppl:people xmlns:ppl="http://schemas.microsoft.com/office/word/2012/wordml"/>'])
    ct_override(e, c["dir"] + "/people.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml")
    rel_agregar(e, c["principal"], "rId97", "http://schemas.microsoft.com/office/2011/relationships/people", "people.xml")


COMUNES = {
    "trash": r_trash, "huerfanas": r_huerfanas, "mac": r_mac, "google": r_google, "libreoffice": r_libreoffice, "wps": r_wps,
    "duplicadas": r_duplicadas, "vacias": r_vacias, "barras": r_barras, "mayusculas": r_mayusculas, "rota": r_rota,
}


def _variantes(base, carpeta, ctx, extra, ext, excluir=()):
    """Escribe una copia de `base` por cada rareza común y por cada rareza propia del formato."""
    out = {"base": base}
    todas = dict(COMUNES)
    todas.update(extra)
    for nombre, fn in todas.items():
        if nombre in excluir:
            continue
        e = leer(base)
        fn(e, ctx)
        out[nombre] = escribir(os.path.join(carpeta, "%s.%s" % (nombre, ext)), e)
    return out


# ------------------------------------------------------------------ Word
def _docx_base(ruta):
    import docx
    d = docx.Document()
    d.add_heading("Informe de ventas", 1)
    p = d.add_paragraph()
    p.add_run("Hola mundo").bold = True
    p.add_run(" y buenos días a todos.")
    d.add_paragraph("Primer punto de la lista", style="List Bullet")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text = "Nombre"
    t.cell(0, 1).text = "Cantidad"
    t.cell(1, 0).text = "Manzanas"
    t.cell(1, 1).text = "12"
    d.sections[0].header.paragraphs[0].text = "Encabezado del documento"
    d.sections[0].footer.paragraphs[0].text = "Pie del documento"
    d.save(ruta)
    return ruta


def _docx_con_comentarios(ruta):
    import docx
    d = docx.Document()
    p = d.add_paragraph()
    r = p.add_run("Hola mundo")
    d.add_paragraph("Segundo párrafo con contenido.")
    d.add_comment(r, text="Revisar esta frase por favor", author="Ana", initials="A")
    d.save(ruta)
    return ruta


def _r_cambios(e, c):
    t = _txt(e, "word/document.xml")
    nuevo = ('<w:p><w:ins w:id="90" w:author="Ana" w:date="2026-01-01T00:00:00Z"><w:r><w:t>texto insertado</w:t></w:r></w:ins>'
             '<w:del w:id="91" w:author="Ana" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>texto borrado</w:delText></w:r></w:del></w:p>')
    _poner(e, "word/document.xml", t.replace("<w:sectPr", nuevo + "<w:sectPr", 1))


def _r_ole(e, c):
    e.append(["word/embeddings/oleObject1.bin", BASURA])
    ct_default(e, "bin", "application/vnd.openxmlformats-officedocument.oleObject")
    rel_agregar(e, "word/document.xml", "rId80", NS_REL + "/oleObject", "embeddings/oleObject1.bin")
    t = _txt(e, "word/document.xml")
    obj = '<w:p><w:r><w:object><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="o1"/><o:OLEObject xmlns:o="urn:schemas-microsoft-com:office:office" Type="Embed" ProgID="Excel.Sheet.12" r:id="rId80"/></w:object></w:r></w:p>'
    _poner(e, "word/document.xml", t.replace("<w:sectPr", obj + "<w:sectPr", 1))


def _r_macros_docm(e, c):
    t = _txt(e, "[Content_Types].xml")
    _poner(e, "[Content_Types].xml", t.replace("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", "application/vnd.ms-word.document.macroEnabled.main+xml"))
    ct_default(e, "bin", "application/vnd.ms-office.vbaProject")
    e.append(["word/vbaProject.bin", BASURA])
    rel_agregar(e, "word/document.xml", "rId81", "http://schemas.microsoft.com/office/2006/relationships/vbaProject", "vbaProject.bin")


def banco_docx(carpeta):
    base = _docx_base(os.path.join(carpeta, "base.docx"))
    ctx = {"dir": "word", "principal": "word/document.xml", "marca": "Hola mundo"}
    out = _variantes(base, carpeta, ctx, {"cambios": _r_cambios, "ole": _r_ole}, "docx")
    com = _docx_con_comentarios(os.path.join(carpeta, "base-comentarios.docx"))
    out["comentarios"] = com
    e = leer(com)
    r_trash(e, ctx)
    out["comentarios+trash"] = escribir(os.path.join(carpeta, "comentarios-trash.docx"), e)
    e = leer(base)
    _r_macros_docm(e, ctx)
    out["macros"] = escribir(os.path.join(carpeta, "macros.docm"), e)
    return out


# ------------------------------------------------------------------ Excel
def _xlsx_base(ruta):
    import openpyxl
    from openpyxl.comments import Comment
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Ventas"
    ws.append(["Producto", "Cantidad", "Precio", "Total"])
    for n, q, p in (("Manzanas", 3, 2.5), ("Naranjas", 5, 1.2)):
        ws.append([n, q, p, None])
    for r in (2, 3):
        ws["D%d" % r] = "=B%d*C%d" % (r, r)
    ws["A2"].comment = Comment("Fruta fresca", "yo")
    wb.save(ruta)
    return ruta


def _r_pivot(e, c):
    """Tabla dinámica: caché con sus registros, tabla y las relaciones que las unen a la hoja y al libro."""
    cache_def = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                 'xmlns:r="%s" r:id="rId1" refreshedBy="x" recordCount="2"><cacheSource type="worksheet"><worksheetSource ref="A1:D3" sheet="Ventas"/></cacheSource>'
                 '<cacheFields count="1"><cacheField name="Producto" numFmtId="0"><sharedItems count="2"><s v="Manzanas"/><s v="Naranjas"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>' % NS_REL)
    e.append(["xl/pivotCache/pivotCacheDefinition1.xml", cache_def.encode()])
    e.append(["xl/pivotCache/pivotCacheRecords1.xml", b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0"/>'])
    e.append(["xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels", ('<?xml version="1.0"?><Relationships xmlns="%s"><Relationship Id="rId1" Type="%s/pivotCacheRecords" '
              'Target="pivotCacheRecords1.xml"/></Relationships>' % (NS_PKG_REL, NS_REL)).encode()])
    e.append(["xl/pivotTables/pivotTable1.xml", b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
              b'name="Tabla1" cacheId="1" dataCaption="Valores"><location ref="F1:G3" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/></pivotTableDefinition>'])
    e.append(["xl/pivotTables/_rels/pivotTable1.xml.rels", ('<?xml version="1.0"?><Relationships xmlns="%s"><Relationship Id="rId1" Type="%s/pivotCacheDefinition" '
              'Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>' % (NS_PKG_REL, NS_REL)).encode()])
    ct_override(e, "xl/pivotCache/pivotCacheDefinition1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml")
    ct_override(e, "xl/pivotCache/pivotCacheRecords1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml")
    ct_override(e, "xl/pivotTables/pivotTable1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml")
    rel_agregar(e, "xl/workbook.xml", "rId70", NS_REL + "/pivotCacheDefinition", "pivotCache/pivotCacheDefinition1.xml")
    rel_agregar(e, "xl/worksheets/sheet1.xml", "rId71", NS_REL + "/pivotTable", "../pivotTables/pivotTable1.xml")
    wb = _txt(e, "xl/workbook.xml")
    if "<pivotCaches>" not in wb:
        wb = re.sub(r"(</sheets>(?:<definedNames>.*?</definedNames>)?)", r'\1<pivotCaches><pivotCache cacheId="1" r:id="rId70"/></pivotCaches>', wb, count=1, flags=re.S)
        if 'xmlns:r=' not in wb.split(">", 2)[1]:
            wb = wb.replace("<workbook ", '<workbook xmlns:r="%s" ' % NS_REL, 1)
        _poner(e, "xl/workbook.xml", wb)


def _r_macros_xlsm(e, c):
    t = _txt(e, "[Content_Types].xml")
    _poner(e, "[Content_Types].xml", t.replace("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", "application/vnd.ms-excel.sheet.macroEnabled.main+xml"))
    ct_default(e, "bin", "application/vnd.ms-office.vbaProject")
    e.append(["xl/vbaProject.bin", BASURA])
    rel_agregar(e, "xl/workbook.xml", "rId72", "http://schemas.microsoft.com/office/2006/relationships/vbaProject", "vbaProject.bin")


def _r_ole_xlsx(e, c):
    e.append(["xl/embeddings/oleObject1.bin", BASURA])
    ct_default(e, "bin", "application/vnd.openxmlformats-officedocument.oleObject")
    rel_agregar(e, "xl/worksheets/sheet1.xml", "rId73", NS_REL + "/oleObject", "../embeddings/oleObject1.bin")


def banco_xlsx(carpeta):
    base = _xlsx_base(os.path.join(carpeta, "base.xlsx"))
    ctx = {"dir": "xl", "principal": "xl/workbook.xml", "marca": "Ventas"}
    out = _variantes(base, carpeta, ctx, {"pivot": _r_pivot, "ole": _r_ole_xlsx}, "xlsx", excluir=("duplicadas",))
    e = leer(base)
    r_duplicadas(e, dict(ctx, principal="xl/worksheets/sheet1.xml", marca="<c "))   # la copia repetida es la de la hoja, que tiene el contenido
    out["duplicadas"] = escribir(os.path.join(carpeta, "duplicadas.xlsx"), e)
    e = leer(base)
    _r_macros_xlsm(e, ctx)
    out["macros"] = escribir(os.path.join(carpeta, "macros.xlsm"), e)
    e = leer(base)
    r_trash(e, ctx)
    _r_pivot(e, ctx)
    out["pivot+trash"] = escribir(os.path.join(carpeta, "pivot-trash.xlsx"), e)
    return out


# ------------------------------------------------------------------ PowerPoint
def _pptx_base(ruta):
    from pptx import Presentation
    from pptx.util import Inches
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Resumen del trimestre"
    s.placeholders[1].text = "Hola mundo\nSegundo punto"
    png = ruta + ".png"
    with open(png, "wb") as f:
        f.write(PNG_1X1)
    s.shapes.add_picture(png, Inches(1), Inches(5), Inches(1), Inches(1))
    s.notes_slide.notes_text_frame.text = "Notas del orador"
    os.remove(png)
    prs.save(ruta)
    return ruta


def _r_medios(e, c):
    """Audio y video incrustados, con su tipo de contenido y relaciones desde la diapositiva."""
    e.append(["ppt/media/audio1.mp3", BASURA])
    e.append(["ppt/media/video1.mp4", BASURA * 4])
    ct_default(e, "mp3", "audio/mpeg")
    ct_default(e, "mp4", "video/mp4")
    rel_agregar(e, "ppt/slides/slide1.xml", "rId60", NS_REL + "/audio", "../media/audio1.mp3")
    rel_agregar(e, "ppt/slides/slide1.xml", "rId61", NS_REL + "/video", "../media/video1.mp4")
    rel_agregar(e, "ppt/slides/slide1.xml", "rId62", "http://schemas.microsoft.com/office/2007/relationships/media", "../media/audio1.mp3")


def _r_comentarios_ppt(e, c):
    e.append(["ppt/commentAuthors.xml", b'<?xml version="1.0" encoding="UTF-8"?><p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cmAuthor id="0" name="Ana" initials="A" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>'])
    e.append(["ppt/comments/comment1.xml", b'<?xml version="1.0" encoding="UTF-8"?><p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cm authorId="0" dt="2026-01-01T00:00:00.000" idx="1"><p:pos x="10" y="10"/><p:text>Revisar</p:text></p:cm></p:cmLst>'])
    ct_override(e, "ppt/commentAuthors.xml", "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml")
    ct_override(e, "ppt/comments/comment1.xml", "application/vnd.openxmlformats-officedocument.presentationml.comments+xml")
    rel_agregar(e, "ppt/presentation.xml", "rId63", NS_REL + "/commentAuthors", "commentAuthors.xml")
    rel_agregar(e, "ppt/slides/slide1.xml", "rId64", NS_REL + "/comments", "../comments/comment1.xml")


def _r_macros_pptm(e, c):
    t = _txt(e, "[Content_Types].xml")
    _poner(e, "[Content_Types].xml", t.replace("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"))
    ct_default(e, "bin", "application/vnd.ms-office.vbaProject")
    e.append(["ppt/vbaProject.bin", BASURA])
    rel_agregar(e, "ppt/presentation.xml", "rId65", "http://schemas.microsoft.com/office/2006/relationships/vbaProject", "vbaProject.bin")


def banco_pptx(carpeta):
    base = _pptx_base(os.path.join(carpeta, "base.pptx"))
    ctx = {"dir": "ppt", "principal": "ppt/presentation.xml", "marca": "Hola mundo"}
    out = _variantes(base, carpeta, ctx, {"medios": _r_medios, "comentarios": _r_comentarios_ppt}, "pptx", excluir=("duplicadas",))
    e = leer(base)
    r_duplicadas(e, dict(ctx, principal="ppt/slides/slide1.xml"))
    out["duplicadas"] = escribir(os.path.join(carpeta, "duplicadas.pptx"), e)
    e = leer(base)
    _r_macros_pptm(e, ctx)
    out["macros"] = escribir(os.path.join(carpeta, "macros.pptm"), e)
    e = leer(base)
    r_trash(e, ctx)
    _r_medios(e, ctx)
    out["medios+trash"] = escribir(os.path.join(carpeta, "medios-trash.pptx"), e)
    return out


# ------------------------------------------------------------------ PDF
def banco_pdf(carpeta):
    import fitz
    base = os.path.join(carpeta, "base.pdf")
    doc = fitz.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text((72, 100), "Hola mundo", fontname="hebo", fontsize=14)
    p.insert_text((72, 140), "Seguro de todo riesgo.", fontname="helv", fontsize=11)
    doc.set_metadata({"title": "Documento de prueba", "author": "Banco"})
    doc.save(base)
    doc.close()
    out = {"base": base}
    datos = open(base, "rb").read()

    def guardar(nombre, contenido):
        ruta = os.path.join(carpeta, nombre + ".pdf")
        with open(ruta, "wb") as f:
            f.write(contenido)
        out[nombre] = ruta

    guardar("basura_al_final", datos + b"\n" + BASURA * 8)
    guardar("basura_al_inicio", BASURA[:64].replace(b"%", b"x") + b"\n" + datos)
    mal = re.sub(rb"startxref\s+\d+", b"startxref\n99999999", datos)
    guardar("xref_roto", mal)
    d = fitz.open(base)
    d.embfile_add("adjunto.txt", b"datos adjuntos")
    cat = d.pdf_catalog()
    d.xref_set_key(cat, "OpenAction", "<</S/JavaScript/JS(app.alert\\('hola'\\))>>")
    d.update_object(d.get_new_xref(), "<</Huerfano true>>")   # un objeto que nadie usa
    ruta = os.path.join(carpeta, "js_adjunto_huerfano.pdf")
    d.save(ruta)
    d.close()
    out["js_adjunto_huerfano"] = ruta
    d = fitz.open(base)
    d.save(os.path.join(carpeta, "incremental.pdf"))
    d.close()
    d = fitz.open(os.path.join(carpeta, "incremental.pdf"))
    d.set_metadata({"title": "Segunda versión"})
    d.saveIncr()
    d.close()
    out["incremental"] = os.path.join(carpeta, "incremental.pdf")
    return out
