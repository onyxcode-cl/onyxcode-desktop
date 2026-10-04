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
function nav(tab: 'chat' | 'code' | 'tasks' | 'more', ...screens: string[]): void {
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
    nav('more')
    const html = render()
    expect(html).toContain('data-tabbar=""')
    const bar = html.match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(count(bar, /aria-current="page"/g)).toBe(1)
    expect(count(bar, /bg-accent-soft text-accent/g)).toBe(1)
    const buttons = html.match(/<button[^>]*aria-current[^>]*>/g) ?? []
    expect(buttons[0]).toContain('min-h-14')
  })
  it('cuatro pestañas de al menos 56 px', () => {
    nav('chat')
    const nav_ = render().match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(count(nav_, /<button/g)).toBe(4)
    expect(count(nav_, /min-h-14/g)).toBe(4)
  })
})

describe('cabecera y armazón', () => {
  it('lista raíz: título grande, filete solo al desplazar y foco programable', () => {
    nav('more')
    const html = render()
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
    expect(html).toContain('data-edge="root"')
    expect(html).toMatch(/<h1 tabindex="-1"/)
    expect(html).toContain('text-[20px]')
  })
  it('pantalla apilada: filete fijo, sin barra inferior', () => {
    nav('more', 'settings')
    const html = render()
    expect(html).toContain('data-edge="detail"')
    expect(html).not.toContain('data-tabbar')
    expect(count(html, /<header/g)).toBe(1)
    expect(count(html, /<h1/g)).toBe(1)
  })
  it('respeta la zona segura lateral (iPhone en horizontal)', () => {
    nav('more')
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

describe('mobile-shell.css', () => {
  const css = readFileSync(join(__dirname, 'mobile-shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('todo selector cuelga de la superficie móvil', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((x) => x[1].trim())
    expect(selectors.length).toBeGreaterThan(5)
    for (const s of selectors) expect(s, s).toContain("[data-surface='mobile']")
  })
  it('oculta la barra inferior con el teclado abierto', () => {
    expect(css).toMatch(/html\[data-keyboard='open'\] \[data-surface='mobile'\] \[data-tabbar\]\s*\{\s*display: none/)
  })
  it('el filete de la raíz depende de data-scrolled', () => {
    expect(css).toContain("[data-surface='mobile'][data-scrolled] header[data-edge='root']")
  })
})
