/**
 * Adaptador del modo Code hacia:
 *  - el cliente SDK de OpenCode (se reutiliza el de `stores/server`, creado con baseUrl + auth del sidecar),
 *  - el stream global de eventos (`/global/event`, vía `onOpencodeEvent`),
 *  - la API del proceso principal (`CodeApi`): `window.api.code` si existe, o los canales IPC genéricos.
 */
import type { WindowApi } from '@shared/ipc'
import type { IpcResult } from '@shared/ipc'
import { useServer, onOpencodeEvent, onStreamReconnect } from '../../../stores/server'
import type { OcEvent, OpencodeClient } from '../../../lib/opencode'
import { errorMessage } from '../../../lib/opencode'
import type { CodeApi } from './types'

export { errorMessage }
export type { OcEvent, OpencodeClient }

/** Cliente SDK actual o `null` si el sidecar aún no está listo. */
export function getClient(): OpencodeClient | null {
  return useServer.getState().client
}

/** Igual que `getClient` pero lanza si no hay conexión. */
export function requireClient(): OpencodeClient {
  const c = getClient()
  if (!c) throw new Error('OpenCode no está conectado todavía')
  return c
}

/** Hook: cliente SDK reactivo. */
export function useClient(): OpencodeClient | null {
  return useServer((s) => s.client)
}

export function subscribeEvents(listener: (event: OcEvent, directory: string) => void): () => void {
  return onOpencodeEvent(listener)
}

export function subscribeReconnect(listener: () => void): () => void {
  return onStreamReconnect(listener)
}

/** Desenvuelve el resultado `{ data, error }` del SDK. */
export function sdkData<T>(res: { data?: T; error?: unknown }): T {
  if (res.error !== undefined && res.error !== null) throw new Error(errorMessage(res.error))
  if (res.data === undefined) throw new Error('Respuesta vacía de OpenCode')
  return res.data
}

// ---------------------------------------------------------------------------
// CodeApi
// ---------------------------------------------------------------------------

function unwrap<T>(r: IpcResult<T>): T {
  if (r.ok) return r.data
  throw new Error(r.code === 'NOT_IMPLEMENTED' ? `No implementado todavía: ${r.error}` : r.error)
}

function buildFromIpc(api: WindowApi): CodeApi {
  return {
    openFolder: async (opts) => unwrap(await api.invoke('dialog:openFolder', opts ?? {})),
    gitStatus: async (cwd) => unwrap(await api.invoke('git:status', { cwd })),
    gitDiff: async (req) => unwrap(await api.invoke('git:diff', req)),
    ptyCreate: async (req) => unwrap(await api.invoke('pty:create', req)),
    ptyWrite: async (id, data) => unwrap(await api.invoke('pty:write', { id, data })),
    ptyResize: async (id, cols, rows) => unwrap(await api.invoke('pty:resize', { id, cols, rows })),
    ptyKill: async (id) => unwrap(await api.invoke('pty:kill', { id })),
    onPtyData: (listener) => api.on('pty:data', listener),
    onPtyExit: (listener) => api.on('pty:exit', listener)
  }
}

let cached: CodeApi | null = null

export function getCodeApi(): CodeApi {
  if (cached) return cached
  const w = window.api as WindowApi & { code?: Partial<CodeApi> }
  const base = buildFromIpc(w)
  // Si el preload expone `window.api.code`, sus métodos tienen prioridad (mismos nombres).
  cached = w.code ? { ...base, ...w.code } : base
  return cached
}
