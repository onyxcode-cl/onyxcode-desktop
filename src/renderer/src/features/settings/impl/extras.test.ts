import { describe, expect, it } from 'vitest'
import type { ModelRef } from '@shared/types'
import { pickModeModel, withModeModel } from './extras'

const DEF: ModelRef = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }
const GPT: ModelRef = { providerID: 'opencode-go', modelID: 'gpt-5.6' }
const CLAUDE: ModelRef = { providerID: 'anthropic', modelID: 'claude' }

describe('pickModeModel', () => {
  it('sin elección propia del modo vale el predeterminado global', () => {
    expect(pickModeModel({}, 'chat', DEF)).toBe(DEF)
    expect(pickModeModel({ code: GPT }, 'chat', DEF)).toBe(DEF)
  })
  it('con elección propia manda sobre el predeterminado y es independiente por modo', () => {
    const by = { chat: GPT, code: CLAUDE }
    expect(pickModeModel(by, 'chat', DEF)).toBe(GPT)
    expect(pickModeModel(by, 'code', DEF)).toBe(CLAUDE)
    expect(pickModeModel(by, 'tasks', DEF)).toBe(DEF)
  })
})

describe('withModeModel', () => {
  it('fija un modo sin tocar los demás ni mutar el original', () => {
    const orig = { code: CLAUDE }
    const next = withModeModel(orig, 'chat', GPT)
    expect(next).toEqual({ code: CLAUDE, chat: GPT })
    expect(orig).toEqual({ code: CLAUDE })
  })
  it('null borra el override de ese modo (vuelve al predeterminado)', () => {
    const next = withModeModel({ chat: GPT, code: CLAUDE }, 'chat', null)
    expect(next).toEqual({ code: CLAUDE })
    expect(pickModeModel(next, 'chat', DEF)).toBe(DEF)
  })
  it('compatibilidad: sin overrides previos (solo defaultModel) todo sigue igual', () => {
    expect(pickModeModel({}, 'tasks', DEF)).toBe(DEF)
  })
})
