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
import { buildSandboxProfile, sandboxDirs, sandboxEnv, type SandboxDirs } from './sandbox-profile'

export { buildSandboxProfile, defaultDeniedReadPaths, defaultWritablePaths, sandboxKey } from './sandbox-profile'

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 30_000
const KILL_GRACE_MS = 3_000

export function isSandboxAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC)
}

/**
 * Credenciales de proveedores del usuario (contenido de `auth.json` de OpenCode) para pasarlas
 * al servidor sandboxeado por entorno. NO se registra ni se escribe en ningún sitio.
 */
function readProviderAuth(): string | null {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  try {
    const raw = readFileSync(join(dataHome, 'opencode', 'auth.json'), 'utf8')
    JSON.parse(raw) // solo validar
    return raw
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

/** Escribe el perfil en un archivo temporal y devuelve su ruta. */
export function writeSandboxProfile(
  folder: string,
  iso: SandboxIsolation,
  configDir: string,
  dir = join(tmpdir(), 'lapis-cowork')
): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `profile-${randomBytes(6).toString('hex')}.sb`)
  const profile = buildSandboxProfile({
    folder,
    privateDir: iso.privateDir,
    userData: iso.userData,
    readOnly: [configDir]
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
  if (sandboxed) {
    if (!options.isolation) throw new Error('Falta el directorio privado del sandbox de Cowork.')
    const dirs: SandboxDirs = sandboxDirs(options.isolation.privateDir)
    for (const d of [dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) mkdirSync(d, { recursive: true })
    profile = writeSandboxProfile(folder, options.isolation, ocEnv.OPENCODE_CONFIG_DIR)
    command = SANDBOX_EXEC
    args = ['-f', profile, bin, ...serveArgs]
    const auth = readProviderAuth()
    isolatedEnv = { ...sandboxEnv(dirs), ...(auth ? { OPENCODE_AUTH_CONTENT: auth } : {}) }
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
    stop
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
