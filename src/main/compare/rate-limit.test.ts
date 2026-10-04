import { describe, expect, it } from 'vitest'
import { EngineCallError, engineRetryExceeded, isQuotaError, isQuotaMessage, retryDelayMs } from './rate-limit'

describe('clasificación de cuota', () => {
  it('«token rate limit», 429 y mensajes de cuota son cuota', () => {
    expect(isQuotaError(new Error('token rate limit exceeded'))).toBe(true)
    expect(isQuotaError('Token Rate Limit reached')).toBe(true)
    expect(isQuotaError({ name: 'APIError', data: { message: 'boom', statusCode: 429 } })).toBe(true)
    expect(isQuotaError(new EngineCallError({ name: 'APIError', data: { message: 'x', statusCode: 429 } }))).toBe(true)
    expect(isQuotaError(new Error('You exceeded your current quota'))).toBe(true)
  })

  it('ProviderModelNotFoundError, auth y red no son cuota', () => {
    expect(isQuotaError({ name: 'ProviderModelNotFoundError', data: { message: 'Model not found: x/y.' } })).toBe(false)
    expect(isQuotaError(new Error('Model not found: opencode-go/zzz.'))).toBe(false)
    expect(isQuotaError({ name: 'APIError', data: { message: 'bad key', statusCode: 401 } })).toBe(false)
    expect(isQuotaError(new Error('ECONNREFUSED'))).toBe(false)
  })

  it('los mensajes de session.status retry se clasifican igual', () => {
    expect(isQuotaMessage('token rate limit, retrying')).toBe(true)
    expect(isQuotaMessage('Too Many Requests')).toBe(true)
    expect(isQuotaMessage('connection reset')).toBe(false)
  })

  it('el motor insiste: solo aborta con más de 2 reintentos por cuota', () => {
    expect(engineRetryExceeded({ type: 'retry', attempt: 2, message: 'token rate limit' })).toBe(false)
    expect(engineRetryExceeded({ type: 'retry', attempt: 3, message: 'token rate limit' })).toBe(true)
    expect(engineRetryExceeded({ type: 'retry', attempt: 9, message: 'ECONNRESET' })).toBe(false)
    expect(engineRetryExceeded({ type: 'busy' })).toBe(false)
    expect(engineRetryExceeded(undefined)).toBe(false)
  })

  it('el reintento espera 20 s ± 5 s', () => {
    expect(retryDelayMs(() => 0)).toBe(15_000)
    expect(retryDelayMs(() => 0.5)).toBe(20_000)
    expect(retryDelayMs(() => 1)).toBe(25_000)
    for (let i = 0; i < 200; i++) {
      const d = retryDelayMs()
      expect(d).toBeGreaterThanOrEqual(15_000)
      expect(d).toBeLessThanOrEqual(25_000)
    }
  })
})
