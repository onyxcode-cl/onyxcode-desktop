import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { api, call } from '../lib/api'

interface SettingsState {
  settings: Settings
  loaded: boolean
  init: () => () => void
  update: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  init: () => {
    void call('settings:get').then((settings) => set({ settings, loaded: true }))
    return api.on('settings:changed', (settings) => set({ settings }))
  },
  update: async (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    const settings = await call('settings:set', patch)
    set({ settings })
  }
}))
