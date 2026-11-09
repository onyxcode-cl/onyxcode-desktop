/**
 * Confianza de carpetas del lado de la app (motor `lazunox.16`, bandera `LAZUNOX_TRUST_REQUIRED=1`).
 *
 * El motor ya no carga una carpeta (complementos, conectores, `.opencode`) si la app no le dijo antes que es de confianza:
 *   `POST /lazunox/trust {directory}` la declara, `DELETE` la quita y la descarga, `GET` lista. Una ruta con `?directory=` de una carpeta no
 * declarada responde `403 {"error":"folder_not_trusted"}` (salvo las lecturas de historial, que van en frío).
 * La lista vive SOLO en la memoria del motor: se pierde en cada reinicio, así que la app es la dueña y la reenvía (`declareAll`) ANTES de
 * decir que el motor está listo.
 *
 * Quién declara qué (ver `docs/SEGURIDAD.md`, sección de la 1.8.13):
 *  - Code: la carpeta pasó el diálogo de confianza en esta ejecución (renderer → `project:engineTrust`), más los árboles de trabajo que la
 *    propia app creó para ella.
 *  - Chat: su carpeta propia, en cada arranque.
 *  - Rutinas (modo código), Comparar: la app declara justo antes de usar la carpeta, como hacía el motor de la 1.8.12 al cargarla sin pedir nada.
 *  - Tareas/Overdrive: cada servidor aislado recibe la declaración de SU carpeta en cuanto responde (`tasks/sandbox.ts`).
 *
 * Contra un motor sin estas rutas (anterior, oficial, falso de pruebas) todo es inofensivo: 404 = «no soportado» y no se reintenta.
 */
import { ENGINE_TRUST_PATH } from '@shared/engine-contract-env'

export interface TrustConn {
  baseUrl: string
  authorization: string
}

/** `ok`: declarada/quitada. `unsupported`: el motor no tiene la ruta. `missing`: la carpeta no existe. `failed`: no se pudo (red, 4xx/5xx). */
export type TrustResult = 'ok' | 'unsupported' | 'missing' | 'failed'

const TIMEOUT_MS = 5_000
/** Tope de carpetas que se recuerdan para reenviarlas en cada reinicio (Code abre pocas; esto es solo defensa). */
const MAX_WANTED = 200

const isAbs = (d: unknown): d is string =>
  typeof d === 'string' && d.length > 0 && d.length <= 4096 && !d.includes('\0') && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(d)
const connKey = (c: TrustConn): string => `${c.baseUrl}|${c.authorization}`
const norm = (d: string): string => (d.length > 1 ? d.replace(/[\\/]+$/, '') || d : d)

/** Una llamada a `/lazunox/trust`. Nunca lanza. */
export async function sendTrust(
  conn: TrustConn,
  method: 'POST' | 'DELETE',
  directory: string,
  fetchImpl: typeof fetch = fetch
): Promise<TrustResult> {
  try {
    const res = await fetchImpl(`${conn.baseUrl}${ENGINE_TRUST_PATH}`, {
      method,
      headers: { Authorization: conn.authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (res.ok) return 'ok'
    if (res.status === 404) {
      const text = await res.text().catch(() => '')
      return /FolderNotFound/i.test(text) ? 'missing' : 'unsupported'
    }
    if (res.status === 405) return 'unsupported'
    return 'failed'
  } catch {
    return 'failed'
  }
}

export interface EngineTrustBinding {
  /** Arranca el motor principal si hace falta y da su conexión. */
  start: () => Promise<TrustConn>
  /** La conexión del motor principal SOLO si ya está listo (no lo arranca). */
  peek: () => TrustConn | null
}

export class EngineTrust {
  /** Carpetas que la app quiere ver declaradas en el motor principal; se reenvían en cada arranque. */
  private wanted = new Set<string>()
  /** Lo ya declarado, por motor (URL + clave: ambas cambian en cada arranque, así que un reinicio empieza de cero aunque se reutilice el puerto). */
  private declared = new Map<string, Set<string>>()
  private inflight = new Map<string, Promise<TrustResult>>()
  private binding: EngineTrustBinding | null = null

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  bind(b: EngineTrustBinding | null): void {
    this.binding = b
  }

  /** Carpetas que se reenviarán al reiniciar. */
  wantedFolders(): string[] {
    return [...this.wanted]
  }

  /** Solo pruebas. */
  reset(): void {
    this.wanted.clear()
    this.declared.clear()
    this.inflight.clear()
    this.binding = null
  }

  private mark(conn: TrustConn, dir: string, on: boolean): void {
    let set = this.declared.get(connKey(conn))
    if (!set) {
      // Un motor viejo deja su entrada: se acota para que reinicios repetidos no la hagan crecer sin fin.
      if (this.declared.size >= 8) this.declared.delete(this.declared.keys().next().value as string)
      set = new Set()
      this.declared.set(connKey(conn), set)
    }
    if (on) set.add(dir)
    else set.delete(dir)
  }

  /** Declara `dir` en el motor de `conn` (cualquiera: el principal o uno de Tareas). No lo recuerda para reenviarlo. */
  async declareOn(conn: TrustConn, directory: string): Promise<TrustResult> {
    if (!isAbs(directory)) return 'failed'
    const dir = norm(directory)
    if (this.declared.get(connKey(conn))?.has(dir)) return 'ok'
    const key = `${connKey(conn)}\n${dir}`
    const have = this.inflight.get(key)
    if (have) return have
    const p = sendTrust(conn, 'POST', dir, this.fetchImpl)
      .then((r) => {
        // `unsupported` también se anota: contra un motor sin la ruta no se insiste en cada petición.
        if (r === 'ok' || r === 'unsupported') this.mark(conn, dir, true)
        return r
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  /**
   * Declara `dir` en el motor principal y la recuerda para los reinicios. Espera a que el motor esté listo. Nunca lanza: si no se pudo,
   * devuelve `failed` y quien llama sigue (a lo sumo recibirá `403 folder_not_trusted`, que las pantallas tratan como «sin confianza»).
   */
  async declare(directory: string): Promise<TrustResult> {
    if (!isAbs(directory) || !this.binding) return 'failed'
    const dir = norm(directory)
    if (!this.wanted.has(dir) && this.wanted.size < MAX_WANTED) this.wanted.add(dir)
    let conn: TrustConn
    try {
      conn = await this.binding.start()
    } catch {
      return 'failed' // el motor no arrancó: al arrancar se reenvían las recordadas
    }
    return this.declareOn(conn, dir)
  }

  /** Declara varias (Code: la carpeta y sus árboles de trabajo). */
  async declareMany(dirs: readonly string[]): Promise<void> {
    await Promise.all(dirs.map((d) => this.declare(d)))
  }

  /** La persona quitó la confianza: se olvida y se le dice al motor (que además descarga la carpeta). Nunca lanza. */
  async revoke(directory: string): Promise<TrustResult> {
    if (!isAbs(directory)) return 'failed'
    const dir = norm(directory)
    this.wanted.delete(dir)
    for (const set of this.declared.values()) set.delete(dir)
    const conn = this.binding?.peek()
    if (!conn) return 'ok' // sin motor en marcha no hay nada que quitar: la lista del motor es de memoria
    return sendTrust(conn, 'DELETE', dir, this.fetchImpl)
  }

  /**
   * Arranque o reinicio del motor principal: ANTES de que alguna pantalla le pida algo, declara las carpetas propias de la app (`always`:
   * Chat) y todas las recordadas. Nunca lanza; devuelve las que no se pudieron declarar (para el registro).
   */
  async declareAll(conn: TrustConn, always: readonly string[]): Promise<string[]> {
    const dirs = [...new Set([...always, ...this.wanted].filter(isAbs).map(norm))]
    const failed: string[] = []
    const queue = [...dirs]
    const worker = async (): Promise<void> => {
      for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
        const r = await this.declareOn(conn, d)
        if (r === 'failed') failed.push(d)
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, dirs.length) }, worker))
    return failed
  }
}

/** Instancia del proceso principal. `index.ts` la ata al sidecar con `bind`. */
export const engineTrust = new EngineTrust()
