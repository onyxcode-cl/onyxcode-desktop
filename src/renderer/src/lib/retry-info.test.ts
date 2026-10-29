import { beforeEach, describe, expect, it } from 'vitest'
import { classifyRetry, noteRetryStatus, useRetryInfo } from './retry-info'

const retry = (sessionID: string, message: string, reason?: string) => ({
  type: 'session.status',
  properties: { sessionID, status: { type: 'retry', attempt: 1, message, next: 1, ...(reason ? { action: { reason } } : {}) } }
})

describe('retry-info', () => {
  beforeEach(() => useRetryInfo.setState({ bySession: {} }))

  it('anota el motivo del reintento y lo borra al volver a ocupado/ocioso', () => {
    noteRetryStatus(retry('s1', 'Provider is overloaded'))
    expect(useRetryInfo.getState().bySession.s1).toEqual({ message: 'Provider is overloaded', free: false, kind: 'other', attempt: 1 })
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
    expect(useRetryInfo.getState().bySession.s3).toEqual({ message: '', free: false, kind: 'other' })
    noteRetryStatus(undefined as never)
  })

  it('no reemplaza el estado si el motivo es el mismo (sin renders de más)', () => {
    noteRetryStatus(retry('s4', 'x'))
    const a = useRetryInfo.getState().bySession
    noteRetryStatus(retry('s4', 'x'))
    expect(useRetryInfo.getState().bySession).toBe(a)
  })

  it('429 del servicio gratuito sin señal del motor: lo reconoce por el texto', () => {
    noteRetryStatus(retry('f1', 'Free usage limit reached. Subscribe to OpenCode Go to keep going.'))
    expect(useRetryInfo.getState().bySession.f1).toMatchObject({ free: true, kind: 'free' })
  })

  it('clasifica red, clave, límite y saturación sin depender del proveedor', () => {
    expect(classifyRetry('fetch failed: ECONNREFUSED 127.0.0.1')).toBe('network')
    expect(classifyRetry('Unauthorized: invalid api key')).toBe('auth')
    expect(classifyRetry('Too many requests, rate limit hit')).toBe('quota')
    expect(classifyRetry('Service unavailable, try later')).toBe('unavailable')
    expect(classifyRetry('algo raro')).toBe('other')
    expect(classifyRetry('')).toBe('other')
    expect(classifyRetry('x', 'free_tier_limit')).toBe('free')
  })

  it('el mensaje se limpia: una línea, recortado y sin claves', () => {
    // La llave falsa se arma en tiempo de ejecución: un literal con forma de llave real dispararía la guardia de secretos del repo.
    const fakeKey = ['sk', 'ant', 'api03'].join('-') + '-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    noteRetryStatus(retry('c1', `boom\n\n   ${fakeKey} ${'x'.repeat(500)}`))
    const m = useRetryInfo.getState().bySession.c1!.message
    expect(m).not.toContain('\n')
    expect(m).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    expect(m.length).toBeLessThanOrEqual(200)
  })

  it('el número de intento cambia el estado y session.idle / session.error lo borran', () => {
    noteRetryStatus(retry('a1', 'x'))
    const first = useRetryInfo.getState().bySession
    noteRetryStatus({ type: 'session.status', properties: { sessionID: 'a1', status: { type: 'retry', attempt: 2, message: 'x' } } })
    expect(useRetryInfo.getState().bySession).not.toBe(first)
    expect(useRetryInfo.getState().bySession.a1?.attempt).toBe(2)
    noteRetryStatus({ type: 'session.idle', properties: { sessionID: 'a1' } })
    expect(useRetryInfo.getState().bySession.a1).toBeUndefined()
    noteRetryStatus(retry('a2', 'x'))
    noteRetryStatus({ type: 'session.error', properties: { sessionID: 'a2' } })
    expect(useRetryInfo.getState().bySession.a2).toBeUndefined()
  })
})
