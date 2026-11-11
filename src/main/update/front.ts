/**
 * Tras una actualización aplicada por la persona («Reiniciar y actualizar»), la app se relanza sola desde un proceso suelto
 * (`open -n` en macOS, PowerShell en Windows) y su ventana quedaba DETRÁS de las demás (informes de la 1.8.15). Se trae al frente
 * SOLO en ese arranque, que responde a una acción de la persona. Nunca en una comprobación automática ni en un arranque normal.
 */
import type { BrowserWindow } from 'electron'

let justUpdated = false

/** El resultado que dejó el script de reemplazo dice que esta versión se instaló bien y es la que corre ahora. */
export function markJustUpdated(result: { version: string; ok: boolean } | null, currentVersion: string): void {
  if (result && result.ok && result.version === currentVersion) justUpdated = true
}

/** true una sola vez: consumirlo evita traer la ventana al frente en cualquier otro momento. */
export function consumeJustUpdated(): boolean {
  const v = justUpdated
  justUpdated = false
  return v
}

/** Trae la ventana al frente (Windows no deja robar el primer plano a un proceso recién lanzado: se usa el truco de «siempre encima» un instante). */
export function bringToFront(
  win: Pick<BrowserWindow, 'show' | 'focus' | 'moveTop' | 'setAlwaysOnTop' | 'isDestroyed'>,
  platform: NodeJS.Platform,
  focusApp: () => void
): void {
  if (win.isDestroyed()) return
  win.show()
  if (platform === 'win32') {
    win.setAlwaysOnTop(true)
    win.focus()
    win.setAlwaysOnTop(false)
  } else {
    focusApp()
    win.focus()
  }
  win.moveTop()
}
