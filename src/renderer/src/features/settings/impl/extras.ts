/**
 * Acceso a `window.api.extras` + store de preferencias de extras (atajo, modelos por modo).
 *
 * Exporta `resolveModelForMode(mode)` / `useModeModel(mode)` para que Chat/Code/Tareas usen
 * el modelo configurado por modo (con fallback a `settings.defaultModel`).
 */
import { create } from 'zustand'
import { t } from '@shared/i18n'
import { DEFAULT_EXTRAS_PREFS, type ExtrasPrefs, type ExtrasPrefsState, type ModelMode } from '@shared/ipc-extras'
import type { ModelRef } from '@shared/types'
import { useSettings } from '../../../stores/settings'

import { getExtras, requireExtras } from '../../../lib/extrasApi'
export { getExtras, requireExtras }

interface ExtrasPrefsStore extends ExtrasPrefsState {
  loaded: boolean
  error: string | null
  init: () => () => void
  update: (patch: Partial<ExtrasPrefs>) => Promise<void>
}

let initCount = 0
let offChanged: (() => void) | null = null

export const useExtrasPrefs = create<ExtrasPrefsStore>((set, get) => ({
  prefs: DEFAULT_EXTRAS_PREFS,
  shortcutError: null,
  loaded: false,
  error: null,
  init: () => {
    const extras = getExtras()
    if (!extras) {
      set({ error: t('settings.extras.bridgeMissing'), loaded: true })
      return () => undefined
    }
    initCount++
    if (initCount === 1) {
      extras
        .invoke('extras:getPrefs')
        .then((s) => set({ ...s, loaded: true, error: null }))
        .catch((err: unknown) => set({ error: String(err), loaded: true }))
      offChanged = extras.on('extras:prefs-changed', (s) => set({ ...s }))
    }
    return () => {
      initCount--
      if (initCount === 0) {
        offChanged?.()
        offChanged = null
      }
    }
  },
  update: async (patch) => {
    const extras = requireExtras()
    const prev = get().prefs
    set({ prefs: { ...prev, ...patch } })
    try {
      const s = await extras.invoke('extras:setPrefs', patch)
      set({ ...s, error: null })
    } catch (err) {
      set({ prefs: prev, error: err instanceof Error ? err.message : String(err) })
    }
  }
}))

/** Modelo efectivo para un modo (override por modo o el predeterminado global). */
export function resolveModelForMode(mode: ModelMode): ModelRef {
  return useExtrasPrefs.getState().prefs.modelsByMode[mode] ?? useSettings.getState().settings.defaultModel
}

/** Hook reactivo equivalente a `resolveModelForMode`. */
export function useModeModel(mode: ModelMode): ModelRef {
  const override = useExtrasPrefs((s) => s.prefs.modelsByMode[mode])
  const fallback = useSettings((s) => s.settings.defaultModel)
  return override ?? fallback
}

/** Carga inicial de prefs fuera de React (p.ej. desde App al arrancar). */
export function initExtrasPrefs(): () => void {
  return useExtrasPrefs.getState().init()
}
