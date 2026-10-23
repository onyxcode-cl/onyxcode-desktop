/**
 * Funciones experimentales del motor (OpenCode 1.19) que se activan por variable de entorno al lanzar el proceso:
 * Modo código (`execute`) y subagentes en segundo plano. Funciones puras, sin Electron, compartidas por main y UI.
 *
 * Solo se usan las dos variables concretas; NUNCA `OPENCODE_EXPERIMENTAL` a secas (enciende todas las experimentales).
 */
import type { EngineExperiments, ModeFlags, Settings } from './types'

/** Modos con interruptor propio. */
export type EngineExperimentMode = 'chat' | 'code' | 'tasks'

export const ENGINE_ENV_CODE_MODE = 'OPENCODE_EXPERIMENTAL_CODE_MODE'
export const ENGINE_ENV_BACKGROUND_SUBAGENTS = 'OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS'

/**
 * Valor por defecto ÚNICO de `Settings.engineExperiments`.
 * Decisión de Ben: se quieren ENCENDIDOS en Chat, Code y Overdrive (Tareas); por ahora todo apagado porque
 * la activación real depende de una prueba de seguridad en curso.
 * TODO: se enciende por defecto cuando pase la prueba de seguridad (cambiar aquí los `false` por `true`; nada más).
 */
export const ENGINE_EXPERIMENTS_DEFAULTS: EngineExperiments = {
  codeMode: { chat: false, code: false, tasks: false },
  backgroundSubagents: { chat: false, code: false, tasks: false }
}

function normalizeModeFlags(raw: unknown, fallback: ModeFlags): ModeFlags {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const pick = (k: EngineExperimentMode): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : fallback[k])
  return { chat: pick('chat'), code: pick('code'), tasks: pick('tasks') }
}

/** Normaliza lo leído de disco: si falta, trae basura o claves raras, se usan los valores por defecto. Nunca lanza. */
export function normalizeEngineExperiments(raw: unknown): EngineExperiments {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    codeMode: normalizeModeFlags(r.codeMode, ENGINE_EXPERIMENTS_DEFAULTS.codeMode),
    backgroundSubagents: normalizeModeFlags(r.backgroundSubagents, ENGINE_EXPERIMENTS_DEFAULTS.backgroundSubagents)
  }
}

type SettingsLike = Pick<Settings, 'engineExperiments'>

/** Qué funciones están encendidas para un modo. */
export function engineExperimentsFor(
  settings: SettingsLike,
  mode: EngineExperimentMode
): { codeMode: boolean; backgroundSubagents: boolean } {
  const e = normalizeEngineExperiments(settings.engineExperiments)
  return { codeMode: e.codeMode[mode], backgroundSubagents: e.backgroundSubagents[mode] }
}

/** Variables de entorno EXACTAS a pasar al motor: solo las encendidas; objeto vacío si ninguna. */
export function engineFlagEnvFor(settings: SettingsLike, mode: EngineExperimentMode): Record<string, string> {
  const f = engineExperimentsFor(settings, mode)
  const env: Record<string, string> = {}
  if (f.codeMode) env[ENGINE_ENV_CODE_MODE] = 'true'
  if (f.backgroundSubagents) env[ENGINE_ENV_BACKGROUND_SUBAGENTS] = 'true'
  return env
}

/**
 * Filtro de DEFENSA EN PROFUNDIDAD para el entorno extra que se mezcla en el servidor de Tareas: solo pasan las dos variables experimentales
 * conocidas y solo con el valor `'true'`. En el lanzamiento, el entorno extra gana sobre el básico, el del sandbox y el del proxy, así que
 * sin este filtro una clave inesperada (`HOME`, `XDG_*`, `HTTP_PROXY`…) rompería el aislamiento. Hoy el único llamador ya produce solo estas.
 */
export function onlyExperimentalEngineEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of [ENGINE_ENV_CODE_MODE, ENGINE_ENV_BACKGROUND_SUBAGENTS]) if (env[k] === 'true') out[k] = 'true'
  return out
}

/**
 * Entorno del sidecar PRINCIPAL. Chat y Code comparten un solo proceso `opencode serve` y la variable vale por
 * proceso, así que se enciende si CUALQUIERA de chat o code la tiene encendida (lo que separa a Chat de Code
 * después es el agente: `chat` tiene `'*': deny`). Overdrive (Tareas) usa `engineFlagEnvFor(settings, 'tasks')`
 * para su sandbox; las Rutinas que no son de Overdrive usan este sidecar.
 */
export function engineFlagEnvForMainSidecar(settings: SettingsLike): Record<string, string> {
  const chat = engineFlagEnvFor(settings, 'chat')
  const code = engineFlagEnvFor(settings, 'code')
  return { ...chat, ...code }
}
