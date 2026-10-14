import { useCallback, useEffect, useRef, useState } from 'react'
import type { Provider, ProviderAuthAuthorization, ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'
import { localeTag, t } from '@shared/i18n'
import { errorMessage, type OpencodeClient } from '../../../lib/opencode'
import { FREE_PROVIDER_ID } from '@shared/ai-availability'
import { startKeyTest } from './useKeyTest'
import { reconcileAfterProviderChange, snapshotProviderIds, type SwitchNotice } from './reconcileModels'

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
    .sort((a, b) => a.name.localeCompare(b.name, localeTag()))
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

/**
 * Guarda una API key en OpenCode (`auth.set`) y recarga los proveedores del servidor
 * (las respuestas en curso se interrumpen). Lanza si el servidor rechaza la clave.
 */
export async function saveProviderKey(client: OpencodeClient, providerID: string, key: string): Promise<void> {
  const r = await client.auth.set({ providerID, auth: { type: 'api', key } })
  if (r.error) throw new Error(errorMessage(r.error))
  await client.global.dispose()
}

/**
 * ¿Tiene una credencial guardada que el usuario puede quitar? El catálogo marca `source: 'api'` para las claves y `custom` para el
 * inicio de sesión por plugin (p. ej. ChatGPT); el proveedor gratuito preinstalado también es `custom` pero no tiene credencial.
 * `env` y `config` vienen del entorno o de la configuración, no de `auth.json`. No se lee `auth.json`: se decide con el catálogo.
 */
export function canDisconnect(p: Pick<Provider, 'id' | 'source'>): boolean {
  return p.source === 'api' || (p.source === 'custom' && p.id !== FREE_PROVIDER_ID)
}

/**
 * Acciones para conectar un proveedor (API key u OAuth). `busy` cubre las acciones cortas (guardar una clave, iniciar el login);
 * `oauthPending` cubre la espera del login en el navegador (hasta 5 min) y NO bloquea guardar la clave de otro proveedor.
 * `onChanged` recarga lo que dependa de los proveedores conectados. Tras cada cambio se reconcilian el modelo predeterminado y
 * los de cada modo (`notice` = aviso «Ahora usas …» con «Deshacer»). Todas las acciones relanzan el error.
 */
export function useProviderConnect(
  client: OpencodeClient | null,
  onChanged: () => Promise<void>
): {
  busy: boolean
  oauthPending: boolean
  error: string | null
  notice: SwitchNotice | null
  setNotice: (n: SwitchNotice | null) => void
  setKey: (providerID: string, key: string) => Promise<void>
  oauthStart: (providerID: string, method: number) => Promise<ProviderAuthAuthorization>
  oauthFinish: (providerID: string, method: number, code?: string) => Promise<void>
  /** Libera la interfaz de un login pendiente. El motor no ofrece cancelar `oauth.callback`: su espera termina sola (5 min). */
  cancelOauth: () => void
} {
  const [busy, setBusy] = useState(false)
  const [oauthPending, setOauthPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<SwitchNotice | null>(null)
  /** Cada login pendiente tiene su número: cancelar lo invalida (su resultado tardío ya no toca el estado de la interfaz). */
  const pendingGen = useRef(0)

  const run = useCallback(
    async <T>(fn: (c: OpencodeClient) => Promise<T>): Promise<T> => {
      if (!client) throw new Error(t('models.connect.notReady'))
      setBusy(true)
      setError(null)
      try {
        return await fn(client)
      } catch (err) {
        setError(errorMessage(err))
        throw err
      } finally {
        setBusy(false)
      }
    },
    [client]
  )

  /** Tras guardar credenciales: recarga y reconcilia las elecciones de modelo (el aviso solo si hubo cambio). */
  const afterChange = useCallback(
    async (c: OpencodeClient, previousIds: string[] | null): Promise<void> => {
      await onChanged()
      const n = await reconcileAfterProviderChange(c, previousIds)
      if (n) setNotice(n)
    },
    [onChanged]
  )

  const setKey = useCallback(
    (providerID: string, key: string) =>
      run(async (c) => {
        const before = await snapshotProviderIds(c)
        await saveProviderKey(c, providerID, key)
        // Solo claves ya guardadas: main lee la clave de su almacén (no viaja por el IPC) y avisa si no sirve.
        startKeyTest(providerID)
        await afterChange(c, before)
      }),
    [run, afterChange]
  )

  const oauthStart = useCallback(
    (providerID: string, method: number) =>
      run(async (c) => {
        const r = await c.provider.oauth.authorize({ providerID, method })
        if (r.error || !r.data) throw new Error(errorMessage(r.error))
        return r.data
      }),
    [run]
  )

  const oauthFinish = useCallback(
    async (providerID: string, method: number, code?: string): Promise<void> => {
      if (!client) throw new Error(t('models.connect.notReady'))
      const mine = ++pendingGen.current
      setOauthPending(true)
      setError(null)
      try {
        const before = await snapshotProviderIds(client)
        const r = await client.provider.oauth.callback({ providerID, method, code })
        if (r.error) throw new Error(errorMessage(r.error))
        await client.global.dispose()
        await afterChange(client, before)
      } catch (err) {
        if (mine === pendingGen.current) setError(errorMessage(err))
        throw err
      } finally {
        if (mine === pendingGen.current) setOauthPending(false)
      }
    },
    [client, afterChange]
  )

  const cancelOauth = useCallback(() => {
    pendingGen.current++
    setOauthPending(false)
  }, [])

  return { busy, oauthPending, error, notice, setNotice, setKey, oauthStart, oauthFinish, cancelOauth }
}
