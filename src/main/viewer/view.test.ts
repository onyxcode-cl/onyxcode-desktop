/**
 * Contención de navegación de la `WebContentsView` del visor: segunda capa de defensa (la primera
 * es `session.ts`'s `webRequest`). Un PDF "hostil" con `/OpenAction` + `/Launch` o una acción `/URI`
 * intenta navegar o abrir ventana; acá se comprueba que `will-navigate`, `will-redirect`,
 * `will-attach-webview` y `window.open` quedan todos bloqueados sin excepción.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handlers = Record<string, (...args: any[]) => void>
const state = vi.hoisted(() => ({
  handlers: {} as Handlers,
  windowOpenHandler: null as null | (() => { action: string }),
  bounds: null as null | { x: number; y: number; width: number; height: number },
  loadedUrls: [] as string[]
}))

vi.mock('electron', () => {
  class WebContentsView {
    webContents = {
      setWindowOpenHandler: (h: () => { action: string }) => (state.windowOpenHandler = h),
      on: (event: string, cb: (...args: any[]) => void) => (state.handlers[event] = cb),
      getZoomFactor: () => 1,
      isDestroyed: () => false,
      close: () => undefined,
      loadURL: async (url: string) => {
        state.loadedUrls.push(url)
      }
    }
    setBounds = (b: { x: number; y: number; width: number; height: number }) => (state.bounds = b)
  }
  return { app: { isPackaged: true }, WebContentsView }
})
vi.mock('./session', () => ({ viewerSession: () => ({}) }))

import { attach, closeView, onViewerEvent, openDoc } from './view'

function fakeWindow(): any {
  const removed: unknown[] = []
  const added: unknown[] = []
  return {
    isDestroyed: () => false,
    webContents: { getZoomFactor: () => 1 },
    contentView: {
      addChildView: (v: unknown) => added.push(v),
      removeChildView: (v: unknown) => removed.push(v)
    },
    _removed: removed,
    _added: added
  }
}

describe('view.ts: contención de la WebContentsView del visor', () => {
  beforeEach(() => {
    state.handlers = {}
    state.windowOpenHandler = null
    state.bounds = null
    state.loadedUrls = []
    closeView()
    void openDoc(`lazunox-viewer://viewer/doc/${'a'.repeat(64)}`)
  })

  it('will-navigate, will-redirect y will-attach-webview se previenen siempre', () => {
    for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
      let prevented = false
      state.handlers[event]({ preventDefault: () => (prevented = true) })
      expect(prevented, event).toBe(true)
    }
  })

  it('window.open (un enlace del documento) se niega', () => {
    expect(state.windowOpenHandler!()).toEqual({ action: 'deny' })
  })

  it('attach() ubica la vista con el rect dado, escalado por el zoom de la ventana anfitriona', () => {
    const win = fakeWindow()
    attach(win, { x: 10, y: 20, width: 300, height: 400 }, true)
    expect(state.bounds).toEqual({ x: 10, y: 20, width: 300, height: 400 })
  })

  it('escape avisa por onViewerEvent', () => {
    const events: string[] = []
    const off = onViewerEvent((e) => events.push(e.type))
    state.handlers['before-input-event']({}, { type: 'keyDown', key: 'Escape' })
    state.handlers['before-input-event']({}, { type: 'keyDown', key: 'a' })
    expect(events).toEqual(['escape'])
    off()
  })

  it('dos aperturas con la MISMA URL (solo cambia el token del hash) navegan a URLs distintas de verdad', () => {
    // Bug real: navegar a la misma ruta con solo el fragmento distinto es "del mismo documento" para
    // Chromium (como un ancla) y no recarga la página — el documento revisado nunca se veía.
    const url = `lazunox-viewer://viewer/index.html#t=${'b'.repeat(64)}&kind=pdf&lang=es&theme=light`
    openDoc(url)
    openDoc(url)
    const [first, second] = state.loadedUrls.slice(-2)
    expect(first).not.toBe(second)
    expect(first.endsWith('#t=' + 'b'.repeat(64) + '&kind=pdf&lang=es&theme=light')).toBe(true)
    expect(second.endsWith('#t=' + 'b'.repeat(64) + '&kind=pdf&lang=es&theme=light')).toBe(true)
  })

  it('el "cache-bust" va ANTES del fragmento (query, no hash) para forzar la recarga', () => {
    openDoc('lazunox-viewer://viewer/index.html#t=abc')
    const loaded = state.loadedUrls.at(-1)!
    const [beforeHash] = loaded.split('#')
    expect(beforeHash).toMatch(/\?_r=\d+$/)
  })

  it('el PRIMER documento de la sesión se ve: attach() puede llegar antes de que exista la vista', () => {
    // Bug real: el renderer mide su hueco y llama a attach() apenas se monta, ANTES de que el primer
    // documento termine de generarse y openDoc() recién ahí cree la vista — sin este orden, attach()
    // no encontraba vista que posicionar y nunca se volvía a intentar: quedaba cargado pero invisible.
    closeView() // vuelve al estado "sin vista todavía" (como la primera vez que se abre un documento)
    const win = fakeWindow()
    attach(win, { x: 5, y: 6, width: 300, height: 400 }, true)
    expect(win._added).toEqual([]) // todavía no hay vista: attach() no tuvo nada que agregar
    openDoc(`lazunox-viewer://viewer/doc/${'c'.repeat(64)}`) // acá recién se crea la vista
    expect(win._added).toHaveLength(1) // se vuelve a aplicar el último hueco conocido al crearse
    expect(state.bounds).toEqual({ x: 5, y: 6, width: 300, height: 400 })
  })
})
