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
 * Decisión de Ben: se quieren ENCENDIDOS en Chat, Code y Overdrive (Tareas). Subagentes en segundo plano: encendidos
 * (2026-10-23, tras pasar las 27 comprobaciones de `scripts/engine-probe`, que cubren al ayudante del Chat y al guardián).
 * Modo código sigue apagado hasta probarlo con la app real (`docs/ANALISIS-OPENCODE-2-FUNCIONES.md` §4).
 */
export const ENGINE_EXPERIMENTS_DEFAULTS: EngineExperiments = {
  codeMode: { chat: false, code: false, tasks: false },
  backgroundSubagents: { chat: true, code: true, tasks: true }
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

/**
 * Migración única de 1.6.0. Antes de 1.6.0 el valor por defecto era «todo apagado» y el almacén lo GUARDABA en disco, así que quien
 * ya usaba la app no recibiría el nuevo valor por defecto (ayudantes en segundo plano encendidos). Si todavía no se migró y los
 * ayudantes están apagados en los tres modos, se encienden una vez; la persona puede volver a apagarlos en Ajustes y no se vuelve a tocar.
 * El Modo código no se toca. Función pura: devuelve lo que hay que guardar y si cambió algo.
 */
export function migrateBackgroundSubagentsDefault(
  raw: unknown,
  alreadyMigrated: boolean | undefined
): { value: EngineExperiments; migrated: true; changed: boolean } {
  const current = normalizeEngineExperiments(raw)
  if (alreadyMigrated === true) return { value: current, migrated: true, changed: false }
  const bg = current.backgroundSubagents
  const allOff = !bg.chat && !bg.code && !bg.tasks
  if (!allOff) return { value: current, migrated: true, changed: true }
  return {
    value: { ...current, backgroundSubagents: { ...ENGINE_EXPERIMENTS_DEFAULTS.backgroundSubagents } },
    migrated: true,
    changed: true
  }
}
