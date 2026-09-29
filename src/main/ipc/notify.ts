/**
 * Notificaciones nativas + badge del Dock desde main (Code/Tareas: sesión terminó o pide algo).
 *
 * `app:notify` crea la `Notification` (respeta el ajuste "Notificaciones"/"Sonido" de
 * `extrasPrefs`); un clic restaura/enfoca la ventana principal y reenvía el destino al renderer
 * (`app:openTarget`) para que cambie de modo y seleccione la sesión/tarea. `app:setAttention`
 * fija `app.dock.setBadge` con el conteo combinado que calcula el renderer (sesiones esperando +
 * no leídas) y hace rebotar el Dock si la ventana no tiene el foco.
 */
import { app, Notification, type IpcMain } from 'electron'
import { extrasPrefs } from '../extras/prefs'
import { findMainWindow, showMainWindow, type MainWindowDeps } from '../extras/windows'
import { handle } from './handle'

export function registerNotifyHandlers(ipcMain: IpcMain, deps: MainWindowDeps): void {
  handle(ipcMain, 'app:notify', ({ title, body, target }) => {
    const prefs = extrasPrefs.get()
    if (!prefs.notificationsEnabled) return
    if (!Notification.isSupported()) return

    const n = new Notification({ title, body, silent: !prefs.soundEnabled })
    n.on('click', () => {
      const { win } = showMainWindow(deps)
      if (!target) return
      const send = (): void => {
        if (!win.isDestroyed()) win.webContents.send('app:openTarget', target)
      }
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 300))
      else send()
    })
    n.show()

    // Rebote del Dock: solo si la ventana principal no tiene el foco (algo pide atención en 2º plano).
    if (process.platform === 'darwin') {
      const mainWin = findMainWindow(deps)
      if (!mainWin || mainWin.isDestroyed() || !mainWin.isFocused()) app.dock?.bounce('informational')
    }
  })

  handle(ipcMain, 'app:setAttention', ({ count }) => {
    if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '')
  })
}
