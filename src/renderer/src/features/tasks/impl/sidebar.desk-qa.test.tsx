import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { tasksMode } from '../index'
import { TasksSearchBox } from './TasksSearchBox'

/** QA visual de la barra lateral de Overdrive (escritorio): un solo buscador, lista sin scroll propio, columnas y «⋯» de la fila activa. */
const list = readFileSync(join(__dirname, 'TaskList.tsx'), 'utf8')
const side = readFileSync(join(__dirname, 'TasksSidebar.tsx'), 'utf8')

describe('Overdrive en la barra lateral de escritorio (QA)', () => {
  it('un solo buscador: la caja «Buscar…» de la barra lateral busca las tareas (nombre accesible «Buscar tareas») y deja la paleta en el atajo', () => {
    expect(tasksMode.SidebarSearch).toBe(TasksSearchBox)
    const html = renderToStaticMarkup(createElement(TasksSearchBox, { openPalette: () => undefined, paletteHint: '⌘K' }))
    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="Buscar tareas"')
    expect(html).toContain('placeholder="Buscar…"')
    expect(html).toContain('aria-keyshortcuts="⌘K"')
    // La lista solo pinta su propia caja en el celular.
    expect(list).toContain('const ownSearch = isRemoteSurface()')
  })
  it('la lista no tiene scroll propio en escritorio (sin barra con dos tareas ni canal reservado)', () => {
    expect(list).toContain('min-h-0 flex-1 overflow-y-auto desk:overflow-visible')
  })
  it('el «⋯» de la fila activa queda a la vista y centrado; el título le deja sitio', () => {
    expect(list).toContain("${active ? ' desk:opacity-100' : ''}")
    expect(list).toContain('desk:absolute! desk:inset-y-0 desk:right-1 desk:flex desk:items-center')
    expect(list).toContain("active ? ' desk:pr-8'")
  })
  it('columnas como en Code: carpeta sin ícono (chevron + nombre) y el ícono de «Proyecto» en la columna del punto', () => {
    expect(side).toContain('desk:h-[30px] desk:gap-[5px] desk:pr-2 desk:pl-[5px] desk:text-ui')
    expect(readFileSync(join(__dirname, 'FolderMenu.tsx'), 'utf8')).toContain(
      'flex h-8 w-full items-center gap-2 rounded-ctl pr-2 pl-1.5 text-left text-sm font-medium text-fg'
    )
  })
})
