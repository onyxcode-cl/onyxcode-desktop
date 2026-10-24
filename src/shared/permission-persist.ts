/**
 * «Recordar mis "siempre" entre sesiones» (Ajustes › Funciones experimentales): el motor propio guarda en disco, por carpeta de proyecto, los
 * permisos que la persona respondió con «Permitir siempre», pero SOLO si arranca con `LAZUNOX_PERMISSION_PERSIST=1`. Este módulo decide
 * las variables que se le pasan. Puro, sin Electron, compartido por main y pruebas.
 *
 *  - `LAZUNOX_PERMISSION_PERSIST=1`: solo con el ajuste `rememberAlways` encendido (defecto: encendido).
 *  - `LAZUNOX_PERMISSION_DIR`: carpeta de guardado, siempre dentro de la carpeta de datos de la app (`userData/permisos-siempre`, modo 0700).
 *  - `LAZUNOX_PERMISSION_NO_PERSIST`: permisos que NUNCA se guardan. El motor admite nombres exactos o con «*» al final (`computer_*`), así
 *    que se pasan los de `NEVER_ALONE_PERMISSIONS` (los mismos que el modo Auto nunca aprueba solo) más `computer_*` y `browser_*`.
 *    Sus propias exclusiones (`external_directory`, `doom_loop`) y la regla de no guardar un «*» suelto de una herramienta propia siguen
 *    valiendo aunque esta lista llegara vacía.
 *
 * Las rutas protegidas (.git, .claude…) no pasan por aquí: el motor manda `always: []` y no hay nada que guardar.
 */

export const ENV_PERMISSION_PERSIST = 'LAZUNOX_PERMISSION_PERSIST'
export const ENV_PERMISSION_DIR = 'LAZUNOX_PERMISSION_DIR'
export const ENV_PERMISSION_NO_PERSIST = 'LAZUNOX_PERMISSION_NO_PERSIST'

/** Nombre de la carpeta de guardado, dentro de la carpeta de datos de la app (y dentro del directorio privado de cada servidor de Tareas). */
export const PERMISSION_DIR_NAME = 'permisos-siempre'

/** Permisos que el modo Auto nunca aprueba solo y que tampoco se recuerdan con «siempre». Única fuente (la usa `auto-mode.ts`). */
export const NEVER_ALONE_PERMISSIONS: readonly string[] = [
  'external_directory',
  'doom_loop',
  'edit',
  'write',
  'task',
  'webfetch',
  'websearch'
]

/** Lista para `LAZUNOX_PERMISSION_NO_PERSIST` (nombres exactos y prefijos con «*» al final). */
export const PERMISSION_NO_PERSIST: readonly string[] = [...NEVER_ALONE_PERMISSIONS, 'computer_*', 'browser_*']

/** Ruta absoluta de POSIX o de Windows (sin comprobar que exista). */
const isAbsoluteLike = (p: string): boolean => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p) && !p.includes('\0') && p.length <= 4096

type SettingsLike = { rememberAlways?: boolean }

/** ¿Está encendido el recuerdo de «siempre»? Ausente = encendido (defecto); solo `false` exacto lo apaga. */
export const rememberAlwaysOn = (settings: SettingsLike): boolean => settings.rememberAlways !== false

/** Variables EXACTAS para el motor; `{}` si está apagado o no hay carpeta válida (así el motor no guarda nada). */
export function permissionPersistEnvFor(settings: SettingsLike, dir: string | null | undefined): Record<string, string> {
  if (!rememberAlwaysOn(settings) || !dir || !isAbsoluteLike(dir)) return {}
  return {
    [ENV_PERMISSION_PERSIST]: '1',
    [ENV_PERMISSION_DIR]: dir,
    [ENV_PERMISSION_NO_PERSIST]: PERMISSION_NO_PERSIST.join(',')
  }
}

/**
 * Filtro de defensa en profundidad para el entorno extra de Tareas (gana sobre el sandbox): solo estas tres claves, con `PERSIST` exactamente
 * `'1'`, una lista de nombres válidos y una carpeta absoluta. `dirOverride`: carpeta propia del servidor (directorio privado del sandbox);
 * `null` = este servidor no puede usar la carpeta (p. ej. aislado en WSL) y no recibe nada.
 */
export function onlyPermissionPersistEnv(env: Record<string, string>, dirOverride?: string | null): Record<string, string> {
  if (dirOverride === null || env[ENV_PERMISSION_PERSIST] !== '1') return {}
  const dir = dirOverride ?? env[ENV_PERMISSION_DIR]
  const list = env[ENV_PERMISSION_NO_PERSIST]
  if (typeof dir !== 'string' || !isAbsoluteLike(dir)) return {}
  if (typeof list !== 'string' || !/^[A-Za-z0-9_*.:-]+(,[A-Za-z0-9_*.:-]+)*$/.test(list) || list.length > 500) return {}
  return { [ENV_PERMISSION_PERSIST]: '1', [ENV_PERMISSION_DIR]: dir, [ENV_PERMISSION_NO_PERSIST]: list }
}
