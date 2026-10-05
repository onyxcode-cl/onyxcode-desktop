import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { PageHeader } from '../components/PageHeader'
import { useUi } from '../stores/ui'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'

/** `renderToStaticMarkup` lee `getInitialState()` de zustand: se siembra también ese objeto y se restaura al terminar. */
const base = { ...useUi.getInitialState() }
function seed(patch: Partial<ReturnType<typeof useUi.getState>>): void {
  useUi.setState(patch)
  Object.assign(useUi.getInitialState(), patch)
}
const reset = (): void => {
  useUi.setState(base)
  Object.assign(useUi.getInitialState(), base)
}

const render = (): string => renderToStaticMarkup(createElement(Sidebar))

describe('barra lateral de escritorio', () => {
  afterEach(reset)

  it('el modo activo lleva aria-current y trazo único de 1.75', () => {
    seed({ mode: 'code', settingsOpen: false })
    const html = render()
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*>(<svg[^>]*>)/)
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
    const widths = [...nav.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1])
    expect(widths.length).toBeGreaterThanOrEqual(4)
    expect(new Set(widths)).toEqual(new Set(['1.75']))
  })

  it('con Ajustes abierto el modo conserva el icono de acento y pierde aria-current', () => {
    seed({ mode: 'code', settingsOpen: true })
    const html = render()
    expect(html).not.toContain('aria-current="page"')
    expect(html).toContain('text-accent')
  })

  it('barra 1b: «Nuevo» sin atajo en la fila (va en el tooltip) y la lista cae en la guía px-2 de 8 px', () => {
    seed({ mode: 'chat', settingsOpen: false })
    const html = render()
    expect(html).not.toMatch(/opacity-0[^"]*">⌘N|text-subtle opacity-0/)
    expect(html).toContain('title="Nueva conversación (⌘N)"')
    expect(html).not.toMatch(/<span[^>]*>⌘N<\/span>/)
    expect(html).toContain('flex min-h-0 flex-1 flex-col px-2')
    expect(html).toMatch(/overflow-y-auto pb-2 pt-4/)
    expect(html).toContain('grid grid-cols-2 gap-0.5')
    expect(html).not.toContain('border-t border-border"></div>')
  })
})

describe('paleta de comandos de escritorio', () => {
  afterEach(reset)

  it('velo propio, atajos como tecla y «Actual» como insignia', () => {
    seed({ paletteOpen: true, mode: 'chat' })
    const html = renderToStaticMarkup(createElement(CommandPalette))
    expect(html).toContain('bg-(--scrim)')
    expect(html).not.toContain('bg-black/40')
    expect(html).toMatch(/<kbd class="kbd shrink-0 border-0 bg-active text-muted">⌘N<\/kbd>/)
    expect(html).toMatch(/<span class="shrink-0 rounded-full bg-active[^"]*">Actual<\/span>/)
    expect(html).toMatch(/<kbd class="kbd border-0 bg-active text-muted">Esc<\/kbd> cerrar/)
    expect(html).not.toContain('uppercase')
  })
})

describe('cabecera de vista', () => {
  it('suma --header-inset solo con desk: y conserva las clases base', () => {
    const page = renderToStaticMarkup(createElement(PageHeader, { title: 'x' }))
    expect(page).toContain('px-6')
    expect(page).toContain('desk:pl-[calc(var(--header-inset,0px)+24px)]')
    const ws = renderToStaticMarkup(createElement(PageHeader, { title: 'x', variant: 'workspace' }))
    expect(ws).toContain('desk:pl-[calc(var(--header-inset,0px)+16px)]')
  })
})
