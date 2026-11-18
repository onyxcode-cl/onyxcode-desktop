/** El aviso Mac se adjunta a Lazunox: la hoja asíncrona no bloquea el bucle de main. */
import { BrowserWindow, dialog } from 'electron'
import { askButtons, type ButtonsDialog } from '../util/native-dialog'

export async function askVideoInstall(options: ButtonsDialog, platform = process.platform): Promise<number> {
  if (platform !== 'darwin') return askButtons(options)
  if (options.signal?.aborted) return 0
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  // Sin ventana no se usa runModal: se cancela sin instalar.
  if (!parent || parent.isDestroyed()) return 0
  if (parent.isMinimized()) parent.restore()
  parent.show()
  parent.focus()
  const result = await dialog.showMessageBox(parent, {
    type: 'warning',
    message: options.message,
    detail: options.detail,
    buttons: options.buttons,
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    ...(options.signal ? { signal: options.signal } : {})
  })
  return options.signal?.aborted ? 0 : result.response
}
