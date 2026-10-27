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

/** ¿Está encendido el puente? Solo con el valor exacto `1` (cualquier otra cosa = apagado). */
export function isUnifiedAppsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[UNIFIED_APPS_ENV] === '1'
}
