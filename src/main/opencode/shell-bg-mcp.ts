/**
 * Conexión de `bgshell` (shell en segundo plano supervisado, `src/main/background-shell/`) con el motor: funciones PURAS y sin
 * Electron. Quien cablea el motor (`config.ts`/`server.ts`) solo tiene que llamar a estas funciones y meter el resultado en el bloque
 * `mcp` y en los permisos; nada de aquí toca el motor por sí mismo.
 *
 * NOMBRES. El motor registra cada herramienta MCP como `<servidor>_<herramienta>` (visto en la prueba real: el conector `lz_shell_bg`
 * mostraba `lz_shell_bg_start`). El servidor se llama `bgshell` y el núcleo nombra sus herramientas `start|status|read|stop|list`, así
 * que el modelo ve `bgshell_start`, `bgshell_status`, `bgshell_read`, `bgshell_stop` y `bgshell_list`.
 *
 * DE DÓNDE SALE EL NODE. Del Node incluido de la app (`runtimesService().bins().node`, F8-B195: `userData/runtimes/node/...`, ruta
 * absoluta). Si no está instalado (`null`) o falta el `.cjs`, `shellBgMcpConfig` devuelve `null` y el motor arranca igual, sin
 * `bgshell` (mismo patrón que `browserMcp`): el modelo simplemente no tiene la herramienta y sigue con `bash`.
 *
 * PERMISOS. `bgshell_start` EJECUTA comandos, así que no puede esquivar la política de `bash`: ver `bgshellToolAction`.
 * (Hallazgo 1 de `docs/PRUEBA-REAL-GO.md`: en Code las herramientas MCP corren SIN preguntar si no hay regla; por eso se les da una.)
 */
import { chmodSync, lstatSync, mkdirSync, truncateSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { effectiveModeFor, rulesetForMode, type PermissionModeId, type PermissionRuleLike, type RuleAction } from '@shared/permission-rules'

/** Clave del servidor en el bloque `mcp` del motor (y prefijo de las herramientas). */
export const SHELL_BG_SERVER = 'bgshell'
export const SHELL_BG_TOOLS = ['start', 'status', 'read', 'stop', 'list'] as const
export type ShellBgTool = (typeof SHELL_BG_TOOLS)[number]
/** Nombre final de la herramienta tal como lo ve el modelo y como lo nombran las reglas de permiso. */
export const shellBgToolId = (tool: ShellBgTool): string => `${SHELL_BG_SERVER}_${tool}`

// ── Carpetas ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ShellBgPaths {
  /** Carpeta raíz de este motor (privada, 0700). */
  root: string
  /** Salidas y registro de PIDs de los trabajos (`LAZUNOX_SHELL_BG_DIR`). Contiene solo carpetas de ejecución. */
  baseDir: string
  /** Avisos JSONL (`LAZUNOX_SHELL_BG_EVENTS`). Fuera de `baseDir` a propósito: la limpieza de restos solo mira `baseDir`. */
  eventsFile: string
}

/** Rutas de un motor a partir de su carpeta raíz (p. ej. `userData/shell-bg/code`, una por motor: Code, cada Tareas…). */
export function shellBgPaths(root: string): ShellBgPaths {
  return { root, baseDir: join(root, 'work'), eventsFile: join(root, 'events.jsonl') }
}

/**
 * Prepara las carpetas ANTES de arrancar el motor: raíz y `work` privadas (0700), y el archivo de avisos vacío (0600), de modo que
 * los avisos de una ejecución anterior (de otro motor ya muerto) nunca se lean como nuevos. Lanza si la raíz no es un directorio
 * real nuestro (un enlace simbólico puesto por otro). En Windows `chmod` no restringe nada y se omite.
 */
export function prepareShellBgDirs(paths: ShellBgPaths): void {
  if (!isAbsolute(paths.root)) throw new Error('shell-bg: la carpeta raíz debe ser absoluta.')
  mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  const st = lstatSync(paths.root)
  if (!st.isDirectory() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
    throw new Error(`shell-bg: carpeta no segura: ${paths.root}`)
  }
  if (process.platform !== 'win32') chmodSync(paths.root, 0o700)
  mkdirSync(paths.baseDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(paths.baseDir, 0o700)
  try {
    const ev = lstatSync(paths.eventsFile)
    if (!ev.isFile()) throw new Error(`shell-bg: el archivo de avisos no es un archivo normal: ${paths.eventsFile}`)
    truncateSync(paths.eventsFile, 0)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    writeFileSync(paths.eventsFile, '', { mode: 0o600 })
  }
  if (process.platform !== 'win32') chmodSync(paths.eventsFile, 0o600)
}

// ── Bloque `mcp` ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ShellBgMcpOptions {
  /** Node incluido de la app (ruta absoluta) o `null` si no está instalado. */
  nodePath: string | null
  /** El `.cjs` generado (`bundledShellBgPath()`) o `null` si no existe. */
  scriptPath: string | null
  /** Carpeta de salidas (`shellBgPaths(...).baseDir`, ya preparada con `prepareShellBgDirs`). */
  baseDir: string
  /** Archivo de avisos que vigila `shell-bg-wake.ts`; sin él no hay aviso de fin al modelo. */
  eventsFile?: string
  /** Silencio antes de «posible atasco», en ms (por defecto 15 min, el del núcleo). */
  quietMs?: number
  maxJobs?: number
  /** Tope absoluto de ejecución de TODOS los trabajos (por defecto ninguno). */
  maxRuntimeMs?: number
  /** Prefijo del comando (en macOS/Linux, `MCP_ENV_WRAPPER` de `tasks/mcp-tasks.ts`: quita del entorno las credenciales del servidor). */
  commandPrefix?: readonly string[]
  /** Tiempo para listar las herramientas al arrancar, en ms (el motor usa 5 s por defecto; un Node frío puede tardar más). */
  timeoutMs?: number
}

const posInt = (n: number | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : null

/**
 * Bloque `mcp.bgshell` del motor (`{type:'local', command:[...], environment:{...}}`), o `null` si no se puede ofrecer (sin Node
 * incluido, sin `.cjs` o rutas no absolutas): en ese caso NO se añade el servidor y el motor arranca igual.
 * Uso: `mcp: { [SHELL_BG_SERVER]: block }` junto al resto de `mcp` (p. ej. `browser`).
 */
export function shellBgMcpConfig(o: ShellBgMcpOptions): Record<string, unknown> | null {
  if (!o.nodePath || !o.scriptPath) return null
  if (!isAbsolute(o.nodePath) || !isAbsolute(o.scriptPath) || !isAbsolute(o.baseDir)) return null
  if (o.eventsFile !== undefined && !isAbsolute(o.eventsFile)) return null
  const environment: Record<string, string> = { LAZUNOX_SHELL_BG_DIR: o.baseDir }
  if (o.eventsFile) environment.LAZUNOX_SHELL_BG_EVENTS = o.eventsFile
  const quiet = posInt(o.quietMs)
  if (quiet) environment.LAZUNOX_SHELL_BG_QUIET_MS = quiet
  const jobs = posInt(o.maxJobs)
  if (jobs) environment.LAZUNOX_SHELL_BG_MAX_JOBS = jobs
  const maxRun = posInt(o.maxRuntimeMs)
  if (maxRun) environment.LAZUNOX_SHELL_BG_MAX_RUNTIME_MS = maxRun
  return {
    type: 'local',
    command: [...(o.commandPrefix ?? []), o.nodePath, o.scriptPath],
    environment,
    enabled: true,
    timeout: posInt(o.timeoutMs) ? Number(posInt(o.timeoutMs)) : 15_000
  }
}

// ── Permisos ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Acción del motor para `bgshell_start` en un modo/agente: LA MISMA que la regla efectiva de `bash` con patrón `*`
 * (`rulesetForMode(effectiveModeFor(modo, agente))`, de `src/shared/permission-rules.ts`, la misma fuente que usa el bloque de modo de
 * Code al hacer `session.update({ permission })`):
 *   Preguntar siempre / Editar sin preguntar / Solo explorar / Automático → `ask`;  Todo sin preguntar → `allow`.
 * `bgshell_start` no hereda la aprobación automática de comandos de solo lectura de «Automático» (la hace la app mirando el comando de
 * `bash`): un trabajo en segundo plano siempre pregunta salvo en «Todo sin preguntar». Si no hubiera regla de `bash *` se devuelve `ask`.
 */
export function bgshellToolAction(mode: PermissionModeId, agent?: string): RuleAction {
  const block = rulesetForMode(effectiveModeFor(mode, agent))
  for (let i = block.length - 1; i >= 0; i--) {
    const r = block[i]!
    if (r.permission === 'bash' && r.pattern === '*') return r.action
  }
  return 'ask'
}

/**
 * Reglas de sesión para las cinco herramientas, para enviar JUNTO al bloque de modo (`session.update({ permission })`):
 * `bgshell_start` igual que `bash`; `status|read|list|stop` en `allow` (solo miran o paran trabajos propios, no ejecutan nada).
 * Van ANTES del bloque del modo, no después: `endsWithRuleset`/`approvalKindOf` reconocen el modo porque la sesión TERMINA con su bloque.
 * Úsese como `[...bgshellSessionRules(modo, agente), ...rulesetForMode(...)]`.
 */
export function bgshellSessionRules(mode: PermissionModeId, agent?: string): PermissionRuleLike[] {
  return SHELL_BG_TOOLS.map((t) => ({
    permission: shellBgToolId(t),
    pattern: '*',
    action: t === 'start' ? bgshellToolAction(mode, agent) : ('allow' as const)
  }))
}

/**
 * Suelo de la configuración (bloque `permission` de la config inline, vale para TODOS los agentes y sesiones, también las hijas de
 * `task` y los motores donde no se envía bloque de modo): `bgshell_start` pregunta y el resto pasa. El bloque de sesión de
 * `bgshellSessionRules` lo sobrescribe después (p. ej. «Todo sin preguntar» → `allow`).
 */
export function bgshellConfigPermission(): Record<string, RuleAction> {
  return Object.fromEntries(SHELL_BG_TOOLS.map((t) => [shellBgToolId(t), t === 'start' ? 'ask' : 'allow'])) as Record<string, RuleAction>
}
