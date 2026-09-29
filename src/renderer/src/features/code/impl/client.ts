/**
 * Adaptador del modo Code hacia:
 *  - el cliente SDK de OpenCode (se reutiliza el de `stores/server`, creado con baseUrl + auth del sidecar),
 *  - el stream global de eventos (`/global/event`, vía `onOpencodeEvent`),
 *  - la API del proceso principal (`CodeApi`): `window.api.code` (preload).
 */
import type { WindowApi } from '@shared/ipc'
import { useServer, onOpencodeEvent, onStreamReconnect } from '../../../stores/server'
import type { OcEvent, OpencodeClient } from '../../../lib/opencode'
import { errorMessage } from '../../../lib/opencode'

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

/** API pty/git/diálogos completa de `window.api.code` (preload), o `null` si no existe. */
export function nativeCode(): import('@shared/ipc-code').CodeApi | null {
  const w = window.api as WindowApi & { code?: import('@shared/ipc-code').CodeApi }
  return w.code && typeof w.code.git?.status === 'function' ? w.code : null
}

/** Como `nativeCode` pero lanza si `window.api.code` no está disponible. */
export function requireCode(): import('@shared/ipc-code').CodeApi {
  const c = nativeCode()
  if (!c) throw new Error('API nativa de Code no disponible')
  return c
}
