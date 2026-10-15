import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../lib/session-reducer'
import { MAX_PARTIAL, formatElapsed, partialProgress, turnTodos, workProgress } from './work-progress'

const user = (created: number): MessageEntry => ({ info: { id: 'u', role: 'user', time: { created } } as never, parts: [] })
const tool = (name: string, status: string, input: object = {}): never =>
  ({ id: name + status, type: 'tool', tool: name, state: { status, input } }) as never

describe('workProgress', () => {
  it('toma la herramienta en curso, el avance del último plan y el inicio del turno', () => {
    const entries: MessageEntry[] = [
      user(1000),
      {
        info: { id: 'a', role: 'assistant', time: { created: 1100 } } as never,
        parts: [
          tool('todowrite', 'completed', {
            todos: [
              { content: 'a', status: 'completed' },
              { content: 'b', status: 'in_progress' },
              { content: 'c', status: 'pending' }
            ]
          }),
          tool('bash', 'completed'),
          tool('write', 'running')
        ]
      }
    ]
    const w = workProgress(entries)
    expect(w.tool?.tool).toBe('write')
    expect(w.total).toBe(3)
    expect(w.done).toBe(1)
    expect(w.startedAt).toBe(1000)
  })
  it('sin plan ni herramientas: pensando', () => {
    const w = workProgress([user(5)])
    expect(w).toMatchObject({ tool: null, total: 0, done: 0, startedAt: 5 })
  })
})

const asst = (parts: unknown[]): MessageEntry => ({ info: { id: 'a' + Math.random(), role: 'assistant', time: { created: 1 } } as never, parts: parts as never })
const plan = (...st: Array<'completed' | 'in_progress' | 'pending'>): never =>
  tool('todowrite', 'completed', { todos: st.map((status, i) => ({ content: 'p' + i, status })) })

describe('workProgress por turno', () => {
  it('turno nuevo sin plan: ignora el plan completo del turno anterior', () => {
    const entries = [user(1), asst([plan('completed', 'completed', 'completed')]), user(500)]
    const w = workProgress(entries)
    expect(w).toMatchObject({ total: 0, done: 0, steps: [], currentIdx: -1, partial: 0, startedAt: 500 })
    expect(turnTodos(entries)).toBeNull()
  })
  it('plan viejo ignorado aunque haya herramientas nuevas', () => {
    const w = workProgress([user(1), asst([plan('completed')]), user(9), asst([tool('read', 'completed', { filePath: '/x/a.csv' })])])
    expect(w.total).toBe(0)
    expect(w.toolCount).toBe(1)
  })
  it('con plan, in_progress y herramientas: avance parcial solo por herramientas posteriores', () => {
    const w = workProgress([
      user(1),
      asst([plan('completed', 'in_progress', 'pending'), tool('read', 'completed'), tool('read', 'completed'), tool('read', 'running', { filePath: '/x/ventas.csv' })])
    ])
    expect(w).toMatchObject({ total: 3, done: 1, currentIdx: 1, toolCount: 3, activity: 'read', target: 'ventas.csv' })
    expect(w.partial).toBeCloseTo(partialProgress(2))
    expect(w.partial).toBeGreaterThan(0)
  })
  it('un plan nuevo reinicia el avance parcial', () => {
    const w = workProgress([user(1), asst([plan('in_progress'), tool('read', 'completed'), plan('completed', 'in_progress')])])
    expect(w.partial).toBe(0)
    expect(w.done).toBe(1)
  })
  it('sin plan con herramientas: contadores y fase', () => {
    const gather = workProgress([user(1), asst([tool('read', 'completed'), tool('glob', 'running')])])
    expect(gather).toMatchObject({ total: 0, toolCount: 2, phase: 'gather' })
    const create = workProgress([user(1), asst([tool('read', 'completed'), tool('write', 'running', { filePath: '/x/informe.md' })])])
    expect(create).toMatchObject({ phase: 'create', activity: 'write', target: 'informe.md' })
    const review = workProgress([user(1), asst([tool('write', 'completed'), tool('read', 'running', { filePath: '/x/informe.md' })])])
    expect(review).toMatchObject({ phase: 'review', activity: 'verify', target: '' })
  })
  it('bash que genera archivos escribe y bash de verificación verifica', () => {
    const gen = workProgress([user(1), asst([tool('bash', 'running', { command: 'python3 build_xlsx.py informe_ventas.xlsx' })])])
    expect(gen).toMatchObject({ activity: 'write', target: 'informe_ventas.xlsx' })
    const chk = workProgress([user(1), asst([tool('bash', 'running', { command: 'python3 recalc_check.py a.xlsx' })])])
    expect(chk.activity).toBe('verify')
    expect(workProgress([user(1), asst([tool('websearch', 'running')])]).activity).toBe('web')
  })
  it('topes: el parcial nunca llega al 80 % ni se completa solo', () => {
    expect(partialProgress(0)).toBe(0)
    expect(partialProgress(1000)).toBeLessThanOrEqual(MAX_PARTIAL)
    expect(partialProgress(2) - partialProgress(1)).toBeGreaterThan(partialProgress(9) - partialProgress(8))
    const many = Array.from({ length: 40 }, () => tool('read', 'completed'))
    expect(workProgress([user(1), asst([plan('in_progress', 'pending'), ...many])]).partial).toBeLessThanOrEqual(MAX_PARTIAL)
  })
})

describe('formatElapsed', () => {
  it('formatea minutos y segundos', () => {
    expect(formatElapsed(8_000)).toBe('0:08')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})
