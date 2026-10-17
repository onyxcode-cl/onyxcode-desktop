/**
 * Estado y acciones de los conectores (servidores MCP) de la app, compartidos por Ajustes › Conectores y por Personalización
 * (F8-B181): una sola lógica de alta, baja, estado y conexión; cada pantalla pone su presentación.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpStatus } from '@opencode-ai/sdk/v2/client'
import type { AppMcpConfig, McpEntry } from '@shared/ipc-extras'
import type { McpCatalogState } from '@shared/mcp-catalog'
import { errorMessage } from '../../../lib/opencode'
import { useServer } from '../../../stores/server'
import { getExtras, requireExtras } from './extras'

export type ExternalEntry = McpEntry | { enabled: boolean }

export interface InstallRequest {
  id: string
  name: string
  inputs: Record<string, string>
  enable: boolean
  askEachUse: boolean
}

export interface McpConnections {
  appCfg: AppMcpConfig | null
  /** Definición efectiva (merge de todas las configs) que reporta el servidor. */
  merged: Record<string, ExternalEntry>
  status: Record<string, McpStatus>
  catalog: McpCatalogState | null
  loading: boolean
  /** Primera carga terminada (con éxito o con error). */
  loaded: boolean
  error: string | null
  setError: (e: string | null) => void
  refresh: () => Promise<void>
  /** Servidor de la app (archivo propio) instalado desde la ficha `catalogId`, si hay. */
  serverOf: (catalogId: string) => string | null
  setEnabled: (name: string, enabled: boolean) => Promise<void>
  remove: (name: string) => Promise<void>
  install: (req: InstallRequest) => Promise<void>
  /** Inicia el inicio de sesión del servicio (el flujo del motor; la app nunca ve la contraseña). */
  authenticate: (name: string) => Promise<void>
}

export function useMcpConnections(opts?: { onRefresh?: () => Promise<void> }): McpConnections {
  const client = useServer((s) => s.client)
  const directory = useServer((s) => s.connection?.chatDirectory)
  const [appCfg, setAppCfg] = useState<AppMcpConfig | null>(null)
  const [merged, setMerged] = useState<Record<string, ExternalEntry>>({})
  const [status, setStatus] = useState<Record<string, McpStatus>>({})
  const [catalog, setCatalog] = useState<McpCatalogState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onRefresh = useRef(opts?.onRefresh)
  onRefresh.current = opts?.onRefresh

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const extras = getExtras()
      const own = extras ? await extras.invoke('mcp:getConfig') : null
      setAppCfg(own)
      if (extras) setCatalog(await extras.invoke('mcp:catalog').catch(() => null))
      await onRefresh.current?.()
      if (client) {
        const [st, cfg] = await Promise.all([client.mcp.status({ directory }), client.config.get({ directory })])
        if (st.error) throw new Error(errorMessage(st.error))
        setStatus(st.data ?? {})
        setMerged((cfg.data?.mcp as Record<string, ExternalEntry> | undefined) ?? {})
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [client, directory])

  useEffect(() => {
    void refresh()
    const extras = getExtras()
    if (!extras) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = extras.on('mcp:changed', (cfg) => {
      setAppCfg(cfg)
      // El servidor recarga su config tras el cambio; volver a pedir estado.
      timer = setTimeout(() => void refresh(), 400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [refresh])

  const serverOf = useCallback(
    (catalogId: string): string | null => {
      const hit = Object.entries(catalog?.installed ?? {}).find(([name, i]) => i.catalogId === catalogId && !!appCfg?.servers[name])
      return hit ? hit[0] : null
    },
    [catalog, appCfg]
  )

  const setEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      await requireExtras().invoke('mcp:setEnabled', { name, enabled })
      await refresh()
    },
    [refresh]
  )
  const remove = useCallback(
    async (name: string) => {
      await requireExtras().invoke('mcp:remove', { name })
      await refresh()
    },
    [refresh]
  )
  const install = useCallback(
    async (req: InstallRequest) => {
      await requireExtras().invoke('mcp:installCatalog', req)
      await refresh()
    },
    [refresh]
  )
  const authenticate = useCallback(
    async (name: string) => {
      if (!client) return
      const r = await client.mcp.auth.authenticate({ name, directory })
      if (r.error) throw new Error(errorMessage(r.error))
      await refresh()
    },
    [client, directory, refresh]
  )

  return { appCfg, merged, status, catalog, loading, loaded, error, setError, refresh, serverOf, setEnabled, remove, install, authenticate }
}
