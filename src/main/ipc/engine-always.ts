import type { IpcMain } from 'electron'
import { ALWAYS_ID_RE, parseAlwaysList, type AlwaysListResult, type AlwaysRevokeResult } from '@shared/engine-always'
import type { OpencodeConnection } from '@shared/types'
import type { OpencodeServer } from '../opencode/server'
import { handle, IpcError } from './handle'

/**
 * Ver y quitar los permisos «siempre» que el motor guardó para una carpeta (Ola 7, 7.22). El renderer pide por IPC y main habla con el
 * sidecar con la autorización de siempre (como `engine-code-extras.ts`). Rutas del motor propio, con el enrutado por `?directory=`:
 *  - `GET /permission/siempre` -> `{ activo, reglas: [{ id, permission, pattern }], aviso? }`
 *  - `DELETE /permission/siempre/{id}` -> `true` (404 si el id ya no existe)
 * 404/405 en el listado = el motor no las tiene (anterior o externo): `available: false`. Solo cubre el motor principal; los servidores
 * aislados de Tareas guardan en su propio directorio privado y se limpian con «Olvidar los permisos guardados».
 * El borrado de TODOS (`DELETE /permission/siempre`) no se usa: ya existe `settings:forgetAlways`.
 */

type Conn = Pick<OpencodeConnection, 'baseUrl' | 'authorization'>
type FetchLike = typeof fetch

const TIMEOUT_MS = 6000
const MAX_BODY_CHARS = 2_000_000

const withDir = (url: string, directory: string): string => `${url}?directory=${encodeURIComponent(directory)}`

export async function fetchAlwaysRules(conn: Conn, req: { directory: string }, fetchImpl: FetchLike = fetch): Promise<AlwaysListResult> {
  const res = await fetchImpl(withDir(`${conn.baseUrl}/permission/siempre`, req.directory), {
    headers: { Authorization: conn.authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const text = await res.text().catch(() => '')
  if (text.length > MAX_BODY_CHARS) throw new Error('El motor devolvió una respuesta demasiado grande')
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // se trata abajo como ilegible
  }
  const parsed = parseAlwaysList(json)
  if (!parsed) throw new Error('El motor devolvió una lista ilegible')
  return { available: true, ...parsed }
}

export async function revokeAlwaysRule(
  conn: Conn,
  req: { directory: string; id: string },
  fetchImpl: FetchLike = fetch
): Promise<AlwaysRevokeResult> {
  // Defensa en profundidad: el id va en la ruta, nunca con caracteres que cambien el destino.
  if (!ALWAYS_ID_RE.test(req.id)) throw new Error('Id de regla no válido')
  const res = await fetchImpl(withDir(`${conn.baseUrl}/permission/siempre/${encodeURIComponent(req.id)}`, req.directory), {
    method: 'DELETE',
    headers: { Authorization: conn.authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 405) return { available: false }
  // 404 = esa regla ya no existe (o el motor no tiene la ruta: el listado ya lo habría dicho): no es un éxito.
  if (res.status === 404) return { available: true, ok: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  return { available: true, ok: true }
}

export function registerEngineAlwaysHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  const conn = (): Conn => {
    const c = server.getConnection()
    if (!c) throw new IpcError('NOT_READY', 'El motor aún no está listo')
    return c
  }
  handle(ipcMain, 'settings:alwaysList', (req) => fetchAlwaysRules(conn(), req))
  handle(ipcMain, 'settings:alwaysRevoke', (req) => revokeAlwaysRule(conn(), req))
}
