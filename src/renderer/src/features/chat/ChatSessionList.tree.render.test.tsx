import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { SidebarTree } from '../../components/SidebarTreeRoot'
import { ChatSessionList } from './ChatSessionList'

const mk = (id: string, title: string): Session => ({ id, title, time: { created: Date.now(), updated: Date.now() } }) as unknown as Session

describe('ChatSessionList dentro del árbol de la barra lateral (2c)', () => {
  const html = renderToStaticMarkup(
    createElement(
      SidebarTree,
      null,
      createElement(ChatSessionList, {
        sessions: [mk('a', 'Receta de pan casero'), mk('b', 'Plan de viaje')],
        activeId: 'a',
        busyIds: new Set(['b']),
        onSelect: () => undefined,
        onRename: () => undefined,
        onDelete: () => undefined,
        showTime: true
      })
    )
  )

  it('cada conversación es un treeitem sin proyecto (nivel 1); la activa lleva aria-current="page"', () => {
    expect(html.match(/role="treeitem"/g)).toHaveLength(2)
    expect(html.match(/aria-level="1"/g)).toHaveLength(2)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('role="group"')
  })

  it('la ocupada lleva punto de acento, «Trabajando» y el estado en su nombre accesible', () => {
    expect(html).toContain('data-state="working"')
    expect(html).toContain('aria-label="Plan de viaje · trabajando"')
    expect(html).toContain('>Trabajando</span>')
  })
})
