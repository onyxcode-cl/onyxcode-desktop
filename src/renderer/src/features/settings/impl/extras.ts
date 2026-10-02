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

/** Resolvedor puro: la elección propia del modo, o el predeterminado global si el modo no tiene. */
export function pickModeModel(modelsByMode: ExtrasPrefs['modelsByMode'], mode: ModelMode, fallback: ModelRef): ModelRef {
  return modelsByMode[mode] ?? fallback
}

/** Copia de `modelsByMode` con la elección del modo cambiada (`null` = borrar el override y volver al predeterminado). */
export function withModeModel(
  modelsByMode: ExtrasPrefs['modelsByMode'],
  mode: ModelMode,
  value: ModelRef | null
): ExtrasPrefs['modelsByMode'] {
  const next = { ...modelsByMode }
  if (value) next[mode] = { providerID: value.providerID, modelID: value.modelID }
  else delete next[mode]
  return next
}

/** Modelo efectivo para un modo (override por modo o el predeterminado global). */
export function resolveModelForMode(mode: ModelMode): ModelRef {
  return pickModeModel(useExtrasPrefs.getState().prefs.modelsByMode, mode, useSettings.getState().settings.defaultModel)
}

/** Hook reactivo equivalente a `resolveModelForMode`. */
export function useModeModel(mode: ModelMode): ModelRef {
  const override = useExtrasPrefs((s) => s.prefs.modelsByMode[mode])
  const fallback = useSettings((s) => s.settings.defaultModel)
  return override ?? fallback
}

/**
 * Recuerda (o borra, con `null`) el modelo de un modo en `modelsByMode` (extras.json).
 * NUNCA toca `settings.defaultModel`: elegir un modelo en un modo no cambia el predeterminado global.
 */
export function setModeModel(mode: ModelMode, value: ModelRef | null): void {
  try {
    const extras = useExtrasPrefs.getState()
    void extras.update({ modelsByMode: withModeModel(extras.prefs.modelsByMode, mode, value) }).catch(() => undefined)
  } catch {
    // sin puente "extras": la elección vale solo para esta sesión de la app
  }
}

/** Espera a que las preferencias de extras estén cargadas (para no resolver un modo con el predeterminado por llegar antes). */
export function whenExtrasLoaded(timeoutMs = 3000): Promise<void> {
  return new Promise<void>((resolve) => {
    if (useExtrasPrefs.getState().loaded) return resolve()
    const timer = setTimeout(() => {
      un()
      resolve()
    }, timeoutMs)
    const un = useExtrasPrefs.subscribe((s) => {
      if (s.loaded) {
        clearTimeout(timer)
        un()
        resolve()
      }
    })
  })
}

/** Carga inicial de prefs fuera de React (p.ej. desde App al arrancar). */
export function initExtrasPrefs(): () => void {
  return useExtrasPrefs.getState().init()
}
