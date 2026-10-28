/**
 * Perfil Seatbelt (SBPL) y entorno aislado de los servidores de Tareas sandboxeados.
 *
 * Módulo PURO (solo `node:*`, sin Electron) para poder probarlo con `sandbox-exec` fuera
 * de la app (ver AUDIT.md S1–S3).
 *
 * Modelo:
 *  - `(allow default)` + denegaciones explícitas (un perfil `(deny default)` rompe bun/opencode
 *    en formas difíciles de mantener; ver AUDIT.md §2.3 "fix real").
 *  - Escritura: SOLO la carpeta de la tarea, el directorio privado del servidor
 *    (`userData/tasks-sandbox/<hash>`: XDG_*, cachés de npm/bun/pip) y temporales.
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
import { dirname, join } from 'node:path'
import type { FolderAccessMode } from '@shared/ipc-tasks'

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

/** Directorios privados de un servidor sandboxeado (dentro de `root` = userData/tasks-sandbox/<hash>). */
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
/**
 * Firma de los commits que hace la IA dentro del sandbox (F8-B197). Sin `user.name`/`user.email` (el `~/.gitconfig` real está denegado),
 * git inventa el autor con el nombre completo del usuario de macOS y el nombre del equipo («Nombre Apellido <usuario@Equipo.local>»):
 * datos personales que acabarían en el historial. Se fija una identidad fija y sin datos personales; el dominio `.invalid` (RFC 2606)
 * no existe ni puede existir, así que el correo no apunta a nadie.
 */
export const SANDBOX_GIT_NAME = 'Lazunox'
export const SANDBOX_GIT_EMAIL = 'lazunox@localhost.invalid'

export function sandboxEnv(dirs: SandboxDirs): Record<string, string> {
  return {
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    TMPDIR: dirs.tmp,
    // `~/.gitconfig` está denegado (puede llevar `url.<token>@…` o ayudantes de credenciales) y `git` MUERE con
    // «unable to access … Operation not permitted» si no puede leerlo: se le da un archivo global propio y privado.
    GIT_CONFIG_GLOBAL: join(dirs.config, 'gitconfig'),
    GIT_AUTHOR_NAME: SANDBOX_GIT_NAME,
    GIT_AUTHOR_EMAIL: SANDBOX_GIT_EMAIL,
    GIT_COMMITTER_NAME: SANDBOX_GIT_NAME,
    GIT_COMMITTER_EMAIL: SANDBOX_GIT_EMAIL,
    npm_config_cache: join(dirs.cache, 'npm'),
    BUN_INSTALL_CACHE_DIR: join(dirs.cache, 'bun'),
    PIP_CACHE_DIR: join(dirs.cache, 'pip'),
    UV_CACHE_DIR: join(dirs.cache, 'uv'),
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    // Marca de que el proceso corre dentro del sandbox de Tareas.
    LAZUNOX_SANDBOX: '1'
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

/**
 * Rutas (subpath) con lectura y escritura denegadas.
 *
 * Criterio (F8-B194): se niega lo que razonablemente guarda credenciales o configuración personal
 * con claves, y NADA de lo que el servidor necesita para arrancar y trabajar (sus XDG, TMPDIR y cachés
 * son privados, en `userData/tasks-sandbox/<hash>`; el binario, el catálogo de modelos y el sistema
 * están fuera de `HOME` o no se tocan). Las rutas que no existen no cuestan nada.
 */
export function defaultDeniedReadPaths(home = homedir()): string[] {
  const h = (...p: string[]): string => join(home, ...p)
  const as = (...p: string[]): string => h('Library', 'Application Support', ...p)
  return [
    // Claves SSH / GPG / nube / contenedores / clústeres
    h('.ssh'),
    h('.aws'),
    h('.gnupg'),
    h('.kube'),
    h('.docker'),
    h('.azure'),
    h('.oci'),
    h('.ibmcloud'),
    h('.terraform.d'),
    h('.vault-token'),
    h('.boto'),
    h('.s3cfg'),
    h('.databrickscfg'),
    h('.colima'),
    h('.lima'),
    // ~/.config entera: gcloud, op (1Password), gh, hub, doctl, wrangler, configstore, heroku,
    // stripe… guardan aquí sus tokens. El servidor usa su propio XDG_CONFIG_HOME (privado), así
    // que nada suyo vive aquí (ni `~/.config/opencode`, que ya se negaba).
    h('.config'),
    // OpenCode del usuario: auth.json (claves de proveedores), DB de todas las sesiones, config/plugins
    h('.local', 'share', 'opencode'),
    h('.local', 'state', 'opencode'),
    // Cachés del usuario (a veces con tokens o con salidas de otras herramientas): el servidor usa su XDG_CACHE_HOME privado
    h('.cache'),
    h('.npm'),
    // Otros agentes de código y editores (sesiones, tokens, historiales de conversación)
    h('.claude'),
    h('.claude.json'),
    h('.claude.json.backup'),
    h('.codex'),
    h('.cursor'),
    h('.windsurf'),
    h('.codeium'),
    h('.gemini'),
    h('.continue'),
    h('.aider.conf.yml'),
    h('.aider.chat.history.md'),
    h('.vscode'),
    h('.zed'),
    // Servidores MCP del usuario guardan sus tokens en ~/.<algo>-mcp-server
    h('.ms-365-mcp-server'),
    h('.mcp-auth'),
    h('.mcp.json'),
    // Tokens de CLIs y gestores de paquetes
    h('.netrc'),
    h('.git-credentials'),
    h('.gitconfig'),
    h('.npmrc'),
    h('.yarnrc'),
    h('.yarnrc.yml'),
    h('.pypirc'),
    h('.pgpass'),
    h('.my.cnf'),
    h('.mylogin.cnf'),
    h('.terraformrc'),
    h('.cargo', 'credentials'),
    h('.cargo', 'credentials.toml'),
    h('.gem', 'credentials'),
    h('.m2', 'settings.xml'),
    h('.gradle', 'gradle.properties'),
    h('.composer', 'auth.json'),
    h('.bundle', 'config'),
    h('.cloudflared'),
    h('.wrangler'),
    h('.vercel'),
    h('.netlify'),
    h('.fly'),
    h('.railway'),
    h('.stripe'),
    h('.supabase'),
    h('.expo'),
    h('.eas'),
    h('.firebase'),
    // Archivos de arranque del intérprete de órdenes: suelen llevar `export TOKEN=…`
    h('.zshrc'),
    h('.zshenv'),
    h('.zprofile'),
    h('.zlogin'),
    h('.zlogout'),
    h('.bashrc'),
    h('.bash_profile'),
    h('.bash_login'),
    h('.bash_logout'),
    h('.profile'),
    h('.envrc'),
    h('.env'),
    // Historiales (órdenes con claves pegadas)
    h('.zsh_history'),
    h('.bash_history'),
    h('.zsh_sessions'),
    h('.zhistory'),
    h('.sh_history'),
    h('.python_history'),
    h('.node_repl_history'),
    h('.irb_history'),
    h('.mysql_history'),
    h('.psql_history'),
    h('.sqlite_history'),
    h('.rediscli_history'),
    h('.lesshst'),
    h('.viminfo'),
    // Navegadores, cookies, llavero, correo y mensajes
    as('Google'),
    as('Chromium'),
    as('Firefox'),
    as('BraveSoftware'),
    as('Microsoft Edge'),
    as('Arc'),
    as('com.operasoftware.Opera'),
    as('Vivaldi'),
    h('Library', 'Safari'),
    h('Library', 'Cookies'),
    h('Library', 'HTTPStorages'),
    h('Library', 'WebKit'),
    h('Library', 'Keychains'),
    h('Library', 'Mail'),
    h('Library', 'Messages'),
    h('Library', 'Accounts'),
    h('Library', 'IdentityServices'),
    h('Library', 'Containers', 'com.apple.Safari'),
    // Contenedores de grupo (datos compartidos entre apps: Notas, Mensajes, Slack, Teams…)
    h('Library', 'Group Containers'),
    // Aplicaciones con sesión iniciada: guardan tokens y mensajes en Application Support
    as('Claude'),
    as('Code'),
    as('Cursor'),
    as('Windsurf'),
    as('Zed'),
    as('Slack'),
    as('discord'),
    as('Microsoft'),
    as('Notion'),
    as('1Password'),
    as('Bitwarden'),
    as('Dropbox'),
    as('zoom.us'),
    as('Signal'),
    as('Telegram Desktop'),
    as('WhatsApp'),
    as('Postman'),
    as('MobileSync'),
    as('AddressBook'),
    as('CallHistoryDB'),
    as('com.apple.TCC')
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
  /**
   * Carpetas adicionales del espacio (vinculadas o de confianza). `rw`: escritura permitida pero
   * SIN borrado (el permiso de borrar solo vale para la carpeta principal). `ro`: la lectura ya
   * está permitida por `(allow default)`; aquí se deniega además toda escritura.
   */
  extraFolders?: Array<{ path: string; mode: FolderAccessMode }>
  /**
   * Subcarpetas de `folder` donde SÍ se permite borrar/renombrar (scratch del agente).
   * Por defecto `[join(folder, '.lazunox', 'trabajo')]` (NO `.lazunox/` entera: `memoria.md` no debe poder borrarse).
   */
  scratchDirs?: string[]
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
  /**
   * Modo unificado: `~/Lazunox/Chats` (carpetas de TODOS los chats) sin lectura ni escritura, y re-permitida solo la propia
   * carpeta (y las adicionales) cuando cuelga de ahí. Este módulo es puro (scripts/verify-bundled.mjs lo carga con Node
   * sin alias): quien lo llama (backends/seatbelt.ts) pasa `isUnifiedAppsEnabled()`. Ausente/false ⇒ el perfil queda byte a byte como siempre.
   */
  isolateChats?: boolean
}

/** Genera el texto del perfil Seatbelt (SBPL). En SBPL gana la ÚLTIMA regla que coincide. */
export function buildSandboxProfile(opts: SandboxProfileOptions): string {
  const home = opts.home ?? homedir()
  const folder = real(opts.folder)
  const priv = real(opts.privateDir)
  const extras = (opts.extraFolders ?? []).map((e) => ({ path: real(e.path), mode: e.mode }))
  const extraRw = [...new Set(extras.filter((e) => e.mode === 'rw').map((e) => e.path))]
  const extraRo = [...new Set(extras.filter((e) => e.mode === 'ro').map((e) => e.path))]
  const writable = [...new Set([folder, priv, ...defaultWritablePaths(), ...(opts.extraWritable ?? []).map(real), ...extraRw])]
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
  if (opts.isolateChats === true) {
    // Las carpetas de chat viven en ~/Lazunox/Chats: un chat (o cualquier carpeta) no debe leer las de OTROS chats.
    // La re-permisión va DESPUÉS de la denegación (gana la última regla) y solo para rutas bajo Chats.
    const chats = real(join(home, 'Lazunox', 'Chats'))
    // Estrictamente DENTRO de Chats: `Chats` entera (o un ancestro) no re-abre las carpetas de todos los chats.
    const under = (p: string): boolean => p.startsWith(chats + '/')
    const reRw = [...new Set([folder, ...extraRw].filter(under))]
    const reRo = [...new Set(extraRo.filter(under))].filter((p) => !reRw.includes(p))
    lines.push(
      '',
      ';; Carpetas de OTROS chats (~/Lazunox/Chats): sin lectura ni escritura; solo la propia (y las adicionales) se re-permite.',
      `(deny file-read* file-write* (subpath ${sbString(chats)}))`,
      // stat de la propia carpeta de Chats (getcwd/realpath); sin listado: no revela los nombres de otros chats.
      `(allow file-read-metadata (literal ${sbString(chats)}))`,
      ...reRw.map((p) => `(allow file-read* file-write* (subpath ${sbString(p)}))`),
      ...reRo.map((p) => `(allow file-read* (subpath ${sbString(p)}))`)
    )
  }
  if (userData) {
    lines.push(
      '',
      ';; userData de la app (tokens MCP, tasks-folders.json, otros sandboxes): denegado…',
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
    lines.push(';; …y el directorio privado de este servidor.', `(allow file-read* file-write* (subpath ${sbString(priv)}))`)
  }
  lines.push(
    '',
    ';; Sin procesos fuera del sandbox: LaunchServices (open), Apple Events (osascript),',
    ';; launchd (launchctl), Automator/Atajos, capturas y portapapeles.',
    '(deny process-exec',
    ...DENIED_EXEC.map((p) => `  (literal ${sbString(p)})`),
    ')',
    '(deny appleevent-send)',
    ';; Información de OTROS procesos (libproc: ruta, tareas, recursos, descriptores): denegada; solo el',
    ';; propio. Forma "deny todo + allow (target self)" (la de los perfiles del sistema; `(target others)`',
    ';; no se aplica). OJO: KERN_PROCARGS2 (`ps eww`) no pasa por ninguna operación Seatbelt: ver SEGURIDAD.md.',
    '(deny process-info*)',
    '(allow process-info* (target self))',
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
  lines.push(';; Red: denegada salvo el/los proxy(es) locales de Tareas y el puerto del servidor.', '(deny network*)')
  if (outboundPorts.length) {
    lines.push('(allow network-outbound', ...outboundPorts.map((p) => `  (remote ip "localhost:${p}")`), ')')
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

  // ── Borrado y renombrado: sin "Permitir borrar, mover y renombrar", `unlink`/`rmdir` y `rename` (que
  // comprueba `file-write-unlink` sobre el ORIGEN) se deniegan a nivel de kernel en la carpeta
  // principal (no solo con un patrón de bash evadible). En las carpetas adicionales `rw` se deniegan
  // SIEMPRE: la concesión solo vale para la principal.
  // Una `rw` que CONTIENE a la principal no debe anular el permiso de borrado de la principal, y una
  // `rw` dentro de la principal (si alguien la pasa) sigue sin poder borrarse: por eso, con
  // `allowDelete`, se reabre el borrado en la principal y se vuelven a denegar las `rw` interiores.
  const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '/')
  const rwOthers = extraRw.filter((p) => p !== folder)
  const noUnlink = [...(opts.allowDelete ? [] : [folder]), ...rwOthers]
  if (noUnlink.length) {
    lines.push(
      ';; Borrado/renombrado NO concedido: unlink/rmdir/rename denegados (principal sin permiso y carpetas adicionales rw).',
      ...noUnlink.map((p) => `(deny file-write-unlink (subpath ${sbString(p)}))`),
      ''
    )
  }
  if (opts.allowDelete && rwOthers.some((p) => inside(folder, p))) {
    lines.push(
      ';; Borrado concedido en la principal aunque una carpeta rw adicional la contenga.',
      `(allow file-write-unlink (subpath ${sbString(folder)}))`,
      ...rwOthers.filter((p) => inside(p, folder)).map((p) => `(deny file-write-unlink (subpath ${sbString(p)}))`),
      ''
    )
  }
  if (opts.isolateChats === true) {
    // Con «Permitir borrar», renombrar/mover/borrar un ANCESTRO de las carpetas de chat (`~/Lazunox`, `Chats`, el home) trabaja
    // con rutas y se saltaría la denegación de lectura (`mv ~/Lazunox ~/L2; cat ~/L2/Chats/b/f.txt`). Se deniega SOLO el literal
    // (no el contenido): escribir dentro de la carpeta de trabajo sigue como siempre.
    const chatsAnc = real(join(home, 'Lazunox', 'Chats'))
    const ancestors = [dirname(dirname(chatsAnc)), dirname(chatsAnc), chatsAnc]
    lines.push(
      ';; Modo unificado: el home, ~/Lazunox y ~/Lazunox/Chats no se pueden renombrar, mover ni borrar (aunque se permita borrar).',
      `(deny file-write-unlink ${ancestors.map((p) => `(literal ${sbString(p)})`).join(' ')})`,
      ''
    )
  }
  // Scratch del agente: sí se puede borrar y renombrar (archivos temporales de conversión, etc.).
  const scratch = (opts.scratchDirs ?? [join(folder, '.lazunox', 'trabajo')]).map((p) => sbString(p))
  if (noUnlink.length && scratch.length) {
    lines.push(
      ';; Scratch (.lazunox/trabajo): borrar y renombrar permitido.',
      ...scratch.map((p) => `(allow file-write-unlink (subpath ${p}))`),
      ''
    )
  }
  // Carpetas de solo lectura: al final, por si una `ro` está dentro de una carpeta escribible.
  if (extraRo.length) {
    lines.push(
      ';; Carpetas adicionales de solo lectura: ninguna escritura (gana sobre las escribibles que las contengan).',
      ...extraRo.map((p) => `(deny file-write* (subpath ${sbString(p)}))`),
      ''
    )
  }
  return lines.join('\n')
}
