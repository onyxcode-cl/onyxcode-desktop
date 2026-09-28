import { create } from 'zustand'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import type { OpencodeClient } from '../lib/opencode'
import { errorMessage } from '../lib/opencode'

interface ProvidersState {
  providers: Provider[]
  defaults: Record<string, string>
  loading: boolean
  error: string | null
  load: (client: OpencodeClient, force?: boolean) => Promise<void>
}

const PREFERRED_PROVIDER = 'opencode-go'

export const useProviders = create<ProvidersState>((set, get) => ({
  providers: [],
  defaults: {},
  loading: false,
  error: null,
  load: async (client, force = false) => {
    if (get().loading || (!force && get().providers.length > 0)) return
    set({ loading: true, error: null })
    try {
      const res = await client.config.providers()
      if (res.error || !res.data) throw new Error(errorMessage(res.error))
      const providers = [...res.data.providers].sort((a, b) =>
        a.id === PREFERRED_PROVIDER ? -1 : b.id === PREFERRED_PROVIDER ? 1 : a.name.localeCompare(b.name)
      )
      set({ providers, defaults: res.data.default, loading: false })
    } catch (err) {
      set({ error: errorMessage(err), loading: false })
    }
  }
}))
