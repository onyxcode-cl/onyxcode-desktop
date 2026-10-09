import { describe, expect, it } from 'vitest'
import { extractChatDocBlocks } from './chatDocBlocks'

const HTML = '```html\n<!doctype html><html><body><h1>hola</h1></body></html>\n```'
const SLIDES = '```slides\n<!doctype html><html><body><section class="slide"><h1>Intro</h1></section></body></html>\n```'
const XLSX = '```xlsx\n{"sheets":[{"name":"Gastos","rows":[["Fecha","Monto"],["2026-10-01",85000]]}]}\n```'
const PPTX = '```pptx\n{"slides":[{"title":"Portada","bullets":["uno","dos"]}]}\n```'

describe('extractChatDocBlocks', () => {
  it('encuentra un bloque html, como antes', () => {
    const blocks = extractChatDocBlocks(`texto\n\n${HTML}`)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('html')
    expect(blocks[0].rawText).toContain('<h1>hola</h1>')
  })

  it('encuentra un bloque xlsx y lo parsea', () => {
    const blocks = extractChatDocBlocks(`acá va:\n\n${XLSX}`)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('xlsx')
    expect(blocks[0].title).toBe('Gastos')
    expect(blocks[0].kind === 'xlsx' && blocks[0].data.sheets[0].rows).toEqual([
      ['Fecha', 'Monto'],
      ['2026-10-01', 85000]
    ])
  })

  it('encuentra un bloque pptx y lo parsea', () => {
    const blocks = extractChatDocBlocks(PPTX)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('pptx')
    expect(blocks[0].title).toBe('Portada')
  })

  it('encuentra un bloque ```slides y lo trata como html (mismo camino, título "Presentación N" por defecto)', () => {
    const blocks = extractChatDocBlocks(`acá va:\n\n${SLIDES}`)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('html')
    expect(blocks[0].rawText).toContain('class="slide"')
  })

  it('varios bloques en el mismo mensaje quedan ordenados por posición, no por tipo', () => {
    const text = `${PPTX}\n\ntexto en el medio\n\n${XLSX}\n\n${HTML}`
    const blocks = extractChatDocBlocks(text)
    expect(blocks.map((b) => b.kind)).toEqual(['pptx', 'xlsx', 'html'])
  })

  it('un xlsx con JSON inválido (a medio escribir) se ignora, no revienta', () => {
    const broken = '```xlsx\n{"sheets":[{"name":"X","rows":[["a"\n```'
    expect(extractChatDocBlocks(broken)).toEqual([])
  })

  it('un xlsx con JSON válido pero que no cumple el schema (sin "sheets") se ignora', () => {
    const wrong = '```xlsx\n{"foo":1}\n```'
    expect(extractChatDocBlocks(wrong)).toEqual([])
  })

  it('un bloque xlsx vacío no cuenta', () => {
    expect(extractChatDocBlocks('```xlsx\n\n```')).toEqual([])
  })

  it('sin título propio (sin nombre de hoja / sin título de diapositiva): usa un título genérico', () => {
    const blocks = extractChatDocBlocks('```xlsx\n{"sheets":[{"name":"","rows":[["x"]]}]}\n```')
    expect(blocks[0].title).toMatch(/Hoja de cálculo/)
  })
})
