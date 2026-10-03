/**
 * Notificaciones nativas (Code/Tareas) vía IPC (`app:notify`, main-process `Notification`) y
 * badge combinado del Dock (`app:setAttention`). Reemplaza el uso directo de `new Notification`
 * en el renderer (ver docs/SEGURIDAD.md: los permisos por defecto solo dejan `notifications` a
 * páginas propias, pero mostrarla desde main permite respetar el ajuste "Sonido" y hacer clic
 * para restaurar/enfocar la ventana y abrir la sesión/tarea, aunque la app no tenga el foco).
 */
import type { NotifyTarget } from '@shared/types'
import { api } from './api'
import { isRemoteSurface } from './platform'

/** Envía una notificación nativa. Silenciosa si la ventana ya tiene el foco (nada que avisar). */
export function sendNotification(title: string, body: string, target?: NotifyTarget): void {
  // PWA del celular: los avisos nativos y el badge del Dock son del Mac (que los muestra por sí mismo).
  if (isRemoteSurface()) return
  try {
    if (document.hasFocus()) return
  } catch {
    // sin `document` (tests): seguir e intentar igual
  }
  void api.invoke('app:notify', { title, body, target }).catch(() => undefined)
}

let lastSent = -1

/** Actualiza el badge del Dock si el conteo cambió desde el último envío. */
export function setAttentionCount(count: number): void {
  if (isRemoteSurface() || count === lastSent) return
  lastSent = count
  void api.invoke('app:setAttention', { count }).catch(() => undefined)
}
