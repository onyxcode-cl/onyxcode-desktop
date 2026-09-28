/**
 * Perfil Seatbelt (SBPL) y entorno aislado de los servidores de Cowork sandboxeados.
 *
 * Módulo PURO (solo `node:*`, sin Electron) para poder probarlo con `sandbox-exec` fuera
 * de la app (ver AUDIT.md S1–S3).
 *
 * Modelo:
 *  - `(allow default)` + denegaciones explícitas (un perfil `(deny default)` rompe bun/opencode
 *    en formas difíciles de mantener; ver AUDIT.md §2.3 "fix real").
 *  - Escritura: SOLO la carpeta de la tarea, el directorio privado del servidor
 *    (`userData/cowork-sandbox/<hash>`: XDG_*, cachés de npm/bun/pip) y temporales.
 *    Nada de `~/.config/opencode`, `~/.local/share/opencode`, `~/.npm`, `~/Library/Caches`…:
 *    todo lo que el sidecar principal (sin sandbox) u otras herramientas del usuario
 *    ejecutan/cargan fuera del sandbox (S1).
 *  - Sin lanzar procesos fuera del perfil: `open`/LaunchServices, `osascript`/Apple Events,
 *    `launchctl`, Automator, Atajos, `screencapture` (S2).
 *  - Lectura denegada de secretos: credenciales de OpenCode, userData de la app (tokens MCP,
 *    otros sandboxes), gh, netrc, npm/pypi, nube, navegadores, Safari, cookies, llavero,
 *    Mail/Messages, historiales de shell (S3).
 */
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** Hash estable de la carpeta de la tarea (nombre del directorio privado del servidor). */
export function sandboxKey(folder: string): string {
  return createHash('sha256').update(real(folder)).digest('hex').slice(0, 16)
}

/** Directorios privados de un servidor sandboxeado (dentro de `root` = userData/cowork-sandbox/<hash>). */
export interface SandboxDirs {
  root: string
  config: string
  data: string
  cache: string
  state: string
  tmp: string
}

export function sandboxDirs(root: string): SandboxDirs {
  return {
    root,
    config: join(root, 'config'),
    data: join(root, 'data'),
    cache: join(root, 'cache'),
    state: join(root, 'state'),
    tmp: join(root, 'tmp')
  }
}

/**
 * Variables de entorno que aíslan a OpenCode (y a npm/bun/pip) en el directorio privado.
 * OpenCode usa XDG_* para `~/.config/opencode`, `~/.local/share/opencode` (DB, auth.json,
 * binarios de LSP), `~/.cache/opencode` y `~/.local/state/opencode`.
 */
export function sandboxEnv(dirs: SandboxDirs): Record<string, string> {
  return {
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    TMPDIR: dirs.tmp,
    npm_config_cache: join(dirs.cache, 'npm'),
    BUN_INSTALL_CACHE_DIR: join(dirs.cache, 'bun'),
    PIP_CACHE_DIR: join(dirs.cache, 'pip'),
    OPENCODE_DISABLE_AUTOUPDATE: '1'
  }
}

/** Temporales del sistema con escritura permitida. */
export function defaultWritablePaths(): string[] {
  return [
    '/private/tmp',
    '/private/var/folders', // $TMPDIR del sistema y DARWIN_USER_CACHE_DIR
    real(tmpdir())
  ]
}

/** Rutas (subpath) con lectura y escritura denegadas. */
export function defaultDeniedReadPaths(home = homedir()): string[] {
  const h = (...p: string[]): string => join(home, ...p)
  const as = (...p: string[]): string => h('Library', 'Application Support', ...p)
  return [
    // Claves SSH / nube / contenedores
    h('.ssh'),
    h('.aws'),
    h('.gnupg'),
    h('.kube'),
    h('.docker'),
    h('.azure'),
    h('.config', 'gcloud'),
    // OpenCode del usuario: auth.json (claves de proveedores), DB de todas las sesiones, config/plugins
    h('.local', 'share', 'opencode'),
    h('.local', 'state', 'opencode'),
    h('.config', 'opencode'),
    // Tokens de CLIs
    h('.config', 'gh'),
    h('.config', 'hub'),
    h('.netrc'),
    h('.git-credentials'),
    h('.npmrc'),
    h('.yarnrc'),
    h('.pypirc'),
    h('.cargo', 'credentials'),
    h('.cargo', 'credentials.toml'),
    h('.gem', 'credentials'),
    h('.terraform.d'),
    // Historiales de shell
    h('.zsh_history'),
    h('.bash_history'),
    h('.zsh_sessions'),
    h('.python_history'),
    h('.node_repl_history'),
    // Navegadores, cookies, llavero, correo y mensajes
    as('Google', 'Chrome'),
    as('Chromium'),
    as('Firefox'),
    as('BraveSoftware'),
    as('Microsoft Edge'),
    as('Arc'),
    as('com.operasoftware.Opera'),
    as('Vivaldi'),
    h('Library', 'Safari'),
    h('Library', 'Cookies'),
    h('Library', 'Keychains'),
    h('Library', 'Mail'),
    h('Library', 'Messages'),
    h('Library', 'Containers', 'com.apple.Safari'),
    h('Library', 'Group Containers', 'group.com.apple.notes')
  ]
}

/** Binarios que lanzan procesos FUERA del sandbox (LaunchServices, Apple Events, launchd). */
export const DENIED_EXEC = [
  '/usr/bin/open',
  '/usr/bin/osascript',
  '/usr/bin/osacompile',
  '/bin/launchctl',
  '/usr/bin/automator',
  '/usr/bin/shortcuts',
  '/usr/bin/lsappinfo',
  '/usr/sbin/screencapture',
  '/usr/bin/pbcopy',
  '/usr/bin/pbpaste'
]

/** Servicios Mach de LaunchServices/launchd que permiten abrir apps o registrar trabajos. */
export const DENIED_MACH = [
  'com.apple.coreservices.launchservicesd',
  'com.apple.lsd.open',
  'com.apple.lsd.modifydb',
  'com.apple.coreservices.appleevents',
  'com.apple.pasteboard.1',
  'com.apple.screencapture.interactive'
]

export interface SandboxProfileOptions {
  /** Carpeta de la tarea (única carpeta del usuario con escritura). */
  folder: string
  /** Directorio privado del servidor (lectura+escritura). */
  privateDir: string
  /** userData de la app: lectura denegada salvo `privateDir` y `readOnly`. */
  userData?: string
  /** Rutas de solo lectura dentro de `userData` (p.ej. userData/opencode-config con los agentes). */
  readOnly?: string[]
  /** Rutas extra con escritura permitida. */
  extraWritable?: string[]
  home?: string
  /**
   * Puertos `localhost` a los que el servidor puede CONECTARSE (egress proxy, credential proxy).
   * Sin esto no hay red: `(deny network*)` con excepciones explícitas.
   */
  allowedOutboundPorts?: number[]
  /** Puerto propio del `opencode serve` (bind + inbound: el proceso main habla con él). */
  serverPort?: number
  /**
   * false (por defecto) ⇒ `file-write-unlink` DENEGADO en `folder` (borrado bloqueado a nivel de
   * sandbox, no solo por patrones de bash): un `rm`, `unlink()` o `os.remove` falla con EPERM
   * aunque el modelo lo intente. true ⇒ el usuario concedió "Permitir borrar" para esta tarea.
   */
  allowDelete?: boolean
}

/** Genera el texto del perfil Seatbelt (SBPL). En SBPL gana la ÚLTIMA regla que coincide. */
export function buildSandboxProfile(opts: SandboxProfileOptions): string {
  const home = opts.home ?? homedir()
  const folder = real(opts.folder)
  const priv = real(opts.privateDir)
  const writable = [...new Set([folder, priv, ...defaultWritablePaths(), ...(opts.extraWritable ?? []).map(real)])]
  const denied = defaultDeniedReadPaths(home)
  const userData = opts.userData ? real(opts.userData) : null
  const readOnly = (opts.readOnly ?? []).map(real)
  const lines = [
    '(version 1)',
    '(allow default)',
    '',
    ';; Escritura: solo la carpeta de la tarea + directorio privado del servidor + temporales.',
    '(deny file-write*)',
    '(allow file-write*',
    ...writable.map((p) => `  (subpath ${sbString(p)})`),
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty")',
    '  (literal "/dev/dtracehelper") (literal "/dev/random") (literal "/dev/urandom")',
    '  (regex #"^/dev/ttys[0-9]+$") (regex #"^/dev/fd/"))',
    '',
    ';; Secretos del usuario: sin lectura ni escritura.',
    '(deny file-read* file-write*',
    ...denied.map((p) => `  (subpath ${sbString(p)})`),
    ')'
  ]
  if (userData) {
    lines.push(
      '',
      ';; userData de la app (tokens MCP, cowork.json, otros sandboxes): denegado…',
      `(deny file-read* file-write* (subpath ${sbString(userData)}))`,
      ';; (stat sí: realpath/lstat de las rutas intermedias; no expone contenido)',
      `(allow file-read-metadata (subpath ${sbString(userData)}))`
    )
    if (readOnly.length) {
      lines.push(
        ';; …salvo la config de OpenCode de la app (agentes), solo lectura…',
        `(allow file-read* ${readOnly.map((p) => `(subpath ${sbString(p)})`).join(' ')})`
      )
    }
    lines.push(
      ';; …y el directorio privado de este servidor.',
      `(allow file-read* file-write* (subpath ${sbString(priv)}))`
    )
  }
  lines.push(
    '',
    ';; Sin procesos fuera del sandbox: LaunchServices (open), Apple Events (osascript),',
    ';; launchd (launchctl), Automator/Atajos, capturas y portapapeles.',
    '(deny process-exec',
    ...DENIED_EXEC.map((p) => `  (literal ${sbString(p)})`),
    ')',
    '(deny appleevent-send)',
    '(deny mach-lookup',
    ...DENIED_MACH.map((n) => `  (global-name ${sbString(n)})`),
    ')',
    ''
  )

  // ── Red: todo denegado salvo el proxy de egress y el proxy de credenciales (127.0.0.1) y el
  // puerto propio del servidor (para que el proceso main pueda hablarle). Sin proxy configurado
  // (p.ej. tests que no lo necesitan) no se abre nada: sin red en absoluto. SBPL solo admite
  // "localhost"/"*" como host en reglas de red (no una IP literal), así que se usa "localhost:<puerto>".
  const outboundPorts = [...new Set(opts.allowedOutboundPorts ?? [])]
  lines.push(';; Red: denegada salvo el/los proxy(es) locales de Cowork y el puerto del servidor.', '(deny network*)')
  if (outboundPorts.length) {
    lines.push(
      '(allow network-outbound',
      ...outboundPorts.map((p) => `  (remote ip "localhost:${p}")`),
      ')'
    )
  }
  if (opts.serverPort) {
    lines.push(
      `(allow network-bind (local ip "localhost:${opts.serverPort}"))`,
      `(allow network-inbound (local ip "localhost:${opts.serverPort}"))`
    )
  }
  // Puertos efímeros para las conexiones salientes propias del proceso (el kernel asigna el
  // puerto local origen; sin esto el `connect()` del lado cliente falla al enlazar el socket).
  lines.push('(allow network-bind (local ip "localhost:*"))', '')

  // ── Borrado: sin "Permitir borrar" para esta tarea, `unlink`/`rmdir`/`rename`-sobre-destino en
  // la carpeta de trabajo se deniega a nivel de kernel (no solo con un patrón de bash evadible).
  if (!opts.allowDelete) {
    lines.push(
      ';; Borrado permanente NO concedido: unlink/rmdir denegados en la carpeta de la tarea.',
      `(deny file-write-unlink (subpath ${sbString(folder)}))`,
      ''
    )
  }
  return lines.join('\n')
}
