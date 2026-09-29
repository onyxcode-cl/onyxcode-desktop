# .onyxcode/trabajo/make_xlsx_basico.py: libro Excel SIN dependencias (solo biblioteca estándar de Python).
# Números como números, texto como texto, fórmulas si empiezan por "=", encabezado en negrita,
# primera fila fija y anchos de columna. Una hoja por entrada de HOJAS.
# Una fórmula puede ir como '=C2*D2' (Excel la calcula al abrir; una vista previa la mostrará vacía)
# o como ('=C2*D2', 15000), con el valor ya calculado, para que también se vea en las vistas previas.
import sys
import zipfile
from xml.sax.saxutils import escape

SALIDA = sys.argv[1] if len(sys.argv) > 1 else 'ventas.xlsx'  # usa un nombre NUEVO (ver la skill)
HOJAS = {
    'Ventas': [
        ['Mes', 'Producto', 'Unidades', 'Precio', 'Total'],
        ['Julio', 'Alfa', 10, 1500, ('=C2*D2', 15000)],
        ['Agosto', 'Beta', 7, 2300, ('=C3*D3', 16100)],
    ]
}

def col(n):  # 1 -> A, 27 -> AA
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def hoja(filas):
    filas_xml = []
    for i, fila in enumerate(filas, start=1):
        celdas = []
        for j, v in enumerate(fila, start=1):
            ref, estilo = '%s%d' % (col(j), i), (' s="1"' if i == 1 else (' s="2"' if isinstance(v, (int, float)) else ''))
            if isinstance(v, tuple) and i > 1:  # (fórmula, valor calculado)
                celdas.append('<c r="%s" s="2"><f>%s</f><v>%s</v></c>' % (ref, escape(v[0].lstrip('=')), v[1]))
            elif isinstance(v, (int, float)) and not isinstance(v, bool):
                celdas.append('<c r="%s"%s><v>%s</v></c>' % (ref, estilo, v))
            elif isinstance(v, str) and v.startswith('=') and i > 1:
                celdas.append('<c r="%s"%s><f>%s</f></c>' % (ref, ' s="2"', escape(v[1:])))
            elif v not in (None, ''):
                celdas.append('<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, estilo, escape(str(v))))
        filas_xml.append('<row r="%d">%s</row>' % (i, ''.join(celdas)))
    anchos = ''.join('<col min="%d" max="%d" width="%d" customWidth="1"/>' % (j, j, min(60, max(len(str(v[1] if isinstance(v, tuple) else v)) for v in c) + 3))
                     for j, c in enumerate(zip(*filas), start=1))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            '<cols>%s</cols><sheetData>%s</sheetData></worksheet>') % (anchos, ''.join(filas_xml))

H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
nombres = list(HOJAS)
tipos = (H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
         '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
         + ''.join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1) for i in range(len(nombres)))
         + '</Types>')
rels = (H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="%s/officeDocument" Target="xl/workbook.xml"/></Relationships>') % R
libro = (H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="%s"><sheets>%s</sheets></workbook>'
         % (R, ''.join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(n[:31]), i + 1, i + 1) for i, n in enumerate(nombres))))
rels_libro = (H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              + ''.join('<Relationship Id="rId%d" Type="%s/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, R, i + 1) for i in range(len(nombres)))
              + '<Relationship Id="rId%d" Type="%s/styles" Target="styles.xml"/></Relationships>' % (len(nombres) + 1, R))
estilos = (H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<numFmts count="0"/><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
           '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
           '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
           '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill></fills>'
           '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
           '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
           '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
           '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
           '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
           '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')

with zipfile.ZipFile(SALIDA, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', tipos)
    z.writestr('_rels/.rels', rels)
    z.writestr('xl/workbook.xml', libro)
    z.writestr('xl/_rels/workbook.xml.rels', rels_libro)
    z.writestr('xl/styles.xml', estilos)
    for i, n in enumerate(nombres):
        z.writestr('xl/worksheets/sheet%d.xml' % (i + 1), hoja(HOJAS[n]))
print('creado', SALIDA)
