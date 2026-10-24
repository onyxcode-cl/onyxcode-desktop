/**
 * Ganchos de usuario (Ajustes › Funciones experimentales › «Ganchos»): comandos de la persona que el motor propio ejecuta antes o después de
 * una herramienta (como los hooks de otros asistentes). Este módulo, puro y compartido por main y renderer, decide dos cosas:
 *
 *  1. La variable que se le pasa al motor: `LAZUNOX_HOOKS_FILE` (ruta absoluta de `userData/hooks/hooks.json`), SOLO con el ajuste
 *     `userHooksEnabled` encendido (defecto: APAGADO, porque ejecuta comandos de la persona). Nunca al sandbox de Tareas (ver `onlyUserHooksEnv`).
 *  2. La validación del archivo, con las MISMAS cotas que el motor (`packages/opencode/src/plugin/lazunox-ganchos.ts`, `leerConfig`): el
 *     motor descarta en silencio lo inválido; la app lo RECHAZA con un mensaje claro para que nada se pierda sin que la persona se entere.
 *
 * El contenido de los ganchos no se registra en logs ni en telemetría: aquí los errores llevan códigos y números, nunca el texto del comando.
 */

export const ENV_HOOKS_FILE = 'LAZUNOX_HOOKS_FILE'

/** Cotas del motor (`lazunox-ganchos.ts`). Si cambian allí, cambian aquí. */
export const HOOKS_MAX_FILE_BYTES = 64 * 1024
export const HOOKS_MAX_PER_EVENT = 20
export const HOOKS_MAX_COMMAND = 2000
export const HOOKS_MAX_MATCHER = 300
export const HOOKS_TIMEOUT_MIN = 1
export const HOOKS_TIMEOUT_MAX = 60

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'PreCompact', 'Stop'] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

export interface UserHook {
  matcher?: string
  command: string
  timeout?: number
}
export type UserHooksConfig = Record<HookEvent, UserHook[]>

/** Archivo que escribe la app cuando no hay nada configurado. */
export const EMPTY_HOOKS_TEXT = '{"hooks":{}}\n'

/** Ejemplo que se muestra como ayuda: bloquea `rm -rf` en la herramienta de comandos (código de salida 2 = bloquear). */
export const HOOKS_EXAMPLE = `{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "command": "if grep -q 'rm -rf'; then echo 'Bloqueado: rm -rf no está permitido' >&2; exit 2; fi",
        "timeout": 10
      }
    ]
  }
}
`

const VACIO = (): UserHooksConfig => ({ PreToolUse: [], PostToolUse: [], PreCompact: [], Stop: [] })

/** Réplica de `leerConfig` del motor (mismas cotas, mismo descarte silencioso). Nunca lanza. Sirve para comprobar que la app y el motor coinciden. */
export function leerConfig(text: string): UserHooksConfig {
  const vacio = VACIO()
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return vacio
  }
  const hooks = (j as { hooks?: Record<string, unknown> } | null)?.hooks
  if (!hooks || typeof hooks !== 'object') return vacio
  const lista = (v: unknown): UserHook[] =>
    (Array.isArray(v) ? v : [])
      .filter(
        (g): g is UserHook =>
          !!g &&
          typeof g === 'object' &&
          typeof (g as UserHook).command === 'string' &&
          (g as UserHook).command.trim().length > 0 &&
          (g as UserHook).command.length <= HOOKS_MAX_COMMAND
      )
      .map((g) => ({
        command: g.command,
        matcher: typeof g.matcher === 'string' && g.matcher.length <= HOOKS_MAX_MATCHER ? g.matcher : undefined,
        timeout:
          typeof g.timeout === 'number' && Number.isFinite(g.timeout)
            ? Math.min(HOOKS_TIMEOUT_MAX, Math.max(HOOKS_TIMEOUT_MIN, Math.floor(g.timeout)))
            : undefined
      }))
      .slice(0, HOOKS_MAX_PER_EVENT)
  return {
    PreToolUse: lista(hooks.PreToolUse),
    PostToolUse: lista(hooks.PostToolUse),
    PreCompact: lista(hooks.PreCompact),
    Stop: lista(hooks.Stop)
  }
}

/** Un problema del archivo: `code` se traduce con `settings.engine.hooks.err.<code>`; `params` son números o nombres de evento (nunca el comando). */
export interface HooksIssue {
  code: string
  params?: Record<string, string | number>
}

export type HooksValidation = { ok: true; text: string; count: number } | { ok: false; issues: HooksIssue[] }

const MAX_ISSUES = 8
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Tamaño en bytes UTF-8 (como `statSync().size` del motor). */
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length

/**
 * Valida el texto del editor. Acepta lo que `leerConfig` conservaría tal cual y rechaza lo que descartaría o recortaría. Texto vacío = sin
 * ganchos. Si pasa, devuelve el texto a guardar (el mismo, con un salto de línea final) y cuántos ganchos hay.
 */
export function validateHooksText(raw: string): HooksValidation {
  if (typeof raw !== 'string') return { ok: false, issues: [{ code: 'badJson' }] }
  const trimmed = raw.trim()
  const text = trimmed ? `${trimmed}\n` : EMPTY_HOOKS_TEXT
  if (utf8Bytes(text) > HOOKS_MAX_FILE_BYTES)
    return { ok: false, issues: [{ code: 'tooBig', params: { kb: HOOKS_MAX_FILE_BYTES / 1024 } }] }
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ code: 'badJson' }] }
  }
  if (!isObj(j) || !isObj(j.hooks)) return { ok: false, issues: [{ code: 'noHooks' }] }
  const issues: HooksIssue[] = []
  const add = (code: string, params?: HooksIssue['params']): void => {
    if (issues.length < MAX_ISSUES) issues.push({ code, params })
  }
  let count = 0
  for (const [event, list] of Object.entries(j.hooks)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      add('unknownEvent', { event: event.slice(0, 40) })
      continue
    }
    if (!Array.isArray(list)) {
      add('notList', { event })
      continue
    }
    if (list.length > HOOKS_MAX_PER_EVENT) add('tooMany', { event, max: HOOKS_MAX_PER_EVENT })
    list.forEach((g, i) => {
      const n = i + 1
      if (!isObj(g)) return add('notObject', { event, n })
      count++
      if (typeof g.command !== 'string' || g.command.trim().length === 0) add('noCommand', { event, n })
      else if (g.command.length > HOOKS_MAX_COMMAND) add('commandTooLong', { event, n, max: HOOKS_MAX_COMMAND })
      if (g.matcher !== undefined) {
        if (typeof g.matcher !== 'string') add('matcherType', { event, n })
        else if (g.matcher.length > HOOKS_MAX_MATCHER) add('matcherTooLong', { event, n, max: HOOKS_MAX_MATCHER })
        else if (g.matcher !== '*') {
          // «*» (todas las herramientas) no se compila: el motor lo trata aparte.
          try {
            // Igual que el motor: se ancla y se compila `^(?:matcher)$`.
            new RegExp(`^(?:${g.matcher})$`)
          } catch {
            add('matcherInvalid', { event, n })
          }
        }
      }
      if (g.timeout !== undefined) {
        const tm = g.timeout
        if (typeof tm !== 'number' || !Number.isInteger(tm) || tm < HOOKS_TIMEOUT_MIN || tm > HOOKS_TIMEOUT_MAX) {
          add('badTimeout', { event, n, min: HOOKS_TIMEOUT_MIN, max: HOOKS_TIMEOUT_MAX })
        }
      }
    })
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, text, count }
}

type SettingsLike = { userHooksEnabled?: boolean }

/** ¿Están encendidos los ganchos? Solo `true` exacto (defecto: apagado). */
export const userHooksOn = (settings: SettingsLike): boolean => settings.userHooksEnabled === true

/** Ruta absoluta de POSIX o de Windows, sin bytes nulos. */
const isAbsoluteLike = (p: string): boolean => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p) && !p.includes('\0') && p.length <= 4096

/** Variable EXACTA para el motor; `{}` si está apagado o no hay una ruta absoluta válida. */
export function userHooksEnvFor(settings: SettingsLike, file: string | null | undefined): Record<string, string> {
  if (!userHooksOn(settings) || !file || !isAbsoluteLike(file)) return {}
  return { [ENV_HOOKS_FILE]: file }
}

/**
 * Filtro de defensa en profundidad para el entorno extra de Tareas: solo `LAZUNOX_HOOKS_FILE`, con ruta absoluta. Solo se usa en servidores de
 * Control total (SIN sandbox). Al servidor con sandbox NO se le pasa: un gancho es un comando que corre con los permisos de la persona, fuera de
 * lo que el sandbox permite (y userData está denegado dentro del sandbox), así que dejarlo entrar rompería el aislamiento de Overdrive.
 */
export function onlyUserHooksEnv(env: Record<string, string>): Record<string, string> {
  const file = env[ENV_HOOKS_FILE]
  return typeof file === 'string' && isAbsoluteLike(file) ? { [ENV_HOOKS_FILE]: file } : {}
}

/** Entorno de ganchos de un servidor de Tareas: solo con Control total (sin sandbox); con sandbox SIEMPRE vacío. */
export const userHooksEnvForTasksServer = (env: Record<string, string>, fullAccess: boolean): Record<string, string> =>
  fullAccess ? onlyUserHooksEnv(env) : {}
