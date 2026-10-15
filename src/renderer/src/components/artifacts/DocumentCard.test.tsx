import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { recordChatDocSize, resetChatDocSizes } from '../../lib/chatDocSize'
import { DocumentCard, docCardCount, docCardType, docFileName } from './DocumentCard'

describe('docCardType', () => {
  it('mapea el tipo de bloque a tipo de tarjeta', () => {
    expect(docCardType('xlsx', false)).toBe('xlsx')
    expect(docCardType('docx', false)).toBe('docx')
    expect(docCardType('pptx', false)).toBe('pptx')
    expect(docCardType('html', true)).toBe('slides')
    expect(docCardType('html', false)).toBe('pdf')
  })
})

describe('docFileName', () => {
  it('agrega la extensión sin duplicarla y limpia caracteres raros', () => {
    expect(docFileName('Informe de ventas', 'xlsx')).toBe('Informe de ventas.xlsx')
    expect(docFileName('informe.xlsx', 'xlsx')).toBe('informe.xlsx')
    expect(docFileName('a/b:c', 'docx')).toBe('a b c.docx')
    expect(docFileName('', 'pdf')).toBe('documento.pdf')
  })
})

describe('docCardCount', () => {
  it('cuenta hojas de un Excel válido y nada si no se puede leer', () => {
    const raw = JSON.stringify({ sheets: [{ name: 'A', rows: [['x']] }, { name: 'B', rows: [['y']] }] })
    expect(docCardCount('xlsx', raw)).toEqual({ key: 'sheets', n: 2 })
    expect(docCardCount('xlsx', '{roto')).toBeNull()
    expect(docCardCount('docx', raw)).toBeNull()
  })
})

describe('DocumentCard: peso', () => {
  it('sin dato no muestra peso; con dato registrado lo muestra', () => {
    resetChatDocSizes()
    const raw = JSON.stringify({ sheets: [{ name: 'A', rows: [['x']] }] })
    const sin = renderToStaticMarkup(<DocumentCard kind="xlsx" rawText={raw} title="Ventas" />)
    expect(sin).not.toMatch(/\bKB\b|\bMB\b/)
    recordChatDocSize('xlsx', raw, 124 * 1024)
    const con = renderToStaticMarkup(<DocumentCard kind="xlsx" rawText={raw} title="Ventas" />)
    expect(con).toContain('124 KB')
    resetChatDocSizes()
  })
})

describe('DocumentCard (render estático)', () => {
  it.each([
    ['xlsx', false],
    ['docx', false],
    ['pptx', false],
    ['html', true],
    ['html', false]
  ] as const)('%s (slides=%s): nombre, tipo, miniatura y botones', (kind, isSlides) => {
    const html = renderToStaticMarkup(<DocumentCard kind={kind} rawText="{}" isSlides={isSlides} title="Informe de ventas" />)
    expect(html).toContain('data-doc-card=')
    expect(html).toContain('data-doc-thumb=')
    expect(html).toContain('Informe de ventas.')
    expect(html).toContain('Abrir')
    expect(html).toContain('Descargar')
    expect(html).toContain('truncate')
  })
})
