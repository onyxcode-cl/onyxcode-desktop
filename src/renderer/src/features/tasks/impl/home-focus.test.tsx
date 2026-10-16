import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { stripDesk } from '../../../../../test/strip-desk'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

// El inicio lee de `useHomeFocus` (estado en vivo); aquí se fija a mano. Zustand en render de servidor da siempre el estado inicial.
const hook = vi.hoisted(() => ({ focus: null as unknown }))
vi.mock('./useHomeFocus', () => ({ useHomeFocus: () => hook.focus }))

import { Home } from './Home'
import { HOME_RECENT_MAX, HOME_WAITING_MAX, pickHomeFocus, type HomeFocus } from './home-focus'
import { ResumeBlock, WaitingCard } from './HomeFocus'
import type { TaskStatus } from './util'

const NOW = Date.now()
const task = (id: string, title: string, minAgo: number): Session =>
  ({ id, title, directory: '/d', time: { created: 0, updated: NOW - minAgo * 60_000 } }) as unknown as Session
const statuses = (m: Record<string, TaskStatus>) => (t: Session) => m[t.id] ?? 'done'
const EMPTY: HomeFocus = { waiting: [], waitingTotal: 0, recent: [], hasTasks: false }

afterEach(() => {
  hook.focus = null
})

describe('pickHomeFocus', () => {
  it('sin tareas (p. ej. sin carpeta) todo sale vacío', () => {
    expect(pickHomeFocus([], statuses({}))).toEqual(EMPTY)
  })

  it('separa las que esperan y las recientes, sin repetir ninguna', () => {
    const tasks = [task('a', 'A', 5), task('b', 'B', 1), task('c', 'C', 3)]
    const f = pickHomeFocus(tasks, statuses({ a: 'waiting', b: 'done', c: 'running' }))
    expect(f.waiting.map((i) => i.task.id)).toEqual(['a'])
    expect(f.recent.map((i) => i.task.id)).toEqual(['b', 'c'])
    expect(f.hasTasks).toBe(true)
  })

  it('las que esperan van por urgencia (pregunta, aprobación, plan) y topadas a 3; las recientes a 5 por fecha', () => {
    const tasks = [
      task('p', 'Plan', 1),
      task('w1', 'Aprob. vieja', 30),
      task('q', 'Pregunta', 20),
      task('w2', 'Aprob. nueva', 2),
      ...Array.from({ length: 8 }, (_, i) => task(`d${i}`, `Hecha ${i}`, 10 + i))
    ]
    const st: Record<string, TaskStatus> = { p: 'plan_ready', w1: 'waiting', q: 'question', w2: 'waiting' }
    const f = pickHomeFocus(tasks, statuses(st))
    expect(f.waiting.map((i) => i.task.id)).toEqual(['q', 'w2', 'w1'])
    expect(f.waiting.length).toBe(HOME_WAITING_MAX)
    expect(f.waitingTotal).toBe(4)
    expect(f.recent.length).toBe(HOME_RECENT_MAX)
    expect(f.recent.map((i) => i.task.id)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4'])
  })

  it('las nuevas sin mensajes y las archivadas no se ofrecen para retomar, pero cuentan como «hay tareas»', () => {
    const f = pickHomeFocus([task('n', 'Nueva', 1)], statuses({ n: 'idle' }))
    expect(f.recent).toEqual([])
    expect(f.hasTasks).toBe(true)
  })
})

describe('bloques del inicio', () => {
  it('esperando aprobación: título, segunda línea de estado y botón «Abrir» por tarea', () => {
    const f = pickHomeFocus(
      [task('a', 'Ordena las facturas', 4), task('b', 'Resume el informe', 9)],
      statuses({ a: 'waiting', b: 'question' })
    )
    const html = stripDesk(renderToStaticMarkup(<WaitingCard focus={f} />))
    expect(html).toContain('Esperando tu aprobación')
    expect(html).toContain('Ordena las facturas')
    expect(html).toContain('Resume el informe')
    expect(html).toContain('Esperando tu respuesta')
    expect(html.match(/>Abrir</g)).toHaveLength(2)
    expect(html).toContain('aria-label="Abrir la tarea «Ordena las facturas»"')
    expect(html).not.toContain('text-[11px]')
  })

  it('más de tres esperando: avisa de las que faltan', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e'].map((id, i) => task(id, id, i))
    const html = renderToStaticMarkup(<WaitingCard focus={pickHomeFocus(tasks, () => 'waiting')} />)
    expect(html.match(/>Abrir</g)).toHaveLength(3)
    expect(html).toContain('y 2 más esperando')
  })

  it('sin tareas esperando no pinta nada (ni bloque vacío)', () => {
    expect(renderToStaticMarkup(<WaitingCard focus={EMPTY} />)).toBe('')
    expect(renderToStaticMarkup(<ResumeBlock focus={EMPTY} />)).toBe('')
  })

  it('Retomar: «Terminado · hace X» o «Trabajando», en el orden de más reciente', () => {
    const tasks = [task('a', 'Vieja', 120), task('b', 'En marcha', 1), task('c', 'Reciente', 7)]
    const f = pickHomeFocus(tasks, statuses({ a: 'done', b: 'running', c: 'done' }))
    const html = renderToStaticMarkup(<ResumeBlock focus={f} />)
    expect(html).toContain('Retomar')
    expect(html).toContain('Terminado · hace 7 min')
    expect(html).toContain('Terminado · hace 2 h')
    expect(html).toContain('>Trabajando<')
    expect(html.indexOf('En marcha')).toBeLessThan(html.indexOf('Reciente'))
    expect(html.indexOf('Reciente')).toBeLessThan(html.indexOf('Vieja'))
  })
})

describe('Home con tareas', () => {
  const render = (): string => renderToStaticMarkup(<Home onSend={async () => undefined} sendError={null} folderBusy={false} />)

  it('con tareas esperando: la tarjeta va antes del compositor y las sugerencias salen plegadas', () => {
    hook.focus = pickHomeFocus(
      [task('a', 'Ordena las facturas', 4), task('b', 'Termina el informe', 30)],
      statuses({ a: 'waiting', b: 'done' })
    )
    const html = render()
    expect(html.indexOf('Esperando tu aprobación')).toBeGreaterThan(-1)
    expect(html.indexOf('Esperando tu aprobación')).toBeLessThan(html.indexOf('<textarea'))
    expect(html.indexOf('Retomar')).toBeGreaterThan(html.indexOf('<textarea'))
    expect(html).toContain('Sugerencias para empezar')
    expect(html).toContain('Mostrar sugerencias')
    expect(html).not.toContain('aria-label="Categorías de sugerencias"')
  })

  it('sin nada (primera vez): ni tarjeta ni «Retomar» y las sugerencias visibles', () => {
    hook.focus = EMPTY
    const html = render()
    expect(html).not.toContain('Esperando tu aprobación')
    expect(html).not.toContain('Retomar')
    expect(html).not.toContain('No hay')
    expect(html).toContain('Ocultar sugerencias')
    expect(html).toContain('aria-label="Categorías de sugerencias"')
  })
})
