/** El aviso Mac se adjunta a Lazunox: la hoja asíncrona no bloquea el bucle de main. */
import { BrowserWindow, dialog } from 'electron'
import type { ButtonsDialog } from '../util/native-dialog'

const conversations = new WeakSet<BrowserWindow>()
/** Solo main registra aquí las ventanas principales que pueden originar el pedido. */
export function registerVideoConversationWindow(window: BrowserWindow): void {
  conversations.add(window)
}

export async function askVideoInstall(options: ButtonsDialog, platform = process.platform): Promise<number> {
  if (options.signal?.aborted) return -1
  // Solo ventanas registradas como conversación; quick/overlay/visor nunca son padres.
  const isConversation = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed() && conversations.has(w)
  const focused = BrowserWindow.getFocusedWindow()
  const parent = isConversation(focused) ? focused : BrowserWindow.getAllWindows().find(isConversation)
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
