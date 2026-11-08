/**
 * Variables de entorno de la «última milla» de la Ola A (Lazunox 1.8.12) que la app pasa al motor. Funciones PURAS (sin Electron, sin disco):
 * main les da el entorno y el resultado de mirar el disco.
 *
 *  - `OPENCODE_ENABLE_EXA=1`: ofrece `websearch` con cualquier proveedor de IA (hoy el motor solo la ofrece con OpenCode/OpenCode Go). Las
 *    búsquedas salen a Exa, un tercero. Ajuste `webSearchAnyProvider`, APAGADO por defecto (decisión D7).
 *  - `LAZUNOX_SUGERENCIA_PERMISOS=1`: el motor añade una sugerencia de una IA a la tarjeta de permiso (nunca aprueba sola). Ajuste
 *    `permissionSuggestions`, APAGADO por defecto.
 *  - `LAZUNOX_POLICY_FILE=<ruta>`: política de empresa del motor (listas `deny`). Decisión D12: SOLO una ruta de ADMINISTRADOR, junto a
 *    `managed.json` de Tareas (Mac `/Library/Application Support/<INTERNAL_NAME>/motor-policy.json`, Windows
 *    `%ProgramData%\<INTERNAL_NAME>\motor-policy.json`). Nunca un archivo que escriba la app (un agente podría borrarlo: «ausente = sin
 *    política»). Sin ajuste: la pone quien administra el equipo. Se pasa solo si el archivo existe; si está roto, el motor falla cerrado.
 *
 * Todas valen para el sidecar principal (Chat y Code). Overdrive (Tareas) NO las recibe: ver `onlyUserHooksEnv`/`manager.ts`.
 * Las tres variables las entiende ya el motor lazunox.14 (`tool/websearch.ts`, `permission/sugerencia.ts`, `permission/politica.ts`).
 */
import { win32, posix } from 'node:path'
import { INTERNAL_NAME } from './brand'

export const ENV_WEB_SEARCH = 'OPENCODE_ENABLE_EXA'
export const ENV_PERMISSION_SUGGESTION = 'LAZUNOX_SUGERENCIA_PERMISOS'
export const ENV_ENGINE_POLICY_FILE = 'LAZUNOX_POLICY_FILE'

/** Nombre del archivo de política del motor dentro de la carpeta de administrador. */
export const ENGINE_POLICY_FILE_NAME = 'motor-policy.json'

export type LastMileSettings = { webSearchAnyProvider?: boolean; permissionSuggestions?: boolean }

/** `{ OPENCODE_ENABLE_EXA: '1' }` solo con `true` exacto; ausente o basura = `{}`. */
export const webSearchEnvFor = (s: LastMileSettings): Record<string, string> =>
  s.webSearchAnyProvider === true ? { [ENV_WEB_SEARCH]: '1' } : {}

/** `{ LAZUNOX_SUGERENCIA_PERMISOS: '1' }` solo con `true` exacto (el motor solo entiende «1»). */
export const suggestionEnvFor = (s: LastMileSettings): Record<string, string> =>
  s.permissionSuggestions === true ? { [ENV_PERMISSION_SUGGESTION]: '1' } : {}

/** ¿Ruta absoluta de Windows (`C:\x`, `C:/x`, `\\servidor\x`)? */
const isWinAbsolute = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

/**
 * Ruta del archivo de política del administrador. Misma lógica que `managedPolicyPath` de Tareas (`tasks/policy.ts`, copiada para no arrastrar
 * Electron). En Windows, `ProgramData` del entorno solo vale si es una ruta absoluta; si no, `C:\ProgramData`.
 */
export function enginePolicyPath(platform: NodeJS.Platform, env: Record<string, string | undefined> = {}): string {
  if (platform === 'win32') {
    const pd = env.ProgramData
    const base = pd && isWinAbsolute(pd) && !pd.includes('\0') ? pd : 'C:\\ProgramData'
    return win32.join(base, INTERNAL_NAME, ENGINE_POLICY_FILE_NAME)
  }
  return posix.join('/Library/Application Support', INTERNAL_NAME, ENGINE_POLICY_FILE_NAME)
}

export interface EnginePolicyProbe {
  platform: NodeJS.Platform
  /** ¿Hay algo en la ruta del administrador? (main: cualquier cosa menos «no existe»; un error de lectura cuenta como que existe.) */
  exists: boolean
  /** `ProgramData` del entorno (Windows). */
  env?: Record<string, string | undefined>
  /** Solo desarrollo (`!app.isPackaged`, ya comprobado por main): ruta absoluta alternativa para probar sin ser administrador. */
  devOverride?: string
}

/**
 * `{ LAZUNOX_POLICY_FILE: <ruta> }` SOLO si el archivo de administrador existe; si no, `{}` (sin política). La ruta sale siempre de la
 * constante de arriba (o del override de desarrollo si es absoluta): nada que escriba la persona o un proyecto llega aquí.
 */
export function enginePolicyEnvFor(probe: EnginePolicyProbe): Record<string, string> {
  if (!probe.exists) return {}
  const o = probe.devOverride
  if (o && (o.startsWith('/') || isWinAbsolute(o)) && !o.includes('\0') && o.length <= 4096) return { [ENV_ENGINE_POLICY_FILE]: o }
  return { [ENV_ENGINE_POLICY_FILE]: enginePolicyPath(probe.platform, probe.env) }
}

/** Las tres variables juntas. Sin `policy` (no se pudo mirar el disco), solo las dos de los ajustes. */
export function engineLastMileEnvFor(s: LastMileSettings, policy?: EnginePolicyProbe): Record<string, string> {
  return { ...webSearchEnvFor(s), ...suggestionEnvFor(s), ...(policy ? enginePolicyEnvFor(policy) : {}) }
}
