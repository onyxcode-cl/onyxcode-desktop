import { app, type BrowserWindow } from 'electron'

/**
 * Modo E2E "sin pantalla" (solo sin empaquetar): las instancias que lanzan los tests y el smoke
 * (`e2e/`) no deben abrir ventanas visibles ni un icono más en el Dock cada vez que se ejecutan.
 * La ventana sigue contando como visible para el renderer (visibilityState, isVisible), pero es
 * transparente, no recibe clics y no roba el foco. En la app empaquetada esto nunca se activa.
 */
export const E2E_HEADLESS = !app.isPackaged && process.env.ONYXCODE_E2E_HEADLESS === '1'

/** Sin icono en el Dock ni barra de menús (macOS). Llamar cuando la app está lista. */
export function applyE2eHeadless(): void {
  if (!E2E_HEADLESS) return
  app.dock?.hide()
  app.setActivationPolicy?.('accessory')
}

/** `win.show()` (+ `focus()` si se pide) o su equivalente invisible en modo E2E sin pantalla. */
export function presentWindow(win: BrowserWindow, opts: { focus?: boolean } = {}): void {
  if (E2E_HEADLESS) {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.showInactive()
    return
  }
  win.show()
  if (opts.focus) win.focus()
}
