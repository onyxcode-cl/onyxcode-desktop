import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
// renderToStaticMarkup lee el estado INICIAL del store de zustand: se sustituye por un estado fijo.
const mock: { deliverables: Record<string, unknown[]> } = { deliverables: {} }
vi.mock('./store', () => ({ useTasks: (sel: (s: typeof mock) => unknown) => sel(mock) }))
vi.mock('../../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../../lib/platform')>()),
  isRemoteSurface: () => false
}))

import { ResultCard, isHelperFile } from './ResultCard'

const file = (name: string, mtime: number) => ({ path: `/Users/x/Desktop/${name}`, relPath: name, size: 2048, mtime })

describe('ResultCard', () => {
  it('sin entregables no pinta nada', () => {
    mock.deliverables = {}
    expect(renderToStaticMarkup(<ResultCard taskId="t1" />)).toBe('')
  })

  it('lista los archivos más recientes con sus acciones y resume el resto', () => {
    Object.assign(mock, {
      deliverables: { t1: [file('a.xlsx', 1), file('b.docx', 2), file('c.pdf', 3), file('d.png', 4), file('e.txt', 5)] }
    })
    const html = renderToStaticMarkup(<ResultCard taskId="t1" />)
    expect(html).toContain('data-testid="result-card"')
    expect(html).toContain('e.txt')
    expect(html).toContain('c.pdf')
    expect(html).not.toContain('a.xlsx')
    expect(html).toContain('Abrir')
    expect(html).toContain('2 archivo')
  })
})

describe('ResultCard no se sale del marco (panel derecho abierto)', () => {
  // Anchos del chat con el panel derecho abierto (360, 450, 540, 700 px) × 1, 3 y 6 archivos con nombres largos. jsdom no calcula
  // layout: aquí se fijan las clases que lo garantizan; las medidas reales (Chromium) se hicieron con el arnés descrito en
  // PANEL-DERECHO-189.md: sin estas clases la fila sobraba 120 px a 360 y 30 px a 450 de ancho.
  const long = 'informe-teletrabajo-pyme-40-personas-version-final-revisada-v'
  for (const n of [1, 3, 6]) {
    it(`${n} archivo(s) con nombre largo: columna que encoge, filas min-w-0 y nombre con «…»`, () => {
      Object.assign(mock, {
        deliverables: {
          t1: Array.from({ length: n }, (_, i) => ({ path: `/Users/x/Desktop/${long}${i}.docx`, relPath: `a${i}`, size: 12288, mtime: i }))
        }
      })
      const html = renderToStaticMarkup(<ResultCard taskId="t1" />)
      // Una columna de grid «1fr» no baja del ancho mínimo de su contenido (el nombre sin cortar): se fuerza minmax(0,1fr)
      // y la fila lleva min-w-0, o las filas desbordan el marco y el icono de carpeta queda cortado.
      expect(html).toMatch(/<ul[^>]*class="[^"]*grid-cols-\[minmax\(0,1fr\)\]/)
      const rows = html.match(/<li[^>]*>/g) ?? []
      expect(rows).toHaveLength(Math.min(n, 3))
      for (const r of rows) expect(r).toMatch(/\bmin-w-0\b/)
      expect(html).toMatch(/class="min-w-0 flex-1 truncate/)
      // Las acciones no se encogen ni se parten: se envuelven a la línea siguiente en vez de salirse.
      expect(html).toMatch(/<li[^>]*class="[^"]*\bflex-wrap\b/)
    })
  }
})

describe('isHelperFile', () => {
  it('oculta los archivos de trabajo del agente y deja los entregables', () => {
    const f = (relPath: string) => ({ relPath, path: `/x/${relPath}` })
    expect(isHelperFile(f('spec.json'))).toBe(true)
    expect(isHelperFile(f('spec-ventas.json'))).toBe(true)
    expect(isHelperFile(f('.lazunox/trabajo/render/p1.png'))).toBe(true)
    expect(isHelperFile(f('~$informe.docx'))).toBe(true)
    expect(isHelperFile(f('bench-ventas.xlsx'))).toBe(false)
    expect(isHelperFile(f('datos.json'))).toBe(false)
  })
})
