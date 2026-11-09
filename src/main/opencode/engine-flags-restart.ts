/**
 * Reinicio del motor al cambiar las funciones experimentales (Modo código, subagentes en segundo plano).
 *
 * Las variables `OPENCODE_EXPERIMENTAL_*` se leen UNA vez al lanzar `opencode serve`, así que un cambio en Ajustes solo
 * vale tras relanzar el proceso. Este módulo compara el entorno que corresponde a cada familia de motor ANTES y DESPUÉS:
 *  - sidecar principal (Chat + Code comparten proceso): `engineFlagEnvForMainSidecar`;
 *  - Overdrive (Tareas, sandbox): `engineFlagEnvFor(_, 'tasks')`.
 * A ese entorno se suman los límites de Modo código y del shell en segundo plano (`engineLimitEnvFor`, solo los cambiados) y las
 * variables de los ganchos de usuario (`LAZUNOX_HOOKS_FILE` y su huella `LAZUNOX_HOOKS_SHA256`, solo el sidecar principal: el sandbox de Tareas nunca los recibe), las de la «última milla» (`engineLastMileEnv`: búsqueda web, sugerencia de permisos y política del administrador, solo el sidecar principal) y las de «Recordar mis "siempre"» (`permissionPersistEnvFor`: el motor las lee una sola vez al lanzar, así que el interruptor reinicia).
 * Solo si cambió el entorno de una familia se reinicia ESA familia, y nunca a mitad de un turno: se espera a que todas las
 * sesiones estén ociosas (se avisa una vez a la persona y se reintenta). Cambiar otra cosa de Ajustes no reinicia nada.
 *
 * Además (F8-B203) el sidecar principal se relanza, con la misma espera, cuando cambia la parte de su config inline que depende de
 * Ajustes y conectores (`mainInline`: reglas de los conectores en Code, subagentes del Chat): `OPENCODE_CONFIG_CONTENT` también se lee
 * solo al lanzar. `recheck()` del valor devuelto vuelve a mirar sin esperar a un cambio de Ajustes (conector añadido, motor que
 * reporta servidores externos al arrancar).
 *
 * Los servidores de Control total (sin sandbox) no se relanzan aquí: `restartSandbox` solo cubre el sandbox y pararlos
 * dejaría la interfaz sin servidor; toman el entorno nuevo en su próximo arranque (el monitor los apaga ociosos).
 */
import { engineExperimentsFor, engineFlagEnvFor, engineFlagEnvForMainSidecar } from '@shared/engine-experiments'
import { engineLimitEnvFor } from '@shared/engine-limits'
import { permissionPersistEnvFor } from '@shared/permission-persist'
import { userHooksEnvFor } from '@shared/user-hooks'
import { recentWorkKeys, workKey } from '../code/work-registry'
import { engineLastMileEnv } from './engine-lastmile'
import type { OpencodeConnection, ServerStatus, Settings } from '@shared/types'

type Env = Record<string, string>
type SettingsLike = Pick<Settings, 'engineExperiments'> &
  Partial<
    Pick<
      Settings,
      'engineLimits' | 'rememberAlways' | 'userHooksEnabled' | 'userHooksSha256' | 'webSearchAnyProvider' | 'permissionSuggestions'
    >
  >

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
  /** Carpetas de Code abiertas con confianza vigente (las únicas, además de `chatDirectory`, cuyo estado se puede preguntar al motor). */
  liveFolders?: () => string[]
  /** ¿Todas las sesiones de esos directorios están ociosas? Si no se puede saber, `false` (no se reinicia). */
  isIdle?: (baseUrl: string, authorization: string, directories: string[]) => Promise<boolean>
  /**
   * Aviso visible a la persona: hay un cambio esperando, o ya se aplicó. `cause: 'connectors'` = solo cambió la config inline
   * (permisos de conectores, subagentes del Chat), no las funciones experimentales: el texto debe decirlo así.
   */
  notify?: (kind: 'pending' | 'restarted', cause?: 'connectors') => void
  /**
   * Huella de la config inline del sidecar principal: la que corresponde ahora (`wanted`) y con la que arrancó el proceso actual
   * (`applied`, `null` si aún no arrancó). Si difieren, se reinicia como con el entorno.
   */
  mainInline?: { wanted(): string; applied(): string | null }
  /**
   * Carpeta de los permisos «siempre» guardados (la misma que recibe el motor). Ausente = el motor no guarda nada y el interruptor no
   * cuenta como cambio de entorno.
   */
  permissionDir?: string
  /**
   * Archivo de ganchos de usuario (`userData/hooks/hooks.json`). Ausente = no se pasa la variable. Solo cuenta para el sidecar principal: el sandbox
   * de Tareas nunca recibe ganchos y los servidores de Control total toman el valor en su próximo arranque.
   */
  hooksFile?: string
  /** Reintento mientras haya turnos en curso (ms). */
  retryMs?: number
  now?: () => number
}

/**
 * «Entorno» de la familia principal: las variables del sidecar MÁS los subagentes del Chat (F8-B206), que no cambian la variable si
 * Code ya la tiene encendida pero sí el permiso `task` del agente `chat` en la config inline: también es una función experimental.
 */
function mainFlagsOf(s: SettingsLike, permissionDir?: string, hooksFile?: string): Env {
  // Los límites (Modo código, shell de fondo) también se leen una sola vez al lanzar: cambiarlos reinicia como cambiar una bandera.
  const env = {
    ...engineFlagEnvForMainSidecar(s),
    ...engineLimitEnvFor(s),
    ...permissionPersistEnvFor(s, permissionDir),
    ...userHooksEnvFor(s, hooksFile),
    // Búsqueda web con cualquier IA, sugerencia en tarjetas y política del administrador (solo si su archivo existe): también se leen una vez al lanzar.
    ...engineLastMileEnv(s)
  }
  return engineExperimentsFor(s, 'chat').backgroundSubagents ? { ...env, 'chat:subagents': 'on' } : env
}

/** Entorno de Overdrive: sus banderas más los límites (valen igual para sus servidores). */
const tasksFlagsOf = (s: SettingsLike, permissionDir?: string): Env => ({
  ...engineFlagEnvFor(s, 'tasks'),
  ...engineLimitEnvFor(s),
  ...permissionPersistEnvFor(s, permissionDir)
})

const sameEnv = (a: Env, b: Env): boolean => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

/** Tope de sesiones recientes que se piden para descubrir carpetas que Lazunox no tiene anotadas. */
const DISCOVER_LIMIT = 200

/**
 * Una sesión de una carpeta que NO se puede consultar (no está abierta con confianza) cuya última actividad es más reciente que esto se
 * cuenta como «posiblemente en curso» y aplaza el reinicio. Es evidencia, no certeza: no se le puede preguntar su estado sin que el motor
 * cargue la carpeta (y con ella sus complementos y conectores).
 */
export const RECENT_WORK_MS = 120_000

interface KnownSession {
  directory: string
  /** Última actividad (ms) si el motor la dio. */
  updated?: number
}

/**
 * Sesiones que el motor tiene guardadas, de todos los proyectos (`GET /experimental/session` SIN `directory`: lista la base de datos y NO
 * carga ninguna carpeta; comprobado con el motor real, `scripts/engine-probe/probe-reinicio.mjs`), incluidas las hijas (subagentes).
 * Mejor esfuerzo: si el motor no tiene la ruta o falla, se devuelve `[]` y se sigue con las carpetas dadas.
 */
async function discoverSessions(baseUrl: string, authorization: string): Promise<KnownSession[]> {
  try {
    const res = await fetch(`${baseUrl}/experimental/session?limit=${DISCOVER_LIMIT}&archived=false`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) return []
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) return []
    const out: KnownSession[] = []
    for (const row of body) {
      const r = row as { directory?: unknown; time?: { updated?: unknown } } | null
      if (typeof r?.directory !== 'string' || !r.directory) continue
      const updated = typeof r.time?.updated === 'number' ? r.time.updated : undefined
      out.push({ directory: r.directory, ...(updated !== undefined ? { updated } : {}) })
    }
    return out
  } catch {
    return []
  }
}

/** Misma carpeta aunque difieran las mayúsculas, el separador o la barra final (Windows y macOS no distinguen mayúsculas). */
const dirKey = (d: string): string => workKey(d)

/**
 * Consulta real a `GET /session/status?directory=…` SOLO de las carpetas dadas; cualquier fallo = no ocioso. El mapa de estados es por
 * sesión e incluye a las HIJAS: un subagente `busy` (también uno en segundo plano, cuya sesión raíz figura ociosa mientras trabaja) hace
 * que la carpeta no esté ociosa.
 *
 * R2: una petición al motor con `directory=` hace que el motor CARGUE esa carpeta (complementos de código, y conectores con `command.list`),
 * así que NUNCA se pregunta por una carpeta que el que llama no dio. Las carpetas que el motor conoce por sus sesiones guardadas pero que no
 * están en `directories` (recientes que la persona nunca abrió o aprobó, carpetas cerradas) no se consultan: solo cuentan como «posiblemente
 * en curso» si tienen actividad de hace menos de `RECENT_WORK_MS`. Compromiso: un turno de una de esas carpetas que lleve más de ese tiempo
 * sin escribir nada (p. ej. un comando largo) no se ve y podría interrumpirse con un reinicio; la alternativa era cargar carpetas sin confianza.
 */
export async function fetchSessionsIdle(
  baseUrl: string,
  authorization: string,
  directories: string[],
  now: () => number = Date.now
): Promise<boolean> {
  try {
    const allowed = new Set(directories.map(dirKey))
    // Trabajo que Rutinas, Telegram, el celular o Comparar mandaron hace poco a una carpeta que no se consulta: se ve en el registro de `main`
    // (un comando largo no mueve `time.updated`, pero el servicio sí anotó que mandó el turno).
    for (const k of recentWorkKeys(now)) if (!allowed.has(k)) return false
    for (const k of await discoverSessions(baseUrl, authorization)) {
      if (allowed.has(dirKey(k.directory))) continue // esas se consultan abajo, con su estado real
      if (k.updated !== undefined && now() - k.updated < RECENT_WORK_MS) return false
    }
    for (const dir of new Set(directories)) {
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

/** Función que quita el listener (y cancela reintentos) y, como método, `recheck()` para volver a mirar a demanda. */
export type EngineFlagsRestartHandle = (() => void) & { recheck(): void }

/** Instala el listener. Devuelve una función que lo quita y cancela los reintentos (con `recheck()`). */
export function installEngineFlagsRestart(deps: EngineFlagsRestartDeps): EngineFlagsRestartHandle {
  const isIdle = deps.isIdle ?? fetchSessionsIdle
  const retryMs = deps.retryMs ?? 15_000
  const now = deps.now ?? Date.now
  const first = deps.settings.get()
  // Entorno con el que (se supone) corre cada familia ahora: el de los Ajustes al instalar, y luego el último aplicado.
  let mainApplied = mainFlagsOf(first, deps.permissionDir, deps.hooksFile)
  let tasksApplied = tasksFlagsOf(first, deps.permissionDir)
  let tasksChangedAt = 0
  /** Carpetas de sandbox ya relanzadas desde el último cambio. */
  const tasksDone = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  let running = false
  let warned = false
  let disposed = false
  /** Llegó un cambio mientras se atendía otro: se vuelve a evaluar al terminar. */
  let dirty = false
  /** Causa de lo pendiente en la familia principal (para el texto del aviso). */
  let mainCause: 'connectors' | undefined

  // Solo la carpeta del Chat y las carpetas de Code ABIERTAS Y CON CONFIANZA vigente (las informa el renderer, que guarda la confianza). Nunca las
  // recientes: preguntar el estado de una carpeta hace que el motor la cargue (R2).
  const mainDirs = (): string[] => [deps.chatDirectory, ...(deps.liveFolders?.() ?? [])]

  /** ¿La config inline con la que corre el sidecar principal es la que corresponde? (sin arrancar aún = sí). Un fallo = sí (no se reinicia a ciegas). */
  const inlineCurrent = (): boolean => {
    if (!deps.mainInline) return true
    try {
      const applied = deps.mainInline.applied()
      return applied === null || applied === deps.mainInline.wanted()
    } catch (err) {
      console.error('[engine-flags] no se pudo calcular la config inline:', err)
      return true
    }
  }

  /** true = nada pendiente en la familia principal. */
  async function settleMain(): Promise<boolean> {
    const want = mainFlagsOf(deps.settings.get(), deps.permissionDir, deps.hooksFile)
    const envSame = sameEnv(want, mainApplied)
    if (envSame && inlineCurrent()) return true
    mainCause = envSame ? 'connectors' : undefined
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
    if (mainCause) deps.notify?.('restarted', mainCause)
    else deps.notify?.('restarted')
    return true
  }

  /** true = nada pendiente en Overdrive. */
  async function settleTasks(): Promise<boolean> {
    const tasks = deps.tasks
    if (!tasks) return true
    const want = tasksFlagsOf(deps.settings.get(), deps.permissionDir)
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
      mainCause = undefined
      const mainOk = await settleMain()
      const tasksOk = await settleTasks()
      if (mainOk && tasksOk) {
        warned = false
        return
      }
      if (!warned) {
        warned = true
        if (!mainOk && tasksOk && mainCause) deps.notify?.('pending', mainCause)
        else deps.notify?.('pending')
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
    const mainChanged = !sameEnv(mainFlagsOf(next, deps.permissionDir, deps.hooksFile), mainApplied) || !inlineCurrent()
    const tasksChanged = !sameEnv(tasksFlagsOf(next, deps.permissionDir), tasksApplied)
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

  const dispose = (): void => {
    disposed = true
    off()
    if (timer) clearTimeout(timer)
    timer = null
  }
  return Object.assign(dispose, {
    recheck: (): void => {
      if (disposed) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      void attempt()
    }
  })
}
