// @vitest-environment jsdom
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryItem } from '@shared/ipc-extras'
import { NO_FILTERS, filterItems, fold, groupItems, typeChips, whenText } from './gallery-logic'

// El arranque de pruebas sustituye `document` por un doble: React decide al cargarse si el navegador soporta el evento `input`, así que
// se carga de nuevo (módulos limpios) con el `document` de jsdom para que el buscador reciba lo que se escribe.
type Mods = {
  act: typeof import('react').act
  createElement: typeof import('react').createElement
  createRoot: typeof import('react-dom/client').createRoot
  GalleryView: typeof import('./GalleryView').GalleryView
  clearThumbCache: typeof import('./GalleryView').clearThumbCache
  useUi: typeof import('../../../stores/ui').useUi
  getDraft: typeof import('../../../stores/drafts').getDraft
}
let M: Mods
let act: Mods['act']
let createElement: Mods['createElement']
let GalleryView: Mods['GalleryView']
beforeAll(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('navigator', { userAgent: globalThis.navigator?.userAgent, language: 'es', languages: ['es'] })
  vi.resetModules()
  const react = await import('react')
  const dom = await import('react-dom/client')
  const view = await import('./GalleryView')
  M = {
    act: react.act,
    createElement: react.createElement,
    createRoot: dom.createRoot,
    GalleryView: view.GalleryView,
    clearThumbCache: view.clearThumbCache,
    useUi: (await import('../../../stores/ui')).useUi,
    getDraft: (await import('../../../stores/drafts')).getDraft
  }
  ;({ act, createElement, GalleryView } = M)
})
afterAll(() => vi.resetModules())

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime()
const HOUR = 3600_000
const DAY = 24 * HOUR
function item(over: Partial<GalleryItem> & { name: string }): GalleryItem {
  return {
    path: `/c/${over.name}`,
    type: 'document',
    origin: 'chat',
    createdAt: NOW - HOUR,
    bytes: 2048,
    kind: 'office',
    canView: true,
    canOpen: true,
    missing: false,
    ...over
  }
}
const ITEMS: GalleryItem[] = [
  item({ name: 'Cotización flota.docx', origin: 'overdrive' }),
  item({ name: 'Presupuesto octubre.xlsx', type: 'sheet', createdAt: NOW - DAY }),
  item({ name: 'Renovaciones Q4.pptx', type: 'slides', createdAt: NOW - 3 * DAY }),
  item({ name: 'Acta reunión.docx', createdAt: NOW - 14 * DAY }),
  item({ name: 'Informe siniestros.pdf', type: 'pdf', origin: 'overdrive', createdAt: NOW - 20 * DAY }),
  item({ name: 'Perdido.docx', missing: true, canView: false, canOpen: false, bytes: 0, createdAt: NOW - 2 * DAY })
]

describe('lógica', () => {
  it('filtra por tipo, origen, fecha y nombre sin tildes', () => {
    expect(filterItems(ITEMS, { ...NO_FILTERS, type: 'sheet' }, NOW).map((i) => i.name)).toEqual(['Presupuesto octubre.xlsx'])
    expect(filterItems(ITEMS, { ...NO_FILTERS, origin: 'overdrive' }, NOW)).toHaveLength(2)
    expect(filterItems(ITEMS, { ...NO_FILTERS, date: 'today' }, NOW).map((i) => i.name)).toEqual(['Cotización flota.docx'])
    expect(filterItems(ITEMS, { ...NO_FILTERS, date: 'week' }, NOW)).toHaveLength(4)
    expect(filterItems(ITEMS, { ...NO_FILTERS, date: 'month' }, NOW)).toHaveLength(6)
    expect(filterItems(ITEMS, { ...NO_FILTERS, query: 'COTIZACION' }, NOW)).toHaveLength(1)
    expect(filterItems(ITEMS, { ...NO_FILTERS, query: 'xyz' }, NOW)).toHaveLength(0)
    expect(fold('Ñandú Áéí')).toBe('nandu aei')
  })
  it('las píldoras fijas siempre salen; Imágenes y Texto solo si hay', () => {
    expect(typeChips(ITEMS).map((c) => c.type)).toEqual(['document', 'sheet', 'slides', 'web', 'pdf'])
    expect(typeChips([item({ name: 'a.png', type: 'image' })]).map((c) => c.type)).toContain('image')
  })
  it('agrupa «Esta semana» y luego por mes, más nuevo primero', () => {
    const g = groupItems(ITEMS, NOW, 'es', 'Esta semana')
    expect(g[0]).toMatchObject({ kind: 'week', label: 'Esta semana' })
    expect(g[0].items.map((i) => i.name)).toEqual([
      'Cotización flota.docx',
      'Presupuesto octubre.xlsx',
      'Perdido.docx',
      'Renovaciones Q4.pptx'
    ])
    expect(g[1]).toMatchObject({ kind: 'month', label: 'octubre' })
  })
  it('textos de fecha', () => {
    const t = (k: string, p?: Record<string, string>): string => (k === 'gallery.when.today' ? `hoy, ${p?.time}` : 'ayer')
    expect(whenText(NOW - HOUR, NOW, 'es', t)).toBe('hoy, 11:00')
    expect(whenText(NOW - DAY, NOW, 'es', t)).toBe('ayer')
    expect(whenText(NOW - 20 * DAY, NOW, 'es', t)).toMatch(/27 sep/)
  })
})

let host: HTMLDivElement
let root: Root
let invoke: ReturnType<typeof vi.fn>
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
function setup(list: () => Promise<unknown>): void {
  invoke = vi.fn(async (channel: string, req?: unknown) => {
    if (channel === 'extras:gallery:list') return list()
    if (channel === 'extras:gallery:thumb') return { kind: 'none' }
    return req
  })
  ;(window as unknown as { api: unknown }).api = { extras: { invoke } }
}
beforeEach(() => {
  M.clearThumbCache()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = M.createRoot(host)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  delete (window as unknown as { api?: unknown }).api
})
const text = (): string => host.textContent ?? ''
const type = (el: HTMLInputElement, value: string): void => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('GalleryView', () => {
  it('cargando: esqueletos accesibles; luego las tarjetas con sus acciones y el origen', async () => {
    let done: (v: unknown) => void = () => undefined
    setup(() => new Promise((r) => (done = r)))
    act(() => root.render(createElement(GalleryView)))
    expect(host.querySelector('[data-gallery-loading]')).not.toBeNull()
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('true')
    done({ items: ITEMS, truncated: false })
    await flush()
    expect(host.querySelector('[data-gallery-loading]')).toBeNull()
    expect(host.querySelectorAll('[data-gallery-card]')).toHaveLength(6)
    expect(text()).toContain('Esta semana')
    expect(text()).toContain('Creado en Overdrive')
    const first = host.querySelector('[data-gallery-card]')!
    expect(Array.from(first.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Ver aquí',
      'Abrir con tu programa',
      'Mostrar en la carpeta'
    ])
    expect(first.querySelector('button')?.getAttribute('aria-label')).toBe('Ver aquí: Cotización flota.docx')
  })

  it('filtros por tipo, buscador y «Quitar filtros»', async () => {
    setup(async () => ({ items: ITEMS, truncated: false }))
    act(() => root.render(createElement(GalleryView)))
    await flush()
    const chip = (label: string): HTMLButtonElement =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-pressed]')).find((b) => b.textContent?.startsWith(label))!
    expect(chip('Todo').getAttribute('aria-pressed')).toBe('true')
    act(() => chip('Planillas').click())
    expect(host.querySelectorAll('[data-gallery-card]')).toHaveLength(1)
    expect(chip('Planillas').getAttribute('aria-pressed')).toBe('true')
    act(() => chip('Todo').click())
    type(host.querySelector('input[type=search]')!, 'acta')
    expect(host.querySelectorAll('[data-gallery-card]')).toHaveLength(1)
    type(host.querySelector('input[type=search]')!, 'nada que ver')
    expect(host.querySelector('[data-gallery-nomatch]')).not.toBeNull()
    act(() =>
      Array.from(host.querySelectorAll('button'))
        .find((b) => b.textContent === 'Quitar filtros')!
        .click()
    )
    expect(host.querySelectorAll('[data-gallery-card]')).toHaveLength(6)
  })

  it('un archivo borrado sale como «Archivo no encontrado» y se quita de la lista', async () => {
    setup(async () => ({ items: ITEMS, truncated: false }))
    act(() => root.render(createElement(GalleryView)))
    await flush()
    const card = host.querySelector('[data-missing]')!
    expect(card.textContent).toContain('Archivo no encontrado')
    expect(Array.from(card.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Quitar de la lista'])
    act(() => card.querySelector('button')!.click())
    expect(invoke).toHaveBeenCalledWith('extras:gallery:remove', { path: '/c/Perdido.docx' })
    expect(host.querySelector('[data-missing]')).toBeNull()
  })

  it('«Ver aquí» cambia a Chat; «Abrir» y «Mostrar» usan los canales de siempre', async () => {
    setup(async () => ({ items: [ITEMS[0]], truncated: false }))
    M.useUi.setState({ mode: 'gallery' })
    act(() => root.render(createElement(GalleryView)))
    await flush()
    const [view, open, reveal] = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-gallery-card] button'))
    act(() => open.click())
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:open', { path: '/c/Cotización flota.docx' })
    act(() => reveal.click())
    expect(invoke).toHaveBeenCalledWith('extras:chatFile:reveal', { path: '/c/Cotización flota.docx' })
    act(() => view.click())
    expect(M.useUi.getState().mode).toBe('chat')
  })

  it('vacío: cuatro tarjetas «Crea algo nuevo» que dejan el pedido escrito en el Chat', async () => {
    setup(async () => ({ items: [], truncated: false }))
    M.useUi.setState({ mode: 'gallery' })
    act(() => root.render(createElement(GalleryView)))
    await flush()
    expect(host.querySelector('[data-gallery-empty]')).not.toBeNull()
    const ctas = Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === 'Crear en el Chat')
    expect(ctas).toHaveLength(4)
    act(() => ctas[1].click())
    expect(M.useUi.getState().mode).toBe('chat')
    expect(M.getDraft('chat:new', '')).toBe('Hazme una planilla para mis gastos del mes')
  })

  it('error amable con «Reintentar»', async () => {
    let fail = true
    setup(async () => {
      if (fail) throw new Error('boom')
      return { items: ITEMS, truncated: true }
    })
    act(() => root.render(createElement(GalleryView)))
    await flush()
    expect(host.querySelector('[role=alert]')?.textContent).toContain('No pudimos cargar tus creaciones')
    expect(text()).not.toContain('boom')
    fail = false
    act(() =>
      Array.from(host.querySelectorAll('button'))
        .find((b) => b.textContent === 'Reintentar')!
        .click()
    )
    await flush()
    expect(host.querySelectorAll('[data-gallery-card]')).toHaveLength(6)
    expect(text()).toContain('Se muestran las 500 más recientes')
  })
})
