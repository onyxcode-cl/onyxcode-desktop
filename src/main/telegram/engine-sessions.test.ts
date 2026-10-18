import { describe, expect, it } from 'vitest'
import { rulesetForMode } from '@shared/permission-rules'
import { CHAT_AGENT } from '@shared/types'
import { agentFor, isHiddenSession, permissionModeOf, toEngineMessage, toSessionInfo } from './engine-link'

const sess = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ses_1',
  title: 'Mi conversación',
  time: { created: 1, updated: 50 },
  ...over
})

describe('sesiones del motor (entrega 2)', () => {
  it('las subsesiones y las sesiones de Tareas nunca se ofrecen', () => {
    expect(isHiddenSession(sess({ parentID: 'ses_0' }))).toBe(true)
    expect(isHiddenSession(sess({ metadata: { mode: 'tasks' } }))).toBe(true)
    expect(isHiddenSession(sess({ metadata: { mode: 'chat' } }))).toBe(false)
    expect(toSessionInfo(sess({ metadata: { mode: 'tasks' } }), '/p', 'code', false)).toBeNull()
    expect(toSessionInfo(sess({ parentID: 'x' }), '/p', 'code', false)).toBeNull()
    expect(toSessionInfo(sess(), '/p', 'code', true)).toMatchObject({
      id: 'ses_1',
      title: 'Mi conversación',
      directory: '/p',
      kind: 'code',
      busy: true,
      updatedAt: 50
    })
  })

  it('reconoce el modo de permisos por el último bloque de reglas de la sesión', () => {
    for (const m of ['manual', 'acceptEdits', 'auto', 'bypass'] as const) {
      expect(permissionModeOf(rulesetForMode(m), 'build')).toBe(m)
      // el motor acumula: un bloque viejo debajo no cambia el resultado
      expect(permissionModeOf([...rulesetForMode('manual'), ...rulesetForMode(m)], 'build')).toBe(m)
    }
    expect(permissionModeOf(rulesetForMode('plan'), 'plan')).toBe('plan')
    expect(permissionModeOf(undefined, 'build')).toBe('unknown')
    expect(permissionModeOf([{ permission: 'bash', pattern: '*', action: 'allow' }], 'build')).toBe('unknown')
    expect(toSessionInfo(sess({ permission: rulesetForMode('bypass') }), '/p', 'code', false)?.mode).toBe('bypass')
    expect(toSessionInfo(sess({ permission: rulesetForMode('bypass') }), '/c', 'chat', false)?.mode).toBe('unknown')
  })

  it('agentFor: Chat usa su agente; Code solo plan o build', () => {
    expect(agentFor('chat', 'build')).toBe(CHAT_AGENT)
    expect(agentFor('code', 'plan')).toBe('plan')
    expect(agentFor('code', 'general')).toBe('build')
    expect(agentFor('code', null)).toBe('build')
  })

  it('toEngineMessage reduce un mensaje y descarta lo que no entiende', () => {
    const m = toEngineMessage({
      info: { id: 'msg_2', role: 'assistant', time: { created: 5, completed: 9 }, agent: 'build' },
      parts: [
        { id: 'p1', type: 'text', text: 'hola', time: { start: 1, end: 2 } },
        {
          id: 'p2',
          type: 'tool',
          tool: 'bash',
          callID: 'c',
          state: {
            status: 'completed',
            input: { command: 'ls' },
            output: 'a\nb',
            title: 'ls',
            time: { start: 3, end: 4 },
            metadata: { diff: 'D' }
          }
        },
        { id: 'p3', type: 'step-start' }
      ]
    })
    expect(m).toMatchObject({
      id: 'msg_2',
      role: 'assistant',
      completed: true,
      parts: [
        { type: 'text', text: 'hola' },
        { type: 'tool', tool: 'bash', state: { status: 'completed', output: 'a\nb', diff: 'D', start: 3, end: 4 } },
        { type: 'other' }
      ]
    })
    expect(toEngineMessage({ info: { id: 'x', role: 'system' } })).toBeNull()
    expect(toEngineMessage(null)).toBeNull()
  })
})
