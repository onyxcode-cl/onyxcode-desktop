# .cowork/make_docx.py: crea un .docx real (títulos, párrafos, viñetas, tablas) solo con la
# biblioteca estándar de Python. Edita la lista CONTENIDO y ejecuta: python3 .cowork/make_docx.py
import re
import sys
import zipfile
from xml.sax.saxutils import escape

SALIDA = sys.argv[1] if len(sys.argv) > 1 else 'informe.docx'  # usa un nombre NUEVO (ver la skill)
CONTENIDO = [
    ('titulo', 'Informe de ventas del tercer trimestre'),
    ('p', 'Resumen: las ventas subieron **12 %** frente al trimestre anterior.'),
    ('h1', 'Detalle por mes'),
    ('tabla', [['Mes', 'Total (CLP)'], ['Julio', '1.234.500'], ['Agosto', '1.310.000']]),
    ('h2', 'Conclusiones'),
    ('ul', ['Crecimiento sostenido', 'Riesgo: dependencia de un cliente']),
]

def runs(texto):  # **negrita** dentro del texto
    out = []
    for i, parte in enumerate(re.split(r'\*\*', texto)):
        if parte:
            rpr = '<w:rPr><w:b/></w:rPr>' if i % 2 else ''
            out.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, escape(parte)))
    return ''.join(out)

def parrafo(texto, estilo=None, num=False):
    ppr = ''
    if estilo or num:
        ppr = '<w:pPr>%s%s</w:pPr>' % (
            '<w:pStyle w:val="%s"/>' % estilo if estilo else '',
            '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' if num else '')
    return '<w:p>%s%s</w:p>' % (ppr, runs(texto))

def tabla(filas):
    ancho = 9360 // len(filas[0])  # ancho útil de la página (Carta, márgenes de 2,5 cm) en twips
    bordes = ''.join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="808080"/>' % b
                     for b in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    xml = ['<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="%d" w:type="dxa"/><w:tblBorders>%s</w:tblBorders>'
           '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>%s</w:tblGrid>'
           % (ancho * len(filas[0]), bordes, '<w:gridCol w:w="%d"/>' % ancho * len(filas[0]))]
    for n, fila in enumerate(filas):
        xml.append('<w:tr>' + ('<w:trPr><w:tblHeader/></w:trPr>' if n == 0 else ''))
        for celda in fila:
            tcpr = '<w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s</w:tcPr>' % (
                ancho, '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' if n == 0 else '')
            texto = '**%s**' % celda if n == 0 else str(celda)
            xml.append('<w:tc>%s%s</w:tc>' % (tcpr, parrafo(texto)))
        xml.append('</w:tr>')
    xml.append('</w:tbl>' + parrafo(''))
    return ''.join(xml)

cuerpo = []
for tipo, dato in CONTENIDO:
    if tipo == 'titulo': cuerpo.append(parrafo(dato, 'Title'))
    elif tipo in ('h1', 'h2', 'h3'): cuerpo.append(parrafo(dato, 'Heading' + tipo[1]))
    elif tipo == 'p': cuerpo.append(parrafo(dato))
    elif tipo == 'ul': cuerpo.extend(parrafo(x, 'ListParagraph', True) for x in dato)
    elif tipo == 'tabla': cuerpo.append(tabla(dato))

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
documento = (H + '<w:document %s><w:body>%s<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
             '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>'
             '</w:sectPr></w:body></w:document>') % (W, ''.join(cuerpo))

def estilo(id, nombre, sz, negrita=False, color=None, antes=0, despues=120, basado='Normal'):
    return ('<w:style w:type="paragraph" w:styleId="%s"><w:name w:val="%s"/><w:basedOn w:val="%s"/><w:qFormat/>'
            '<w:pPr><w:keepNext/><w:spacing w:before="%d" w:after="%d"/></w:pPr><w:rPr>%s%s<w:sz w:val="%d"/></w:rPr></w:style>'
            ) % (id, nombre, basado, antes, despues, '<w:b/>' if negrita else '',
                 '<w:color w:val="%s"/>' % color if color else '', sz)

estilos = (H + '<w:styles %s><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
           '<w:sz w:val="22"/><w:lang w:val="es-CL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
           % W + estilo('Title', 'Title', 44, True, '1F3864', 0, 240) + estilo('Heading1', 'heading 1', 32, True, '1F3864', 240, 120)
           + estilo('Heading2', 'heading 2', 26, True, '2F5496', 200, 80) + estilo('Heading3', 'heading 3', 24, True, '2F5496', 160, 60)
           + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>'
             '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
             '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
           + ''.join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="808080"/>' % b for b in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
           + '</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>')

numeracion = (H + '<w:numbering %s><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
              '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>'
              '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
              '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>') % W

tipos = (H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
         '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
         '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
rels = (H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="%s/officeDocument" Target="word/document.xml"/></Relationships>') % R
rels_doc = (H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="%s/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="%s/numbering" Target="numbering.xml"/></Relationships>') % (R, R)

with zipfile.ZipFile(SALIDA, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', tipos)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/document.xml', documento)
    z.writestr('word/styles.xml', estilos)
    z.writestr('word/numbering.xml', numeracion)
    z.writestr('word/_rels/document.xml.rels', rels_doc)
print('creado', SALIDA)
