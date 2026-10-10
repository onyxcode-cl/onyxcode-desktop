import { describe, expect, it } from 'vitest'
import { buildUpstreamHeaders } from './proxy'

describe('buildUpstreamHeaders', () => {
  it('sustituye Authorization por la real y descarta el centinela', () => {
    const h = buildUpstreamHeaders(
      { authorization: 'Bearer sandboxed-placeholder-x', host: 'localhost', accept: 'a' },
      'opencode.ai',
      'Bearer REAL'
    )
    expect(h.authorization).toBe('Bearer REAL')
    expect(h.host).toBe('opencode.ai')
    expect(h.accept).toBe('a')
    expect(h['x-api-key']).toBeUndefined()
  })
  it('si el SDK manda x-api-key (protocolo Anthropic) se reemplaza por la clave real', () => {
    const h = buildUpstreamHeaders(
      { 'x-api-key': 'sandboxed-placeholder-x', 'anthropic-version': '2023-06-01' },
      'opencode.ai',
      'Bearer REAL'
    )
    expect(h['x-api-key']).toBe('REAL')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(JSON.stringify(h)).not.toContain('placeholder')
  })
})
