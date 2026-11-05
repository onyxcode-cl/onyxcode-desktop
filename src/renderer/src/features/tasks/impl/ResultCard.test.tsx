import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
// renderToStaticMarkup lee el estado INICIAL del store de zustand: se sustituye por un estado fijo.
const mock: { deliverables: Record<string, unknown[]> } = { deliverables: {} }
const sess = vi.hoisted(() => ({ messages: {} as Record<string, unknown[]> }))
vi.mock('../../../stores/sessions', () => ({ useSessions: (sel: (s: typeof sess) => unknown) => sel(sess), MAIN_SOURCE: 'main' }))
vi.mock('./store', () => ({ useTasks: (sel: (s: typeof mock) => unknown) => sel(mock) }))
vi.mock('../../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../../lib/platform')>()),
  isRemoteSurface: () => false
}))

import { ResultCard, isHelperFile } from './ResultCard'
import { splitVersions } from './util'

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
  const long = 'informe-teletrabajo-pyme-40-personas-version-final-revisada-parte'
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

describe('borradores v1/v2 (versiones anteriores)', () => {
  const f = (name: string, mtime: number) => ({ path: `/Users/x/Desktop/${name}`, relPath: name, size: 2048, mtime })

  it('splitVersions: la versión mayor es la entrega; sin sufijo cuenta como v1; no mezcla documentos ni extensiones', () => {
    const all = [f('informe.docx', 1), f('informe-v2.docx', 2), f('informe-v3.docx', 3), f('informe-v3.pdf', 4), f('otro.docx', 5)]
    const { latest, older } = splitVersions(all)
    expect(latest.map((x) => x.relPath).sort()).toEqual(['informe-v3.docx', 'informe-v3.pdf', 'otro.docx'])
    expect(older.map((x) => x.relPath).sort()).toEqual(['informe-v2.docx', 'informe.docx'])
  })

  it('splitVersions: un solo archivo, o otro documento con «final» en medio del nombre, no se agrupa', () => {
    expect(splitVersions([f('plan-v2.pptx', 1)]).older).toEqual([])
    expect(splitVersions([f('informe.docx', 1), f('resumen-final-ventas.docx', 2)]).older).toEqual([])
  })

  it('la tarjeta muestra solo la última y ofrece «Ver versiones anteriores» sin listar los borradores', () => {
    Object.assign(mock, { deliverables: { t1: [f('informe.docx', 1), f('informe-v2.docx', 2), f('informe-v3.docx', 3)] } })
    const html = renderToStaticMarkup(<ResultCard taskId="t1" />)
    expect(html).toContain('informe-v3.docx')
    expect(html).not.toContain('informe-v2.docx')
    expect(html).not.toContain('>informe.docx<')
    expect(html).toContain('Ver versiones anteriores (2)')
  })

  it('sin borradores no aparece el botón', () => {
    Object.assign(mock, { deliverables: { t1: [f('a.docx', 1), f('b.pdf', 2)] } })
    expect(renderToStaticMarkup(<ResultCard taskId="t1" />)).not.toContain('versiones anteriores')
  })
})

describe('entrega principal = el último documento creado con documentos_crear', () => {
  const f = (name: string, mtime: number) => ({ path: `/Users/x/Desktop/${name}`, relPath: name, size: 2048, mtime })
  const created = (name: string) => ({
    info: { id: `m-${name}`, role: 'assistant' },
    parts: [
      {
        type: 'tool',
        tool: 'lazunox_documentos_crear',
        state: { status: 'completed', output: `Documento creado: ${name} (12 KB). Revisión…` }
      }
    ]
  })

  it('va primero aunque otro borrador tenga fecha más nueva; los creados antes del mismo tipo quedan como anteriores', () => {
    Object.assign(mock, { deliverables: { t1: [f('prueba-a.docx', 1), f('prueba-b.docx', 9), f('prueba-d.docx', 5), f('datos.xlsx', 3)] } })
    sess.messages = { t1: [created('prueba-a.docx'), created('prueba-d.docx')] }
    const html = renderToStaticMarkup(<ResultCard taskId="t1" />)
    expect(html.indexOf('prueba-d.docx')).toBeGreaterThan(-1)
    expect(html.indexOf('prueba-d.docx')).toBeLessThan(html.indexOf('prueba-b.docx') === -1 ? Infinity : html.indexOf('prueba-b.docx'))
    expect(html).not.toContain('>prueba-a.docx<')
    expect(html).toContain('Ver versiones anteriores (1)')
    expect(html).toContain('datos.xlsx')
  })

  it('sin llamadas a documentos_crear se ordena por fecha como antes', () => {
    Object.assign(mock, { deliverables: { t1: [f('a.docx', 1), f('b.docx', 2)] } })
    sess.messages = { t1: [] }
    const html = renderToStaticMarkup(<ResultCard taskId="t1" />)
    expect(html.indexOf('b.docx')).toBeLessThan(html.indexOf('a.docx'))
    expect(html).not.toContain('versiones anteriores')
  })
})

describe('familia de versiones: solo la entrega visible, todo lo demás plegado', () => {
  const f = (name: string, mtime: number) => ({ path: `/Users/x/Desktop/${name}`, relPath: name, size: 2048, mtime })
  it('«final» gana a -v2 y al original aunque v2 sea más nuevo', () => {
    const { latest, older } = splitVersions([
      f('informe.docx', 1),
      f('informe-v2.docx', 9),
      f('informe-final.docx', 5),
      f('informe (2).docx', 4)
    ])
    expect(latest.map((x) => x.relPath)).toEqual(['informe-final.docx'])
    expect(older.map((x) => x.relPath).sort()).toEqual(['informe (2).docx', 'informe-v2.docx', 'informe.docx'])
  })
  it('la tarjeta no lista v2 junto a final', () => {
    Object.assign(mock, { deliverables: { t1: [f('informe-v2.docx', 9), f('informe-final.docx', 5)] } })
    sess.messages = { t1: [] }
    const html = renderToStaticMarkup(<ResultCard taskId="t1" />)
    expect(html).toContain('informe-final.docx')
    expect(html).not.toContain('>informe-v2.docx<')
    expect(html).toContain('Ver versiones anteriores (1)')
  })
})
