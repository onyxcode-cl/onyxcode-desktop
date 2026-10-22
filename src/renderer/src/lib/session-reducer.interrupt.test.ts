/** Partes de herramienta «en curso» fantasma: se marcan interrumpidas cuando se SABE que la sesión está ociosa. */
import { describe, expect, it } from 'vitest'
import {
  createBuffers,
  interruptRunningParts,
  interruptSettledSessions,
  reduceEvent,
  type ConvSlice,
  type MessageEntry
} from './session-reducer'

type Ev = Parameters<typeof reduceEvent>[1]
const open = { accept: () => true, dedupe: false }

const tool = (id: string, status: 'running' | 'pending' | 'completed', tool = 'bash') =>
  ({
    id,
    sessionID: 's1',
    messageID: 'm1',
    type: 'tool',
    callID: `c-${id}`,
    tool,
    state:
      status === 'completed'
        ? { status, input: {}, output: 'ok', title: 't', metadata: {}, time: { start: 1, end: 2 } }
        : status === 'running'
          ? { status, input: { command: 'sleep 99' }, time: { start: 5 } }
          : { status, input: {}, raw: '' }
  }) as never

const entry = (parts: unknown[]): MessageEntry => ({
  info: { id: 'm1', role: 'assistant', sessionID: 's1' } as never,
  parts: parts as never
})
const slice = (status: ConvSlice['status'], parts: unknown[]): ConvSlice => ({
  messages: { s1: [entry(parts)] },
  status,
  errors: {},
  sessions: {}
})
const stateOf = (e: MessageEntry | undefined, i: number): { status: string; error?: string } =>
  (e?.parts[i] as unknown as { state: { status: string; error?: string } }).state

describe('interruptRunningParts', () => {
  it('pasa running y pending a error con texto de interrumpida y conserva las demás', () => {
    const out = interruptRunningParts([entry([tool('a', 'running'), tool('b', 'pending'), tool('c', 'completed')])])
    expect(stateOf(out?.[0], 0)).toMatchObject({ status: 'error' })
    expect(stateOf(out?.[0], 0).error).toMatch(/nterrump/)
    expect(stateOf(out?.[0], 1).status).toBe('error')
    expect(stateOf(out?.[0], 2).status).toBe('completed')
  })
  it('devuelve la misma referencia si no hay nada en curso', () => {
    const list = [entry([tool('c', 'completed')])]
    expect(interruptRunningParts(list)).toBe(list)
    expect(interruptRunningParts(undefined)).toBeUndefined()
  })
})

describe('interruptSettledSessions', () => {
  const messages = { s1: [entry([tool('a', 'running')])], s2: [entry([tool('b', 'running')])] }
  it('solo toca las sesiones que pasaron de ocupadas a ociosas', () => {
    const out = interruptSettledSessions({ s1: 'busy', s2: 'busy' }, { s1: 'idle', s2: 'busy' }, messages)
    expect(stateOf(out?.s1[0], 0).status).toBe('error')
    expect(out?.s2).toBe(messages.s2)
  })
  it('no toca una sesión sin estado previo ni una que ya estaba ociosa', () => {
    expect(interruptSettledSessions({}, { s1: 'idle' }, messages)).toBeNull()
    expect(interruptSettledSessions({ s1: 'idle' }, { s1: 'idle' }, messages)).toBeNull()
  })
})

describe('reduceEvent: fin de turno con partes fantasma', () => {
  it('session.idle tras busy marca la parte en curso como interrumpida', () => {
    const ev = { type: 'session.idle', properties: { sessionID: 's1' } } as unknown as Ev
    const { slice: out } = reduceEvent(slice({ s1: 'busy' }, [tool('a', 'running')]), ev, createBuffers(), open)
    expect(stateOf(out.messages.s1[0], 0).status).toBe('error')
  })
  it('session.status idle tras busy también', () => {
    const ev = { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } } as unknown as Ev
    const { slice: out } = reduceEvent(slice({ s1: 'busy' }, [tool('a', 'running')]), ev, createBuffers(), open)
    expect(stateOf(out.messages.s1[0], 0).status).toBe('error')
  })
  it('una sesión ocupada conserva sus partes en curso', () => {
    const ev = { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } } as unknown as Ev
    const { slice: out } = reduceEvent(slice({ s1: 'idle' }, [tool('a', 'running')]), ev, createBuffers(), open)
    expect(stateOf(out.messages.s1[0], 0).status).toBe('running')
  })
})
