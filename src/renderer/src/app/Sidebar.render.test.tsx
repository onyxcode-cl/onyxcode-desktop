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

describe('barra lateral de escritorio (riel + lista, maqueta B)', () => {
  afterEach(reset)

  /** El riel es el primer `<aside>`; la lista, lo que sigue a `data-list` (si se dibuja). */
  const railOf = (html: string): string => html.slice(html.indexOf('<aside'), html.indexOf('</aside>'))
  const listOf = (html: string): string => html.slice(html.indexOf('data-list'))

  it('el riel lleva los cuatro modos como botones de ícono con nombre accesible; el activo lleva aria-current', () => {
    seed({ mode: 'code', settingsOpen: false })
    const rail = railOf(render())
    expect(rail).toContain('w-14')
    expect(rail.match(/<nav aria-label="Modo"[^>]*>/g)).toHaveLength(1)
    const nav = rail.slice(rail.indexOf('<nav aria-label="Modo"'), rail.indexOf('</nav>'))
    expect(nav.match(/<button/g)).toHaveLength(4)
    expect(nav.match(/<svg/g)).toHaveLength(4)
    for (const name of ['Chat', 'Code', 'Overdrive', 'Rutinas']) expect(nav).toContain(`aria-label="${name}"`)
    // Solo íconos: ningún nombre como texto visible dentro del riel.
    expect(nav).not.toMatch(/>(Chat|Code|Overdrive|Rutinas)</)
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1)
    expect(nav).toMatch(/aria-label="Code" aria-current="page"/)
    expect(nav).toContain('bg-active text-fg')
  })

  it('con Ajustes abierto el modo pierde aria-current y Ajustes queda pulsado', () => {
    seed({ mode: 'code', settingsOpen: true })
    const html = render()
    expect(html).not.toContain('aria-current="page"')
    expect(html).toMatch(/aria-label="Ajustes" aria-pressed="true"/)
  })

  it('el pie del riel trae Ayuda, Tema y Ajustes con nombre accesible', () => {
    seed({ mode: 'chat', settingsOpen: false })
    const rail = railOf(render())
    for (const name of ['Ayuda', 'Cambiar tema', 'Ajustes']) expect(rail).toContain(`aria-label="${name}"`)
  })

  it('la lista (maqueta B): «Nueva» primaria de acento suave, «Buscar…» con ⌘K, árbol y «● Conectado»; sin marca ni rótulo de sección', () => {
    seed({ mode: 'chat', settingsOpen: false })
    const html = render()
    const list = listOf(html)
    // La maqueta no lleva marca: el nombre de la app no se dibuja en la barra.
    expect(html).not.toContain('>Lazunox</span>')
    // El nombre anterior no puede aparecer (se arma en dos trozos para que esta guardia no lo encuentre en el propio archivo).
    expect(html).not.toMatch(new RegExp(['on', 'yx'].join(''), 'i'))
    // «Nueva»: atajo en aria-keyshortcuts y en el título (la maqueta no lo dibuja).
    expect(list).toMatch(
      /<button[^>]*title="Nueva conversación \(⌘N\)"[^>]*aria-keyshortcuts="⌘N"[^>]*bg-accent-soft[^>]*>.*?Nueva conversación<\/span><\/button>/
    )
    expect(list).toMatch(
      /aria-label="Buscar o ir a…"[^>]*rounded-\[9px\] border border-border[^>]*>.*?>Buscar…<\/span><span aria-hidden="true"[^>]*>⌘K<\/span>/
    )
    expect(list).not.toContain('Sin proyecto')
    expect(list).toContain('role="tree" aria-label="Proyectos y conversaciones"')
    expect(list).toContain('border-t border-border text-ui text-muted')
    expect(list).toContain('>Iniciando…</span>')
    // Ajustes, Ayuda y Tema viven en el riel, no en la lista.
    expect(list).not.toContain('aria-label="Ajustes"')
  })

  it('los filtros «Todas / Activas / Cambios» solo salen en Code, con aria-pressed y sin partirse en dos líneas', () => {
    seed({ mode: 'chat', settingsOpen: false })
    expect(render()).not.toContain('aria-label="Filtrar sesiones"')
    seed({ mode: 'code', settingsOpen: false })
    const html = render()
    expect(html).toContain('role="group" aria-label="Filtrar sesiones"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Todas<\/button>/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Activas<\/button>/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Cambios<\/button>/)
    expect(html).toContain('flex-nowrap')
    expect(html).toContain('whitespace-nowrap')
    // Nombre accesible propio: «Cambios» a secas lo tiene el botón del panel Cambios de Code.
    expect(html).toContain('aria-label="Filtrar: con cambios"')
    expect(html).not.toMatch(/aria-label="Cambios"/)
    seed({ mode: 'code', sessionFilter: 'review' })
    expect(render()).toMatch(/aria-pressed="true"[^>]*>Cambios<\/button>/)
  })

  it('en Code las acciones de proyecto (abrir carpeta, recientes) van discretas en la franja superior de la lista', () => {
    seed({ mode: 'code', settingsOpen: false })
    const head = listOf(render()).split('Nueva sesión')[0]
    expect(head).toContain('aria-label="Proyectos recientes"')
    expect(head).toMatch(/aria-label="Ocultar barra lateral/)
    expect(head).not.toContain('>Proyectos</span>')
  })

  it('plegada: solo el riel (sin lista), con «Mostrar», «Nueva» y «Buscar» en él', () => {
    seed({ mode: 'chat', settingsOpen: false, sidebarCollapsed: true })
    const html = render()
    expect(html).toContain('data-collapsed=""')
    expect(html).not.toContain('data-list')
    expect(html).not.toContain('>Lazunox<')
    expect(html).toContain('<nav aria-label="Modo"')
    for (const name of ['Mostrar barra lateral', 'Nueva conversación', 'Buscar o ir a…', 'Chat', 'Code', 'Ajustes']) {
      expect(html).toContain(`aria-label="${name}"`)
    }
    expect(html.match(/size-9/g)?.length).toBeGreaterThanOrEqual(8)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('Rutinas no tiene lista: solo el riel, sin botón «Mostrar» (no hay qué mostrar)', () => {
    seed({ mode: 'routines', settingsOpen: false })
    const html = render()
    expect(html).not.toContain('data-list')
    expect(html).not.toContain('aria-label="Mostrar barra lateral"')
    expect(html).toContain('aria-label="Buscar o ir a…"')
  })

  it('ventana angosta: la lista se pliega sola a riel y, abierta, va superpuesta', () => {
    seed({ mode: 'code', settingsOpen: false, narrow: true, narrowOpen: false })
    expect(render()).not.toContain('data-list')
    seed({ narrowOpen: true })
    const html = render()
    expect(html).toContain('data-list')
    expect(listOf(html)).toContain('absolute inset-y-0 left-14 z-30')
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
