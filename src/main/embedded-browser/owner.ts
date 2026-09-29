/**
 * Resolución del actor que llama al MCP (Lote D, B.6 guarda 1): `onyxcode_session` es obligatorio y
 * el TOKEN del cliente (registrado por `mcp-server.ts` con `clientFor`) determina el producto, si
 * está sandboxeado y, en Cowork, la carpeta. En Code (un único sidecar compartido por todas las
 * carpetas) la carpeta se resuelve por sesión con `GET /session/:id` al propio sidecar, con caché:
 * el cliente NUNCA puede decir por qué carpeta actúa, solo de qué sesión de OpenCode viene.
 */
import type { BrowserOwner, BrowserProduct } from '@shared/ipc-browser'
import type { OpencodeConnection } from '@shared/types'
import type { AgentActor } from './api'

/** Atadura del cliente MCP (una por servidor de OpenCode que arranca `configFor`). */
export interface ClientBinding {
  product: BrowserProduct
  sandboxed: boolean
  /** Cowork: la carpeta de este servidor, fija de por vida. Code: null (varía por sesión). */
  folder: string | null
  /** Para logs. */
  label?: string
}

export interface ResolveActorDeps {
  mainConnection(): Promise<OpencodeConnection>
}

const CODE_DIR_CACHE_MAX = 500

interface CacheEntry {
  directory: string
  at: number
}

/** Caché sesión de Code → carpeta (no caduca: una sesión no cambia de carpeta; tope de tamaño). */
const codeDirCache = new Map<string, CacheEntry>()

function rememberCodeDir(sessionId: string, directory: string): void {
  if (codeDirCache.size >= CODE_DIR_CACHE_MAX) {
    const oldest = codeDirCache.keys().next().value
    if (oldest !== undefined) codeDirCache.delete(oldest)
  }
  codeDirCache.set(sessionId, { directory, at: Date.now() })
}

/** Solo para pruebas: vacía la caché de carpetas de Code. */
export function clearCodeDirCacheForTests(): void {
  codeDirCache.clear()
}

async function resolveCodeDirectory(sessionId: string, deps: ResolveActorDeps): Promise<string> {
  const cached = codeDirCache.get(sessionId)
  if (cached) return cached.directory
  let conn: OpencodeConnection
  try {
    conn = await deps.mainConnection()
  } catch {
    throw new Error('No se pudo identificar la tarea (el sidecar de Code no está disponible).')
  }
  let res: Response
  try {
    res = await fetch(`${conn.baseUrl}/session/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: conn.authorization },
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    throw new Error('No se pudo identificar la tarea (no se pudo consultar la sesión).')
  }
  if (!res.ok) throw new Error('No se pudo identificar la tarea (sesión desconocida).')
  let body: { directory?: unknown }
  try {
    body = (await res.json()) as { directory?: unknown }
  } catch {
    throw new Error('No se pudo identificar la tarea (respuesta inválida al consultar la sesión).')
  }
  if (typeof body.directory !== 'string' || !body.directory) {
    throw new Error('No se pudo identificar la tarea (la sesión no tiene carpeta).')
  }
  rememberCodeDir(sessionId, body.directory)
  return body.directory
}

/**
 * Construye el `AgentActor` a partir de `onyxcode_session` (inyectado por el plugin `onyxcode-session`)
 * y la atadura del cliente MCP que llamó. Falla cerrado si falta la sesión o no se puede resolver
 * la carpeta de Code.
 */
export async function resolveActor(binding: ClientBinding, onyxcodeSession: unknown, deps: ResolveActorDeps): Promise<AgentActor> {
  const sessionId = typeof onyxcodeSession === 'string' ? onyxcodeSession.trim() : ''
  if (!sessionId) {
    throw new Error(
      'No se pudo identificar la tarea (falta onyxcode_session). Esto no debería pasar si el plugin ' +
        'onyxcode-session está activo: reinicia el servidor de OpenCode.'
    )
  }
  if (binding.product === 'cowork') {
    if (!binding.folder) throw new Error('No se pudo identificar la carpeta de la tarea de Cowork.')
    const owner: BrowserOwner = { kind: 'cowork', folder: binding.folder }
    return { sessionId, product: 'cowork', owner, sandboxed: binding.sandboxed, label: binding.label }
  }
  const directory = await resolveCodeDirectory(sessionId, deps)
  const owner: BrowserOwner = { kind: 'code', directory }
  return { sessionId, product: 'code', owner, sandboxed: binding.sandboxed, label: binding.label }
}
