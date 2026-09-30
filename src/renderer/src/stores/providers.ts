import { create } from 'zustand'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import type { OpencodeClient } from '../lib/opencode'
import { errorMessage } from '../lib/opencode'

interface ProvidersState {
  providers: Provider[]
  defaults: Record<string, string>
  loading: boolean
  /** true cuando ya hubo una carga correcta (antes de eso no se sabe qué IA hay conectada). */
  loaded: boolean
  /** Cliente de la última carga: si cambia (servidor reiniciado) se vuelve a cargar. */
  client: OpencodeClient | null
  error: string | null
  load: (client: OpencodeClient, force?: boolean) => Promise<void>
}

export const PREFERRED_PROVIDER = 'opencode-go'

/** Proveedor preferido primero; el resto por nombre. */
export function sortProviders(list: Provider[]): Provider[] {
  return [...list].sort((a, b) => (a.id === PREFERRED_PROVIDER ? -1 : b.id === PREFERRED_PROVIDER ? 1 : a.name.localeCompare(b.name, 'es')))
}

export const useProviders = create<ProvidersState>((set, get) => ({
  providers: [],
  defaults: {},
  loading: false,
  loaded: false,
  client: null,
  error: null,
  load: async (client, force = false) => {
    if (get().loading || (!force && get().loaded && get().client === client)) return
    set({ loading: true, error: null })
    try {
      const res = await client.config.providers()
      if (res.error || !res.data) throw new Error(errorMessage(res.error))
      const providers = sortProviders(res.data.providers)
      set({ providers, defaults: res.data.default, loading: false, loaded: true, client })
    } catch (err) {
      set({ error: errorMessage(err), loading: false })
    }
  }
}))
