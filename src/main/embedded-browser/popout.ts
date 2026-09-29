/**
 * Ventana «Navegador» aparte (Lote D, B.10 y D1 paso 8): el mismo `BrowserPanel`, en su propia
 * `BrowserWindow` (rol `browserHost`, preload `browser-host`, página
 * `onyxcode://app/browser/index.html`). Se abre a petición o automáticamente con `showInactive()`
 * cuando el agente actúa y la ventana principal está minimizada u oculta (Control total, A.5).
 *
 * Este módulo solo gestiona la ventana; qué `WebContentsView` aloja y sus bounds los decide
 * `service.ts` (mueve la vista entre `mainWindow.contentView` y esta ventana según corresponda).
 */
import { app, BrowserWindow } from 'electron'
import { APP_NAME } from '@shared/brand'
import { extrasWindows, loadRendererPage, preloadPath } from '../extras/windows'
import { registerWindowRole } from '../ipc/guard'

let win: BrowserWindow | null = null

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
    title: `${APP_NAME} · Navegador`,
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
