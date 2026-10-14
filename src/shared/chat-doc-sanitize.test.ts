import { describe, expect, it } from 'vitest'
import { GPT_DOCX, GPT_PPTX, GPT_XLSX, LONG_BULLET } from '../test/fixtures/chat-doc-gpt'
import { sanitizeDoc, sniffDocKind } from './chat-doc-sanitize'
import { isDocxSpec, isPptxSpec, isXlsxSpec, MAX_BULLET_CHARS, type DocxSpec, type PptxSpec, type XlsxSpec } from './chat-doc-spec'

describe('sanitizeDoc: pptx de GPT', () => {
  const raw = GPT_PPTX
  it('sin sanear, el esquema estricto lo rechaza entero', () => {
    expect(isPptxSpec(raw)).toBe(false)
  })
  const out = sanitizeDoc('pptx', raw) as PptxSpec & Record<string, unknown>
  it('queda válido y sin claves desconocidas', () => {
    expect(isPptxSpec(out)).toBe(true)
    expect(out).not.toHaveProperty('title')
    expect(out).not.toHaveProperty('author')
    expect(out.theme).toBe('blue')
    for (const s of out.slides) {
      expect(s).not.toHaveProperty('notes')
      expect(s).not.toHaveProperty('speaker_notes')
      expect(s).not.toHaveProperty('image')
      expect(s).not.toHaveProperty('subtitle')
    }
  })
  it('el subtítulo de la portada pasa a ser su primera viñeta y el layout «title» a «cover»', () => {
    expect(out.slides[0]).toMatchObject({ layout: 'cover', title: 'Plan comercial 2026', bullets: ['Primer semestre'] })
  })
  it('recorta los textos largos a su límite y pasa números a texto', () => {
    const s = out.slides[1]
    expect(LONG_BULLET.length).toBeGreaterThan(MAX_BULLET_CHARS)
    expect(s.bullets?.[0].length).toBeLessThanOrEqual(MAX_BULLET_CHARS)
    expect(s.bullets?.[0].endsWith('…')).toBe(true)
    expect(s.bullets?.[2]).toBe('42')
    expect(s.note!.length).toBeLessThanOrEqual(140)
    expect(s.eyebrow!.length).toBeLessThanOrEqual(40)
  })
  it('KPI numérico → texto; descarta claves extra y recorta el valor largo', () => {
    const kpis = out.slides[2].kpis!
    expect(kpis[0]).toEqual({ label: 'Ventas', value: '1250000', delta: '+12%' })
    expect(kpis[2].value.length).toBeLessThanOrEqual(16)
  })
  it('gráfico: 12 puntos como máximo y valores en texto → número', () => {
    const c = out.slides[3].chart!
    expect(c.categories).toHaveLength(12)
    expect(c.values[3]).toBe(30)
    expect(c).not.toHaveProperty('color')
  })
  it('tabla: celdas numéricas a texto y filas ajustadas al número de columnas', () => {
    expect(out.slides[4].table).toEqual({
      columns: ['Plan', 'Precio'],
      rows: [
        ['Básico', '9990'],
        ['Pro', '29990']
      ]
    })
  })
  it('un diseño que necesita su dato y no lo tiene vuelve al predeterminado', () => {
    const r = sanitizeDoc('pptx', { slides: [{ title: 'x', layout: 'kpis', kpis: [{ label: 'a', value: '1' }] }] }) as PptxSpec
    expect(r.slides[0].layout).toBeUndefined()
    expect(isPptxSpec(r)).toBe(true)
  })
  it('NO relaja lo que protege: colores que no son hex se descartan, no se aceptan', () => {
    const r = sanitizeDoc('pptx', {
      palette: { bg: 'url(x)', text: '#FFFFFF', accent: '#000000' },
      slides: [{ title: 'x', background: 'javascript:alert(1)' }]
    }) as PptxSpec
    expect(r.palette).toBeUndefined()
    expect(r.slides[0].background).toBeUndefined()
  })
  it('sin la forma mínima (sin slides) lo devuelve tal cual y el esquema lo rechaza', () => {
    const r = sanitizeDoc('pptx', { diapositivas: [] })
    expect(isPptxSpec(r)).toBe(false)
  })
})

describe('sanitizeDoc: docx de GPT', () => {
  const out = sanitizeDoc('docx', GPT_DOCX) as DocxSpec
  it('sin sanear, el esquema estricto lo rechaza; saneado, pasa', () => {
    expect(isDocxSpec(GPT_DOCX)).toBe(false)
    expect(isDocxSpec(out)).toBe(true)
  })
  it('descarta claves de más del documento y de los bloques', () => {
    expect(out).not.toHaveProperty('language')
    expect(out.blocks[1]).toEqual({ type: 'paragraph', text: 'Las ventas crecieron **12,5%**.' })
  })
  it('nivel de encabezado como texto → número', () => {
    expect(out.blocks[0]).toEqual({ type: 'heading', level: 1, text: 'Resumen' })
  })
  it('un bloque de tipo desconocido con texto se conserva como párrafo', () => {
    expect(out.blocks[2]).toEqual({ type: 'paragraph', text: 'Una cita que GPT escribe como bloque propio' })
  })
  it('SEGURIDAD: un bloque «image» con ruta se descarta entero (la ruta nunca llega al resultado)', () => {
    expect(out.blocks.some((b) => (b as { type: string }).type === 'image')).toBe(false)
    expect(JSON.stringify(out)).not.toContain('.ssh')
  })
  it('listas y tablas: números a texto y filas al largo de las columnas', () => {
    expect(out.blocks[3]).toEqual({ type: 'bullets', items: ['Norte', '7', ['sub 1', 'sub 2']] })
    expect(out.blocks[4]).toMatchObject({
      type: 'table',
      rows: [
        ['Norte', 1234567],
        ['Sur', null],
        ['Centro', 'Sí']
      ]
    })
  })
  it('un documento sin ningún bloque utilizable sigue siendo inválido', () => {
    expect(isDocxSpec(sanitizeDoc('docx', { blocks: [{ type: 'image', path: 'a.png' }] }))).toBe(false)
  })
})

describe('sanitizeDoc: xlsx de GPT', () => {
  const out = sanitizeDoc('xlsx', GPT_XLSX) as XlsxSpec
  it('queda válido', () => {
    expect(isXlsxSpec(GPT_XLSX)).toBe(false)
    expect(isXlsxSpec(out)).toBe(true)
  })
  it('recorta el nombre de hoja (31), descarta claves extra, formatos desconocidos y gráficos inválidos', () => {
    const sheet = out.sheets[0]
    expect(sheet.name.length).toBeLessThanOrEqual(31)
    expect(sheet).not.toHaveProperty('description')
    expect(sheet.columnFormats).toEqual([null, 'currency', null])
    expect(sheet.charts).toEqual([{ type: 'column', range: 'A1:B3', title: 'Gastos' }])
    expect(sheet.rows[1]).toEqual(['2026-10-01', 85000, 'Sí'])
    expect(sheet.rows[2]).toEqual(['2026-10-02', null, null])
  })
})

describe('sniffDocKind', () => {
  it('reconoce la spec inequívoca de cada documento', () => {
    expect(sniffDocKind({ sheets: [{ name: 'A', rows: [] }] })).toBe('xlsx')
    expect(sniffDocKind({ slides: [{ title: 'x' }] })).toBe('pptx')
    expect(sniffDocKind({ blocks: [{ type: 'paragraph', text: 'x' }] })).toBe('docx')
  })
  it('un JSON cualquiera (configuración, datos) NO se confunde con un documento', () => {
    expect(sniffDocKind({ name: 'app', version: '1.0.0' })).toBeNull()
    expect(sniffDocKind({ slides: 3 })).toBeNull()
    expect(sniffDocKind({ blocks: [1, 2, 3] })).toBeNull()
    expect(sniffDocKind([{ slides: [] }])).toBeNull()
    expect(sniffDocKind({ sheets: [{ name: 'a' }] })).toBeNull()
  })
  it('ambiguo (dos formas a la vez) → null', () => {
    expect(sniffDocKind({ slides: [{ title: 'x' }], blocks: [{ type: 'paragraph' }] })).toBeNull()
  })
})
