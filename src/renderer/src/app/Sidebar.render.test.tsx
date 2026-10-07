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

describe('barra lateral de escritorio (2c)', () => {
  afterEach(reset)

  it('el modo activo lleva aria-current en un segmentado de solo texto', () => {
    seed({ mode: 'code', settingsOpen: false })
    const html = render()
    expect(html.match(/<nav aria-label="Modo"[^>]*>/g)).toHaveLength(1)
    const nav = html.slice(html.indexOf('<nav aria-label="Modo"'), html.indexOf('</nav>'))
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1)
    expect(nav).toMatch(/aria-current="page"[^>]*>(<span class="truncate">Code<\/span>)/)
    expect(nav).not.toContain('<svg')
    expect(nav).toContain('rounded-[10px] bg-hover p-[3px]')
  })

  it('con Ajustes abierto el modo conserva el texto fuerte y pierde aria-current', () => {
    seed({ mode: 'code', settingsOpen: true })
    const html = render()
    expect(html).not.toContain('aria-current="page"')
    expect(html).toMatch(/font-medium text-fg"><span class="truncate">Code/)
  })

  it('estructura: marca con el nombre de la app, «Nueva» con su atajo, buscador, árbol y pie de tres botones', () => {
    seed({ mode: 'chat', settingsOpen: false })
    const html = render()
    expect(html).toContain('>Lazunox</span>')
    // El nombre anterior no puede aparecer (se arma en dos trozos para que esta guardia no lo encuentre en el propio archivo).
    expect(html).not.toMatch(new RegExp(['on', 'yx'].join(''), 'i'))
    // «Nueva conversación»: el nombre accesible sigue siendo el texto (el atajo es decorativo y va en aria-keyshortcuts).
    expect(html).toMatch(/<button[^>]*aria-keyshortcuts="[^"]+"[^>]*>.*?Nueva conversación<\/span><span aria-hidden="true"[^>]*>⌘N<\/span>/)
    expect(html).not.toContain('title="Nueva conversación (⌘N)"')
    // Buscador como campo sobre la «tarjeta», con ⌘K.
    expect(html).toMatch(/class="[^"]*sb-card[^"]*shadow-\[inset_0_0_0_1px_var\(--border\)\][^"]*"/)
    expect(html).toMatch(/>⌘K<\/span>/)
    // Rótulo de sección y árbol.
    expect(html).toContain('Sin proyecto')
    expect(html).toContain('role="tree" aria-label="Proyectos y conversaciones"')
    expect(html).toContain('overflow-y-auto px-2 pt-5 pb-2')
    // Pie: Ajustes · Ayuda · Tema y el estado de la conexión.
    for (const name of ['Ajustes (⌘,)', 'Ayuda', 'Cambiar tema']) expect(html).toContain(`aria-label="${name}"`)
    expect(html).not.toContain('border-t border-border"></div>')
  })

  it('en Code y Tareas el rótulo es «Proyectos» y lleva la acción de abrir carpeta', () => {
    seed({ mode: 'code', settingsOpen: false })
    const html = render()
    expect(html).toContain('>Proyectos</span>')
    expect(html).not.toContain('Sin proyecto')
  })

  it('colapsada: 56 px, botones de 36 px con nombre accesible y el mismo nav «Modo»', () => {
    seed({ mode: 'chat', settingsOpen: false, sidebarCollapsed: true })
    const html = render()
    expect(html).toContain('data-collapsed=""')
    expect(html).toContain('w-14')
    expect(html).not.toContain('>Lazunox<')
    expect(html).toContain('<nav aria-label="Modo"')
    for (const name of ['Mostrar barra lateral', 'Nueva conversación', 'Buscar o ir a…', 'Chat', 'Code', 'Ajustes']) {
      expect(html).toContain(`aria-label="${name}"`)
    }
    expect(html.match(/size-9/g)?.length).toBeGreaterThanOrEqual(8)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
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
