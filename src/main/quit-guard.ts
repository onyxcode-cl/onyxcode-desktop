/**
 * Confirmación al salir con tareas en curso (F8-B32, H6). Lógica pura (sin `electron`) para poder probarla:
 * `index.ts` la usa desde `before-quit`.
 *
 * No se pregunta cuando la salida NO la pide el usuario: el actualizador reinicia la app (`isUpdating`) y el
 * cierre de sesión / apagado del sistema (`systemShutdown`); un diálogo ahí bloquearía la actualización o el
 * apagado del Mac. Ver `needsQuitConfirmation`.
 */
export interface QuitContext {
  /** Tareas en curso (monitor de Tareas). */
  busyCount: number
  /** `isUpdating()`: el actualizador está sustituyendo la app y la cierra él mismo. */
  updating: boolean
  /** El sistema se apaga o cierra sesión. */
  systemShutdown: boolean
}

/** ¿Hay que preguntar antes de salir? Devuelve el nº de tareas a mencionar (0 = salir sin preguntar). */
export function needsQuitConfirmation(c: QuitContext): number {
  if (c.updating || c.systemShutdown) return 0
  return c.busyCount > 0 ? c.busyCount : 0
}
