import { useCallback, useEffect, useRef, useState } from 'react'
import type { Provider, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { errorMessage, type OpencodeClient } from '../../../lib/opencode'

/** Catálogo de proveedores de OpenCode (`provider.list` + `provider.auth`). */
export interface ProviderCatalog {
  all: Provider[]
  connected: string[]
  auth: Record<string, ProviderAuthMethod[]>
}

/** Carga el catálogo de proveedores y métodos de autenticación; `reload` lo vuelve a pedir. */
export function useProviderCatalog(client: OpencodeClient | null): {
  catalog: ProviderCatalog | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const reload = useCallback(async () => {
    if (!client) return
    const mine = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const [list, auth] = await Promise.all([client.provider.list(), client.provider.auth()])
      if (list.error || !list.data) throw new Error(errorMessage(list.error))
      if (mine === generation.current) setCatalog({ all: list.data.all, connected: list.data.connected, auth: auth.data ?? {} })
    } catch (err) {
      if (mine === generation.current) setError(errorMessage(err))
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void reload()
    const gen = generation
    return () => {
      gen.current++
    }
  }, [reload])

  return { catalog, loading, error, reload }
}

/** Proveedores no conectados (salvo `exclude`), ordenados por nombre. */
export function unconnectedProviders(catalog: ProviderCatalog, exclude: string[] = []): Provider[] {
  return catalog.all
    .filter((p) => !catalog.connected.includes(p.id) && !exclude.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Nombre visible de un proveedor según el catálogo (o su id si no está). */
export function providerName(catalog: Pick<ProviderCatalog, 'all'>, id: string): string {
  return catalog.all.find((p) => p.id === id)?.name ?? id
}

export interface AuthOptions {
  /** ¿Admite API key? (también si el servidor no declara métodos). */
  api: boolean
  /** Métodos OAuth utilizables (índice en la lista original); se descartan los que piden datos previos (`prompts`). */
  oauth: { index: number; label: string }[]
}

export function authOptions(methods: ProviderAuthMethod[] | undefined): AuthOptions {
  const list = methods ?? []
  const oauth: AuthOptions['oauth'] = []
  list.forEach((m, index) => {
    if (m.type === 'oauth' && !m.prompts?.length) oauth.push({ index, label: m.label })
  })
  return { api: list.length === 0 || list.some((m) => m.type === 'api'), oauth }
}
