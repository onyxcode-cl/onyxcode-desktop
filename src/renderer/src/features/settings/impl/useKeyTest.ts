import { create } from 'zustand'
import type { KeyTestResult } from '@shared/key-test'
import { t } from '@shared/i18n'
import { call } from '../../../lib/api'

/** Estado de la última «prueba de clave» de un proveedor (solo estado: la clave nunca llega aquí). */
export type KeyTestEntry = { phase: 'testing' } | { phase: 'done'; result: KeyTestResult } | { phase: 'error'; message: string }

interface KeyTestsState {
  entries: Record<string, KeyTestEntry>
  /** Prueba la clave guardada del proveedor (main hace la petición). No lanza: el fallo queda en `entries`. */
  run: (providerID: string) => Promise<void>
  clear: (providerID: string) => void
}

export const useKeyTests = create<KeyTestsState>((set, get) => ({
  entries: {},
  async run(providerID) {
    if (get().entries[providerID]?.phase === 'testing') return
    set((s) => ({ entries: { ...s.entries, [providerID]: { phase: 'testing' } } }))
    let entry: KeyTestEntry
    try {
      entry = { phase: 'done', result: await call('app:testProviderKey', { providerID }) }
    } catch (err) {
      entry = { phase: 'error', message: err instanceof Error ? err.message : t('models.keyTest.failed') }
    }
    set((s) => ({ entries: { ...s.entries, [providerID]: entry } }))
  },
  clear(providerID) {
    set((s) => {
      const entries = { ...s.entries }
      delete entries[providerID]
      return { entries }
    })
  }
}))

/** Hook: estado de la prueba de un proveedor y acción para lanzarla. */
export function useKeyTest(providerID: string | null): {
  entry: KeyTestEntry | undefined
  test: () => Promise<void>
} {
  const entry = useKeyTests((s) => (providerID ? s.entries[providerID] : undefined))
  return { entry, test: () => (providerID ? useKeyTests.getState().run(providerID) : Promise.resolve()) }
}

/** Lanza la prueba sin esperar (p. ej. justo después de guardar una clave). */
export function startKeyTest(providerID: string): void {
  void useKeyTests.getState().run(providerID)
}
