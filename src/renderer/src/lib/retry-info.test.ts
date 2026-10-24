import { beforeEach, describe, expect, it } from 'vitest'
import { noteRetryStatus, useRetryInfo } from './retry-info'

const retry = (sessionID: string, message: string, reason?: string) => ({
  type: 'session.status',
  properties: { sessionID, status: { type: 'retry', attempt: 1, message, next: 1, ...(reason ? { action: { reason } } : {}) } }
})

describe('retry-info', () => {
  beforeEach(() => useRetryInfo.setState({ bySession: {} }))

  it('anota el motivo del reintento y lo borra al volver a ocupado/ocioso', () => {
    noteRetryStatus(retry('s1', 'Provider is overloaded'))
    expect(useRetryInfo.getState().bySession.s1).toEqual({ message: 'Provider is overloaded', free: false })
    noteRetryStatus({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } })
    expect(useRetryInfo.getState().bySession.s1).toBeUndefined()
  })

  it('reconoce el fin del uso gratuito', () => {
    noteRetryStatus(retry('s2', 'Free usage exceeded, subscribe to Go', 'free_tier_limit'))
    expect(useRetryInfo.getState().bySession.s2?.free).toBe(true)
  })

  it('ignora otros eventos y datos raros sin lanzar', () => {
    noteRetryStatus({ type: 'message.updated', properties: {} })
    noteRetryStatus({ type: 'session.status', properties: { sessionID: 's3', status: { type: 'retry', message: 42 } } })
    expect(useRetryInfo.getState().bySession.s3).toEqual({ message: '', free: false })
    noteRetryStatus(undefined as never)
  })

  it('no reemplaza el estado si el motivo es el mismo (sin renders de más)', () => {
    noteRetryStatus(retry('s4', 'x'))
    const a = useRetryInfo.getState().bySession
    noteRetryStatus(retry('s4', 'x'))
    expect(useRetryInfo.getState().bySession).toBe(a)
  })
})
