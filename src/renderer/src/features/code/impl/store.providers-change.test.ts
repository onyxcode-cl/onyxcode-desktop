/** Cambio de cuenta: el modelo en memoria de Code se descarta cuando cambia el conjunto de proveedores. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useProviders: (typeof import('../../../stores/providers'))['useProviders']
const gpt = { providerID: 'openai', modelID: 'gpt-5' }
const prov = (id: string): never => ({ id, name: id, models: {} }) as never

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ useCode } = await import('./store'))
  ;({ useProviders } = await import('../../../stores/providers'))
})

describe('modelo en memoria de Code', () => {
  it('se conserva mientras los proveedores no cambian y se descarta al conectar otro', () => {
    useProviders.setState({ loaded: true, providers: [prov('openai')] })
    useCode.setState({ model: gpt, variant: 'high' })
    useProviders.setState({ providers: [prov('openai')] })
    expect(useCode.getState().model).toEqual(gpt)
    useProviders.setState({ providers: [prov('openai'), prov('opencode-go')] })
    expect(useCode.getState().model).toBeNull()
    expect(useCode.getState().variant).toBeNull()
  })
})
