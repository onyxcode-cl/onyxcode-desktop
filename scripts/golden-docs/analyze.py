"""Análisis de UN caso del set dorado: abre el archivo, lo renderiza (programas de ArtCraft, PNG) y calcula filtros duros y conteos.
Lo llama scripts/golden-docs.mjs con un JSON en argv[1]: {case, spec, file, imgDir, bins}. Imprime UN JSON en stdout.
Solo biblioteca estándar + PyMuPDF (fitz). Sin red, sin IA."""
import json, math, os, re, subprocess, sys, unicodedata, zipfile
from xml.etree import ElementTree as ET
import fitz

A = json.loads(sys.argv[1])
CASE, SPEC, FILE, IMG, BINS = A['case'], A['spec'], A['file'], A['imgDir'], A['bins']
KIND = CASE['kind']
NOTES, HARD, DEF = [], {}, {}
os.makedirs(IMG, exist_ok=True)


def run(cmd, timeout=120):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except Exception as e:  # tiempo agotado, binario ausente…
        return 99, str(e)


def norm(s):
    s = unicodedata.normalize('NFKC', s).lower()
    s = s.replace('’', "'").replace('“', '"').replace('”', '"')
    s = s.replace(':', '')
    return re.sub(r'\s+', '', s)


RTL = re.compile(r'[֐-ࣿ]')
SKIP_KEYS = {'theme', 'style', 'layout', 'type', 'fonts', 'palette', 'formula', 'font', 'color', 'fill', 'fillTo', 'line', 'background',
             'align', 'transition', 'shape', 'at', 'range', 'toc', 'page_numbers', 'zebra', 'total_row', 'widths_cm', 'columnFormats', 'name_', 'date', 'freeze', 'filter', 'columnWidths', 'conditional', 'validations', 'cover', 'rule'}


def spec_strings(node, out, parent=None):
    """Textos que el pedido trae y que DEBEN aparecer en el archivo (contenido pedido)."""
    if isinstance(node, dict):
        if 'formula' in node:  # celda de fórmula: su texto no se exige
            return
        for k, v in node.items():
            if k in SKIP_KEYS: continue
            if k == 'value' and not isinstance(v, str): continue
            spec_strings(v, out, k)
    elif isinstance(node, list):
        for v in node: spec_strings(v, out, parent)
    elif isinstance(node, str):
        for part in node.replace('**', '').split('\n'):
            part = part.strip()
            if len(part) >= 3 and not re.fullmatch(r'#[0-9A-Fa-f]{6}', part): out.append(part)


def xml_text(z, pattern, tag):
    parts = []
    for n in z.namelist():
        if re.fullmatch(pattern, n):
            root = ET.fromstring(z.read(n))
            parts.append(' '.join(e.text for e in root.iter(tag) if e.text))
    return '\n'.join(parts)


# ─────────────── 1) abrir ───────────────
spec = None
if SPEC.endswith('.json'):
    spec = json.load(open(SPEC, encoding='utf8'))
html = open(SPEC, encoding='utf8').read() if SPEC.endswith('.html') else None

opens, text_all, pages, pdf_path = True, '', 0, None
z = None
try:
    if KIND != 'pdf':
        z = zipfile.ZipFile(FILE)
        bad = z.testzip()
        if bad: opens = False; NOTES.append(f'ZIP dañado: {bad}')
        for n in z.namelist():
            if n.endswith('.xml') or n.endswith('.rels'):
                try: ET.fromstring(z.read(n))
                except ET.ParseError as e: opens = False; NOTES.append(f'XML mal formado en {n}: {e}'); break
except Exception as e:
    opens = False; NOTES.append(f'no abre como ZIP: {e}')

# ─────────────── 2) renderizar + texto ───────────────
page_texts = []  # por página/lámina
doc = None

if KIND == 'pptx':
    code, out = run([BINS['deckcraft'], 'info', FILE]); opens = opens and code == 0
    if code != 0: NOTES.append('deckcraft info falló: ' + out[-150:])
    run([BINS['deckcraft'], 'render', FILE, '--all', '--scale', '1', os.path.join(IMG, 's.png')], 240)
    if z:
        slides = sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)], key=lambda n: int(re.findall(r'\d+', n)[0]))
        pages = len(slides)
        for n in slides:
            root = ET.fromstring(z.read(n))
            page_texts.append(' '.join(e.text for e in root.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}t') if e.text))
        text_all = '\n'.join(page_texts)
        text_all += '\n' + xml_text(z, r'ppt/charts/chart\d+\.xml', '{http://schemas.openxmlformats.org/drawingml/2006/chart}v')
elif KIND == 'docx':
    code, out = run([BINS['wordcraft'], 'info', FILE]); opens = opens and code == 0
    try: pages_info = json.loads(out[out.index('{'):]).get('pages')
    except Exception: pages_info = None
    pdf_path = os.path.join(IMG, 'conv.pdf')
    run([BINS['wordcraft'], 'convert', FILE, pdf_path], 180)
    for i in range(1, min(12, (pages_info or 1)) + 1):
        run([BINS['wordcraft'], 'render', FILE, os.path.join(IMG, f'page-{i}.png'), '--page', str(i), '--scale', '1'], 120)
    if z: text_all = xml_text(z, r'word/document\.xml', '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')
elif KIND == 'xlsx':
    code, out = run([BINS['gridcraft'], 'info', FILE, '--json']); opens = opens and code == 0
    xl_info = None
    try: xl_info = json.loads(out[out.index('{'):])
    except Exception: NOTES.append('gridcraft info no devolvió JSON')
    pdf_path = os.path.join(IMG, 'conv.pdf')
    run([BINS['gridcraft'], 'run', '--in', FILE, '--cmd', 'file.exportPdf=' + json.dumps({'path': pdf_path, 'sheets': 'all', 'fitToPage': True}), '--quiet'], 180)
    if z:
        text_all = xml_text(z, r'xl/sharedStrings\.xml', '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
        text_all += '\n' + ' '.join(s.get('name', '') for s in ET.fromstring(z.read('xl/workbook.xml')).iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'))
else:  # pdf
    pdf_path = FILE

if pdf_path and os.path.exists(pdf_path):
    try:
        doc = fitz.open(pdf_path)
        pages = pages or doc.page_count
        page_texts = [p.get_text() for p in doc]
        if KIND in ('pdf', 'docx', 'xlsx'):
            if KIND == 'pdf': text_all = '\n'.join(page_texts)
            elif KIND == 'xlsx': text_all += '\n' + '\n'.join(page_texts)
            elif KIND == 'docx': text_all += '\n' + '\n'.join(page_texts)
        for i, p in enumerate(doc):
            if i >= 12: break
            if KIND == 'docx': continue  # las páginas de Word ya salieron de WordCraft
            p.get_pixmap(dpi=80).save(os.path.join(IMG, f'page-{i + 1}.png'))
    except Exception as e:
        if KIND == 'pdf': opens = False
        NOTES.append(f'PDF ilegible: {e}')
elif KIND == 'pdf':
    opens = False
if KIND == 'pdf' and doc is not None and doc.page_count == 0: opens = False

# valores calculados de Excel (para fórmulas)
calc = {}
if KIND == 'xlsx' and spec:
    sheet_names = [s['name'] for s in spec['sheets']]
    for sn in sheet_names:
        code, out = run([BINS['gridcraft'], 'cat', FILE, '--sheet', sn, '--csv'])
        calc[sn] = out if code == 0 else ''
        if code != 0: NOTES.append(f'gridcraft cat falló en «{sn}»')
        text_all += '\n' + calc[sn]

HARD['genera'] = True
HARD['abre'] = bool(opens)

# ─────────────── 3) filtros duros ───────────────
ERR = re.compile(r'#(REF!|DIV/0!|NAME\?|VALUE!|N/A|NUM!|NULL!)|Err:\d+')
HARD['sin_errores_formula'] = not (KIND == 'xlsx' and any(ERR.search(v) for v in calc.values()))
LEFT = re.compile(r'(?i:lorem ipsum|click to add|haz clic para|\bundefined\b|\[object |\[PENDIENTE|PLACEHOLDER)|\bTODO\b|\bXXX+\b|\{\{|\}\}|\bNaN\b')
m = LEFT.search(text_all or '')
HARD['sin_restos_plantilla'] = m is None
if m: NOTES.append(f'resto de plantilla: «{m.group(0)}»')

# ─────────────── 4) conteos de defectos ───────────────
# 4a) contenido pedido que no aparece
need = []
if spec is not None: spec_strings(spec, need)
else:
    body = re.sub(r'<style.*?</style>', '', html, flags=re.S | re.I)
    body = re.sub(r'<[^>]+>', '\n', body)
    import html as H
    need = [t.strip() for t in H.unescape(body).split('\n') if len(t.strip()) >= 6]
hay = norm(text_all)
missing = []
for t in need:
    n = norm(t)
    if RTL.search(t):  # el texto de derecha a izquierda puede salir reordenado: basta con que estén sus letras
        letters = [c for c in n if c.isalpha()]
        if letters and sum(1 for c in letters if c in hay) / len(letters) < 0.8: missing.append(t)
        continue
    probe = n if len(n) <= 120 else n[:60] + '|' + n[-30:]
    ok = all(p in hay for p in probe.split('|'))
    if not ok: missing.append(t)
DEF['contenido_faltante'] = len(missing)
for t in missing[:4]: NOTES.append(f'falta en el archivo: «{t[:70]}»')

# 4b) páginas / láminas fuera de lo esperado
rng = CASE.get('expect', {}).get('slides' if KIND == 'pptx' else 'pages')
if rng and pages: DEF['paginas_fuera_de_rango'] = 0 if rng[0] <= pages <= rng[1] else 1
if rng and pages and DEF['paginas_fuera_de_rango']: NOTES.append(f'{pages} {"láminas" if KIND == "pptx" else "páginas"} (esperado {rng[0]}–{rng[1]})')

# 4c) última página casi vacía (extensión del cuerpo, sin pie ni encabezado)
def body_extent(page):
    h = page.rect.height
    ys = [b[3] for b in page.get_text('blocks') if b[3] < 0.92 * h and b[1] > 0.04 * h and (b[4] or '').strip()]
    return (max(ys) / h) if ys else 0.0
if doc is not None and doc.page_count > 1 and KIND in ('pdf', 'docx'):
    last = body_extent(doc[-1])
    DEF['ultima_pagina_casi_vacia'] = 1 if last < 0.25 else 0
    if last < 0.25: NOTES.append(f'última página casi vacía (el cuerpo llega al {int(last * 100)} % de la altura)')

# 4d) PDF: letra chica y texto fuera de la página
if KIND == 'pdf' and doc is not None:
    small = out_ = 0
    for p in doc:
        r = p.rect
        for b in p.get_text('dict')['blocks']:
            for ln in b.get('lines', []):
                for sp in ln['spans']:
                    if not sp['text'].strip(): continue
                    if sp['size'] < 7.0: small += 1
                    x0, y0, x1, y1 = sp['bbox']
                    if x0 < r.x0 - 2 or y0 < r.y0 - 2 or x1 > r.x1 + 2 or y1 > r.y1 + 2: out_ += 1
    DEF['letra_chica'] = small
    DEF['texto_fuera_de_pagina'] = out_

# 4e) PowerPoint: geometría del XML
if KIND == 'pptx' and z:
    NS = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
    pres = ET.fromstring(z.read('ppt/presentation.xml'))
    sz = pres.find('p:sldSz', NS)
    W, H_ = int(sz.get('cx')) / 12700, int(sz.get('cy')) / 12700
    tiny = oob = overlap = overflow = empty = 0
    slides = sorted([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)], key=lambda n: int(re.findall(r'\d+', n)[0]))
    for n in slides:
        root = ET.fromstring(z.read(n))
        tree = root.find('p:cSld/p:spTree', NS)
        boxes = []
        has_text = False
        for sp in tree.findall('p:sp', NS):
            txt = ''.join(t.text or '' for t in sp.iter('{%s}t' % NS['a'])).strip()
            xf = sp.find('p:spPr/a:xfrm', NS)
            if not txt or xf is None: continue
            has_text = True
            off, ext = xf.find('a:off', NS), xf.find('a:ext', NS)
            x, y, w, h = int(off.get('x')) / 12700, int(off.get('y')) / 12700, int(ext.get('cx')) / 12700, int(ext.get('cy')) / 12700
            if x < -0.01 * W or y < -0.01 * H_ or x + w > 1.01 * W or y + h > 1.01 * H_: oob += 1
            sizes = [int(r.get('sz')) / 100 for r in sp.iter('{%s}rPr' % NS['a']) if r.get('sz')]
            footer_zone = y > 0.93 * H_
            if not footer_zone:
                t_ = sum(1 for s in sizes if s < 10)
                tiny += t_
                if t_ and tiny <= 3: NOTES.append(f'lámina {slides.index(n) + 1}: letra de {min(sizes):g} pt («{txt[:30]}…»)')
            # estimación de desborde: líneas = ceil(ancho de texto / ancho de caja); alto = líneas * tamaño * 1.2
            if sizes and w > 0 and h > 0 and sp.find('p:txBody/a:bodyPr/a:normAutofit', NS) is None:
                need_h = 0
                for para in sp.findall('p:txBody/a:p', NS):
                    t = ''.join(r.text or '' for r in para.iter('{%s}t' % NS['a']))
                    ps = [int(r.get('sz')) / 100 for r in para.iter('{%s}rPr' % NS['a']) if r.get('sz')] or [max(sizes)]
                    s = max(ps)
                    need_h += max(1, math.ceil(len(t) * s * 0.5 / max(w - 14, 1))) * s * 1.2
                if need_h > h * 1.3 and need_h - h > 10:
                    overflow += 1
                    if overflow <= 3: NOTES.append(f'lámina {slides.index(n) + 1}: texto probablemente desborda su caja («{txt[:40]}…», necesita ~{int(need_h)} pt y hay {int(h)})')
            boxes.append((x, y, w, h))
        for gf in tree.findall('p:graphicFrame', NS): has_text = True
        if not has_text: empty += 1
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
                iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
                if ix * iy > 0.25 * min(a[2] * a[3], b[2] * b[3]):
                    overlap += 1
                    if overlap <= 3: NOTES.append(f'lámina {slides.index(n) + 1}: dos cajas de texto se montan')
    DEF.update({'letra_chica': tiny, 'texto_fuera_de_lamina': oob, 'cajas_montadas': overlap, 'texto_desbordado_est': overflow, 'laminas_vacias': empty})

# 4f) Word: negrita contagiada, índice, Total huérfano, encabezado de tabla no repetido
if KIND == 'docx' and z and spec is not None:
    W_ = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(W_ + 'body')
    full_bold = 0
    for p in body.findall(W_ + 'p'):  # solo párrafos de cuerpo (no tablas)
        ps = p.find(W_ + 'pPr/' + W_ + 'pStyle')
        if ps is not None and ps.get(W_ + 'val') not in ('Normal', None): continue
        runs = p.findall(W_ + 'r')
        txt = ''.join(t.text or '' for t in p.iter(W_ + 't'))
        if len(txt) < 40 or not runs: continue
        def bold(r):
            b = r.find(W_ + 'rPr/' + W_ + 'b')
            return b is not None and b.get(W_ + 'val') not in ('0', 'false')
        if all(bold(r) for r in runs if (r.find(W_ + 't') is not None)): full_bold += 1
    expected = sum(1 for b in spec.get('blocks', []) if b.get('type') == 'paragraph' and re.fullmatch(r'\*\*.+\*\*', (b.get('text') or '').strip()) and len(b['text']) > 44)
    DEF['negrita_contagiada'] = max(0, full_bold - expected)
    if spec.get('toc'):
        low = text_all.lower()
        DEF['indice_en_ingles'] = 1 if ('contents' in low and 'contenido' not in low and 'índice' not in low) else 0
    orphan = hdr_missing = 0
    if doc is not None and doc.page_count > 1:
        # líneas de encabezado/pie: las que se repiten tal cual en varias páginas (o son solo un número de página)
        from collections import Counter
        edge = Counter()
        for t in page_texts:
            ls = [l.strip() for l in t.split('\n') if l.strip()]
            for l in set(ls[:2] + ls[-2:]): edge[l] += 1
        def body_lines(t):
            return [l.strip() for l in t.split('\n') if l.strip() and edge[l.strip()] < 2 and not re.fullmatch(r'\d{1,3}', l.strip())]
        tables = [b for b in spec.get('blocks', []) if b.get('type') == 'table']
        for i in range(1, len(page_texts)):
            bl = body_lines(page_texts[i])
            if not bl: continue
            for b in tables:  # una página continúa, como mucho, UNA tabla
                cols = [norm(str(c)) for c in b['columns']]
                first_cells = {norm(str(r[0])) for r in b['rows'] if r}
                if norm(bl[0]) not in first_cells: continue
                if b.get('total_row') and bl[0].lower().startswith('total'): orphan += 1
                head = norm(' '.join(bl[:len(cols) * 2 + 2]))
                if not all(c in head for c in cols): hdr_missing += 1
                break
    DEF['total_huerfano'] = orphan
    DEF['encabezado_tabla_no_repetido'] = hdr_missing

# 4g) Excel: valores declarados vs calculados, gráficos y hojas
if KIND == 'xlsx' and spec is not None:
    import csv, io
    mism = 0
    def col_idx(c):
        n = 0
        for ch in c: n = n * 26 + ord(ch) - 64
        return n - 1
    for s in spec['sheets']:
        rows = list(csv.reader(io.StringIO(calc.get(s['name'], ''))))
        for ri, row in enumerate(s['rows']):
            for ci, cell in enumerate(row):
                if isinstance(cell, dict) and 'formula' in cell:
                    try: got = rows[ri][ci]
                    except IndexError: mism += 1; continue
                    want = cell.get('value')
                    g = re.sub(r'[^\d,.\-eE]', '', got)
                    try:
                        gv = float(g.replace(',', '')) if g else None
                        wv = float(want)
                        # porcentajes: el CSV puede traer «103.57%» (×100) o la fracción
                        if got.strip().endswith('%'): gv = gv / 100
                        if gv is None or abs(gv - wv) > max(1e-6, abs(wv) * 0.005): mism += 1
                    except (TypeError, ValueError):
                        if str(want).strip() != got.strip(): mism += 1
    DEF['valor_declarado_distinto'] = mism
    want_charts = sum(len(s.get('charts', [])) for s in spec['sheets'])
    have_charts = len([n for n in (z.namelist() if z else []) if re.fullmatch(r'xl/charts/chart\d+\.xml', n)])
    DEF['graficos_faltantes'] = max(0, want_charts - have_charts)
    have_sheets = len([n for n in (z.namelist() if z else []) if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n)])
    DEF['hojas_distintas'] = 0 if have_sheets == len(spec['sheets']) else 1

# ─────────────── 5) pedidos que el motor no puede cumplir (se anotan, no cuentan como defecto) ───────────────
for t in CASE.get('tags', []):
    if t == 'pide-imagenes': NOTES.append('el encargo pedía imágenes: el esquema no las admite (límite del motor, no se cuenta)')
    if t == 'pide-formato-condicional': NOTES.append('el encargo pedía formato condicional: el esquema no lo admite (límite del motor, no se cuenta)')

images = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(IMG) for f in fs if f.endswith('.png'))
print(json.dumps({'gen_ok': True, 'pass': all(HARD.values()), 'hard': HARD, 'defects': DEF, 'pages': pages, 'images': len(images), 'notes': NOTES}, ensure_ascii=False))
