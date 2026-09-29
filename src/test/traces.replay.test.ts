/**
 * Reproduce las trazas sintéticas (`fixtures/traces`) sobre ambos stores y congela el estado final
 * recortado. Los snapshots documentan las diferencias actuales entre `useSessions` y `useCode`
 * (p. ej. dedupe por event.id, sesiones desconocidas) que la Fase 6 va a ir unificando.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, Part } from '@opencode-ai/sdk/v2/client'
import { chatSimple } from './fixtures/traces/chat-simple'
import { codeSubagent } from './fixtures/traces/code-subagent'
import { reconnect } from './fixtures/traces/reconnect'
import type { TraceEvent } from './fixtures/events'

vi.mock('../renderer/src/lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const traces: Record<string, { events: TraceEvent[]; directory: string }> = {
  'chat-simple': { events: chatSimple, directory: '/work/chat' },
  'code-subagent': { events: codeSubagent, directory: '/work/code' },
  reconnect: { events: reconnect, directory: '/work/reconnect' }
}

interface Entry {
  info: Message
  parts: Part[]
}

function trimPart(p: Part): Record<string, unknown> {
  switch (p.type) {
    case 'text':
    case 'reasoning':
      return { id: p.id, type: p.type, text: p.text, ended: 'time' in p && !!p.time?.end }
    case 'tool':
      return { id: p.id, type: 'tool', tool: p.tool, status: p.state.status }
    default:
      return { id: p.id, type: p.type }
  }
}

function trimMessages(messages: Record<string, Entry[]>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(messages).map(([sid, list]) => [
      sid,
      list.map((e) => ({ id: e.info.id, role: e.info.role, parts: e.parts.map(trimPart) }))
    ])
  )
}

beforeEach(() => {
  vi.resetModules()
})

describe.each(Object.keys(traces))('traza %s', (name) => {
  const { events, directory } = traces[name]

  it('useSessions (store genérico, sin origen)', async () => {
    const { useSessions } = await import('../renderer/src/stores/sessions')
    for (const { event } of events) useSessions.getState().applyEvent(event)
    const s = useSessions.getState()
    expect({
      sessions: Object.keys(s.sessions).sort(),
      status: s.status,
      errors: s.errors,
      messages: trimMessages(s.messages)
    }).toMatchSnapshot()
  })

  it('useCode (proyecto abierto = directorio de la traza)', async () => {
    const { useCode } = await import('../renderer/src/features/code/impl/store')
    useCode.setState({ directory })
    for (const { event, directory: dir } of events) useCode.getState().applyEvent(event, dir)
    const s = useCode.getState()
    expect({
      sessions: Object.keys(s.sessions).sort(),
      runState: s.runState,
      permissions: Object.keys(s.permissions),
      unread: s.unread,
      fsVersion: s.fsVersion,
      messages: trimMessages(s.messages)
    }).toMatchSnapshot()
  })

  it('tiene ids de evento incrementales y directorio', () => {
    for (const te of events) {
      expect(te.event.id).toMatch(/^evt_\d{4}$/)
      expect(te.directory).toBe(directory)
    }
  })
})
