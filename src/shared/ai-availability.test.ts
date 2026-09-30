import { describe, expect, it } from 'vitest'
import { aiAvailability, firstFreeModel, isConfiguredProvider, resolveModel, sendGate, type ProviderLike } from './ai-availability'

const go: ProviderLike = { id: 'opencode-go', source: 'api', models: { 'deepseek-v4.1-flash': {}, 'other-go': {} } }
const free: ProviderLike = { id: 'opencode', source: 'custom', models: { 'fake-free-model': {} } }
const other: ProviderLike = { id: 'acme', source: 'api', models: { 'acme-1': {}, 'acme-2': {} } }
const saved = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }
const defaults = { 'opencode-go': 'other-go', acme: 'acme-2' }

describe('disponibilidad de IA', () => {
  it('el gratuito preinstalado no cuenta como configurado', () => {
    expect(isConfiguredProvider(free)).toBe(false)
    expect(isConfiguredProvider(go)).toBe(true)
  })

  it('sin cargar: unknown, se envía el modelo pedido tal cual y no bloquea', () => {
    expect(aiAvailability(null)).toBe('unknown')
    const eff = resolveModel(saved, null, {})
    expect(eff).toEqual(saved)
    expect(sendGate('unknown', eff).blocked).toBe(false)
  })

  it('vacío: none, modelo null y bloquea', () => {
    expect(aiAvailability([])).toBe('none')
    const eff = resolveModel(saved, [], {})
    expect(eff).toBeNull()
    expect(sendGate('none', eff)).toEqual({ blocked: true, reason: 'no-ai', freeNote: false })
  })

  it('solo gratuito: free-only, el guardado de Go no existe y bloquea; ofrece el gratuito', () => {
    expect(aiAvailability([free])).toBe('free-only')
    const eff = resolveModel(saved, [free], {})
    expect(eff).toBeNull()
    expect(sendGate('free-only', eff).blocked).toBe(true)
    expect(firstFreeModel([free])).toEqual({ providerID: 'opencode', modelID: 'fake-free-model' })
    expect(firstFreeModel([go])).toBeNull()
    expect(firstFreeModel(null)).toBeNull()
  })

  it('gratuito elegido explícitamente: envía con nota suave', () => {
    const wanted = { providerID: 'opencode', modelID: 'fake-free-model' }
    const eff = resolveModel(wanted, [free], {})
    expect(eff).toEqual(wanted)
    expect(sendGate('free-only', eff)).toEqual({ blocked: false, reason: null, freeNote: true })
  })

  it('Go con modelo guardado inválido cae al predeterminado de Go sin persistir', () => {
    const wanted = { providerID: 'opencode-go', modelID: 'no-existe' }
    expect(aiAvailability([free, go])).toBe('ready')
    expect(resolveModel(wanted, [free, other, go], defaults)).toEqual({ providerID: 'opencode-go', modelID: 'other-go' })
    expect(wanted.modelID).toBe('no-existe')
  })

  it('modelo guardado válido se respeta', () => {
    expect(resolveModel(saved, [go, other], defaults)).toEqual(saved)
  })

  it('otro proveedor configurado sin Go: usa su predeterminado', () => {
    expect(resolveModel(saved, [free, other], defaults)).toEqual({ providerID: 'acme', modelID: 'acme-2' })
    expect(sendGate('ready', { providerID: 'acme', modelID: 'acme-2' })).toEqual({ blocked: false, reason: null, freeNote: false })
  })
})
