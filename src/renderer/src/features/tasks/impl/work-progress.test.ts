import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../lib/session-reducer'
import { formatElapsed, workProgress } from './work-progress'

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

describe('formatElapsed', () => {
  it('formatea minutos y segundos', () => {
    expect(formatElapsed(8_000)).toBe('0:08')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})
