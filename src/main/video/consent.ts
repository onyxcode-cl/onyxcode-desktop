/** El aviso Mac se adjunta a Lazunox: la hoja asíncrona no bloquea el bucle de main. */
import { BrowserWindow, dialog } from 'electron'
import type { ButtonsDialog } from '../util/native-dialog'

export async function askVideoInstall(options: ButtonsDialog, platform = process.platform): Promise<number> {
  if (options.signal?.aborted) return -1
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  // Sin ventana no se usa runModal: se cancela sin instalar.
  if (!parent || parent.isDestroyed()) return -1
  if (parent.isMinimized()) parent.restore()
  parent.show()
  parent.focus()
  const result = await dialog.showMessageBox(parent, {
    type: 'warning',
    message: options.message,
    detail: options.detail,
    buttons: options.buttons,
    // Sin botón de Return: una tecla pendiente al enviar el Chat no responde la hoja.
    defaultId: platform === 'darwin' ? -1 : 0,
    cancelId: 0,
    noLink: true,
    ...(options.signal ? { signal: options.signal } : {})
  })
  return options.signal?.aborted ? -1 : result.response
}
