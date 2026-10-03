/**
 * Motores OpenCode que ve el celular y reescritura de credenciales (F0-T4).
 *
 * El celular NUNCA recibe la contraseña Basic del sidecar: `opencode:connection`, `opencode:restart`, el evento
 * `opencode:connection` y `tasks:start` se reescriben a `baseUrl = onyx://engine/main` (o `.../task/<token>`) y
 * `authorization = ''`. El mapeo token → conexión real vive solo aquí (en el Mac) y caduca al cerrar (`clear()`).
 * `scrub` es la red de seguridad final: cualquier cadena de una respuesta o evento que contenga una credencial conocida
 * se tacha, aunque algún canal la devolviera por un camino que no se previó.
 */
import { randomBytes } from 'node:crypto'
import type { OpencodeConnection } from '@shared/types'
import type { TasksConnection } from '@shared/ipc-tasks'

export const ENGINE_MAIN = 'main'
export const ENGINE_SCHEME = 'onyx://engine/'
export const REDACTED = '[redacted]'

export interface EngineTarget {
  baseUrl: string
  /** Valor completo de la cabecera `Authorization` (nunca sale del Mac). */
  authorization: string
}

interface TaskEngine {
  token: string
  folder: string
  target: EngineTarget
}

export interface EngineRegistryOptions {
  /** Conexión al motor principal (lo arranca si hace falta). */
  getMain: () => Promise<OpencodeConnection>
}

/** Texto de una credencial Basic en todas sus formas útiles: valor completo, `usuario:clave`, clave y base64. */
function secretForms(authorization: string): string[] {
  const out = new Set<string>()
  if (authorization.length >= 6) out.add(authorization)
  const b64 = authorization.replace(/^Basic\s+/i, '').trim()
  if (b64.length >= 6) out.add(b64)
  try {
    const plain = Buffer.from(b64, 'base64').toString('utf8')
    if (plain.includes(':')) {
      if (plain.length >= 6) out.add(plain)
      const pass = plain.slice(plain.indexOf(':') + 1)
      if (pass.length >= 6) out.add(pass)
    }
  } catch {
    /* no era base64 */
  }
  return [...out]
}

export class EngineRegistry {
  private readonly tasks = new Map<string, TaskEngine>()
  private readonly byFolder = new Map<string, string>()
  private readonly known = new Set<string>()

  constructor(private readonly o: EngineRegistryOptions) {}

  private remember(authorization: string): void {
    for (const s of secretForms(authorization)) this.known.add(s)
  }

  /** Credenciales conocidas (para la prueba de propiedad y `scrub`). */
  secrets(): string[] {
    return [...this.known]
  }

  /** `onyx://engine/main` o `onyx://engine/task/<token>` → identificador de motor del protocolo (`main`, `task/<token>`). */
  static engFromUrl(url: string): string | null {
    return url.startsWith(ENGINE_SCHEME) ? url.slice(ENGINE_SCHEME.length) : null
  }

  /** Motor principal: la conexión que el renderer del Mac recibe, sin credenciales. */
  rewriteConnection(conn: OpencodeConnection): OpencodeConnection {
    this.remember(conn.authorization)
    return { ...conn, baseUrl: `${ENGINE_SCHEME}${ENGINE_MAIN}`, authorization: '', username: '' }
  }

  /** Motor de una tarea: registra el mapeo (un token estable por carpeta) y devuelve la conexión sin credenciales. */
  rewriteTasksConnection(conn: TasksConnection): TasksConnection {
    this.remember(conn.authorization)
    let token = this.byFolder.get(conn.folder)
    if (!token) {
      token = randomBytes(12).toString('base64url')
      this.byFolder.set(conn.folder, token)
    }
    this.tasks.set(token, { token, folder: conn.folder, target: { baseUrl: conn.baseUrl, authorization: conn.authorization } })
    return { ...conn, baseUrl: `${ENGINE_SCHEME}task/${token}`, authorization: '' }
  }

  /** ¿Existe el motor? (`main` siempre; `task/<token>` solo si lo registró un `tasks:start`). */
  has(eng: string): boolean {
    if (eng === ENGINE_MAIN) return true
    const m = /^task\/([A-Za-z0-9_-]{8,64})$/.exec(eng)
    return !!m && this.tasks.has(m[1] as string)
  }

  /** Carpeta del motor de una tarea (para acotar el ámbito de sus eventos). */
  folderOf(eng: string): string | null {
    const m = /^task\/([A-Za-z0-9_-]{8,64})$/.exec(eng)
    return m ? (this.tasks.get(m[1] as string)?.folder ?? null) : null
  }

  /** Conexión real del motor (con credenciales) o `null` si no existe. Solo para uso interno del Mac. */
  async resolve(eng: string): Promise<EngineTarget | null> {
    if (eng === ENGINE_MAIN) {
      const c = await this.o.getMain()
      this.remember(c.authorization)
      return { baseUrl: c.baseUrl, authorization: c.authorization }
    }
    const m = /^task\/([A-Za-z0-9_-]{8,64})$/.exec(eng)
    const t = m ? this.tasks.get(m[1] as string) : undefined
    return t ? t.target : null
  }

  /** Motores de tarea registrados (para cerrar sus streams). */
  taskEngines(): string[] {
    return [...this.tasks.keys()].map((t) => `task/${t}`)
  }

  /** Los tokens caducan al cerrar (último celular desconectado, «Cortar todo»). */
  clear(): void {
    this.tasks.clear()
    this.byFolder.clear()
  }

  /** Tacha toda credencial conocida que aparezca en cualquier cadena del valor (copia profunda; no modifica el original). */
  scrub<T>(value: T): T {
    const secrets = [...this.known].sort((a, b) => b.length - a.length)
    if (secrets.length === 0) return value
    return scrubDeep(value, secrets, 0) as T
  }
}

function scrubString(s: string, secrets: string[]): string {
  let out = s
  for (const sec of secrets) if (out.includes(sec)) out = out.split(sec).join(REDACTED)
  return out
}

function scrubDeep(v: unknown, secrets: string[], depth: number): unknown {
  if (typeof v === 'string') return scrubString(v, secrets)
  if (v === null || typeof v !== 'object') return v
  if (depth > 64) return null
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, secrets, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[scrubString(k, secrets)] = scrubDeep(x, secrets, depth + 1)
  return out
}
