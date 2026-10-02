/**
 * Entorno MÍNIMO para los procesos que lanza la app (servidores `opencode serve`, MCP de computer
 * use): lista blanca de variables del sistema + las que la app añade explícitamente. Así no se
 * filtran a OpenCode (ni a su bash, MCP de terceros, rutinas…) variables de Electron/Vite
 * (`ELECTRON_RENDERER_URL`, `ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS`, `DYLD_*`, tokens que el
 * usuario tenga exportados en su shell, etc.
 */
import { homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, posix, win32 } from 'node:path'

/** Variables del sistema que sí se heredan (si existen). */
const ALLOWED = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'TZ',
  'TERM',
  // Red corporativa: proxy y CAs propias (sin ellos OpenCode no llega al proveedor).
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // Ubicación de config/datos de OpenCode del usuario (auth.json, sesiones).
  // XDG_* del usuario: el sidecar sobrescribe XDG_DATA_HOME con el almacén propio (ver getOpencodeEnv).
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  // Binario de OpenCode elegido por el usuario (lo usa findOpencodeBinary en main).
  'OPENCODE_BIN'
])

/**
 * Windows: además de lo anterior, lo que Bun/OpenCode, Git y los shells necesitan para arrancar
 * (sin SystemRoot, USERPROFILE, APPDATA, TEMP, PATHEXT, ComSpec… falla). En Windows los nombres de
 * variable no distinguen mayúsculas (`Path`, no `PATH`), por eso la comparación es insensible.
 */
const ALLOWED_WIN = new Set(
  [
    ...ALLOWED,
    'USERNAME',
    'USERDOMAIN',
    'SystemRoot',
    'SystemDrive',
    'windir',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'PATHEXT',
    'ComSpec',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'CommonProgramFiles',
    'CommonProgramFiles(x86)',
    'CommonProgramW6432',
    'ALLUSERSPROFILE',
    'PUBLIC',
    'COMPUTERNAME',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS'
  ].map((k) => k.toUpperCase())
)

export type EnvPlatform = NodeJS.Platform

/** Directorios extra donde buscar binarios (apps lanzadas desde Finder/Explorador tienen PATH mínimo). */
export function extraPathDirs(
  platform: EnvPlatform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir()
): string[] {
  if (platform === 'win32') {
    const get = (k: string): string | undefined => {
      const key = Object.keys(env).find((e) => e.toUpperCase() === k.toUpperCase())
      return key ? env[key] : undefined
    }
    const dirs = [win32.join(get('USERPROFILE') || home, '.opencode', 'bin')]
    const local = get('LOCALAPPDATA')
    if (local) dirs.push(win32.join(local, 'Programs'))
    for (const pf of [get('ProgramFiles'), get('ProgramW6432'), get('ProgramFiles(x86)')]) {
      if (pf) dirs.push(win32.join(pf, 'Git', 'cmd'))
    }
    return dirs
  }
  return [
    posix.join(home, '.opencode', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    posix.join(home, '.local', 'bin'),
    posix.join(home, '.bun', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
}

export const EXTRA_PATH_DIRS = extraPathDirs()

export function augmentedPath(
  base = process.env.PATH ?? '',
  dirs: string[] = EXTRA_PATH_DIRS,
  platform: EnvPlatform = process.platform
): string {
  const win = platform === 'win32'
  const delim = win ? win32.delimiter : delimiter
  const norm = (d: string): string => (win ? d.toLowerCase().replace(/[\\/]+$/, '') : d)
  const merged = base.split(delim).filter(Boolean)
  const seen = new Set(merged.map(norm))
  for (const d of dirs) {
    if (!seen.has(norm(d))) {
      merged.push(d)
      seen.add(norm(d))
    }
  }
  return merged.join(delim)
}

export interface MinimalEnvOptions {
  /** Plataforma (solo tests; por defecto la real). */
  platform?: EnvPlatform
  /** Entorno de origen (solo tests; por defecto `process.env`). */
  source?: Record<string, string | undefined>
}

/**
 * Entorno de un proceso hijo: lista blanca de `process.env` (+ `LC_*`), PATH ampliado, valores por
 * defecto para HOME/USER/TMPDIR/LANG y luego `extra` (que puede sobrescribir todo lo anterior).
 * En Windows las claves no distinguen mayúsculas: la variable de rutas se conserva como `Path`.
 */
export function minimalEnv(extra: Record<string, string | undefined> = {}, opts: MinimalEnvOptions = {}): Record<string, string> {
  const platform = opts.platform ?? process.platform
  const source = opts.source ?? process.env
  const win = platform === 'win32'
  const env: Record<string, string> = {}
  /** Clave existente en `env` equivalente a `k` (mismo nombre sin distinguir mayúsculas en Windows). */
  const keyOf = (k: string): string | undefined =>
    win ? Object.keys(env).find((e) => e.toUpperCase() === k.toUpperCase()) : k in env ? k : undefined
  const put = (k: string, v: string): void => {
    const existing = keyOf(k)
    if (existing && existing !== k) delete env[existing]
    env[k] = v
  }
  for (const [k, v] of Object.entries(source)) {
    if (typeof v !== 'string') continue
    if (win ? ALLOWED_WIN.has(k.toUpperCase()) || /^LC_[A-Z]+$/i.test(k) : ALLOWED.has(k) || /^LC_[A-Z]+$/.test(k)) put(k, v)
  }
  const pathKey = (win && keyOf('PATH')) || 'PATH'
  const dirs = opts.source || opts.platform ? extraPathDirs(platform, source) : EXTRA_PATH_DIRS
  put(pathKey, augmentedPath(env[pathKey], dirs, platform))
  const home = win ? source.USERPROFILE || homedir() : homedir()
  if (!keyOf('HOME')) put('HOME', home)
  if (win) {
    if (!keyOf('USERPROFILE')) put('USERPROFILE', home)
    if (!keyOf('TEMP')) put('TEMP', tmpdir())
    if (!keyOf('TMP')) put('TMP', env[keyOf('TEMP') as string])
  } else if (!keyOf('TMPDIR')) put('TMPDIR', tmpdir())
  if (!keyOf('LANG')) put('LANG', 'en_US.UTF-8')
  if (!win) {
    try {
      const u = userInfo()
      env.USER ||= u.username
      env.LOGNAME ||= u.username
      if (!env.SHELL && u.shell) env.SHELL = u.shell
    } catch {
      // sin información de usuario
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string') put(k, v)
    else {
      const existing = keyOf(k)
      if (existing) delete env[existing]
    }
  }
  return env
}
