/**
 * Entorno MÍNIMO para los procesos que lanza la app (servidores `opencode serve`, MCP de computer
 * use): lista blanca de variables del sistema + las que la app añade explícitamente. Así no se
 * filtran a OpenCode (ni a su bash, MCP de terceros, rutinas…) variables de Electron/Vite
 * (`ELECTRON_RENDERER_URL`, `ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS`, `DYLD_*`, tokens que el
 * usuario tenga exportados en su shell, etc.
 */
import { homedir, tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'

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

/** Directorios extra donde buscar binarios (apps lanzadas desde Finder tienen PATH mínimo). */
export const EXTRA_PATH_DIRS = [
  join(homedir(), '.opencode', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.bun', 'bin'),
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
]

export function augmentedPath(base = process.env.PATH ?? ''): string {
  const merged = base.split(delimiter).filter(Boolean)
  for (const d of EXTRA_PATH_DIRS) if (!merged.includes(d)) merged.push(d)
  return merged.join(delimiter)
}

/**
 * Entorno de un proceso hijo: lista blanca de `process.env` (+ `LC_*`), PATH ampliado, valores por
 * defecto para HOME/USER/TMPDIR/LANG y luego `extra` (que puede sobrescribir todo lo anterior).
 */
export function minimalEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue
    if (ALLOWED.has(k) || /^LC_[A-Z]+$/.test(k)) env[k] = v
  }
  env.PATH = augmentedPath(env.PATH)
  env.HOME ||= homedir()
  env.TMPDIR ||= tmpdir()
  env.LANG ||= 'en_US.UTF-8'
  try {
    const u = userInfo()
    env.USER ||= u.username
    env.LOGNAME ||= u.username
    if (!env.SHELL && u.shell) env.SHELL = u.shell
  } catch {
    // sin información de usuario
  }
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string') env[k] = v
    else delete env[k]
  }
  return env
}
