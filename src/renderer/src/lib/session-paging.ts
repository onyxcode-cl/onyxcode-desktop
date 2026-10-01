/** Paginación de las listas de sesiones (Chat, Tareas, Code): el servidor devuelve como máximo `limit` raíces. */
export const SESSIONS_PAGE = 200
/** Tope al pedir «todas» (filtro/búsqueda con más sesiones de las cargadas). */
export const SESSIONS_ALL = 10_000

/** Siguiente `limit` al pulsar «Cargar más» (`all` = pedir todas de golpe). */
export function nextSessionsLimit(current: number, all = false): number {
  return all ? SESSIONS_ALL : Math.min(SESSIONS_ALL, current + SESSIONS_PAGE)
}

/** ¿Puede haber más sesiones en el servidor? (la lista llegó llena). */
export function sessionsMayHaveMore(received: number, limit: number): boolean {
  return received >= limit && limit < SESSIONS_ALL
}
