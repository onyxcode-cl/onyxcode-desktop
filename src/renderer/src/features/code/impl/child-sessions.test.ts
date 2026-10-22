import { describe, expect, it } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import {
  backgroundBusyRoots,
  effectiveRun,
  isChildRequest,
  liveBackgroundChildIds,
  rootOf,
  subagentNameOf,
  withBackgroundBusy
} from './child-sessions'

const NOW = Date.now()
const sess = (id: string, parentID?: string, title = id): never =>
  ({ id, parentID, title, time: { created: NOW - 60_000, updated: NOW - 1000 } }) as never
const taskPart = (child: string, over: { background?: boolean; description?: string; agent?: string } = {}): Part =>
  ({
    id: `prt_${child}`,
    sessionID: 'root',
    messageID: 'm1',
    type: 'tool',
    callID: `call_${child}`,
    tool: 'task',
    state: {
      status: 'completed',
      input: { description: over.description ?? '', subagent_type: over.agent ?? '' },
      metadata: { sessionId: child, ...(over.background === false ? {} : { background: true }) }
    }
  }) as never

const sessions = { root: sess('root'), kid: sess('kid', 'root', 'Revisar logs (@explore subagent)'), grand: sess('grand', 'kid') }
const messages = { root: [{ parts: [taskPart('kid', { description: 'Revisar logs', agent: 'explore' })] }] }

describe('sesiones hijas: quién pide y cómo se llama', () => {
  it('rootOf sube por parentID hasta la raíz', () => {
    expect(rootOf(sessions, 'grand')).toBe('root')
    expect(rootOf(sessions, 'root')).toBe('root')
  })

  it('isChildRequest: hija conocida sí, raíz conocida no, desconocida solo si hay otra conversación abierta', () => {
    expect(isChildRequest(sessions, 'kid', 'root')).toBe(true)
    expect(isChildRequest(sessions, 'root', 'root')).toBe(false)
    expect(isChildRequest(sessions, 'zzz', 'root')).toBe(true)
    expect(isChildRequest(sessions, 'zzz', null)).toBe(false)
    expect(isChildRequest({}, 'root', 'root')).toBe(false)
  })

  it('el nombre sale de la parte task del padre (descripción, luego tipo) y, si no, del título de la hija', () => {
    expect(subagentNameOf(sessions, messages, 'kid')).toBe('Revisar logs')
    const onlyAgent = { root: [{ parts: [taskPart('kid', { agent: 'explore' })] }] }
    expect(subagentNameOf(sessions, onlyAgent, 'kid')).toBe('explore')
    expect(subagentNameOf(sessions, { root: [] }, 'kid')).toBe('Revisar logs (@explore subagent)')
    expect(subagentNameOf(sessions, messages, 'root')).toBe('root')
  })
})

describe('sesiones hijas: «ocupado» de la raíz', () => {
  it('una hija en segundo plano que trabaja deja a la raíz idle como ocupada', () => {
    const status = { kid: 'busy' as const }
    const input = { sessions, status, messages }
    expect(backgroundBusyRoots(input)).toEqual(['root'])
    expect(effectiveRun('idle', 'root', ['root'])).toBe('busy')
    expect(effectiveRun(undefined, 'root', ['root'])).toBe('busy')
    expect(withBackgroundBusy({ root: 'idle' as const, kid: 'busy' as const }, ['root']).root).toBe('busy')
    expect(liveBackgroundChildIds({ ...input, rootId: 'root' })).toEqual(['kid'])
  })

  it('una hija con permiso pendiente cuenta como viva', () => {
    const ids = liveBackgroundChildIds({ sessions, status: {}, messages, rootId: 'root', pending: ['kid'] })
    expect(ids).toEqual(['kid'])
  })

  it('sin hijas (o con hijas en reposo) todo queda igual que antes', () => {
    const status = { root: 'idle' as const }
    expect(backgroundBusyRoots({ sessions, status, messages })).toEqual([])
    expect(withBackgroundBusy(status, [])).toBe(status)
    expect(effectiveRun('idle', 'root', [])).toBe('idle')
    expect(effectiveRun(undefined, 'root', [])).toBeUndefined()
    expect(effectiveRun('retry', 'root', ['root'])).toBe('retry')
    expect(backgroundBusyRoots({ sessions: { root: sess('root') }, status: { root: 'busy' }, messages: {} })).toEqual([])
  })

  it('una hija que NO es un trabajo de fondo (consulta lateral o primer plano) no ocupa a la raíz', () => {
    const fg = { root: [{ parts: [taskPart('kid', { background: false })] }] }
    expect(backgroundBusyRoots({ sessions, status: { kid: 'busy' }, messages: fg })).toEqual([])
    expect(backgroundBusyRoots({ sessions, status: { kid: 'busy' }, messages: { root: [] } })).toEqual([])
  })

  it('si la raíz ya trabaja no se vuelve a marcar', () => {
    expect(backgroundBusyRoots({ sessions, status: { root: 'busy', kid: 'busy' }, messages })).toEqual([])
  })
})
