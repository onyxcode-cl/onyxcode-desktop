import { describe, expect, it } from 'vitest'
import { isPptxSpec } from './chat-doc-spec'
import { normalizePptx } from './chat-doc-normalize'

describe('normalizePptx', () => {
  it('un elemento «line»/«circle»/«rectangle» pasa a ser una forma válida', () => {
    const raw = {
      slides: [
        {
          layout: 'free',
          elements: [
            { type: 'line', x: 100, y: 285, w: 760, h: 0, line: '#F28C38', lineWidth: 4 },
            { type: 'circle', x: 0, y: 0, w: 50, h: 50, fill: '#FFFFFF' },
            { type: 'Rectangle', x: 0, y: 0, w: 50, h: 50 },
            { type: 'text', x: 1, y: 1, w: 10, h: 10, text: 'hola' }
          ]
        }
      ]
    }
    expect(isPptxSpec(raw)).toBe(false)
    const fixed = normalizePptx(raw)
    expect(isPptxSpec(fixed)).toBe(true)
    const els = (fixed as { slides: { elements: Record<string, unknown>[] }[] }).slides[0].elements
    expect(els.map((e) => [e.type, e.shape])).toEqual([
      ['shape', 'line'],
      ['shape', 'ellipse'],
      ['shape', 'rect'],
      ['text', undefined]
    ])
  })
  it('números en una tabla pasan a texto', () => {
    const raw = { slides: [{ title: 'T', layout: 'table', table: { columns: ['Plan', 'Precio'], rows: [['Pro', 29990]] } }] }
    expect(isPptxSpec(raw)).toBe(false)
    expect(isPptxSpec(normalizePptx(raw))).toBe(true)
  })
  it('un tipo desconocido sigue siendo inválido (no se inventa nada) y lo que no es presentación queda igual', () => {
    const raw = { slides: [{ layout: 'free', elements: [{ type: 'bomba', x: 0, y: 0, w: 1, h: 1 }] }] }
    expect(isPptxSpec(normalizePptx(raw))).toBe(false)
    expect(normalizePptx('hola')).toBe('hola')
    expect(normalizePptx(null)).toBeNull()
  })
})
