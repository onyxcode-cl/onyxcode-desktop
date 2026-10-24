/**
 * Límites del Modo código y del shell en segundo plano del motor propio (Ajustes › Funciones experimentales › Límites).
 * El motor los lee de variables de entorno al arrancar (`LAZUNOX_CODE_MODE_*`, `LAZUNOX_SHELL_BG_*`; enteros positivos). Funciones puras,
 * sin Electron, compartidas por main y UI.
 *
 * DECISIÓN DE PERSISTENCIA: `Settings.engineLimits` guarda SOLO lo que la persona cambió (objeto escaso). Un campo ausente = «usa el
 * defecto del motor/app». Así quien tiene un `settings.json` antiguo (sin el campo) recibe los defectos, y si algún día cambia un defecto
 * no queda clavado el valor viejo en disco (lección de `engineExperiments`, que sí guardaba los defectos). `normalizeEngineLimits` además
 * descarta lo que no sea entero dentro del rango y lo que sea igual al defecto actual.
 *
 * Unidades humanas en Ajustes (minutos, segundos, MB, llamadas); aquí se convierten a lo que lee el motor (ms, bytes). 1 MB del Modo código
 * = 1 000 000 bytes (su defecto es 5 000 000) y 1 MB del shell = 1 048 576 bytes (su defecto es 10 MiB): así el defecto es un número entero.
 */
import type { Settings } from './types'

export type EngineLimitKey =
  'codeTimeoutMin' | 'codeMaxCalls' | 'codeOutputMb' | 'codeYieldSec' | 'codeMaxCells' | 'shellLifeMin' | 'shellOutputMb' | 'maxSubagents'

/** Solo las claves cambiadas por la persona; ausente = valor por defecto. */
export type EngineLimits = Partial<Record<EngineLimitKey, number>>

interface LimitSpec {
  key: EngineLimitKey
  env: string
  min: number
  max: number
  def: number
  /** Unidad humana → valor que lee el motor. */
  toEngine: (n: number) => number
}

const MIN_MS = 60_000
const SEC_MS = 1000
const CODE_MB = 1_000_000
const SHELL_MB = 1024 * 1024

export const ENGINE_LIMIT_SPECS: readonly LimitSpec[] = [
  { key: 'codeTimeoutMin', env: 'LAZUNOX_CODE_MODE_TIMEOUT_MS', min: 1, max: 120, def: 10, toEngine: (n) => n * MIN_MS },
  { key: 'codeMaxCalls', env: 'LAZUNOX_CODE_MODE_MAX_TOOL_CALLS', min: 10, max: 10_000, def: 1000, toEngine: (n) => n },
  { key: 'codeOutputMb', env: 'LAZUNOX_CODE_MODE_MAX_OUTPUT_BYTES', min: 1, max: 50, def: 5, toEngine: (n) => n * CODE_MB },
  { key: 'codeYieldSec', env: 'LAZUNOX_CODE_MODE_YIELD_MS', min: 5, max: 50, def: 30, toEngine: (n) => n * SEC_MS },
  { key: 'codeMaxCells', env: 'LAZUNOX_CODE_MODE_MAX_CELLS', min: 1, max: 6, def: 3, toEngine: (n) => n },
  { key: 'shellLifeMin', env: 'LAZUNOX_SHELL_BG_MAX_MS', min: 1, max: 240, def: 30, toEngine: (n) => n * MIN_MS },
  { key: 'shellOutputMb', env: 'LAZUNOX_SHELL_BG_MAX_OUTPUT', min: 1, max: 100, def: 10, toEngine: (n) => n * SHELL_MB },
  // Ayudantes (subagentes) en segundo plano a la vez; el motor ya usa 8 si la variable no llega.
  { key: 'maxSubagents', env: 'LAZUNOX_MAX_SUBAGENTS', min: 1, max: 64, def: 8, toEngine: (n) => n }
]

export const ENGINE_LIMIT_ENV_NAMES: readonly string[] = ENGINE_LIMIT_SPECS.map((s) => s.env)

export const ENGINE_LIMIT_SPEC: Readonly<Record<EngineLimitKey, LimitSpec>> = Object.fromEntries(
  ENGINE_LIMIT_SPECS.map((s) => [s.key, s])
) as Record<EngineLimitKey, LimitSpec>

/** Valor por defecto (en unidad humana) de un límite. */
export const engineLimitDefault = (key: EngineLimitKey): number => ENGINE_LIMIT_SPEC[key].def

/** Normaliza lo leído de disco o del renderer: solo claves conocidas, enteros dentro del rango y distintos del defecto. Nunca lanza. */
export function normalizeEngineLimits(raw: unknown): EngineLimits {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: EngineLimits = {}
  for (const s of ENGINE_LIMIT_SPECS) {
    const v = r[s.key]
    if (typeof v === 'number' && Number.isInteger(v) && v >= s.min && v <= s.max && v !== s.def) out[s.key] = v
  }
  return out
}

type SettingsLike = Partial<Pick<Settings, 'engineLimits'>>

/** Valor efectivo (unidad humana) de cada límite: el cambiado o el defecto. */
export function effectiveEngineLimits(settings: SettingsLike): Record<EngineLimitKey, number> {
  const n = normalizeEngineLimits(settings.engineLimits)
  return Object.fromEntries(ENGINE_LIMIT_SPECS.map((s) => [s.key, n[s.key] ?? s.def])) as Record<EngineLimitKey, number>
}

/** Variables de entorno EXACTAS a pasar al motor: solo las de límites que difieren del defecto (el motor ya usa el suyo en el resto). */
export function engineLimitEnvFor(settings: SettingsLike): Record<string, string> {
  const n = normalizeEngineLimits(settings.engineLimits)
  const env: Record<string, string> = {}
  for (const s of ENGINE_LIMIT_SPECS) {
    const v = n[s.key]
    if (v !== undefined) env[s.env] = String(s.toEngine(v))
  }
  return env
}

/**
 * Filtro de defensa en profundidad del entorno extra de Tareas: solo las variables de límites conocidas y solo con un entero positivo
 * de hasta 10 cifras (el entorno extra gana sobre el sandbox, así que no puede colarse otra clave).
 */
export function onlyEngineLimitEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ENGINE_LIMIT_ENV_NAMES) {
    const v = env[k]
    if (typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v)) out[k] = v
  }
  return out
}
