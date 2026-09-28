/**
 * Sandbox de Cowork (macOS Seatbelt / `sandbox-exec`).
 *
 * Cada carpeta de Cowork tiene su PROPIO `opencode serve` lanzado dentro de
 * `sandbox-exec -f <perfil>`; todos los procesos hijos (bash, python, textutil…) heredan
 * el perfil. El perfil permite todo excepto:
 *   - escribir fuera de la carpeta de la tarea, dirs temporales y dirs internos de opencode;
 *   - leer secretos típicos del usuario (~/.ssh, ~/.aws, ~/.gnupg…).
 *
 * En plataformas sin `sandbox-exec` se lanza sin sandbox (`sandboxed: false`).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { findOpencodeBinary, getFreePort } from '../opencode/server'
import { getOpencodeEnv } from './opencode-config'

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const HOST = '127.0.0.1'
const HEALTH_TIMEOUT_MS = 30_000
const KILL_GRACE_MS = 3_000

export function isSandboxAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC)
}

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Escapa una ruta para un literal de string SBPL. */
function sbString(p: string): string {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export interface SandboxProfileOptions {
  /** Carpeta de la tarea (única carpeta del usuario con escritura). */
  folder: string
  /** Rutas extra con escritura permitida. */
  extraWritable?: string[]
  home?: string
}

/** Rutas con escritura permitida además de la carpeta (opencode, cachés, temporales). */
export function defaultWritablePaths(home = homedir()): string[] {
  return [
    '/private/tmp',
    '/private/var/folders', // $TMPDIR y DARWIN_USER_CACHE_DIR
    real(tmpdir()),
    join(home, '.local', 'share', 'opencode'),
    join(home, '.local', 'state', 'opencode'),
    join(home, '.cache', 'opencode'),
    join(home, '.config', 'opencode'),
    join(home, '.npm'),
    join(home, '.bun', 'install', 'cache'),
    join(home, 'Library', 'Caches')
  ]
}

/** Rutas con lectura denegada (secretos). */
export function defaultDeniedReadPaths(home = homedir()): string[] {
  return [
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.gnupg'),
    join(home, '.kube'),
    join(home, '.docker'),
    join(home, 'Library', 'Keychains')
  ]
}

/** Genera el texto del perfil Seatbelt (SBPL). */
export function buildSandboxProfile(opts: SandboxProfileOptions): string {
  const home = opts.home ?? homedir()
  const folder = real(opts.folder)
  const writable = [folder, ...defaultWritablePaths(home), ...(opts.extraWritable ?? []).map(real)]
  const unique = [...new Set(writable)]
  return [
    '(version 1)',
    '(allow default)',
    '',
    ';; Escritura: solo la carpeta de la tarea + temporales + dirs internos de opencode.',
    '(deny file-write*)',
    '(allow file-write*',
    ...unique.map((p) => `  (subpath ${sbString(p)})`),
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty")',
    '  (literal "/dev/dtracehelper") (literal "/dev/random") (literal "/dev/urandom")',
    '  (regex #"^/dev/ttys[0-9]+$") (regex #"^/dev/fd/"))',
    '',
    ';; Secretos del usuario: sin lectura ni escritura.',
    '(deny file-read* file-write*',
    ...defaultDeniedReadPaths(home).map((p) => `  (subpath ${sbString(p)})`),
    ')',
    ''
  ].join('\n')
}

/** Escribe el perfil en un archivo temporal y devuelve su ruta. */
export function writeSandboxProfile(folder: string, dir = join(tmpdir(), 'opendesk-cowork')): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `profile-${randomBytes(6).toString('hex')}.sb`)
  writeFileSync(file, buildSandboxProfile({ folder }), 'utf8')
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
  onExit?: (code: number | null) => void
}

function augmentedPath(): string {
  const extra = [join(homedir(), '.opencode', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  const cur = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const d of extra) if (!cur.includes(d)) cur.push(d)
  return cur.join(delimiter)
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
  const cors = ['null', ...(options.corsOrigins ?? [])]
  const serveArgs = ['serve', '--port', String(port), '--hostname', HOST, ...cors.flatMap((o) => ['--cors', o])]

  let command = bin
  let args = serveArgs
  if (sandboxed) {
    const profile = writeSandboxProfile(folder)
    command = SANDBOX_EXEC
    args = ['-f', profile, bin, ...serveArgs]
  }

  const child: ChildProcess = spawn(command, args, {
    cwd: folder,
    env: {
      ...process.env,
      ...getOpencodeEnv(),
      PATH: augmentedPath(),
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENDESK_COWORK_FOLDER: folder
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

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
      options.onExit?.(code)
      resolve(code)
    })
  })

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
    child.kill('SIGTERM')
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
