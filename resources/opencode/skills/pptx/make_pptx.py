# .onyxcode/trabajo/make_pptx.py: presentación .pptx SIN dependencias (solo biblioteca estándar de Python).
# Diapositivas de portada y de título + viñetas (sin imágenes ni gráficos: para eso hace falta python-pptx).
# Edita DIAPOSITIVAS y ejecuta: python3 .onyxcode/trabajo/make_pptx.py
import sys
import zipfile
from xml.sax.saxutils import escape

SALIDA = sys.argv[1] if len(sys.argv) > 1 else 'presentacion.pptx'  # usa un nombre NUEVO (ver la skill)
DIAPOSITIVAS = [
    {'portada': True, 'titulo': 'Resultados del tercer trimestre', 'texto': ['Equipo comercial · septiembre de 2026']},
    {'titulo': 'Resumen', 'texto': ['Ventas +12 % frente al trimestre anterior', 'Tres clientes concentran el 60 %', 'Objetivo del cuarto trimestre: diversificar']},
    {'titulo': 'Próximos pasos', 'texto': ['Reunión con los clientes clave', 'Campaña para cuentas nuevas']},
]

H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.presentationml'
GRP = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
       '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')

def rels(*items):
    return H + '<Relationships xmlns="%s">%s</Relationships>' % (PKG, ''.join(
        '<Relationship Id="%s" Type="%s/%s" Target="%s"/>' % (i, R, t, d) for i, t, d in items))

def marcador(id, nombre, ph, x, y, cx, cy, extra='', lst='<a:lstStyle/>'):
    return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>%s</p:nvPr></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm></p:spPr>'
            '<p:txBody><a:bodyPr%s/>%s<a:p><a:r><a:rPr lang="es-CL"/><a:t>Texto</a:t></a:r></a:p></p:txBody></p:sp>'
            ) % (id, nombre, ph, x, y, cx, cy, extra, lst)

barra = ('<p:sp><p:nvSpPr><p:cNvPr id="9" name="Barra"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/>'
         '<a:ext cx="12192000" cy="180000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>'
         '<a:ln><a:noFill/></a:ln></p:spPr></p:sp>')
def nivel(n, sz, marl, viñeta):
    return ('<a:lvl%dpPr marL="%d" indent="%d"><a:spcBef><a:spcPts val="600"/></a:spcBef>%s<a:defRPr sz="%d"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
            '<a:latin typeface="+mn-lt"/></a:defRPr></a:lvl%dpPr>') % (n, marl, -285750 if viñeta else 0, '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' if viñeta else '<a:buNone/>', sz, n)

maestra = (H + '<p:sldMaster %s><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>%s%s%s%s</p:spTree></p:cSld>'
           '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
           '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>'
           '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3600" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
           '<p:bodyStyle>%s%s</p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>'
           ) % (NS, GRP, barra, marcador(2, 'Titulo', '<p:ph type="title"/>', 609600, 457200, 10972800, 1000000, ' anchor="ctr"'),
                marcador(3, 'Contenido', '<p:ph type="body" idx="1"/>', 609600, 1600200, 10972800, 4525963),
                nivel(1, 2400, 342900, True), nivel(2, 2000, 742950, True))
layout_contenido = (H + '<p:sldLayout %s type="obj" preserve="1"><p:cSld name="Titulo y contenido"><p:spTree>%s%s%s</p:spTree></p:cSld>'
                    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
                    ) % (NS, GRP, marcador(2, 'Titulo', '<p:ph type="title"/>', 609600, 457200, 10972800, 1000000, ' anchor="ctr"'),
                         marcador(3, 'Contenido', '<p:ph idx="1"/>', 609600, 1600200, 10972800, 4525963))
layout_portada = (H + '<p:sldLayout %s type="title" preserve="1"><p:cSld name="Portada"><p:spTree>%s%s%s</p:spTree></p:cSld>'
                  '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
                  ) % (NS, GRP, marcador(2, 'Titulo', '<p:ph type="ctrTitle"/>', 914400, 2100000, 10363200, 1400000, ' anchor="b"'),
                       marcador(3, 'Subtitulo', '<p:ph type="subTitle" idx="1"/>', 914400, 3700000, 10363200, 1000000, '',
                                '<a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>'))

def color(n, v): return '<a:%s><a:srgbClr val="%s"/></a:%s>' % (n, v, n)
tema = (H + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Oficina"><a:themeElements>'
        '<a:clrScheme name="Oficina"><a:dk1><a:srgbClr val="222222"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
        + color('dk2', '1F3864') + color('lt2', 'EEEEEE') + color('accent1', '2F5496') + color('accent2', 'C55A11') + color('accent3', '548235')
        + color('accent4', 'BF9000') + color('accent5', '7030A0') + color('accent6', '0E7C86') + color('hlink', '0563C1') + color('folHlink', '954F72')
        + '</a:clrScheme><a:fontScheme name="Oficina"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
          '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
          '<a:fmtScheme name="Oficina"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
          '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
          '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
          '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
          '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
          '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>')

def diapositiva(d):
    ph_t, ph_c = ('<p:ph type="ctrTitle"/>', '<p:ph type="subTitle" idx="1"/>') if d.get('portada') else ('<p:ph type="title"/>', '<p:ph idx="1"/>')
    parrafos = ''.join('<a:p><a:r><a:rPr lang="es-CL"/><a:t>%s</a:t></a:r></a:p>' % escape(t) for t in d.get('texto', []))
    def sp(id, nombre, ph, cuerpo):
        return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>%s</p:nvPr></p:nvSpPr><p:spPr/>'
                '<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>%s</p:txBody></p:sp>') % (id, nombre, ph, cuerpo)
    return (H + '<p:sld %s><p:cSld><p:spTree>%s%s%s</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
            ) % (NS, GRP, sp(2, 'Titulo', ph_t, '<a:p><a:r><a:rPr lang="es-CL"/><a:t>%s</a:t></a:r></a:p>' % escape(d['titulo'])), sp(3, 'Contenido', ph_c, parrafos or '<a:p><a:endParaRPr lang="es-CL"/></a:p>'))

n = len(DIAPOSITIVAS)
tipos = (H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/ppt/presentation.xml" ContentType="%s.presentation.main+xml"/>'
         '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="%s.slideMaster+xml"/>'
         '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="%s.slideLayout+xml"/>'
         '<Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="%s.slideLayout+xml"/>'
         '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
         % (CT, CT, CT, CT) + ''.join('<Override PartName="/ppt/slides/slide%d.xml" ContentType="%s.slide+xml"/>' % (i + 1, CT) for i in range(n)) + '</Types>')
presentacion = (H + '<p:presentation %s saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
                '<p:sldIdLst>%s</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
                ) % (NS, ''.join('<p:sldId id="%d" r:id="rId%d"/>' % (256 + i, i + 3) for i in range(n)))

with zipfile.ZipFile(SALIDA, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', tipos)
    z.writestr('_rels/.rels', rels(('rId1', 'officeDocument', 'ppt/presentation.xml')))
    z.writestr('ppt/presentation.xml', presentacion)
    z.writestr('ppt/_rels/presentation.xml.rels', rels(('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'), ('rId2', 'theme', 'theme/theme1.xml'),
               *[('rId%d' % (i + 3), 'slide', 'slides/slide%d.xml' % (i + 1)) for i in range(n)]))
    z.writestr('ppt/slideMasters/slideMaster1.xml', maestra)
    z.writestr('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
               ('rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml'), ('rId3', 'theme', '../theme/theme1.xml')))
    z.writestr('ppt/slideLayouts/slideLayout1.xml', layout_portada)
    z.writestr('ppt/slideLayouts/slideLayout2.xml', layout_contenido)
    for i in (1, 2):
        z.writestr('ppt/slideLayouts/_rels/slideLayout%d.xml.rels' % i, rels(('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')))
    z.writestr('ppt/theme/theme1.xml', tema)
    for i, d in enumerate(DIAPOSITIVAS):
        z.writestr('ppt/slides/slide%d.xml' % (i + 1), diapositiva(d))
        z.writestr('ppt/slides/_rels/slide%d.xml.rels' % (i + 1), rels(('rId1', 'slideLayout', '../slideLayouts/slideLayout%d.xml' % (1 if d.get('portada') else 2))))
print('creado', SALIDA)
