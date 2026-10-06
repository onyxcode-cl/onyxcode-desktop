/**
 * Especificación PURA del backend WSL de Tareas (F8-B81): comandos y entorno de `wsl.exe` con LISTA CERRADA, el
 * `wsl.conf` de la distro dedicada, la política Landlock y la trama inicial hacia el lanzador. Sin Electron ni `fs`.
 *
 * Reglas que aquí se hacen cumplir (y que `wsl-spec.test.ts` vigila):
 *  - SOLO existen los comandos de `WslCommand`; todos apuntan a la distro dedicada `Lazunox-Tareas`. NUNCA
 *    `--shutdown` (mataría las distros del usuario), ni `--mount`, `--update`, `--install` ni `-d` de otra distro;
 *  - `wsl.exe` se lanza con entorno mínimo + `WSLENV=''` + `WSL_UTF8=1`: ninguna variable de Windows cruza;
 *  - sin interop (ejecutar `.exe` desde dentro) y sin automontaje de unidades: `WSL_CONF`;
 *  - la trama inicial NO recibe credenciales de proveedores: solo entorno de una lista de prefijos y, si trae
 *    `OPENCODE_AUTH_CONTENT`, cada entrada debe ser un centinela (`sandboxed-placeholder-<16 hex>`);
 *  - todo montaje lleva `noexec,nosuid,nodev`; las `ro` además `ro`; el scratch solo dentro de la carpeta principal;
 *    sin `allowDelete` la política de la carpeta principal NO incluye REMOVE_FILE/REMOVE_DIR/REFER.
 */
import { win32 } from 'node:path'
import { BridgeProtocolError, encodeInit } from './bridge-protocol'
import { fromSandboxPath, mountFor, toSandboxPath, type PathMount } from './wsl-paths'

export const WSL_DISTRO = 'Lazunox-Tareas'
export const WSL_LAUNCHER_PATH = '/opt/lazunox/launcher.py'
export const WSL_USER = 'lazunox'
/** uid/gid de `lazunox` en el rootfs (fijado por el script que lo construye). */
export const WSL_UID = 1000
export const INIT_VERSION = 1

/** `/etc/wsl.conf` de la distro dedicada (texto exacto; lo copia el rootfs). */
export const WSL_CONF = `[automount]
enabled=false
mountFsTab=false

[interop]
enabled=false
appendWindowsPath=false

[user]
default=${WSL_USER}

[boot]
systemd=false
`

// ───────────────────────── Comandos de wsl.exe (lista cerrada) ─────────────────────────

export type WslCommand =
  | { kind: 'launch' }
  /** El lanzador comprueba el entorno (interop, montajes, Landlock) y sale con un JSON; no arranca nada. */
  | { kind: 'probe' }
  | { kind: 'terminate' }
  | { kind: 'unregister' }
  | { kind: 'import'; installDir: string; rootfsTar: string }
  | { kind: 'list' }
  | { kind: 'status' }
  | { kind: 'version' }

export class WslSpecError extends Error {
  constructor(
    readonly reason: string,
    message?: string
  ) {
    super(message ?? reason)
    this.name = 'WslSpecError'
  }
}

function safeWinDir(p: string, what: string): string {
  const r = toSandboxPath(p)
  if (!r.ok) throw new WslSpecError('bad-path', `${what}: ${r.reason}`)
  if (p.includes('"')) throw new WslSpecError('bad-path', what)
  return p
}

export function wslArgs(cmd: WslCommand): string[] {
  const inDistro = ['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', WSL_LAUNCHER_PATH]
  switch (cmd.kind) {
    case 'launch':
      return inDistro
    case 'probe':
      return [...inDistro, '--probe']
    case 'terminate':
      return ['--terminate', WSL_DISTRO]
    case 'unregister':
      return ['--unregister', WSL_DISTRO]
    case 'import':
      return ['--import', WSL_DISTRO, safeWinDir(cmd.installDir, 'installDir'), safeWinDir(cmd.rootfsTar, 'rootfsTar'), '--version', '2']
    case 'list':
      return ['-l', '-v']
    case 'status':
      return ['--status']
    case 'version':
      return ['--version']
  }
}

const ALLOWED_TEMPLATES: ReadonlyArray<ReadonlyArray<string>> = [
  ['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', WSL_LAUNCHER_PATH],
  ['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', WSL_LAUNCHER_PATH, '--probe'],
  ['--terminate', WSL_DISTRO],
  ['--unregister', WSL_DISTRO],
  ['-l', '-v'],
  ['--status'],
  ['--version']
]

/** Última barrera antes del `spawn`: los argumentos tienen que ser EXACTAMENTE uno de los permitidos. */
export function assertAllowedWslArgs(args: readonly string[]): void {
  const hit = ALLOWED_TEMPLATES.some((t) => t.length === args.length && t.every((a, i) => a === args[i]))
  if (hit) return
  // `--import <distro> <dir> <tar> --version 2`: distro fija, rutas Windows válidas.
  if (
    args.length === 6 &&
    args[0] === '--import' &&
    args[1] === WSL_DISTRO &&
    args[4] === '--version' &&
    args[5] === '2' &&
    toSandboxPath(args[2]!).ok &&
    toSandboxPath(args[3]!).ok &&
    !args[2]!.includes('"') &&
    !args[3]!.includes('"')
  )
    return
  throw new WslSpecError('wsl-args-not-allowed', `argumentos de wsl.exe no permitidos: ${args.slice(0, 3).join(' ')}`)
}

/** Variables del anfitrión que SÍ llegan a `wsl.exe` (sin distinguir mayúsculas). Nada de USERPROFILE/APPDATA/Path. */
export const WSL_ENV_ALLOWED = ['SystemRoot', 'windir', 'SystemDrive', 'TEMP', 'TMP', 'LOCALAPPDATA'] as const

export function wslEnv(hostEnv: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  const lower = new Map<string, string>()
  for (const [k, v] of Object.entries(hostEnv)) if (typeof v === 'string') lower.set(k.toLowerCase(), v)
  for (const name of WSL_ENV_ALLOWED) {
    const v = lower.get(name.toLowerCase())
    if (v !== undefined) out[name] = v
  }
  // Nada cruza al otro lado por WSLENV, y la salida propia de wsl.exe en UTF-8.
  out.WSLENV = ''
  out.WSL_UTF8 = '1'
  return out
}

export interface WslSpawnSpec {
  command: string
  args: string[]
  env: Record<string, string>
  options: { windowsHide: true; shell: false; stdio: ['pipe', 'pipe', 'pipe']; detached: false }
}

/** `wsl.exe` por ruta absoluta (`%SystemRoot%\System32`): no depende del `Path` (que no se pasa). */
export function buildWslSpawn(cmd: WslCommand, hostEnv: Record<string, string | undefined>): WslSpawnSpec {
  const args = wslArgs(cmd)
  assertAllowedWslArgs(args)
  const env = wslEnv(hostEnv)
  const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows'
  return {
    command: win32.join(root, 'System32', 'wsl.exe'),
    args,
    env,
    options: { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: false }
  }
}

// ───────────────────────── Política Landlock ─────────────────────────

/** Derechos Landlock (ABI ≤ 2) que la política maneja; lo no concedido queda denegado. TRUNCATE no se maneja (como macOS). */
export const LANDLOCK_RIGHTS = [
  'EXECUTE',
  'WRITE_FILE',
  'READ_FILE',
  'READ_DIR',
  'REMOVE_DIR',
  'REMOVE_FILE',
  'MAKE_CHAR',
  'MAKE_DIR',
  'MAKE_REG',
  'MAKE_SOCK',
  'MAKE_FIFO',
  'MAKE_BLOCK',
  'MAKE_SYM',
  'REFER'
] as const
export type LandlockRight = (typeof LANDLOCK_RIGHTS)[number]
export const LANDLOCK_MIN_ABI = 2

export type LandlockAccess = 'rx' | 'ro' | 'dev' | 'rw-nodelete' | 'rw-delete' | 'private'

/**
 * Derechos por nivel de acceso. Carpetas de Windows (drvfs): sin MAKE_SYM/FIFO/SOCK/CHAR/BLOCK (los enlaces son el
 * vector de los ataques A2-A4; decisión abierta del dueño en docs/WINDOWS-TAREAS.md). `rw-nodelete` no incluye
 * REMOVE_FILE, REMOVE_DIR ni REFER: borrar y renombrar caen con EACCES. `private` (XDG y tmp de la VM) lo permite todo.
 */
export const LANDLOCK_ACCESS: Record<LandlockAccess, readonly LandlockRight[]> = {
  rx: ['EXECUTE', 'READ_FILE', 'READ_DIR'],
  ro: ['READ_FILE', 'READ_DIR'],
  dev: ['READ_FILE', 'READ_DIR', 'WRITE_FILE'],
  'rw-nodelete': ['READ_FILE', 'READ_DIR', 'WRITE_FILE', 'MAKE_REG', 'MAKE_DIR'],
  'rw-delete': ['READ_FILE', 'READ_DIR', 'WRITE_FILE', 'MAKE_REG', 'MAKE_DIR', 'REMOVE_FILE', 'REMOVE_DIR', 'REFER'],
  private: LANDLOCK_RIGHTS
}

export interface LandlockRule {
  path: string
  access: LandlockAccess
}

export const LANDLOCK_SYSTEM_RULES: readonly LandlockRule[] = [
  { path: '/usr', access: 'rx' },
  { path: '/lib', access: 'rx' },
  { path: '/lib64', access: 'rx' },
  { path: '/bin', access: 'rx' },
  { path: '/sbin', access: 'rx' },
  { path: '/etc', access: 'ro' },
  { path: '/opt/lazunox', access: 'rx' },
  { path: '/proc', access: 'ro' },
  { path: '/dev', access: 'dev' }
]

// ───────────────────────── Trama inicial ─────────────────────────

export interface WslMount {
  win: string
  linux: string
  mode: 'rw' | 'ro'
}

export interface WslInit {
  v: typeof INIT_VERSION
  sandboxKey: string
  mounts: WslMount[]
  /** Puertos de 127.0.0.1 de Windows a los que el agente puede pedir un flujo; dentro se escucha en el MISMO número. */
  relayPorts: number[]
  serverPort: number
  serveArgs: string[]
  /** Carpeta de trabajo del servidor dentro de la distro. */
  cwd: string
  env: Record<string, string>
  landlock: { minAbi: number; rules: LandlockRule[] }
}

export interface WslLaunchInput {
  /** Carpeta de la tarea (Windows). */
  folder: string
  extraFolders?: Array<{ path: string; mode: 'rw' | 'ro' }>
  /** Config de agentes de la app (Windows), solo lectura. */
  configDir: string
  allowDelete: boolean
  /** Por defecto `<folder>\.lazunox\trabajo`. Deben estar dentro de `folder`. */
  scratchDirs?: string[]
  sandboxKey: string
  serverPort: number
  serveArgs: string[]
  env: Record<string, string>
  /** Puertos del anfitrión (egress, credenciales, extra). */
  relayPorts: number[]
}

const ENV_ALLOWED = /^(?:OPENCODE_[A-Z0-9_]+|LAZUNOX_[A-Z0-9_]+|(?:HTTPS?|ALL|NO)_PROXY|(?:https?|all|no)_proxy|LANG|LC_ALL|TZ)$/
/** Se reconstruyen a partir de los montajes: el valor del anfitrión es una ruta de Windows. */
const ENV_REWRITTEN = new Set(['OPENCODE_CONFIG_DIR', 'LAZUNOX_TASKS_FOLDER'])
const PLACEHOLDER = /^sandboxed-placeholder-[0-9a-f]{16}$/
export const MAX_ENV_TOTAL = 32 * 1024

/** `OPENCODE_AUTH_CONTENT` solo puede ser `{}` o entradas `{type:'api', key:<centinela>}`; si no, init_secret. */
export function assertPlaceholderAuth(content: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new BridgeProtocolError('init_secret', 'OPENCODE_AUTH_CONTENT no es JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BridgeProtocolError('init_secret')
  for (const entry of Object.values(parsed as Record<string, unknown>)) {
    const e = entry as Record<string, unknown> | null
    const keys = e && typeof e === 'object' ? Object.keys(e).sort().join(',') : ''
    if (!e || keys !== 'key,type' || e.type !== 'api' || typeof e.key !== 'string' || !PLACEHOLDER.test(e.key)) {
      throw new BridgeProtocolError('init_secret', 'OPENCODE_AUTH_CONTENT con algo que no es un centinela')
    }
  }
}

function mountOrThrow(win: string, what: string): PathMount {
  const m = mountFor(win)
  if (!m.ok) throw new WslSpecError('bad-path', `${what}: ${m.reason}`)
  return m.mount
}

/** Construye la trama inicial (objeto + bytes). `forbid` = secretos reales que no pueden aparecer (defensa extra). */
export function buildWslInit(input: WslLaunchInput, forbid: readonly string[] = []): { init: WslInit; frame: Buffer; mounts: PathMount[] } {
  if (!/^[0-9a-f]{16}$/.test(input.sandboxKey)) throw new WslSpecError('bad-key')
  for (const p of [input.serverPort, ...input.relayPorts]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new WslSpecError('bad-port', String(p))
  }

  const main = mountOrThrow(input.folder, 'folder')
  const mounts: WslMount[] = [{ ...main, mode: 'rw' }]
  const seen = new Set([main.linux.toLowerCase()])
  const extras = [
    ...(input.extraFolders ?? []).map((e) => ({ win: e.path, mode: e.mode, what: 'extraFolder' })),
    { win: input.configDir, mode: 'ro' as const, what: 'configDir' }
  ]
  for (const e of extras) {
    if (e.mode !== 'rw' && e.mode !== 'ro') throw new WslSpecError('bad-mode')
    const m = mountOrThrow(e.win, e.what)
    const k = m.linux.toLowerCase()
    if (seen.has(k)) continue // misma carpeta dos veces (o la misma con otras mayúsculas): gana la primera
    seen.add(k)
    mounts.push({ ...m, mode: e.mode })
  }

  // Scratch: SOLO dentro de la carpeta principal.
  const scratchWin = input.scratchDirs ?? [`${main.win.replace(/\\+$/, '')}\\.lazunox\\trabajo`]
  const scratch: string[] = []
  for (const s of scratchWin) {
    const t = toSandboxPath(s)
    if (!t.ok) throw new WslSpecError('bad-path', `scratch: ${t.reason}`)
    const inside = fromSandboxPath(t.path, [main])
    if (!inside.ok) throw new WslSpecError('scratch-outside', s)
    scratch.push(t.path)
  }

  const key = input.sandboxKey
  const xdg = `/home/${WSL_USER}/xdg/${key}`
  const tmp = `/tmp/lazunox-${key}`
  const rules: LandlockRule[] = [...LANDLOCK_SYSTEM_RULES, { path: xdg, access: 'private' }, { path: tmp, access: 'private' }]
  for (const m of mounts) {
    if (m.mode === 'ro') rules.push({ path: m.linux, access: 'ro' })
    else rules.push({ path: m.linux, access: m === mounts[0] && input.allowDelete ? 'rw-delete' : 'rw-nodelete' })
  }
  // Scratch (borrar y renombrar permitido, como `.lazunox/trabajo` en Seatbelt); siempre con la principal.
  for (const s of scratch) rules.push({ path: s, access: 'rw-delete' })

  // Entorno: lista de prefijos; las rutas del anfitrión se reconstruyen desde los montajes.
  const env: Record<string, string> = {}
  let total = 0
  for (const [k, v] of Object.entries(input.env)) {
    if (!ENV_ALLOWED.test(k) || ENV_REWRITTEN.has(k) || typeof v !== 'string') continue
    if (v.includes('\u0000')) throw new WslSpecError('bad-env', k)
    if (k === 'OPENCODE_AUTH_CONTENT') assertPlaceholderAuth(v)
    total += k.length + v.length
    env[k] = v
  }
  if (total > MAX_ENV_TOTAL) throw new WslSpecError('env-too-large')
  env.LAZUNOX_TASKS_FOLDER = main.linux
  const cfgLinux = mountOrThrow(input.configDir, 'configDir').linux.toLowerCase()
  const cfg = mounts.find((m) => m.mode === 'ro' && m.linux.toLowerCase() === cfgLinux)
  if (cfg) env.OPENCODE_CONFIG_DIR = cfg.linux

  const init: WslInit = {
    v: INIT_VERSION,
    sandboxKey: key,
    mounts,
    relayPorts: [...new Set(input.relayPorts)].sort((a, b) => a - b),
    serverPort: input.serverPort,
    serveArgs: input.serveArgs,
    cwd: main.linux,
    env,
    landlock: { minAbi: LANDLOCK_MIN_ABI, rules }
  }
  return { init, frame: encodeInit(init, forbid), mounts: mounts.map(({ win, linux }) => ({ win, linux })) }
}

/** Opciones de `mount -t drvfs` que construye el lanzador (la misma lógica está en `resources/wsl/protocol.py`). */
export function drvfsOptions(mode: 'rw' | 'ro'): string {
  return `noexec,nosuid,nodev,${mode === 'ro' ? 'ro,' : ''}uid=${WSL_UID},gid=${WSL_UID}`
}
