/** Aviso de aprobaciones de Inicio (celular): sin permisos no pinta nada; con ellos, texto, título de la tarea y alto mínimo de 56. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const state = vi.hoisted(() => ({
  permissions: {} as Record<string, { id: string; sessionID: string }>,
  sessions: {} as Record<string, { id: string; title?: string; parentID?: string }>
}))
vi.mock('../../features/tasks/impl/store', () => ({
  useTasks: (sel: (s: typeof state) => unknown) => sel(state),
  rootTaskId: (id: string) => state.sessions[id]?.parentID ?? id
}))
vi.mock('../../stores/sessions', () => ({ useSessions: (sel: (s: typeof state) => unknown) => sel(state) }))

import { ApprovalNotice } from './ApprovalNotice'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
  state.permissions = {}
  state.sessions = {}
})
afterEach(() => {
  delete g.window
})

describe('ApprovalNotice', () => {
  it('sin permisos pendientes no pinta nada', () => {
    expect(renderToStaticMarkup(<ApprovalNotice />)).toBe('')
  })
  it('con permisos: texto en singular, título de la tarea, botón de 56 px como mínimo y sin color como único aviso', () => {
    state.permissions = { p1: { id: 'p1', sessionID: 'child' } }
    state.sessions = { root: { id: 'root', title: 'Borra los temporales' }, child: { id: 'child', parentID: 'root' } }
    const h = renderToStaticMarkup(<ApprovalNotice />)
    expect(h).toContain('<button')
    expect(h).toContain('min-h-14')
    expect(h).toContain('1 tarea espera tu aprobación')
    expect(h).toContain('Borra los temporales')
    expect(h).toContain('title="Revisar aprobaciones pendientes"')
    expect(h).toContain('border-warning/45')
    expect(h).toContain('bg-warning/10')
  })
  it('cuenta tareas raíz distintas (dos permisos de la misma tarea son una)', () => {
    state.permissions = { p1: { id: 'p1', sessionID: 'a' }, p2: { id: 'p2', sessionID: 'a' }, p3: { id: 'p3', sessionID: 'b' } }
    expect(renderToStaticMarkup(<ApprovalNotice />)).toContain('2 tareas esperan tu aprobación')
  })
})
