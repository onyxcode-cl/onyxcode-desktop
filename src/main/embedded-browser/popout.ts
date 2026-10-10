/**
 * Ventana «Navegador» aparte (Lote D, B.10 y D1 paso 8): el mismo `BrowserPanel`, en su propia
 * `BrowserWindow` (rol `browserHost`, preload `browser-host`, página
 * `lazunox://app/browser/index.html`). Se abre a petición o automáticamente con `showInactive()`
 * cuando el agente actúa y la ventana principal está minimizada u oculta (Control total, A.5).
 *
 * Este módulo solo gestiona la ventana; qué `WebContentsView` aloja y sus bounds los decide
 * `service.ts` (mueve la vista entre `mainWindow.contentView` y esta ventana según corresponda).
 */
import { app, BrowserWindow } from 'electron'
import { DISPLAY_NAME } from '@shared/brand'
import { extrasWindows, loadRendererPage, preloadPath } from '../extras/windows'
import { registerWindowRole } from '../ipc/guard'

let win: BrowserWindow | null = null
let onClosed: (() => void) | null = null

/** `service.ts` se entera de que la ventana aparte se cerró (X) para dejar de considerarla anfitrión. */
export function setPopoutClosedListener(fn: () => void): void {
  onClosed = fn
}

export function popoutWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

function create(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: `${DISPLAY_NAME} · Navegador`,
    webPreferences: {
      preload: preloadPath('browser-host'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged
    }
  })
  extrasWindows.add(created)
  registerWindowRole(created.webContents, 'browserHost')
  created.on('closed', () => {
    if (win === created) win = null
    try {
      onClosed?.()
    } catch (err) {
      console.error('[embedded-browser] cierre de ventana Navegador:', err)
    }
  })
  void loadRendererPage(created, 'browser/index.html').catch((err) => console.error('[embedded-browser] ventana Navegador:', err))
  return created
}

export function ensurePopoutWindow(): BrowserWindow {
  const existing = popoutWindow()
  if (existing) return existing
  win = create()
  return win
}

/** Nunca roba el foco (A.5/B.10): se usa para el auto-abrir con la principal minimizada. */
export function showPopoutInactive(): BrowserWindow {
  const w = ensurePopoutWindow()
  w.showInactive()
  return w
}

export function closePopout(): void {
  const w = popoutWindow()
  if (w) w.close()
}

/** Estado mínimo de un owner para decidir si su panel vuelve de la ventana aparte (`popoutAuto`: lo abrió el agente). */
export interface PopoutOwnerState {
  hostKind: 'panel' | 'popout' | 'none'
  popoutAuto: boolean
}

/**
 * Al abrir el popout por el agente con la principal oculta, solo es «automático» (y por tanto vuelve al panel) si el panel
 * estaba en la principal o no había ventana alguna (al volver, el panel se monta solo). Si el usuario ya lo tenía aparte, no se marca.
 */
export function isAutoPopoutFromPanel(hostKind: PopoutOwnerState['hostKind'], visible: boolean): boolean {
  void visible
  return hostKind !== 'popout'
}

/**
 * Owners cuyo popout automático vuelve al panel cuando la ventana principal está visible otra vez. `close` indica que la
 * ventana aparte ya no la usa nadie (ningún owner la tiene a petición del usuario), así que se puede cerrar.
 * Un popout pedido a propósito (`popoutAuto: false`) nunca se toca.
 */
export function planAutoPopoutReturn<T extends PopoutOwnerState>(
  owners: readonly T[],
  mainVisible: boolean
): { reclaim: T[]; close: boolean } {
  if (!mainVisible) return { reclaim: [], close: false }
  const reclaim = owners.filter((o) => o.popoutAuto)
  if (reclaim.length === 0) return { reclaim, close: false }
  const manualStillOpen = owners.some((o) => !o.popoutAuto && o.hostKind === 'popout')
  return { reclaim, close: !manualStillOpen }
}
