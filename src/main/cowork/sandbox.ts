/**
 * Sandbox de Cowork (macOS Seatbelt / `sandbox-exec`).
 *
 * Cada carpeta de Cowork tiene su PROPIO `opencode serve` lanzado dentro de
 * `sandbox-exec -f <perfil>`; todos los procesos hijos (bash, python, textutil…) heredan
 * el perfil (ver `sandbox-profile.ts`: qué se puede escribir/leer/ejecutar).
 *
 * Aislamiento de OpenCode (AUDIT.md S1): el servidor sandboxeado usa sus propios
 * XDG_CONFIG/DATA/CACHE/STATE_HOME en `userData/cowork-sandbox/<hash>/` (DB, logs, binarios de
 * LSP, cachés de npm/bun/pip), así que no puede tocar la config/plugins globales de OpenCode que
 * carga el sidecar principal SIN sandbox. Las credenciales de proveedores se le pasan por
 * `OPENCODE_AUTH_CONTENT` (OpenCode lo prefiere a `auth.json`, verificado en 1.18.32): el
 * `auth.json` del usuario queda ilegible dentro del sandbox, no se copia a disco y nunca se
 * registra en logs; el plugin `lapis-env` lo oculta del entorno de bash.
 *
 * En plataformas sin `sandbox-exec` se lanza sin sandbox (`sandboxed: false`).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { findOpencodeBinary, getFreePort } from '../opencode/server'
import { killTree, trackPid, untrackPid } from '../opencode/pids'
import { getOpencodeEnv } from './opencode-config'
import { minimalEnv } from '../process/child-env'
import { withDisclaim } from '../process/disclaim'
import type { FolderAccessMode } from '@shared/ipc-cowork'
import { buildSandboxProfile, sandboxDirs, sandboxEnv, type SandboxDirs } from './sandbox-profile'
import { CredentialProxy, EgressProxy, randomToken, type EgressBlockedEvent, type EgressLogEntry } from './proxy'
import { PROVIDER_TARGETS, buildProviderOverride, placeholderAuthContent, type ProviderAuthEntry } from './provider-egress'

export { buildSandboxProfile, defaultDeniedReadPaths, defaultWritablePaths, sandboxKey } from './sandbox-profile'

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 30_000
const KILL_GRACE_MS = 3_000

export function isSandboxAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC)
}

/**
 * Credenciales de proveedores del usuario (contenido de `auth.json` de OpenCode), PARSEADAS para
 * poder derivar la clave real por proveedor (credential proxy) y una versión centinela (para el
 * entorno del sandbox). NO se registra ni se escribe en ningún sitio.
 */
function readProviderAuth(): Record<string, ProviderAuthEntry> | null {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  try {
    const raw = readFileSync(join(dataHome, 'opencode', 'auth.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, ProviderAuthEntry>
    if (parsed && typeof parsed === 'object') return parsed
    return null
  } catch {
    return null
  }
}

export interface SandboxIsolation {
  /** Directorio privado del servidor (userData/cowork-sandbox/<hash>). */
  privateDir: string
  /** userData de la app (lectura denegada dentro del sandbox salvo privateDir/readOnly). */
  userData: string
}

export interface SandboxNetworkOptions {
  /** Puertos localhost adicionales a permitir en salida (egress proxy, credential proxy…). */
  allowedOutboundPorts: number[]
  /** Puerto propio del servidor (bind + inbound). */
  serverPort: number
  /** "Permitir borrar, mover y renombrar" concedido para esta tarea (si no, `file-write-unlink` se deniega). */
  allowDelete: boolean
  /** Carpetas adicionales (vinculadas o de confianza): `rw` escribible sin borrado, `ro` sin escritura. */
  extraFolders?: Array<{ path: string; mode: FolderAccessMode }>
}

/** Escribe el perfil en un archivo temporal y devuelve su ruta. */
export function writeSandboxProfile(
  folder: string,
  iso: SandboxIsolation,
  configDir: string,
  network?: SandboxNetworkOptions,
  dir = join(tmpdir(), 'lapis-cowork')
): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `profile-${randomBytes(6).toString('hex')}.sb`)
  const profile = buildSandboxProfile({
    folder,
    privateDir: iso.privateDir,
    userData: iso.userData,
    readOnly: [configDir],
    allowedOutboundPorts: network?.allowedOutboundPorts,
    serverPort: network?.serverPort,
    allowDelete: network?.allowDelete,
    extraFolders: network?.extraFolders
  })
  writeFileSync(file, profile, 'utf8')
  return file
}

export interface CoworkServerHandle {
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
}

export interface StartCoworkServerOptions {
  corsOrigins?: string[]
  /** Desactivar el sandbox (solo para depuración). */
  noSandbox?: boolean
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
}

/**
 * Lanza un `opencode serve` dedicado a `folder`, dentro de `sandbox-exec` en macOS.
 * cwd = folder. Resuelve cuando `/global/health` responde.
 */
export async function startCoworkServer(
  folder: string,
  options: StartCoworkServerOptions = {}
): Promise<CoworkServerHandle> {
  const bin = findOpencodeBinary()
  if (!bin) throw new Error('No se encontró el binario `opencode` (instálalo o define OPENCODE_BIN).')
  if (!existsSync(folder)) throw new Error(`La carpeta no existe: ${folder}`)

  const sandboxed = !options.noSandbox && isSandboxAvailable()
  const port = await getFreePort()
  const username = 'cowork'
  const password = randomBytes(24).toString('base64url')
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const baseUrl = `http://${HOST}:${port}`
  const cors = options.corsOrigins ?? []
  const serveArgs = ['serve', '--port', String(port), '--hostname', HOST, ...cors.flatMap((o) => ['--cors', o])]

  let command = bin
  let args = serveArgs
  let profile: string | null = null
  const ocEnv = getOpencodeEnv()
  let isolatedEnv: Record<string, string> = {}
  const egressToken = randomToken()
  const egress = sandboxed
    ? new EgressProxy({ token: egressToken, allowlist: options.networkAllowlist ?? (() => []), onBlocked: options.onEgressBlocked, onLog: options.onEgressLog })
    : null
  const credentialProxies: CredentialProxy[] = []
  if (sandboxed) {
    if (!options.isolation) throw new Error('Falta el directorio privado del sandbox de Cowork.')
    const dirs: SandboxDirs = sandboxDirs(options.isolation.privateDir)
    for (const d of [dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) mkdirSync(d, { recursive: true })

    await egress!.start()
    const auth = readProviderAuth()
    const baseUrls: Record<string, string> = {}
    if (auth) {
      for (const [id, entry] of Object.entries(auth)) {
        const target = PROVIDER_TARGETS[id]
        if (!target || target.auth !== 'bearer' || !entry.key) continue
        const cred = new CredentialProxy({
          token: randomToken(),
          targetOrigin: target.origin,
          targetPathPrefix: target.pathPrefix,
          authorization: `Bearer ${entry.key}`
        })
        await cred.start()
        credentialProxies.push(cred)
        baseUrls[id] = cred.baseUrl()
      }
    }
    const outboundPorts = [egress!.port, ...credentialProxies.map((c) => c.port), ...(options.extraOutboundPorts ?? [])]
    profile = writeSandboxProfile(folder, options.isolation, ocEnv.OPENCODE_CONFIG_DIR, {
      allowedOutboundPorts: outboundPorts,
      serverPort: port,
      allowDelete: options.allowDelete === true,
      extraFolders: options.extraFolders
    })
    command = SANDBOX_EXEC
    args = ['-f', profile, bin, ...serveArgs]
    const proxyUrl = `http://${egressToken}@127.0.0.1:${egress!.port}`
    isolatedEnv = {
      ...sandboxEnv(dirs),
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
          merged = { ...parsed, provider: { ...(parsed.provider as object | undefined), ...(override.provider as object) } }
        } catch {
          merged = override
        }
      }
      options = { ...options, extraEnv: { ...options.extraEnv, OPENCODE_CONFIG_CONTENT: JSON.stringify(merged) } }
    }
  }

  // Sin heredar los permisos TCC de la app (S6): el lanzador se ejecuta ANTES de sandbox-exec, así
  // que sandbox-exec y opencode (y todo lo que lancen) quedan desvinculados. Entorno mínimo.
  const launch = withDisclaim(command, args)
  const child: ChildProcess = spawn(launch.command, launch.args, {
    cwd: folder,
    env: minimalEnv({
      ...ocEnv,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENDESK_COWORK_FOLDER: folder,
      ...isolatedEnv,
      ...options.extraEnv
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    // Líder de su propio grupo: `killTree` mata también MCP/bash (AUDIT.md B3).
    detached: true
  })
  trackPid(child.pid, sandboxed ? 'cowork' : 'cowork-full')

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
      if (profile) rmSync(profile, { force: true })
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
    version = await waitForHealth(baseUrl, authorization, child)
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
    deleteAllowed: !sandboxed || options.allowDelete === true
  }
}

async function waitForHealth(baseUrl: string, authorization: string, child: ChildProcess): Promise<string | undefined> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`opencode (cowork) terminó durante el arranque (code=${child.exitCode})`)
    }
    try {
      const res = await fetch(`${baseUrl}/global/health`, {
        headers: { authorization },
        signal: AbortSignal.timeout(2000)
      })
      if (res.ok) {
        const body = (await res.json()) as { healthy?: boolean; version?: string }
        if (body.healthy !== false) return body.version
      }
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`opencode (cowork) no respondió en ${HEALTH_TIMEOUT_MS / 1000}s`)
}
