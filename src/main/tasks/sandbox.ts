/**
 * Sandbox de Tareas (macOS Seatbelt / `sandbox-exec`).
 *
 * Cada carpeta de Tareas tiene su PROPIO `opencode serve` lanzado dentro de
 * `sandbox-exec -f <perfil>`; todos los procesos hijos (bash, python, textutil…) heredan
 * el perfil (ver `sandbox-profile.ts`: qué se puede escribir/leer/ejecutar).
 *
 * Aislamiento de OpenCode (AUDIT.md S1): el servidor sandboxeado usa sus propios
 * XDG_CONFIG/DATA/CACHE/STATE_HOME en `userData/tasks-sandbox/<hash>/` (DB, logs, binarios de
 * LSP, cachés de npm/bun/pip), así que no puede tocar la config/plugins globales de OpenCode que
 * carga el sidecar principal SIN sandbox. Las credenciales de proveedores se le pasan por
 * `OPENCODE_AUTH_CONTENT` (OpenCode lo prefiere a `auth.json`, verificado en 1.18.32): el
 * `auth.json` PROPIO de la app (`userData/opencode-data/opencode/auth.json`, nunca el del CLI)
 * queda ilegible dentro del sandbox, no se copia a disco y nunca se registra en logs; el plugin
 * `lazunox-env` lo oculta del entorno de bash.
 *
 * En macOS sin `sandbox-exec` se lanza sin sandbox (`sandboxed: false`). En WINDOWS NUNCA: sin la bandera `tasksWin`, sin
 * distro lista, sin pin, sin informe o con `noSandbox`, `startTasksServer` LANZA antes de arrancar ningún proceso (A18).
 */
import { t } from '@shared/i18n'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { app } from 'electron'
import { appAuthFile } from '../opencode/data-dir'
import { resolveOpencodeAsync } from '../opencode/server'
import { getFreePort, waitForHealth } from '../util/net'
import { killTree, trackPid, untrackPid } from '../opencode/pids'
import { getOpencodeEnv } from './opencode-config'
import type { FolderAccessMode } from '@shared/ipc-tasks'
import { IDENTITY_MAP, type PathMapWire } from '@shared/tasks-path-map'
import { selectBackend, TasksSandboxNotReady, WinBackendUnavailable, type WinBackendProvider } from './backends'
import { detectElevated } from './win-elevation'
import { noneBackend } from './backends/none'
import { SANDBOX_EXEC, seatbeltAvailable, writeSandboxProfile } from './backends/seatbelt'
import type { LaunchedSandbox, SandboxBackend, SandboxIsolation, SandboxNetworkOptions } from './backends/types'
import { CredentialProxy, EgressProxy, randomToken, type EgressBlockedEvent, type EgressLogEntry } from './proxy'
import { PROVIDER_TARGETS, buildProviderOverride, placeholderAuthContent, type ProviderAuthEntry } from './provider-egress'

export { buildSandboxProfile, defaultDeniedReadPaths, defaultWritablePaths, sandboxKey } from './sandbox-profile'

// El perfil Seatbelt y su escritura viven ahora en `backends/seatbelt.ts` (F8-B81, extracción sin cambios).
export { SANDBOX_EXEC, writeSandboxProfile }
export type { SandboxIsolation, SandboxNetworkOptions }
const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 30_000
const KILL_GRACE_MS = 3_000

export function isSandboxAvailable(): boolean {
  return seatbeltAvailable()
}

/**
 * Credenciales de proveedores del usuario (contenido de `auth.json` de OpenCode), PARSEADAS para
 * poder derivar la clave real por proveedor (credential proxy) y una versión centinela (para el
 * entorno del sandbox). NO se registra ni se escribe en ningún sitio.
 */
export function readProviderAuth(file: string = appAuthFile(app.getPath('userData'))): Record<string, ProviderAuthEntry> | null {
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, ProviderAuthEntry>
    if (parsed && typeof parsed === 'object') return parsed
    return null
  } catch {
    return null
  }
}

export interface TasksServerHandle {
  folder: string
  baseUrl: string
  /** Valor completo del header Authorization (Basic …). */
  authorization: string
  username: string
  sandboxed: boolean
  pid: number | undefined
  version?: string
  /** Últimas líneas de log del proceso. */
  logs: () => string
  /** Se resuelve cuando el proceso termina. */
  exited: Promise<number | null>
  stop: () => Promise<void>
  /** Puerto del proxy de egress (si el servidor está sandboxeado). */
  egressPort?: number
  /** true si esta instancia arrancó con "Permitir borrar, mover y renombrar" concedido. */
  deleteAllowed: boolean
  /**
   * Cómo ve OpenCode las rutas: `directory` es la carpeta DENTRO del sandbox (la que va en `?directory=`) y `map` traduce
   * entre ambos mundos. En macOS es la identidad. Traducir no autoriza: `assertInsideApproved` sigue siendo la puerta.
   */
  paths: { map: PathMapWire; directory: string }
}

export interface StartTasksServerOptions {
  corsOrigins?: string[]
  /** Desactivar el sandbox (Control total en macOS; en Windows solo junto con `winFullAccess`). */
  noSandbox?: boolean
  /**
   * Windows: Control total (sin WSL). Solo vale con `noSandbox`, `tasksWin` y Lazunox NO elevado (`isElevated`, inyectable en pruebas;
   * sin saberlo se trata como elevado). Cualquier otro uso de `noSandbox` en win32 sigue lanzando.
   */
  winFullAccess?: boolean
  isElevated?: () => Promise<boolean | null>
  /** Variables de entorno extra para `opencode serve` (p.ej. OPENCODE_CONFIG_CONTENT). */
  extraEnv?: Record<string, string>
  /** Dirs privados + userData (obligatorio para el modo sandbox). */
  isolation?: SandboxIsolation
  onExit?: (code: number | null) => void
  /** Lista blanca de red EFECTIVA en este instante (se re-evalúa en cada intento de conexión). */
  networkAllowlist?: () => readonly string[]
  onEgressBlocked?: (ev: EgressBlockedEvent) => void
  onEgressLog?: (entry: EgressLogEntry) => void
  /** "Permitir borrar, mover y renombrar" concedido para esta tarea (Seatbelt: `file-write-unlink`). */
  allowDelete?: boolean
  /** Carpetas adicionales del espacio (vinculadas o de confianza) con su modo. */
  extraFolders?: Array<{ path: string; mode: FolderAccessMode }>
  /**
   * Puertos localhost adicionales a permitir en salida (Lote D, B.7): el puerto fijo del MCP del
   * navegador integrado, para que Seatbelt deje conectar desde dentro del sandbox.
   */
  extraOutboundPorts?: number[]
  /** Plataforma efectiva (solo pruebas; por defecto `process.platform`). */
  platform?: string
  /** Bandera efectiva `tasksWin` (Windows). Ausente = apagada. */
  tasksWin?: boolean
  /** Constructor del backend de Windows (lo aporta `main`). Ausente = en Windows no se lanza nada. */
  winBackend?: WinBackendProvider
}

/**
 * Lanza un `opencode serve` dedicado a `folder`, dentro de `sandbox-exec` en macOS.
 * cwd = folder. Resuelve cuando `/global/health` responde.
 */
export async function startTasksServer(folder: string, options: StartTasksServerOptions = {}): Promise<TasksServerHandle> {
  const platform = options.platform ?? process.platform
  // Windows: jamás sin aislamiento (A18). Se decide ANTES de resolver el binario o de abrir ningún puerto.
  if (platform === 'win32' && options.noSandbox) {
    if (options.winFullAccess !== true) throw new Error(t('merr.task.winNoUnsandboxed'))
    if (options.tasksWin !== true) throw new WinBackendUnavailable('flag')
    let elevated: boolean | null = null
    try {
      elevated = await (options.isElevated ?? detectElevated)()
    } catch {
      elevated = null
    }
    if (elevated !== false) throw new WinBackendUnavailable('elevated')
  }
  const bin = (await resolveOpencodeAsync())?.path
  if (!bin) throw new Error(t('merr.engine.noBinaryShort'))
  if (!existsSync(folder)) throw new Error(t('merr.task.noFolder', { folder }))

  const backend: SandboxBackend = options.noSandbox
    ? noneBackend
    : await selectBackend(platform, { tasksWin: options.tasksWin, win: options.winBackend })
  if (platform === 'win32' && !options.noSandbox) {
    // Invariante: en Windows solo existe el backend de la distro, y solo con la distro lista (instalada, sana y al día).
    if (backend.id !== 'wsl') throw new Error(t('merr.task.winNoUnsandboxed'))
    const st = await backend.status()
    if (st.state !== 'ready') throw new TasksSandboxNotReady(st)
  }
  const sandboxed = backend.id !== 'none'
  const port = await getFreePort()
  const username = 'tasks'
  const password = randomBytes(24).toString('base64url')
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const baseUrl = `http://${HOST}:${port}`
  const cors = options.corsOrigins ?? []
  const serveArgs = ['serve', '--port', String(port), '--hostname', HOST, ...cors.flatMap((o) => ['--cors', o])]

  const ocEnv = getOpencodeEnv()
  let isolatedEnv: Record<string, string> = {}
  let outboundPorts: number[] = []
  const egressToken = randomToken()
  const egress = sandboxed
    ? new EgressProxy({
        token: egressToken,
        allowlist: options.networkAllowlist ?? (() => []),
        onBlocked: options.onEgressBlocked,
        onLog: options.onEgressLog
      })
    : null
  const credentialProxies: CredentialProxy[] = []
  if (sandboxed) {
    if (!options.isolation) throw new Error(t('merr.task.noPrivateDir'))
    backend.prepare?.(options.isolation)

    await egress!.start()
    const auth = readProviderAuth()
    const baseUrls: Record<string, string> = {}
    if (auth) {
      for (const [id, entry] of Object.entries(auth)) {
        const target = Object.prototype.hasOwnProperty.call(PROVIDER_TARGETS, id) ? PROVIDER_TARGETS[id] : undefined
        if (!target || !entry || typeof entry.key !== 'string' || !entry.key) continue
        const cred = new CredentialProxy({
          token: randomToken(),
          targetOrigin: target.origin,
          targetPathPrefix: target.pathPrefix,
          key: entry.key
        })
        await cred.start()
        credentialProxies.push(cred)
        baseUrls[id] = cred.baseUrl()
      }
    }
    outboundPorts = [egress!.port, ...credentialProxies.map((c) => c.port), ...(options.extraOutboundPorts ?? [])]
    const proxyUrl = `http://${egressToken}@127.0.0.1:${egress!.port}`
    isolatedEnv = {
      ...(auth ? { OPENCODE_AUTH_CONTENT: placeholderAuthContent(auth) } : {}),
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      NO_PROXY: '127.0.0.1,localhost',
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      no_proxy: '127.0.0.1,localhost'
    }
    if (Object.keys(baseUrls).length) {
      const override = buildProviderOverride(baseUrls)
      const prevConfig = options.extraEnv?.OPENCODE_CONFIG_CONTENT
      let merged: Record<string, unknown> = override
      if (prevConfig) {
        try {
          const parsed = JSON.parse(prevConfig) as Record<string, unknown>
          // Mezcla por proveedor: el override solo pone `options.baseURL`; no pisa modelos ni otras opciones ya definidos para ese id.
          const prevProviders = (parsed.provider ?? {}) as Record<string, Record<string, unknown>>
          const providers: Record<string, unknown> = { ...prevProviders }
          for (const [id, entry] of Object.entries(override.provider as Record<string, { options: Record<string, unknown> }>)) {
            const prev = prevProviders[id] ?? {}
            providers[id] = { ...prev, options: { ...((prev.options as object | undefined) ?? {}), ...entry.options } }
          }
          merged = { ...parsed, provider: providers }
        } catch {
          merged = override
        }
      }
      options = { ...options, extraEnv: { ...options.extraEnv, OPENCODE_CONFIG_CONTENT: JSON.stringify(merged) } }
    }
  }

  const launched: LaunchedSandbox = await backend.launch({
    folder,
    bin,
    serveArgs,
    serverPort: port,
    isolation: options.isolation,
    configDir: ocEnv.OPENCODE_CONFIG_DIR,
    allowDelete: options.allowDelete === true,
    extraFolders: options.extraFolders,
    outboundPorts,
    baseEnv: {
      ...ocEnv,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      LAZUNOX_TASKS_FOLDER: folder
    },
    proxyEnv: isolatedEnv,
    extraEnv: options.extraEnv
  })
  const child = launched.child
  trackPid(child.pid, sandboxed ? 'tasks' : 'tasks-full')

  const tail: string[] = []
  const log = (d: Buffer | string): void => {
    tail.push(d.toString())
    if (tail.length > 80) tail.splice(0, tail.length - 80)
  }
  child.stdout?.on('data', log)
  child.stderr?.on('data', log)
  child.on('error', (err) => log(`[spawn error] ${err.message}\n`))
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      untrackPid(child.pid)
      killTree(child.pid, 'SIGKILL') // resto del grupo
      void launched.dispose()
      void egress?.stop()
      void Promise.all(credentialProxies.map((c) => c.stop()))
      options.onExit?.(code)
      resolve(code)
    })
  })

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const timer = setTimeout(() => killTree(child.pid, 'SIGKILL'), KILL_GRACE_MS)
    killTree(child.pid, 'SIGTERM')
    await exited
    clearTimeout(timer)
  }

  let version: string | undefined
  try {
    version = await waitForHealth(baseUrl, authorization, child, {
      label: 'opencode (tareas)',
      timeoutMs: HEALTH_TIMEOUT_MS
    })
  } catch (err) {
    await stop()
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${msg}\n${tail.slice(-5).join('').trim()}`)
  }

  return {
    folder,
    baseUrl,
    authorization,
    username,
    sandboxed,
    pid: child.pid,
    version,
    logs: () => tail.join(''),
    exited,
    stop,
    egressPort: egress?.port,
    deleteAllowed: !sandboxed || options.allowDelete === true,
    paths: launched.mounts
      ? { map: { kind: 'wsl', mounts: launched.mounts }, directory: launched.toSandboxPath(folder) }
      : { map: IDENTITY_MAP, directory: folder }
  }
}
