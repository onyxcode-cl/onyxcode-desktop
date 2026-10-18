import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { SidebarTree } from '../../components/SidebarTreeRoot'
import { ChatSidebarRow } from './ChatSidebarRow'

const mk = (title: string, updated: number): Session => ({ id: 's1', title, time: { created: updated, updated } }) as unknown as Session

const row = (over: { active?: boolean; busy?: boolean; updated?: number; title?: string } = {}): string =>
  renderToStaticMarkup(
    createElement(
      SidebarTree,
      null,
      createElement(ChatSidebarRow, {
        session: mk(over.title ?? 'Receta de pan casero', over.updated ?? Date.now() - 5 * 60_000),
        active: over.active ?? false,
        busy: over.busy ?? false,
        onSelect: () => undefined,
        onRename: () => undefined,
        onDelete: () => undefined
      })
    )
  )

describe('ChatSidebarRow: fila de dos líneas de la barra lateral de escritorio', () => {
  it('en reposo: título, segunda línea «Terminado · hace 5 min», sin punto y con papelera y «⋯» ocultos hasta el ratón', () => {
    const html = row()
    expect(html).toContain('>Receta de pan casero</div>')
    expect(html).toMatch(/data-testid="chat-row-meta"[^>]*>Terminado · hace 5 min</)
    expect(html).not.toContain('data-state=')
    expect(html).toContain('hidden group-focus-within:flex group-hover:flex')
    expect(html).toContain('aria-label="Eliminar"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('role="treeitem"')
  })

  it('trabajando: punto de estado, «Trabajando» en acento y el estado en el nombre accesible', () => {
    const html = row({ busy: true })
    expect(html).toContain('data-state="working"')
    expect(html).toMatch(/text-accent"[^>]*data-testid="chat-row-meta"|data-testid="chat-row-meta"[^>]*text-accent/)
    expect(html).toContain('>Trabajando</div>')
    expect(html).toContain('aria-label="Receta de pan casero · trabajando"')
    expect(html).not.toContain('Terminado')
  })

  it('terminado: «Terminado · ayer» pasado un día', () => {
    expect(row({ updated: Date.now() - 30 * 3_600_000 })).toContain('Terminado · ayer')
  })

  it('abierta: resaltada, con aria-current="page" y las acciones siempre a la vista', () => {
    const html = row({ active: true })
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('bg-active')
    expect(html).not.toContain('hidden group-focus-within:flex')
  })

  it('título provisorio del motor («New session - 2026-10-18T13:40:00.000Z»): se muestra «Nueva conversación»', () => {
    for (const title of ['New session - 2026-10-18T13:40:00.000Z', 'new session - 2026-10-18T13:40:12.345Z', '']) {
      const html = row({ title })
      expect(html).toContain('>Nueva conversación</div>')
      expect(html).not.toContain('New session')
    }
    // Un título real que menciona «new session» no se toca.
    expect(row({ title: 'New session ideas' })).toContain('>New session ideas</div>')
  })
})
