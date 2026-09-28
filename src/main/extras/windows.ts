import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

/** Ventanas creadas por extras (quick entry, artifacts): nunca son la "ventana principal". */
export const extrasWindows = new WeakSet<BrowserWindow>()

export interface MainWindowDeps {
  /** Devuelve la ventana principal si existe. Por defecto: la primera que no sea de extras. */
  getMainWindow?: () => BrowserWindow | null
  /** Crea la ventana principal (se usa si no hay ninguna abierta). */
  createMainWindow: () => BrowserWindow
}

export function findMainWindow(deps: MainWindowDeps): BrowserWindow | null {
  const fromDeps = deps.getMainWindow?.()
  if (fromDeps && !fromDeps.isDestroyed()) return fromDeps
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !extrasWindows.has(w)) ?? null
}

/** Muestra y enfoca la ventana principal (creándola si hace falta). `fresh` = recién creada. */
export function showMainWindow(deps: MainWindowDeps): { win: BrowserWindow; fresh: boolean } {
  let win = findMainWindow(deps)
  let fresh = false
  if (!win) {
    win = deps.createMainWindow()
    fresh = true
  }
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  if (process.platform === 'darwin') app.focus({ steal: true })
  win.focus()
  return { win, fresh }
}

/** Ruta del preload compartido (bundle de main vive en out/main). */
export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

/** Carga una página del renderer multi-página (`quick`, …) en dev o prod. */
export function loadRendererPage(win: BrowserWindow, page: string): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) return win.loadURL(`${devUrl.replace(/\/$/, '')}/${page}/index.html`)
  return win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
}
