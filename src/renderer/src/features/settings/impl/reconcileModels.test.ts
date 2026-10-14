import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL } from '@shared/types'

const settings = { defaultModel: { providerID: 'openai', modelID: 'gpt-5' } as { providerID: string; modelID: string } }
const prefs = { modelsByMode: {} as Record<string, { providerID: string; modelID: string }> }
const updateSettings = vi.fn(async (p: { defaultModel: typeof settings.defaultModel }) => {
  settings.defaultModel = p.defaultModel
})
const updatePrefs = vi.fn(async (p: { modelsByMode: typeof prefs.modelsByMode }) => {
  prefs.modelsByMode = p.modelsByMode
})
vi.mock('../../../stores/settings', () => ({ useSettings: { getState: () => ({ settings, update: updateSettings }) } }))
vi.mock('./extras', () => ({ useExtrasPrefs: { getState: () => ({ prefs, update: updatePrefs }) } }))
vi.mock('../../../stores/providers', () => ({ useProviders: { getState: () => ({ loaded: false, providers: [], client: null }) } }))

import { reconcileAfterProviderChange } from './reconcileModels'

const client = (providers: unknown[]): never => ({ config: { providers: async () => ({ data: { providers, default: {} } }) } }) as never
const openai = { id: 'openai', name: 'OpenAI', source: 'custom', models: { 'gpt-5': {} } }
const go = { id: 'opencode-go', name: 'OpenCode Go', source: 'api', models: { [DEFAULT_MODEL.modelID]: {} } }

beforeEach(() => {
  settings.defaultModel = { providerID: 'openai', modelID: 'gpt-5' }
  prefs.modelsByMode = { chat: { providerID: 'openai', modelID: 'gpt-5' } }
  updateSettings.mockClear()
  updatePrefs.mockClear()
})

describe('reconcileAfterProviderChange', () => {
  it('al conectar Go pasa a DEFAULT_MODEL, limpia el modo y permite deshacer', async () => {
    const n = await reconcileAfterProviderChange(client([openai, go]), ['openai'])
    expect(n?.text).toContain('OpenCode Go')
    expect(settings.defaultModel).toEqual(DEFAULT_MODEL)
    expect(prefs.modelsByMode).toEqual({})
    await n!.undo()
    expect(settings.defaultModel).toEqual({ providerID: 'openai', modelID: 'gpt-5' })
    expect(prefs.modelsByMode.chat).toEqual({ providerID: 'openai', modelID: 'gpt-5' })
  })
  it('sin cambios no avisa ni escribe', async () => {
    expect(await reconcileAfterProviderChange(client([openai]), ['openai'])).toBeNull()
    expect(updateSettings).not.toHaveBeenCalled()
  })
  it('si el motor falla no lanza', async () => {
    const bad = { config: { providers: async () => Promise.reject(new Error('x')) } } as never
    expect(await reconcileAfterProviderChange(bad, [])).toBeNull()
  })
})
