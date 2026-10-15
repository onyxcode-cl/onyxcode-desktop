import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { SidebarTree } from '../../../components/SidebarTreeRoot'

// Mismo stub del store que `sidebar.desk.render.test.tsx` (el real suscribe a useSessions al cargar).
vi.mock('./store', () => ({
  useTasks: Object.assign(() => undefined, { getState: () => ({}), setState: () => undefined, subscribe: () => () => undefined }),
  isPinned: () => false,
  syncActivity: () => undefined
}))

import { TaskRow } from './TaskList'
import type { TaskStatus } from './util'

const session = (title: string): Session => ({ id: 't1', title, time: { created: 0, updated: Date.now() } }) as unknown as Session
const row = (status: TaskStatus, active = false): string =>
  renderToStaticMarkup(
    <SidebarTree>
      <TaskRow
        task={session('Borra los temporales')}
        status={status}
        active={active}
        unseen={false}
        blockedHost={false}
        archivedView={false}
        group={null}
        knownGroups={[]}
      />
    </SidebarTree>
  )

describe('TaskRow dentro del árbol de la barra lateral (2c)', () => {
  it('esperando aprobación: treeitem de nivel 2, punto warning y «Aprobar» en texto visible (nunca solo color)', () => {
    const html = row('waiting')
    expect(html).toContain('role="treeitem"')
    expect(html).toContain('aria-level="2"')
    expect(html).toContain('aria-label="Borra los temporales · esperando tu aprobación o respuesta"')
    expect(html).toContain('data-state="waiting"')
    expect(html).toContain('bg-warning')
    expect(html).toMatch(/>Aprobar<\/span>|Aprobar/)
    expect(html).not.toContain('border-warning/45')
  })

  it('trabajando: punto de acento y «Trabajando» sin spinner; terminada: punto de éxito', () => {
    const w = row('running')
    expect(w).toContain('data-state="working"')
    expect(w).toContain('Trabajando')
    expect(w).not.toContain('before:animate-spin')
    expect(row('done')).toContain('data-state="done"')
  })

  it('la fila activa lleva aria-current="page", 30 px sin sangría (maqueta B) y fondo activo', () => {
    const html = row('idle', true)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('desk:min-h-[42px]')
    expect(html).not.toContain('desk:ml-[22px]')
    expect(html).toContain('bg-active desk:text-fg')
    expect(html).not.toContain('data-state=')
  })
})
