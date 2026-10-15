import { describe, expect, it } from 'vitest'
import { buildUpstreamHeaders, stripQueryCredentials } from './proxy'

describe('buildUpstreamHeaders', () => {
  it('sustituye Authorization por la real y descarta el centinela', () => {
    const h = buildUpstreamHeaders(
      { authorization: 'Bearer sandboxed-placeholder-x', host: 'localhost', accept: 'a' },
      'opencode.ai',
      'REAL'
    )
    expect(h.authorization).toBe('Bearer REAL')
    expect(h.host).toBe('opencode.ai')
    expect(h.accept).toBe('a')
    expect(h['x-api-key']).toBeUndefined()
  })
  it('si el SDK manda x-api-key (protocolo Anthropic) se reemplaza por la clave real', () => {
    const h = buildUpstreamHeaders({ 'x-api-key': 'sandboxed-placeholder-x', 'anthropic-version': '2023-06-01' }, 'opencode.ai', 'REAL')
    expect(h['x-api-key']).toBe('REAL')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(JSON.stringify(h)).not.toContain('placeholder')
  })
})

describe('buildUpstreamHeaders: la clave real va solo donde el cliente la puso', () => {
  it('sin credencial del cliente → Authorization Bearer', () => {
    const h = buildUpstreamHeaders({ accept: 'a' }, 'h', 'REAL')
    expect(h.authorization).toBe('Bearer REAL')
    expect(Object.keys(h).filter((k) => /key/i.test(k))).toEqual([])
  })
  it('x-api-key del cliente → solo x-api-key (sin Authorization)', () => {
    const h = buildUpstreamHeaders({ 'x-api-key': 'S', 'anthropic-version': 'v', 'anthropic-beta': 'b' }, 'h', 'REAL')
    expect(h['x-api-key']).toBe('REAL')
    expect(h.authorization).toBeUndefined()
    expect(h['anthropic-version']).toBe('v')
    expect(h['anthropic-beta']).toBe('b')
  })
  it('x-goog-api-key del cliente o ?key= → solo x-goog-api-key', () => {
    expect(buildUpstreamHeaders({ 'x-goog-api-key': 'S' }, 'h', 'REAL')['x-goog-api-key']).toBe('REAL')
    const h = buildUpstreamHeaders({}, 'h', 'REAL', true)
    expect(h['x-goog-api-key']).toBe('REAL')
    expect(h.authorization).toBeUndefined()
  })
  it('api-key del cliente → solo api-key; Proxy-Authorization se descarta', () => {
    const h = buildUpstreamHeaders({ 'api-key': 'S', 'proxy-authorization': 'S' }, 'h', 'REAL')
    expect(h['api-key']).toBe('REAL')
    expect(h.authorization).toBeUndefined()
    expect(h['proxy-authorization']).toBeUndefined()
  })
  it('stripQueryCredentials conserva el resto del query tal cual', () => {
    expect(stripQueryCredentials('?a=1%20b&key=S&c=x+y&api_key=T&d')).toEqual({ search: '?a=1%20b&c=x+y&d', hadKey: true })
    expect(stripQueryCredentials('?alt=sse')).toEqual({ search: '?alt=sse', hadKey: false })
    expect(stripQueryCredentials('?KEY=S')).toEqual({ search: '', hadKey: true })
  })
})
