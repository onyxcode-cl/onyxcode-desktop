/**
 * Quick Entry: ventana pequeña, sin marco y siempre encima, que se alterna con un atajo
 * global (por defecto Option+Space). Al enviar, abre/enfoca la ventana principal en Chat
 * con el prompt (evento `extras:quick-prompt`).
 */
import { BrowserWindow, globalShortcut, screen } from 'electron'
import type { QuickPromptEvent } from '@shared/ipc-extras'
import { extrasWindows, loadRendererPage, preloadPath, showMainWindow, type MainWindowDeps } from './windows'

const WIDTH = 680
const HEIGHT = 76

let quickWin: BrowserWindow | null = null
let registered: string | null = null
/** Prompt pendiente para una ventana principal que aún está cargando. */
let pendingPrompt: QuickPromptEvent | null = null

function createQuickWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: true,
    ...(isMac ? { type: 'panel' as const, vibrancy: 'hud' as const, visualEffectState: 'active' as const } : {}),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  extrasWindows.add(win)
  win.setAlwaysOnTop(true, 'floating')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) win.hide()
  })
  win.on('closed', () => {
    if (quickWin === win) quickWin = null
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  void loadRendererPage(win, 'quick')
  return win
}

function position(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const x = Math.round(workArea.x + (workArea.width - WIDTH) / 2)
  const y = Math.round(workArea.y + workArea.height * 0.28)
  win.setBounds({ x, y, width: WIDTH, height: HEIGHT })
}

export function showQuickEntry(): void {
  if (!quickWin || quickWin.isDestroyed()) quickWin = createQuickWindow()
  const win = quickWin
  position(win)
  const reveal = (): void => {
    win.show()
    win.focus()
    win.webContents.send('extras:quick-shown')
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reveal)
  else reveal()
}

export function hideQuickEntry(): void {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) quickWin.hide()
}

export function toggleQuickEntry(): void {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible() && quickWin.isFocused()) hideQuickEntry()
  else showQuickEntry()
}

/** Pre-crea la ventana (oculta) para que el primer atajo sea instantáneo. */
export function warmQuickEntry(): void {
  if (!quickWin || quickWin.isDestroyed()) quickWin = createQuickWindow()
}

/**
 * Registra (o re-registra) el atajo global. Devuelve un mensaje de error en español o null.
 * Un acelerador vacío desactiva el atajo.
 */
export function registerQuickEntryShortcut(accelerator: string): string | null {
  if (registered) {
    globalShortcut.unregister(registered)
    registered = null
  }
  const acc = accelerator.trim()
  if (!acc) return null
  try {
    const ok = globalShortcut.register(acc, toggleQuickEntry)
    if (!ok) return `No se pudo registrar "${acc}": otra aplicación ya usa ese atajo.`
    registered = acc
    return null
  } catch (err) {
    return `Atajo inválido "${acc}": ${err instanceof Error ? err.message : String(err)}`
  }
}

export function unregisterQuickEntryShortcut(): void {
  if (registered) globalShortcut.unregister(registered)
  registered = null
}

export function destroyQuickEntry(): void {
  unregisterQuickEntryShortcut()
  if (quickWin && !quickWin.isDestroyed()) quickWin.destroy()
  quickWin = null
}

/** Envía el prompt a la ventana principal (la crea/enfoca si hace falta). */
export function deliverQuickPrompt(deps: MainWindowDeps, event: QuickPromptEvent): void {
  const text = event.text.trim()
  if (!text) return
  hideQuickEntry()
  const { win, fresh } = showMainWindow(deps)
  if (fresh || win.webContents.isLoading()) {
    // El renderer lo recoge con `extras:takePendingPrompt` al montar; además se reenvía al terminar
    // de cargar por si ya estaba escuchando.
    pendingPrompt = { text }
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (pendingPrompt && !win.isDestroyed()) {
          win.webContents.send('extras:quick-prompt', pendingPrompt)
          pendingPrompt = null
        }
      }, 800)
    })
    return
  }
  win.webContents.send('extras:quick-prompt', { text })
}

export function takePendingPrompt(): QuickPromptEvent | null {
  const p = pendingPrompt
  pendingPrompt = null
  return p
}
