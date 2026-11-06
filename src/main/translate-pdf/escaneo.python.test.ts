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
})
