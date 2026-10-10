import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
// renderToStaticMarkup lee el estado INICIAL del store de zustand: se sustituye por un estado fijo.
const mock: { deliverables: Record<string, unknown[]> } = { deliverables: {} }
vi.mock('./store', () => ({ useTasks: (sel: (s: typeof mock) => unknown) => sel(mock) }))
vi.mock('../../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../../lib/platform')>()),
  isRemoteSurface: () => false
}))

import { ResultCard } from './ResultCard'

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
