# .cowork/read_xlsx_basico.py: muestra el contenido de un .xlsx SIN dependencias (biblioteca estándar).
# Uso: python3 .cowork/read_xlsx_basico.py archivo.xlsx   -> una línea por fila, celdas separadas por tabulador.
# Muestra el valor guardado (las fórmulas sin valor calculado salen vacías) y no interpreta formatos de fecha.
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def indice(ref):  # 'C7' -> 2
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1

z = zipfile.ZipFile(sys.argv[1])
compartidas = []
if 'xl/sharedStrings.xml' in z.namelist():
    for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
        compartidas.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
libro = ET.fromstring(z.read('xl/workbook.xml'))
rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
for hoja in libro.find('m:sheets', NS):
    destino = rels[hoja.get('{%s}id' % NS['r'])].lstrip('/')
    print('== Hoja: %s' % hoja.get('name'))
    for fila in ET.fromstring(z.read(destino if destino.startswith('xl/') else 'xl/' + destino)).iter('{%s}row' % NS['m']):
        valores = []
        for c in fila.findall('m:c', NS):
            i = indice(c.get('r'))
            valores += [''] * (i - len(valores))
            v = c.find('m:v', NS)
            if c.get('t') == 's' and v is not None:
                valores.append(compartidas[int(v.text)])
            elif c.get('t') == 'inlineStr':
                valores.append(''.join(t.text or '' for t in c.iter('{%s}t' % NS['m'])))
            else:
                valores.append((v.text or '') if v is not None else '')
        print('\t'.join(valores))
