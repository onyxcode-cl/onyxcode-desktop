/**
 * Traducir PDF: hoja ESCANEADA con capa OCR invisible (F9-fase 0). Corre el script real con el Python incluido en la app
 * (solo macOS: en Windows aún no hay Python incluido, ver el informe de investigación). Se salta si ese Python no está.
 *
 * Regresión que cubre: el detector de escaneos usaba una función que no existe en PyMuPDF y el error quedaba escondido
 * («es digital»), con lo que el español se escribía encima de la foto con el inglés debajo.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')
const PYTHON = join(ROOT, 'resources', 'python-bin', 'mac-arm64', 'python', 'bin', 'python3')
const SCRIPT = join(ROOT, 'resources', 'opencode', 'skills', 'pdf', 'scripts', 'translate_pdf.py')
const tienePython = process.platform === 'darwin' && process.arch === 'arm64' && existsSync(PYTHON)

const FIXTURE_ANGOSTO = `
import fitz, sys
out = sys.argv[1]
# La foto tiene el texto a 11 pt; la capa OCR lo trae un poco más angosto (≈10 pt menos por línea: lo normal en un escaneo), y una raya de tabla cerca.
src = fitz.open()
p = src.new_page(width=595, height=842)
p.insert_textbox(fitz.Rect(60, 100, 535, 160), "The Insurers hereby agree with the Insured that the property is covered against loss.", fontsize=11, fontname="helv")
p.draw_line((60, 90), (535, 90), width=1)
pix = p.get_pixmap(dpi=150)
doc = fitz.open()
pg = doc.new_page(width=595, height=842)
pg.insert_image(pg.rect, pixmap=pix)
for w in p.get_text("words"):
    pg.insert_text((60 + (w[0] - 60) * 0.97, w[3] - 2), w[4], fontsize=10.4, fontname="helv", render_mode=3)
doc.save(out)
`

const MEDIR = `
import fitz, sys, json
a = fitz.open(sys.argv[1])[0]; b = fitz.open(sys.argv[2])[0]
# Tinta a la DERECHA de donde llega la capa OCR de cada línea (hasta 25 pt más allá), antes y después; y tinta de la raya de tabla (y 88-92 pt).
def tinta(pag, r):
    pix = pag.get_pixmap(clip=fitz.Rect(*r), dpi=100, colorspace=fitz.csGRAY, alpha=False)
    return sum(1 for v in pix.samples if v < 128)
lineas = {}
for w in a.get_text("words"):
    k = round(w[1])
    lineas[k] = max(lineas.get(k, 0), w[2])
zonas = [(x + 2, y, x + 25, y + 11) for y, x in lineas.items() if y > 95]
print(json.dumps({"antes": sum(tinta(a, z) for z in zonas), "despues": sum(tinta(b, z) for z in zonas),
                  "raya_antes": tinta(a, (60, 88, 535, 92)), "raya_despues": tinta(b, (60, 88, 535, 92))}))
`

const FIXTURE = `
import fitz, sys
out, out_dig = sys.argv[1], sys.argv[2]
# 1) hoja digital de dos párrafos, se «fotografía» y se pega como imagen a página completa
src = fitz.open()
p = src.new_page(width=595, height=842)
p.insert_textbox(fitz.Rect(60, 80, 535, 200), "The Insurers hereby agree with the Insured that if at any time during the period of insurance stated in the Schedule the property is lost or damaged.", fontsize=11, fontname="helv")
p.insert_textbox(fitz.Rect(60, 230, 535, 330), "2. The Schedule shall be deemed to be incorporated in and form part of this Policy and shall be read as including the Schedule.", fontsize=11, fontname="helv")
pix = p.get_pixmap(dpi=150)
# 2) hoja escaneada: la foto + el mismo texto INVISIBLE (modo 3), palabra por palabra como lo deja un OCR
doc = fitz.open()
pg = doc.new_page(width=595, height=842)
pg.insert_image(pg.rect, pixmap=pix)
for w in p.get_text("words"):
    pg.insert_text((w[0], w[3] - 2), w[4], fontsize=11, fontname="helv", render_mode=3)
doc.save(out)
# 3) hoja digital normal (control): texto visible y sin imagen
d2 = fitz.open()
q = d2.new_page(width=595, height=842)
q.insert_textbox(fitz.Rect(60, 80, 535, 200), "A normal digital page with real visible text that must stay digital.", fontsize=11, fontname="helv")
d2.save(out_dig)
`

describe.skipIf(!tienePython)('translate_pdf.py: hoja escaneada con capa OCR', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lzx-escaneo-'))
    execFileSync(PYTHON, ['-c', FIXTURE, join(dir, 'escaneo.pdf'), join(dir, 'digital.pdf')], { env: { PYTHONDONTWRITEBYTECODE: '1' } })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const run = (args: string[]): string =>
    execFileSync(PYTHON, [SCRIPT, ...args], { cwd: dir, env: { PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' })

  it('clasifica la hoja como escaneada y la digital como digital', () => {
    run(['extraer', 'escaneo.pdf', '-o', 'seg.json'])
    run(['extraer', 'digital.pdf', '-o', 'seg-dig.json'])
    const esc = JSON.parse(readFileSync(join(dir, 'seg.json'), 'utf8'))
    const dig = JSON.parse(readFileSync(join(dir, 'seg-dig.json'), 'utf8'))
    expect(esc.clases['1']).toBe('escaneada_ocr')
    expect(dig.clases['1']).toBe('digital')
  })

  it('arma párrafos completos (no una palabra por segmento) y no mezcla los dos', () => {
    const esc = JSON.parse(readFileSync(join(dir, 'seg.json'), 'utf8'))
    const textos: string[] = esc.segmentos.map((s: { texto: string }) => s.texto)
    expect(textos.length).toBeLessThanOrEqual(3)
    expect(textos.some((t) => t.startsWith('The Insurers hereby agree') && t.endsWith('lost or damaged.'))).toBe(true)
    expect(textos.some((t) => t.startsWith('2. The Schedule shall be deemed'))).toBe(true)
  })

  it('al aplicar tapa el original: lo informa y en la imagen ya no queda texto original sin cubrir', () => {
    const esc = JSON.parse(readFileSync(join(dir, 'seg.json'), 'utf8'))
    const tr: Record<string, string> = {}
    for (const s of esc.segmentos as { id: string; texto: string }[]) tr[s.id] = `ES ${s.texto.split(' ').slice(0, 6).join(' ')} traducido`
    writeFileSync(join(dir, 'tr.json'), JSON.stringify(tr))
    run(['aplicar', 'escaneo.pdf', '-t', 'tr.json', '-o', 'salida.pdf', '--informe', 'informe.json'])
    const inf = JSON.parse(readFileSync(join(dir, 'informe.json'), 'utf8'))
    expect(inf.escaneadas).toEqual([1])
    expect(inf.traducidos).toBe(esc.segmentos.length)
    expect(inf.caracteres_sin_fuente ?? []).toEqual([])
  })

  it('avisa cuando una cifra del original no está en la traducción', () => {
    const esc = JSON.parse(readFileSync(join(dir, 'seg.json'), 'utf8'))
    const tr: Record<string, string> = {}
    for (const s of esc.segmentos as { id: string; texto: string }[]) tr[s.id] = s.texto.replace(/^2\./, '9.').replace('Insurers', 'Aseguradores')
    writeFileSync(join(dir, 'tr2.json'), JSON.stringify(tr))
    run(['aplicar', 'escaneo.pdf', '-t', 'tr2.json', '-o', 'salida2.pdf', '--informe', 'informe2.json'])
    const inf = JSON.parse(readFileSync(join(dir, 'informe2.json'), 'utf8'))
    expect((inf.cifras_distintas ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('el comando «imagen» dibuja una página como PNG con tope de tamaño y rechaza una página que no existe', () => {
    const out = run(['imagen', 'escaneo.pdf', '--pagina', '1', '-o', 'pagina-1.png'])
    expect(out).toContain('OK: página 1')
    const png = readFileSync(join(dir, 'pagina-1.png'))
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(png.length).toBeGreaterThan(1000)
    expect(() => run(['imagen', 'escaneo.pdf', '--pagina', '9', '-o', 'pagina-9.png'])).toThrow()
  })

  it('tapa también las letras que la capa OCR dejó fuera (cajas más angostas que la foto) sin borrar las rayas de la tabla', () => {
    execFileSync(PYTHON, ['-c', FIXTURE_ANGOSTO, join(dir, 'angosto.pdf')], { env: { PYTHONDONTWRITEBYTECODE: '1' } })
    run(['extraer', 'angosto.pdf', '-o', 'seg-ang.json'])
    const seg = JSON.parse(readFileSync(join(dir, 'seg-ang.json'), 'utf8'))
    const tr: Record<string, string> = {}
    for (const sg of seg.segmentos as { id: string }[]) tr[sg.id] = 'Los Aseguradores acuerdan con el Asegurado.'
    writeFileSync(join(dir, 'tr-ang.json'), JSON.stringify(tr))
    run(['aplicar', 'angosto.pdf', '-t', 'tr-ang.json', '-o', 'salida-ang.pdf'])
    const m = JSON.parse(
      execFileSync(PYTHON, ['-c', MEDIR, join(dir, 'angosto.pdf'), join(dir, 'salida-ang.pdf')], { env: { PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' })
    ) as { antes: number; despues: number; raya_antes: number; raya_despues: number }
    expect(m.antes).toBeGreaterThan(30) // en la foto hay inglés a la derecha de lo que cubre la capa OCR
    expect(m.despues).toBeLessThan(m.antes * 0.1) // y se tapó
    expect(m.raya_despues).toBeGreaterThan(m.raya_antes * 0.9) // la raya de la tabla sigue entera
  })
})
