/**
 * Contrato del «puente de apps» del modo unificado (1.8, ola 1): el agente sigue DENTRO del aislamiento («Una carpeta») y pide el control
 * de apps por el proxy MCP de main (igual que el navegador integrado). Las constantes viven aquí para que el proxy (tasks/), el servidor
 * de control (computer/) y el motor las compartan sin duplicar cadenas. Todo está apagado salvo `LAZUNOX_UNIFIED_APPS=1`.
 */

/** Variable de entorno que enciende el puente. Sin ella el comportamiento es el de la 1.7.x. */
export const UNIFIED_APPS_ENV = 'LAZUNOX_UNIFIED_APPS'

/** Nombre de la ruta del proxy MCP del servidor aislado que lleva a las herramientas `computer_*`. */
export const BRIDGE_ROUTE_NAME = 'computer'

/** Cabecera que SOLO el proxy de main añade a las peticiones del puente; su valor es un secreto aleatorio de esta ejecución de la app. */
export const BRIDGE_ORIGIN_HEADER = 'x-lazunox-bridge'

/** Cabecera con la clave del servidor aislado de origen (`serverKey`, p. ej. la carpeta); la fija el proxy, nunca el agente. */
export const BRIDGE_SERVER_HEADER = 'x-lazunox-server'

/** Argumento que el plugin del motor inyecta en cada llamada `computer_*` con el id de la sesión del agente. */
export const BRIDGE_SESSION_ARG = 'lazunox_session'

/** Segunda variable, solo para Windows (experimental): junto con `LAZUNOX_UNIFIED_APPS=1` enciende el modo unificado en el PC con Windows. */
export const UNIFIED_APPS_WIN_ENV = 'LAZUNOX_UNIFIED_APPS_WIN'

/**
 * ¿Está encendido el modo unificado en esa plataforma? macOS: `LAZUNOX_UNIFIED_APPS==='1'`. Windows: AMBAS variables con el valor exacto `1`
 * (experimental; apagado por defecto hasta pasar la batería en el PC real). Cualquier otra plataforma: apagado.
 */
export function isUnifiedAppsEnabledFor(platform: NodeJS.Platform, env: Record<string, string | undefined> = process.env): boolean {
  if (platform === 'darwin') return env[UNIFIED_APPS_ENV] === '1'
  if (platform === 'win32') return env[UNIFIED_APPS_ENV] === '1' && env[UNIFIED_APPS_WIN_ENV] === '1'
  return false
}

/** ¿Está encendido el puente en ESTA plataforma? Solo con el valor exacto `1` de la(s) variable(s) (cualquier otra cosa = apagado). */
export function isUnifiedAppsEnabled(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  // Fuera de Windows se conserva la regla de siempre (una sola variable); solo Windows exige además la segunda.
  return platform === 'win32' ? isUnifiedAppsEnabledFor('win32', env) : env[UNIFIED_APPS_ENV] === '1'
}

let unifiedWinCapsReady = false
/** Windows: lo fija el gestor de Tareas (Control del PC + Tareas aisladas por WSL disponibles). Lazunox no elevado se comprueba además al registrar el puente. */
export function setUnifiedWinCapsReady(ready: boolean): void {
  unifiedWinCapsReady = ready
}
export function isUnifiedWinCapsReady(): boolean {
  return unifiedWinCapsReady
}
