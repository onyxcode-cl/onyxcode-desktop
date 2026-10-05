/**
 * Armazón del celular: barra inferior con píldora activa, cabecera con filete al desplazar, safe area lateral, foco al título y
 * guardia del CSS propio. Render estático con la superficie `remote` simulada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useCode } from '../../features/code/impl/store'
import { useTasks } from '../../features/tasks/impl/store'
import { DETAIL_SCREEN, initialNav, useMobileNavStore } from './nav'
import { MobileShell } from './MobileShell'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length
const render = (): string => renderToStaticMarkup(createElement(MobileShell))

type AnyStore = { setState: (p: object) => void; getInitialState: () => object }
const originals = new Map<AnyStore, object>()
function seed(store: AnyStore, patch: object): void {
  if (!originals.has(store)) originals.set(store, { ...store.getInitialState() })
  store.setState(patch)
  Object.assign(store.getInitialState(), patch)
}
function nav(tab: 'chat' | 'code' | 'tasks' | 'routines', ...screens: string[]): void {
  const base = initialNav(tab)
  seed(useMobileNavStore as unknown as AnyStore, { tab, stacks: { ...base.stacks, [tab]: ['root', ...screens] } })
}

beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
  seed(useCode as unknown as AnyStore, { directory: '/Users/ana/proy', activeSessionID: null, sessions: {}, sessionProject: {} })
})
afterEach(() => {
  delete g.window
  for (const [store, orig] of originals) {
    store.setState(orig)
    Object.assign(store.getInitialState(), orig)
  }
  originals.clear()
  useMobileNavStore.getState().reset()
})

describe('barra inferior', () => {
  it('lleva data-tabbar y solo la pestaña activa tiene aria-current y la píldora con fondo', () => {
    nav('routines')
    const html = render()
    expect(html).toContain('data-tabbar=""')
    const bar = html.match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(count(bar, /aria-current="page"/g)).toBe(1)
    // Píldora 52×28 sobre bg-hover (rediseño F8-B102): solo la activa lleva fondo y el icono de acento.
    expect(count(bar, /bg-hover text-accent/g)).toBe(1)
    expect(count(bar, /h-\[var\(--m-pill-h\)\] w-\[var\(--m-pill-w\)\]/g)).toBe(4)
    expect(bar).toContain('bg-sidebar')
    expect(bar).not.toContain('border-t')
    const buttons = html.match(/<button[^>]*aria-current[^>]*>/g) ?? []
    expect(buttons[0]).toContain('min-h-[var(--m-tab-item)]')
  })
  it('cuatro pestañas de 52 px de alto (más el relleno de la barra de inicio)', () => {
    nav('chat')
    const nav_ = render().match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(count(nav_, /<button/g)).toBe(4)
    expect(count(nav_, /min-h-\[var\(--m-tab-item\)\]/g)).toBe(4)
    expect(nav_).toContain('max(12px, var(--sab, 0px))')
  })
})

describe('pestañas (rediseño PWA T0)', () => {
  it('la cuarta pestaña es Rutinas, ya no «Más»; Tareas usa ListChecks', () => {
    nav('chat')
    const bar = render().match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? ''
    const labels = [...bar.matchAll(/<span class="(?:font-semibold text-fg|text-muted)">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(labels).toHaveLength(4)
    expect(labels[3]).toBe('Rutinas')
    expect(labels).not.toContain('Más')
    expect(bar).toContain('lucide-list-checks')
    expect(bar).not.toContain('lucide-users')
    expect(bar).toContain('lucide-calendar-clock')
  })
  it('Ajustes y «Este celular» se resuelven apilados en cualquier pestaña (cabecera con atrás y sin barra inferior)', () => {
    for (const tab of ['chat', 'tasks', 'routines'] as const) {
      nav(tab, 'settings')
      const html = render()
      expect(html, tab).toContain('data-edge="detail"')
      expect(html, tab).not.toContain('data-tabbar')
      expect(html, tab).toContain(`data-screen="${tab}:2"`)
    }
    nav('tasks', 'phone')
    expect(render()).toContain('data-m="phone"')
  })
})

describe('cabecera y armazón', () => {
  it('raíz: título centrado de 17/24, menú a la izquierda, filete solo al desplazar y foco programable', () => {
    nav('routines')
    const html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
    expect(html).toContain('data-edge="root"')
    expect(html).toMatch(/<h1 tabindex="-1"/)
    expect(html).toContain('text-[17px] leading-6 font-semibold')
    expect(html).toContain('text-center')
    expect(html).toContain('aria-label="Abrir menú"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('text-[20px]')
  })
  it('pantalla apilada: filete fijo, sin barra inferior', () => {
    nav('routines', 'settings')
    const html = render()
    expect(html).toContain('data-edge="detail"')
    expect(html).not.toContain('data-tabbar')
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
  })
  it('el botón de menú mide 44 y el detalle lo cambia por el chevron de 22', () => {
    nav('routines')
    expect(render().match(/<button[^>]*data-drawer-trigger[^>]*>/)?.[0]).toContain('h-11 w-11')
    nav('routines', 'settings')
    const detail = render()
    expect(detail).not.toContain('data-drawer-trigger')
    expect(detail).toContain('aria-label="Atrás"')
    expect(detail).toContain('lucide-chevron-left')
    expect(detail).toContain('width="22"')
  })
  it('respeta la zona segura lateral (iPhone en horizontal)', () => {
    nav('routines')
    const html = render()
    expect(html).toContain('safe-area-inset-left')
    expect(html).toContain('safe-area-inset-right')
  })
  it('la conversación de Code sigue con una sola cabecera', () => {
    nav('code', DETAIL_SCREEN)
    seed(useCode as unknown as AnyStore, { activeSessionID: 'x' })
    expect(count(render(), /<h1/g)).toBe(1)
  })
})

describe('punto de aprobación de Tareas', () => {
  const dot = (html: string): string => html.match(/<span role="img"[^>]*>/)?.[0] ?? ''
  it('sin permisos pendientes no hay punto', () => {
    nav('chat')
    expect(render()).not.toContain('Aprobaciones pendientes')
  })
  it('con un permiso pendiente: punto de 8 px bg-warning con texto accesible', () => {
    nav('chat')
    seed(useTasks as unknown as AnyStore, { permissions: { p1: { id: 'p1' } } })
    const html = render()
    const d = dot(html)
    expect(d).toContain('aria-label="Aprobaciones pendientes"')
    expect(d).toContain('h-2 w-2')
    expect(d).toContain('bg-warning')
    // Cuelga del icono de Tareas, no de otra pestaña.
    const bar = html.match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? ''
    const tasksBtn = bar.split('<button').find((b) => b.includes('lucide-list-checks')) ?? ''
    expect(tasksBtn).toContain('Aprobaciones pendientes')
    expect(count(html, /Aprobaciones pendientes/g)).toBe(1)
  })
})

describe('panel abierto: el resto del armazón queda inert', () => {
  it('cerrado: sin panel ni inert', () => {
    nav('chat')
    const html = render()
    expect(html).not.toContain('data-drawer=""')
    expect(html).not.toContain('inert')
  })
  it('abierto: el contenedor y <main> son inert (el panel va aparte, fuera de ellos)', () => {
    nav('chat')
    useMobileNavStore.setState({ drawerOpen: true })
    Object.assign((useMobileNavStore as unknown as AnyStore).getInitialState(), { drawerOpen: true })
    const html = render()
    expect(html).toMatch(/<div class="[^"]*" inert="">/)
    expect(html).toMatch(/<main[^>]*inert=""/)
  })
})

describe('raíces de Chat y Tareas', () => {
  it('la raíz de Chat es Inicio (la vista), no la lista de conversaciones', () => {
    seed(useCode as unknown as AnyStore, { directory: null })
    nav('chat')
    const html = render()
    expect(html).toContain('data-screen="chat:1"')
    expect(html).not.toContain('data-m="chat-list"')
  })
})

describe('mobile-shell.css', () => {
  const css = readFileSync(join(__dirname, 'mobile-shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('todo selector cuelga de la superficie móvil', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((x) => x[1].trim())
    expect(selectors.length).toBeGreaterThan(5)
    for (const s of selectors) expect(s, s).toContain("[data-surface='mobile']")
  })
  it('dentro del panel las filas no se deslizan', () => {
    expect(css).toMatch(/\[data-in-drawer\] \[data-m='swipe-row'\] > div:last-child\s*\{\s*transform: none !important/)
  })
  it('oculta la barra inferior con el teclado abierto', () => {
    expect(css).toMatch(/html\[data-keyboard='open'\] \[data-surface='mobile'\] \[data-tabbar\]\s*\{\s*display: none/)
  })
  it('el filete de la raíz depende de data-scrolled', () => {
    expect(css).toContain("[data-surface='mobile'][data-scrolled] header[data-edge='root']")
  })
})
