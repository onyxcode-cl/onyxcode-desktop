import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from './types'
import {
  aiAvailability,
  firstFreeModel,
  isChoiceUnavailable,
  isConfiguredProvider,
  resolveModel,
  sendGate,
  type ProviderLike
} from './ai-availability'

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

describe('elección explícita que falta (F8-B42)', () => {
  const luna = { providerID: 'opencode-go', modelID: 'gpt-5.6-luna' }
  const goWithoutLuna: ProviderLike = { id: 'opencode-go', source: 'api', models: { 'deepseek-v4.1-flash': {}, 'other-go': {} } }
  const goWithLuna: ProviderLike = { id: 'opencode-go', source: 'api', models: { 'deepseek-v4.1-flash': {}, 'gpt-5.6-luna': {} } }

  it('modelo elegido ausente de la lista cargada: no disponible (y resolveModel sigue sustituyendo solo para Code/Tareas)', () => {
    expect(isChoiceUnavailable(luna, [goWithoutLuna])).toBe(true)
    expect(resolveModel(luna, [goWithoutLuna], defaults)).toEqual({ providerID: 'opencode-go', modelID: 'other-go' })
  })

  it('modelo presente: disponible', () => {
    expect(isChoiceUnavailable(luna, [goWithLuna])).toBe(false)
  })

  it('proveedor sin clave (no está en la lista): no disponible, la elección no cambia', () => {
    const anthropic = { providerID: 'anthropic', modelID: 'claude-x' }
    expect(isChoiceUnavailable(anthropic, [goWithLuna])).toBe(true)
    expect(anthropic).toEqual({ providerID: 'anthropic', modelID: 'claude-x' })
  })

  it('lista aún sin cargar: nunca no disponible', () => {
    expect(isChoiceUnavailable(luna, null)).toBe(false)
  })

  it('sin IA configurada (vacío o solo gratuito): no aplica, manda el aviso de «conecta una IA»', () => {
    expect(isChoiceUnavailable(luna, [])).toBe(false)
    expect(isChoiceUnavailable(luna, [free])).toBe(false)
  })

  it('el predeterminado de fábrica nunca elegido sí puede sustituirse (usuario nuevo con otra IA)', () => {
    expect(isChoiceUnavailable(DEFAULT_MODEL, [other])).toBe(false)
  })

  it('con la elección no disponible el envío se bloquea con motivo propio, sin freeNote', () => {
    expect(sendGate('ready', null, true)).toEqual({ blocked: true, reason: 'model-unavailable', freeNote: false })
    expect(sendGate('ready', luna, false).blocked).toBe(false)
  })
})
