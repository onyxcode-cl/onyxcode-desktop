/**
 * Navegación unificada del celular: UNA cabecera y UNA lista por pantalla, y las pantallas de Code (Cambios/Archivos/«⋯»)
 * viven en la pila del armazón. Render estático con la superficie `remote` simulada (el módulo `lib/platform` la lee en cada llamada).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { useCode } from '../../features/code/impl/store'
import { CODE_ACTIONS, CODE_CHANGES, CODE_FILES, DETAIL_SCREEN, initialNav, useMobileNavStore } from './nav'
import { popScreen } from './MobileShell'
import { MobileShell } from './MobileShell'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length
const render = (): string => renderToStaticMarkup(createElement(MobileShell))

/**
 * `renderToStaticMarkup` lee `getInitialState()` de zustand (instantánea de servidor): para ver el estado de la prueba se
 * actualiza también ese objeto y se restaura al terminar.
 */
type AnyStore = { setState: (p: object) => void; getInitialState: () => object }
const originals = new Map<AnyStore, object>()
function seed(store: AnyStore, patch: object): void {
  if (!originals.has(store)) originals.set(store, { ...store.getInitialState() })
  store.setState(patch)
  Object.assign(store.getInitialState(), patch)
}
function restoreAll(): void {
  for (const [store, orig] of originals) {
    store.setState(orig)
    Object.assign(store.getInitialState(), orig)
  }
  originals.clear()
}
/** Pone la pila de Code en `screens` (el store de navegación se siembra entero). */
function codeStack(...screens: string[]): void {
  const base = initialNav('code')
  seed(useMobileNavStore as unknown as AnyStore, { tab: 'code', stacks: { ...base.stacks, code: ['root', ...screens] } })
}

const SESSION = { id: 'ses_1', title: 'Arreglar login', time: { created: 1, updated: 2 } }

beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
  codeStack()
  seed(useCode as unknown as AnyStore, {
    directory: '/Users/ana/proy',
    activeSessionID: null,
    sessions: { ses_1: SESSION as never },
    sessionProject: { ses_1: '/Users/ana/proy' }
  })
})
afterEach(() => {
  delete g.window
  restoreAll()
  useMobileNavStore.getState().reset()
})

describe('Code en el armazón del celular', () => {
  it('lista: una sola cabecera, una sola lista de sesiones y «+» en la barra única', () => {
    const html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
    expect(count(html, />Arreglar login</g)).toBe(1)
    expect(count(html, /<nav /g)).toBe(1) // barra inferior
  })

  it('conversación: una sola cabecera con Cambios, Archivos y «⋯» de 44 px; sin lista de sesiones ni segunda barra', () => {
    seed(useCode as unknown as AnyStore, { activeSessionID: 'ses_1' })
    codeStack(DETAIL_SCREEN)
    const html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
    expect(html).toContain('Cambios')
    expect(html).toContain('Archivos')
    expect(html).toContain('h-11 w-11')
    expect(html).not.toContain('Sesiones') // título de la lista de sesiones
    expect(html).not.toContain('data-code-panel')
    expect(html).not.toContain('<nav ') // en una pantalla apilada no hay barra inferior
  })

  it('Cambios y Archivos son pantallas de la pila con su propio título (siguen siendo UNA cabecera)', () => {
    seed(useCode as unknown as AnyStore, { activeSessionID: 'ses_1' })
    codeStack(DETAIL_SCREEN, CODE_CHANGES)
    let html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(html).toContain(`data-code-panel="${CODE_CHANGES}"`)
    codeStack(DETAIL_SCREEN, CODE_FILES)
    html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(html).toContain(`data-code-panel="${CODE_FILES}"`)
  })

  it('atrás: cierra Cambios, luego vuelve a la lista y suelta la sesión; el siguiente atrás no hace nada', () => {
    useCode.setState({ activeSessionID: 'ses_1' })
    const st = useMobileNavStore
    st.getState().push(DETAIL_SCREEN)
    st.getState().push(CODE_CHANGES)
    popScreen()
    expect(st.getState().stacks.code).toEqual(['root', 'detail'])
    expect(useCode.getState().activeSessionID).toBe('ses_1')
    popScreen()
    expect(st.getState().stacks.code).toEqual(['root'])
    expect(useCode.getState().activeSessionID).toBeNull()
    popScreen()
    expect(st.getState().stacks.code).toEqual(['root'])
  })

  it('el menú «⋯» es una pantalla de la pila y pasa al navegador sin dejar dos entradas', () => {
    const st = useMobileNavStore
    st.getState().push(DETAIL_SCREEN)
    st.getState().push(CODE_ACTIONS)
    st.getState().replace('code:browser')
    expect(st.getState().stacks.code).toEqual(['root', 'detail', 'code:browser'])
  })

  it('cambiar de pestaña conserva la pila de Code y la barra de pestañas no se pierde al volver', () => {
    const st = useMobileNavStore
    st.getState().push(DETAIL_SCREEN)
    st.getState().push(CODE_FILES)
    st.getState().setTab('chat')
    expect(st.getState().stacks.code).toEqual(['root', 'detail', 'code:files'])
    st.getState().setTab('code')
    expect(st.getState().tab).toBe('code')
  })

  it('cerrar el proyecto deja la pila de Code en la lista (resetTab)', () => {
    const st = useMobileNavStore
    st.getState().push(DETAIL_SCREEN)
    st.getState().push(CODE_CHANGES)
    st.getState().resetTab('code')
    expect(st.getState().stacks.code).toEqual(['root'])
  })

  it('sin carpeta abierta: «Proyectos» sin cabecera propia (una sola, la del armazón)', () => {
    seed(useCode as unknown as AnyStore, { directory: null })
    const html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
  })
})
