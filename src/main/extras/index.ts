/**
 * Arranque de extras en main: atajo global de Quick Entry + bandeja.
 * Lo invoca `registerExtrasHandlers` (src/main/ipc/extras-handlers.ts); no hace falta llamarlo aparte.
 */
import { app, BrowserWindow } from 'electron'
import type { ExtrasPrefs, ExtrasPrefsState, IpcExtrasEventChannel, IpcExtrasEventContract } from '@shared/ipc-extras'
import { whenAccountAllowed } from '../account/access'
import { extrasPrefs } from './prefs'
import { destroyQuickEntry, registerQuickEntryShortcut, toggleQuickEntry, warmQuickEntry } from './quick-entry'
import { createTray, destroyTray, setTrayRemoteActive, updateTrayShortcut } from './tray'
import { onRemoteMode, remoteMode, stopAllRemote } from '../remote/loader'
import { showMainWindow, type MainWindowDeps } from './windows'

export { openArtifact, ARTIFACT_CSP } from './artifact-window'
export { appOpencodeConfigEnv, appOpencodeConfigPath, ensureAppOpencodeConfig } from './mcp-config'
export { showQuickEntry, hideQuickEntry, toggleQuickEntry } from './quick-entry'
export { createTrayIcon } from './tray'
export { extrasPrefs } from './prefs'

let shortcutError: string | null = null

export function getPrefsState(): ExtrasPrefsState {
  return { prefs: extrasPrefs.get(), shortcutError }
}

/** Envía un evento de extras a todas las ventanas. */
export function broadcastExtras<C extends IpcExtrasEventChannel>(
  channel: C,
  ...payload: IpcExtrasEventContract[C] extends void ? [] : [IpcExtrasEventContract[C]]
): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...payload)
  }
}

/** Envía un evento a la ventana principal (la crea/enfoca si hace falta). */
export function sendToMain<C extends IpcExtrasEventChannel>(
  deps: MainWindowDeps,
  channel: C,
  ...payload: IpcExtrasEventContract[C] extends void ? [] : [IpcExtrasEventContract[C]]
): void {
  const { win, fresh } = showMainWindow(deps)
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...payload)
  }
  if (fresh || win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 800))
  else send()
}

function applyPrefs(deps: MainWindowDeps, prefs: ExtrasPrefs): void {
  shortcutError = registerQuickEntryShortcut(prefs.quickEntryShortcut)
  if (shortcutError) console.warn('[extras]', shortcutError)
  if (prefs.showTray) {
    createTray(
      {
        // Con la cuenta obligatoria sin iniciar, la bandeja solo deja abrir la app (que muestra el acceso) y salir.
        onNewConversation: whenAccountAllowed(() => sendToMain(deps, 'extras:new-conversation')),
        onQuickEntry: whenAccountAllowed(() => toggleQuickEntry()),
        onOpenApp: () => void showMainWindow(deps),
        onOpenSettings: whenAccountAllowed(() => sendToMain(deps, 'extras:open-settings')),
        onQuit: () => app.quit(),
        onRemoteStop: () => void stopAllRemote()
      },
      prefs.quickEntryShortcut
    )
    updateTrayShortcut(prefs.quickEntryShortcut)
    setTrayRemoteActive(remoteMode() !== 'off')
  } else {
    destroyTray()
  }
}

let initialized = false

/** Idempotente. Debe llamarse con la app lista (`app.whenReady()`). */
export function initExtras(deps: MainWindowDeps): void {
  if (initialized) return
  initialized = true
  applyPrefs(deps, extrasPrefs.get())
  onRemoteMode((mode) => setTrayRemoteActive(mode !== 'off'))
  extrasPrefs.onChange((prefs) => {
    applyPrefs(deps, prefs)
    broadcastExtras('extras:prefs-changed', getPrefsState())
  })
  // Pre-cargar Quick Entry un poco después del arranque.
  setTimeout(() => {
    try {
      warmQuickEntry()
    } catch (err) {
      console.error('[extras] no se pudo precargar Quick Entry:', err)
    }
  }, 1500)
  app.on('will-quit', () => {
    destroyQuickEntry()
    destroyTray()
  })
}
