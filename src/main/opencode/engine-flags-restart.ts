/**
 * Reinicio del motor al cambiar las funciones experimentales (Modo código, subagentes en segundo plano).
 *
 * Las variables `OPENCODE_EXPERIMENTAL_*` se leen UNA vez al lanzar `opencode serve`, así que un cambio en Ajustes solo
 * vale tras relanzar el proceso. Este módulo compara el entorno que corresponde a cada familia de motor ANTES y DESPUÉS:
 *  - sidecar principal (Chat + Code comparten proceso): `engineFlagEnvForMainSidecar`;
 *  - Overdrive (Tareas, sandbox): `engineFlagEnvFor(_, 'tasks')`.
 * Solo si cambió el entorno de una familia se reinicia ESA familia, y nunca a mitad de un turno: se espera a que todas las
 * sesiones estén ociosas (se avisa una vez a la persona y se reintenta). Cambiar otra cosa de Ajustes no reinicia nada.
 *
 * Los servidores de Control total (sin sandbox) no se relanzan aquí: `restartSandbox` solo cubre el sandbox y pararlos
 * dejaría la interfaz sin servidor; toman el entorno nuevo en su próximo arranque (el monitor los apaga ociosos).
 */
import { engineFlagEnvFor, engineFlagEnvForMainSidecar } from '@shared/engine-experiments'
import type { OpencodeConnection, ServerStatus, Settings } from '@shared/types'

type Env = Record<string, string>
type SettingsLike = Pick<Settings, 'engineExperiments'> & Partial<Pick<Settings, 'recentFolders'>>

export interface EngineFlagsServer {
  restart(): Promise<unknown>
  getStatus(): ServerStatus
  getConnection(): OpencodeConnection | null
}

export interface EngineFlagsLiveServer {
  folder: string
  directory: string
  fullAccess: boolean
  baseUrl: string
  authorization: string
  startedAt: number
}

export interface EngineFlagsTasks {
  liveServers(): EngineFlagsLiveServer[]
  restartSandbox(folder: string): Promise<boolean>
}

export interface EngineFlagsRestartDeps {
  settings: { get(): SettingsLike; onChange(listener: (s: SettingsLike) => void): () => void }
  server: EngineFlagsServer
  /** Ausente donde no hay modo Tareas. */
  tasks?: EngineFlagsTasks
  /** Directorio del modo Chat: el estado del sidecar principal se consulta por directorio. */
  chatDirectory: string
  /** ¿Todas las sesiones de esos directorios están ociosas? Si no se puede saber, `false` (no se reinicia). */
  isIdle?: (baseUrl: string, authorization: string, directories: string[]) => Promise<boolean>
  /** Aviso visible a la persona: hay un cambio esperando, o ya se aplicó. */
  notify?: (kind: 'pending' | 'restarted') => void
  /** Reintento mientras haya turnos en curso (ms). */
  retryMs?: number
  now?: () => number
}

const sameEnv = (a: Env, b: Env): boolean => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/** Tope de sesiones recientes que se piden para descubrir carpetas que Lazunox no tiene anotadas. */
const DISCOVER_LIMIT = 200

/**
 * Carpetas donde el motor tiene sesiones recientes (`GET /experimental/session`, de todos los proyectos), incluidas las
 * hijas (subagentes). Sirve para no depender solo de `chatDirectory` y `recentFolders`: un subagente de fondo o una
 * sesión de una carpeta que ya no figura en recientes también cuenta como «en curso». Mejor esfuerzo: si el motor no
 * tiene la ruta o falla, se devuelve `[]` y se sigue con las carpetas conocidas.
 */
async function discoverDirectories(baseUrl: string, authorization: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/experimental/session?limit=${DISCOVER_LIMIT}&archived=false`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) return []
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) return []
    const dirs = new Set<string>()
    for (const row of body) {
      const dir = (row as { directory?: unknown } | null)?.directory
      if (typeof dir === 'string' && dir) dirs.add(dir)
    }
    return [...dirs]
  } catch {
    return []
  }
}

/**
 * Consulta real a `GET /session/status?directory=…` de cada carpeta (las dadas MÁS las que el motor conoce); cualquier fallo
 * = no ocioso. El mapa de estados es por sesión e incluye a las HIJAS: un subagente `busy` (también uno en segundo plano,
 * cuya sesión raíz figura ociosa mientras trabaja) hace que la carpeta no esté ociosa.
 */
export async function fetchSessionsIdle(baseUrl: string, authorization: string, directories: string[]): Promise<boolean> {
  try {
    const dirs = [...new Set([...directories, ...(await discoverDirectories(baseUrl, authorization))])]
    for (const dir of dirs) {
      const res = await fetch(`${baseUrl}/session/status?directory=${encodeURIComponent(dir)}`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(3000)
      })
      if (!res.ok) return false
      const body = (await res.json()) as Record<string, { type?: string }> | null
      if (!body || typeof body !== 'object' || !Object.values(body).every((v) => v?.type === 'idle')) return false
    }
    return true
  } catch {
    return false
  }
}

/** Instala el listener. Devuelve una función que lo quita y cancela los reintentos. */
export function installEngineFlagsRestart(deps: EngineFlagsRestartDeps): () => void {
  const isIdle = deps.isIdle ?? fetchSessionsIdle
  const retryMs = deps.retryMs ?? 15_000
  const now = deps.now ?? Date.now
  const first = deps.settings.get()
  // Entorno con el que (se supone) corre cada familia ahora: el de los Ajustes al instalar, y luego el último aplicado.
  let mainApplied = engineFlagEnvForMainSidecar(first)
  let tasksApplied = engineFlagEnvFor(first, 'tasks')
  let tasksChangedAt = 0
  /** Carpetas de sandbox ya relanzadas desde el último cambio. */
  const tasksDone = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let running = false
  let warned = false
  let disposed = false
  /** Llegó un cambio mientras se atendía otro: se vuelve a evaluar al terminar. */
  let dirty = false

  const mainDirs = (): string[] => [deps.chatDirectory, ...(deps.settings.get().recentFolders ?? [])]

  /** true = nada pendiente en la familia principal. */
  async function settleMain(): Promise<boolean> {
    const want = engineFlagEnvForMainSidecar(deps.settings.get())
    if (sameEnv(want, mainApplied)) return true
    const state = deps.server.getStatus().state
    // Parado: el próximo arranque ya lee los Ajustes nuevos.
    if (state === 'stopped' || state === 'error') {
      mainApplied = want
      return true
    }
    const conn = deps.server.getConnection()
    if (state !== 'ready' || !conn) return false
    if (!(await isIdle(conn.baseUrl, conn.authorization, mainDirs()))) return false
    // Se fija ANTES de reiniciar: el arranque lee los Ajustes de ese momento.
    mainApplied = want
    try {
      await deps.server.restart()
    } catch (err) {
      console.error('[engine-flags] no se pudo reiniciar el motor:', err)
    }
    deps.notify?.('restarted')
    return true
  }

  /** true = nada pendiente en Overdrive. */
  async function settleTasks(): Promise<boolean> {
    const tasks = deps.tasks
    if (!tasks) return true
    const want = engineFlagEnvFor(deps.settings.get(), 'tasks')
    if (sameEnv(want, tasksApplied)) return true
    let pending = false
    let restarted = false
    for (const s of tasks.liveServers()) {
      // Control total: ver nota de cabecera. Los servidores nacidos tras el cambio ya llevan el entorno nuevo.
      if (s.fullAccess || s.startedAt >= tasksChangedAt || tasksDone.has(s.folder)) continue
      if (!(await isIdle(s.baseUrl, s.authorization, [s.directory]))) {
        pending = true
        continue
      }
      try {
        restarted = (await tasks.restartSandbox(s.folder)) || restarted
      } catch (err) {
        console.error('[engine-flags] no se pudo reiniciar el sandbox:', err)
      }
      tasksDone.add(s.folder)
    }
    if (restarted) deps.notify?.('restarted')
    if (pending) return false
    tasksApplied = want
    return true
  }

  async function attempt(): Promise<void> {
    if (disposed) return
    if (running) {
      dirty = true
      return
    }
    running = true
    try {
      const mainOk = await settleMain()
      const tasksOk = await settleTasks()
      if (mainOk && tasksOk) {
        warned = false
        return
      }
      if (!warned) {
        warned = true
        deps.notify?.('pending')
      }
      if (!disposed) {
        timer = setTimeout(() => {
          timer = null
          void attempt()
        }, retryMs)
        timer.unref?.()
      }
    } finally {
      running = false
      if (dirty && !disposed) {
        dirty = false
        void attempt()
      }
    }
  }

  const off = deps.settings.onChange((next) => {
    if (disposed) return
    const mainChanged = !sameEnv(engineFlagEnvForMainSidecar(next), mainApplied)
    const tasksChanged = !sameEnv(engineFlagEnvFor(next, 'tasks'), tasksApplied)
    if (tasksChanged) {
      tasksChangedAt = now()
      tasksDone.clear()
    }
    if (!mainChanged && !tasksChanged) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    void attempt()
  })

  return () => {
    disposed = true
    off()
    if (timer) clearTimeout(timer)
    timer = null
  }
}
