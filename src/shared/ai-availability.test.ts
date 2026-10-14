import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from './types'
import {
  aiAvailability,
  firstFreeModel,
  isChoiceUnavailable,
  isConfiguredProvider,
  reconcileChoices,
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
    // Prefiere los que se sabe que responden, aunque no sean el primero del catálogo.
    const many = { ...free, models: { 'ling-3.0-flash-fin-free': {}, 'big-pickle': {}, 'ling-3.1-flash-free': {} } } as typeof free
    expect(firstFreeModel([many])).toEqual({ providerID: 'opencode', modelID: 'ling-3.1-flash-free' })
    // Un modelo obsoleto nunca se elige, ni siquiera si es el preferido o el primero.
    const dep = {
      ...free,
      models: { 'exo-free': { status: 'deprecated' }, 'ling-3.1-flash-free': { status: 'deprecated' }, 'big-pickle': {} }
    } as typeof free
    expect(firstFreeModel([dep])).toEqual({ providerID: 'opencode', modelID: 'big-pickle' })
    const noPref = { ...free, models: { 'otro-free': {}, 'zeta-free': {} } } as typeof free
    expect(firstFreeModel([noPref])).toEqual({ providerID: 'opencode', modelID: 'otro-free' })
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

describe('reconcileChoices', () => {
  const gpt = { providerID: 'openai', modelID: 'gpt-5' }
  const openai: ProviderLike = { id: 'openai', source: 'custom', models: { 'gpt-5': {} } }
  const base = { defaultModel: gpt, modelsByMode: { chat: gpt, code: { providerID: 'opencode-go', modelID: 'other-go' } } }
  it('al conectar Go con elecciones en otro proveedor vuelve a DEFAULT_MODEL y limpia el modo', () => {
    const r = reconcileChoices(base, [openai, go], defaults, ['openai'])
    expect(r.changed).toBe(true)
    expect(r.choices.defaultModel).toEqual(DEFAULT_MODEL)
    expect(r.choices.modelsByMode).toEqual({ code: { providerID: 'opencode-go', modelID: 'other-go' } })
    expect(r.switchedTo).toEqual(DEFAULT_MODEL)
    expect(r.previous.defaultModel).toEqual(gpt)
  })
  it('si Go ya estaba conectado no toca la elección explícita', () => {
    expect(reconcileChoices(base, [openai, go], defaults, ['openai', 'opencode-go']).changed).toBe(false)
  })
  it('al desconectar el proveedor sustituye el predeterminado y limpia los modos', () => {
    const r = reconcileChoices(base, [go], defaults, ['openai', 'opencode-go'])
    expect(r.choices.defaultModel).toEqual({ providerID: 'opencode-go', modelID: 'other-go' })
    expect(r.choices.modelsByMode.chat).toBeUndefined()
  })
  it('sin lista cargada o sin IA configurada no cambia nada', () => {
    expect(reconcileChoices(base, null, defaults, []).changed).toBe(false)
    expect(reconcileChoices(base, [free], defaults, []).changed).toBe(false)
  })
  it('si Go no tiene DEFAULT_MODEL usa su predeterminado', () => {
    const g2: ProviderLike = { id: 'opencode-go', source: 'api', models: { 'other-go': {} } }
    expect(reconcileChoices(base, [openai, g2], defaults, ['openai']).choices.defaultModel.modelID).toBe('other-go')
  })
})
