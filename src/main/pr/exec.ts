/**
 * Ejecución de `git` y `gh` para el flujo de pull request: `execFile` SIN shell, argumentos en lista, entorno mínimo (lista
 * blanca; jamás se pasa un token de GitHub desde el entorno: `gh` usa la sesión que la persona ya inició por su cuenta),
 * tiempo límite y tope de salida. Sin `electron`: se prueba con Node puro.
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export class PrError extends Error {
  constructor(
    /** Código estable para la interfaz (`gh-missing`, `blocked`…). */
    readonly code: string,
    message: string,
    readonly stderr = ''
  ) {
    super(message)
    this.name = 'PrError'
  }
}

/** Variables que sí se heredan: lo justo para que git/ssh/gh encuentren su configuración, el llavero y el proxy de la persona. */
const ENV_ALLOW = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SSH_AUTH_SOCK',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy'
]

/** Entorno de los procesos hijos del flujo de PR (función pura: recibe el entorno de origen). */
export function minimalEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const k of ENV_ALLOW) if (source[k] !== undefined) env[k] = source[k]
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GCM_INTERACTIVE = 'never'
  env.GH_PROMPT_DISABLED = '1'
  env.GH_NO_UPDATE_NOTIFIER = '1'
  env.GH_SPINNER_DISABLED = '1'
  env.NO_COLOR = '1'
  env.LC_ALL = 'C'
  env.LANG = 'C'
  return env
}

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  input?: string
  maxBuffer?: number
  /** Códigos de salida que no son error. */
  okCodes?: number[]
  env?: NodeJS.ProcessEnv
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
  /** La salida superó `maxBuffer` y se cortó. */
  truncated: boolean
}

const DEFAULT_TIMEOUT = 60_000
const DEFAULT_BUFFER = 16 * 1024 * 1024

/**
 * Corre `bin args…`. No lanza por un código de salida distinto de 0 (lo devuelve en `code`); sí lanza `PrError` si el programa no
 * existe (`not-found`), si se pasa el tiempo (`timeout`) o si no se pudo ni arrancar.
 */
export function runFile(bin: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((res, rej) => {
    const child = execFile(
      bin,
      [...args],
      {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
        maxBuffer: opts.maxBuffer ?? DEFAULT_BUFFER,
        encoding: 'utf8',
        env: opts.env ?? minimalEnv()
      },
      (err, stdout, stderr) => {
        if (!err) return res({ stdout, stderr, code: 0, truncated: false })
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string | null }
        if (e.code === 'ENOENT') return rej(new PrError('not-found', `${bin}: not found`))
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return res({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: 0, truncated: true })
        }
        if (e.killed || e.signal === 'SIGTERM') return rej(new PrError('timeout', `${bin}: timeout`, String(stderr ?? '')))
        const code = typeof e.code === 'number' ? e.code : null
        if (code === null) return rej(new PrError('spawn', e.message, String(stderr ?? '')))
        res({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code, truncated: false })
      }
    )
    // Siempre se cierra la entrada: un programa que lea stdin (`--body-file -`, un aviso) termina en vez de esperar para siempre.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(opts.input)
  })
}

// ---------------------------------------------------------------------------
// Localizar `gh`
// ---------------------------------------------------------------------------

export interface FindDeps {
  platform?: NodeJS.Platform
  pathEnv?: string
  home?: string
  isFile?: (p: string) => boolean
  /** Carpeta del proyecto: un `gh` dentro de ella NO se usa. */
  projectDir?: string
}

const defaultIsFile = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/** Carpetas donde suele estar `gh` aunque la app, abierta desde el Finder o el menú Inicio, tenga un PATH mínimo. */
export function knownGhDirs(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    const dirs = [
      env.ProgramFiles ? join(env.ProgramFiles, 'GitHub CLI') : 'C:\\Program Files\\GitHub CLI',
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'GitHub CLI') : join(home, 'AppData', 'Local', 'Programs', 'GitHub CLI')
    ]
    return dirs
  }
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin', join(home, '.local', 'bin')]
}

/**
 * Ruta ABSOLUTA del ejecutable `gh` o `null`. Mira el PATH (solo entradas absolutas, nunca la carpeta del proyecto) y luego las
 * carpetas habituales. Siempre se ejecuta por ruta absoluta: nada de buscar `gh` relativo a la carpeta de trabajo.
 */
export function findGh(deps: FindDeps = {}): string | null {
  const platform = deps.platform ?? process.platform
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? ''
  const isFile = deps.isFile ?? defaultIsFile
  const home = deps.home ?? homedir()
  const exe = platform === 'win32' ? 'gh.exe' : 'gh'
  const proj = deps.projectDir ? resolve(deps.projectDir) : null
  const dirs = [...pathEnv.split(platform === 'win32' ? ';' : ':'), ...knownGhDirs(platform, home)]
  for (const d of dirs) {
    if (!d || !isAbsolute(d)) continue
    if (proj && (resolve(d) === proj || resolve(d).startsWith(proj + sep))) continue
    const full = join(d, exe)
    if (isFile(full)) return full
  }
  return null
}
