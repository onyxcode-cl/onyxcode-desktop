import { describe, expect, it } from 'vitest'
import { pickRoutineModel } from './model'

const saved = { providerID: 'openai', modelID: 'gpt-5' }
const go = { id: 'opencode-go', source: 'api', models: { 'deepseek-v4.1-flash': {} } }
const openai = { id: 'openai', source: 'custom', models: { 'gpt-5': {} } }

describe('pickRoutineModel', () => {
  it('mantiene el modelo guardado si sigue disponible', () => {
    expect(pickRoutineModel(saved, { providers: [openai, go], default: {} })).toEqual(saved)
  })
  it('lo sustituye por el de la IA conectada si su proveedor ya no está', () => {
    expect(pickRoutineModel(saved, { providers: [go], default: {} })).toEqual({ providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' })
  })
  it('sin ninguna IA configurada devuelve null; sin lista cargada, el guardado', () => {
    expect(pickRoutineModel(saved, { providers: [], default: {} })).toBeNull()
    expect(pickRoutineModel(saved, null)).toEqual(saved)
  })
})
