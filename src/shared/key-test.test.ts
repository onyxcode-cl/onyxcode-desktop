import { describe, expect, it } from 'vitest'
import { keyTestText, type KeyTestStatus } from './key-test'

const ALL: KeyTestStatus[] = [
  'ok',
  'invalid',
  'forbidden',
  'rate-limited',
  'no-credit',
  'offline',
  'unreachable',
  'provider-down',
  'timeout',
  'unexpected',
  'not-stored',
  'oauth',
  'unsupported'
]

describe('keyTestText', () => {
  it('hay un texto distinto y no vacío para cada estado', () => {
    const titles = ALL.map((status) => keyTestText({ status, httpStatus: null, latencyMs: null }, 'Proveedor X').title)
    expect(new Set(titles).size).toBe(titles.length)
    for (const status of ALL) {
      const t = keyTestText({ status, httpStatus: 500, latencyMs: 12 }, 'Proveedor X')
      expect(t.title.length).toBeGreaterThan(0)
      expect(t.message.length).toBeGreaterThan(0)
    }
  })

  it('ok muestra la latencia y distingue inválida, sin red, límite y proveedor caído', () => {
    expect(keyTestText({ status: 'ok', httpStatus: 200, latencyMs: 340 }, 'OpenAI').title).toBe('Funciona · 340 ms')
    expect(keyTestText({ status: 'invalid', httpStatus: 401, latencyMs: 5 }, 'OpenAI').tone).toBe('error')
    expect(keyTestText({ status: 'offline', httpStatus: null, latencyMs: null }, 'OpenAI').message).toMatch(/conexión/i)
    expect(keyTestText({ status: 'rate-limited', httpStatus: 429, latencyMs: 5 }, 'OpenAI').title).toMatch(/Límite/)
    expect(keyTestText({ status: 'provider-down', httpStatus: 503, latencyMs: 5 }, 'OpenAI').message).toMatch(/503/)
  })

  it('«unsupported» no promete gastar tokens', () => {
    expect(keyTestText({ status: 'unsupported', httpStatus: null, latencyMs: null }, 'Foo').message).toContain(
      'No se puede probar sin gastar'
    )
  })
})
