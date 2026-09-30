import { describe, expect, it } from 'vitest'
import type { Provider, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { authOptions, providerName, unconnectedProviders, type ProviderCatalog } from './providerCatalog'

const prov = (id: string, name: string): Provider => ({ id, name, source: 'api', env: [], options: {}, models: {} }) as Provider

const catalog: ProviderCatalog = {
  all: [prov('z', 'Zeta'), prov('a', 'Álamo'), prov('b', 'Beta'), prov('c', 'Gamma')],
  connected: ['c'],
  auth: {}
}

describe('unconnectedProviders', () => {
  it('excluye los conectados y ordena por nombre (es)', () => {
    expect(unconnectedProviders(catalog).map((p) => p.id)).toEqual(['a', 'b', 'z'])
  })
  it('respeta la lista de exclusión', () => {
    expect(unconnectedProviders(catalog, ['b']).map((p) => p.id)).toEqual(['a', 'z'])
  })
})

describe('providerName', () => {
  it('devuelve el nombre del catálogo o el id', () => {
    expect(providerName(catalog, 'b')).toBe('Beta')
    expect(providerName(catalog, 'nuevo')).toBe('nuevo')
  })
})

describe('authOptions', () => {
  const api: ProviderAuthMethod = { type: 'api', label: 'API key' }
  const oauth: ProviderAuthMethod = { type: 'oauth', label: 'Cuenta' }
  it('sin métodos: solo API key', () => {
    expect(authOptions(undefined)).toEqual({ api: true, oauth: [] })
    expect(authOptions([])).toEqual({ api: true, oauth: [] })
  })
  it('solo oauth: sin API key y con el índice original', () => {
    expect(authOptions([oauth])).toEqual({ api: false, oauth: [{ index: 0, label: 'Cuenta' }] })
  })
  it('mezcla: api y oauth con índice', () => {
    expect(authOptions([api, oauth])).toEqual({ api: true, oauth: [{ index: 1, label: 'Cuenta' }] })
  })
  it('descarta oauth con prompts', () => {
    const withPrompts: ProviderAuthMethod = { type: 'oauth', label: 'Empresa', prompts: [{ type: 'text', key: 'k', message: 'm' }] }
    expect(authOptions([withPrompts])).toEqual({ api: false, oauth: [] })
    expect(authOptions([withPrompts, oauth]).oauth).toEqual([{ index: 1, label: 'Cuenta' }])
  })
})
