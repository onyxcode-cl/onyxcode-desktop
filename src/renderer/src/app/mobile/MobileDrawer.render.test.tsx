/**
 * Panel lateral de la PWA (F8-B102, T1): diálogo modal de 320 px con velo, X y filas de 44, pie con Ajustes y el estado del enlace,
 * gesto de cierre y CSS de las filas. Render estático con la superficie `remote` simulada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { useCode } from '../../features/code/impl/store'
import { MobileDrawer } from './MobileDrawer'
import DrawerPanel, { DRAWER_SWIPE_PX, swipeClosesDrawer } from './DrawerPanel'
import { initialNav, useMobileNavStore } from './nav'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } }; __onyxLink?: unknown }
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length
// El contenido (DrawerPanel) se baja al abrir; las pruebas lo pintan directo, y `MobileDrawer` solo decide si hay panel.
const render = (): string => renderToStaticMarkup(createElement(DrawerPanel))

type AnyStore = { setState: (p: object) => void; getInitialState: () => object }
const originals = new Map<AnyStore, object>()
function seed(store: AnyStore, patch: object): void {
  if (!originals.has(store)) originals.set(store, { ...store.getInitialState() })
  store.setState(patch)
  Object.assign(store.getInitialState(), patch)
}
function open(tab: 'chat' | 'code' | 'tasks' | 'routines' = 'chat'): void {
  seed(useMobileNavStore as unknown as AnyStore, { ...initialNav(tab), drawerOpen: true })
}

beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
  seed(useCode as unknown as AnyStore, { directory: '/Users/ana/proy', activeSessionID: null, sessions: {}, sessionProject: {} })
})
afterEach(() => {
  delete g.window
  delete g.__onyxLink
  for (const [store, orig] of originals) {
    store.setState(orig)
    Object.assign(store.getInitialState(), orig)
  }
  originals.clear()
  useMobileNavStore.getState().reset()
})

describe('MobileDrawer', () => {
  it('cerrado no pinta nada (ni baja el trozo); abierto, mientras llega el trozo, tampoco pinta el panel', () => {
    seed(useMobileNavStore as unknown as AnyStore, initialNav('chat'))
    expect(renderToStaticMarkup(createElement(MobileDrawer))).toBe('')
    open()
    expect(renderToStaticMarkup(createElement(MobileDrawer))).not.toContain('role="dialog"')
  })

  it('abierto: diálogo modal con nombre, velo y ancho de 320 px acotado al viewport', () => {
    open()
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Menú de navegación"')
    expect(html).toContain('data-drawer-scrim=""')
    expect(html).toContain('bg-[var(--m-backdrop)]')
    expect(html).toContain('w-[min(var(--m-drawer),calc(100vw-40px))]')
    expect(html).not.toContain('backdrop-blur')
  })

  it('cabecera con logo y nombre, X de 44 y márgenes de zona segura', () => {
    open()
    const html = render()
    expect(html).toContain('Lazunox')
    const x = html.match(/<button[^>]*aria-label="Cerrar menú"[^>]*>/)?.[0] ?? ''
    expect(x).toContain('h-11 w-11')
    expect(html).toContain('safe-area-inset-top')
    expect(html).toContain('safe-area-inset-bottom')
    expect(html).toContain('safe-area-inset-left')
  })

  it('acciones y pie en filas de al menos 44 (--m-row-list), sin gestos de fila (data-in-drawer)', () => {
    open()
    const html = render()
    expect(html).toContain('data-in-drawer=""')
    expect(html).toContain('Nueva conversación')
    expect(html).toContain('Buscar o ir a…')
    expect(html).toContain('Ajustes')
    // Nueva conversación, Buscar y Ajustes: tres filas de 44.
    expect(count(html, /min-h-\[var\(--m-row-list\)\]/g)).toBeGreaterThanOrEqual(3)
    // Ningún botón propio del panel queda por debajo de 44.
    for (const b of html.match(/<button[^>]*(?:Cerrar menú|class="[^"]*min-h-\[var\(--m-row-list\)\][^"]*")[^>]*>/g) ?? [])
      expect(b).toMatch(/h-11 w-11|min-h-\[var\(--m-row-list\)\]/)
  })

  it('el pie muestra el estado del enlace con texto, no solo color', () => {
    open()
    // Sin enlace (pruebas): se considera en línea.
    expect(render()).toMatch(
      /data-testid="drawer-link-status"[^>]*><span class="h-1\.5 w-1\.5 rounded-full bg-success"[^>]*><\/span>Conectado/
    )
    for (const [status, dot, label] of [
      ['offline', 'bg-subtle', 'Sin conexión'],
      ['reconnecting', 'bg-warning', 'Reconectando…']
    ] as const) {
      g.__onyxLink = { status: () => status, onStatus: () => () => undefined }
      const html = render()
      expect(html, status).toContain(`${dot}" aria-hidden="true"></span>${label}`)
    }
  })

  it('Code sin carpeta no ofrece «nueva sesión»', () => {
    seed(useCode as unknown as AnyStore, { directory: null })
    open('code')
    expect(render()).not.toContain('Nueva sesión')
  })
})

describe('gesto de cierre', () => {
  it('cierra al deslizar a la izquierda 60 px o más y más horizontal que vertical', () => {
    expect(DRAWER_SWIPE_PX).toBe(60)
    expect(swipeClosesDrawer(-60, 0)).toBe(true)
    expect(swipeClosesDrawer(-120, 30)).toBe(true)
  })
  it('no cierra por un deslizamiento corto, a la derecha o casi vertical (desplazar la lista)', () => {
    expect(swipeClosesDrawer(-59, 0)).toBe(false)
    expect(swipeClosesDrawer(80, 0)).toBe(false)
    expect(swipeClosesDrawer(-70, 70)).toBe(false)
    expect(swipeClosesDrawer(-70, 50)).toBe(false)
  })
})
