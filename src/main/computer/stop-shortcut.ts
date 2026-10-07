/**
 * Atajo global de parada de Control del PC por plataforma (plan C §2 «Atajo de parada», decisión 4 del dueño). Puro.
 * macOS: `⌘⇧Esc`. Windows: `Ctrl+Shift+Esc` es el Administrador de tareas (Windows lo reserva y no se puede registrar), así que se
 * usa `Ctrl+Alt+Shift+Esc`; el Esc físico del gancho de teclado sigue siendo la vía principal. Falta verificar en el PC que
 * `globalShortcut.register` devuelve true (alternativa del plan: `Ctrl+Alt+Pause`). El texto visible vive en i18n (`.win`).
 */

export const STOP_SHORTCUT_MAC = 'CommandOrControl+Shift+Escape'
export const STOP_SHORTCUT_WIN = 'Ctrl+Alt+Shift+Escape'

export function stopShortcutFor(platform: string): string {
  return platform === 'win32' ? STOP_SHORTCUT_WIN : STOP_SHORTCUT_MAC
}
