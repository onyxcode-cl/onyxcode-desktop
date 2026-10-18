import { describe, expect, it } from 'vitest'
import { normalizeEngineEvent } from './engine-link'

const ev = (type: string, properties: Record<string, unknown>, directory = '/work/app') => ({
  directory,
  payload: { id: 'e', type, properties }
})

describe('normalizeEngineEvent', () => {
  it('permiso v1: copia lo necesario y recuerda la carpeta', () => {
    expect(
      normalizeEngineEvent(
        ev('permission.asked', {
          id: 'per_1',
          sessionID: 'ses_1',
          permission: 'bash',
          patterns: ['ls *'],
          metadata: { command: 'ls -la' },
          always: ['ls *']
        })
      )
    ).toEqual({
      kind: 'permission-asked',
      req: {
        id: 'per_1',
        sessionID: 'ses_1',
        permission: 'bash',
        patterns: ['ls *'],
        metadata: { command: 'ls -la' },
        api: 'v1',
        directory: '/work/app'
      }
    })
  })

  it('permiso v2: action/resources y API v2', () => {
    const out = normalizeEngineEvent(ev('permission.v2.asked', { id: 'p2', sessionID: 's', action: 'edit', resources: ['a.ts'], save: [] }))
    expect(out).toMatchObject({ kind: 'permission-asked', req: { id: 'p2', permission: 'edit', patterns: ['a.ts'], api: 'v2' } })
  })

  it('respuestas de permiso y preguntas', () => {
    expect(normalizeEngineEvent(ev('permission.replied', { sessionID: 's', requestID: 'per_1', reply: 'always' }))).toEqual({
      kind: 'permission-replied',
      id: 'per_1',
      reply: 'always'
    })
    expect(normalizeEngineEvent(ev('permission.v2.replied', { sessionID: 's', requestID: 'p2', reply: 'reject' }))).toEqual({
      kind: 'permission-replied',
      id: 'p2',
      reply: 'reject'
    })
    expect(
      normalizeEngineEvent(ev('question.asked', { id: 'q', sessionID: 's', questions: [{ question: '¿Sí?', header: 'x', options: [] }] }))
    ).toEqual({
      kind: 'question-asked',
      id: 'q',
      sessionID: 's',
      text: '¿Sí?'
    })
    expect(normalizeEngineEvent(ev('question.rejected', { sessionID: 's', requestID: 'q' }))).toEqual({ kind: 'question-closed', id: 'q' })
  })

  it('estado de sesión y fin: status e idle', () => {
    expect(normalizeEngineEvent(ev('session.status', { sessionID: 's', status: { type: 'busy' } }))).toEqual({
      kind: 'status',
      sessionID: 's',
      status: 'busy'
    })
    expect(normalizeEngineEvent(ev('session.status', { sessionID: 's', status: { type: 'idle' } }))).toEqual({
      kind: 'status',
      sessionID: 's',
      status: 'idle'
    })
    expect(normalizeEngineEvent(ev('session.idle', { sessionID: 's' }))).toEqual({ kind: 'status', sessionID: 's', status: 'idle' })
  })

  it('error: texto legible; abortar no es error', () => {
    expect(
      normalizeEngineEvent(ev('session.error', { sessionID: 's', error: { name: 'ApiError', data: { message: 'sin saldo' } } }))
    ).toEqual({
      kind: 'error',
      sessionID: 's',
      message: 'sin saldo'
    })
    expect(normalizeEngineEvent(ev('session.error', { sessionID: 's', error: { name: 'MessageAbortedError' } }))).toBeNull()
  })

  it('actividad (mensajes) y datos de sesión', () => {
    expect(normalizeEngineEvent(ev('message.part.updated', { part: { sessionID: 's' } }))).toEqual({ kind: 'activity', sessionID: 's' })
    expect(normalizeEngineEvent(ev('message.part.delta', { sessionID: 's' }))).toEqual({ kind: 'activity', sessionID: 's' })
    expect(normalizeEngineEvent(ev('session.updated', { info: { id: 's', title: 'T', parentID: 'p' } }))).toEqual({
      kind: 'session-info',
      sessionID: 's',
      title: 'T',
      parentID: 'p'
    })
  })

  it('lo demás y lo malformado se descarta sin lanzar', () => {
    for (const bad of [
      null,
      1,
      'x',
      {},
      { payload: null },
      ev('file.edited', {}),
      ev('permission.asked', { id: 1 }),
      ev('session.status', {}),
      { payload: { type: 3, properties: {} } }
    ])
      expect(normalizeEngineEvent(bad)).toBeNull()
  })
})
