/** F8-B89: una tarea nunca sale dos veces en la barra lateral (En curso / En otras carpetas). */
import { describe, expect, it } from 'vitest'
import type { TasksTaskActivity } from '@shared/ipc-tasks'
import { activeElsewhere, splitInProgress } from './SidebarSections'
import type { TaskStatus } from './util'

const act = (sessionId: string, folder: string): TasksTaskActivity => ({
  sessionId,
  folder,
  fullAccess: false,
  title: sessionId,
  state: 'running',
  since: 1
})

describe('activeElsewhere', () => {
  const all = [act('a', '/p/uno'), act('b', '/p/dos'), act('c', '/p/uno/')]
  it('deja solo las de otras carpetas (ignora la barra final)', () => {
    expect(activeElsewhere(all, '/p/uno').map((t) => t.sessionId)).toEqual(['b'])
  })
  it('sin carpeta abierta, todas son de otras carpetas', () => {
    expect(activeElsewhere(all, null)).toHaveLength(3)
  })
})

describe('splitInProgress', () => {
  const status: Record<string, TaskStatus> = {
    d1: 'done',
    r1: 'running',
    w1: 'waiting',
    q1: 'question',
    r2: 'running',
    e1: 'error',
    i1: 'interrupted'
  }
  const ids = Object.keys(status)
  it('no duplica ni pierde ninguna tarea', () => {
    const { live, rest } = splitInProgress(ids, (i) => status[i])
    expect([...live, ...rest].sort()).toEqual([...ids].sort())
    expect(live.filter((i) => rest.includes(i))).toEqual([])
  })
  it('ordena por urgencia y respeta el orden dentro del mismo rango', () => {
    expect(splitInProgress(ids, (i) => status[i]).live).toEqual(['q1', 'w1', 'i1', 'r1', 'r2'])
    expect(splitInProgress(ids, (i) => status[i]).rest).toEqual(['d1', 'e1'])
  })
  it('con todo «done» no hay grupo en curso', () => {
    expect(splitInProgress(ids, () => 'done').live).toEqual([])
  })
})
