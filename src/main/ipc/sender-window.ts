import { BrowserWindow, type WebContents } from 'electron'
import { isRemoteSender } from '../remote/sender'

/**
 * Ventana a la que pertenece el remitente de una llamada IPC. El remitente virtual del celular no es un
 * `WebContents`: no tiene ventana (null) y los diálogos usan el respaldo (`?? getWindow()`), sin tocar Electron
 * con un objeto que no es suyo.
 */
export function windowOfSender(sender: WebContents): BrowserWindow | null {
  if (isRemoteSender(sender)) return null
  return BrowserWindow.fromWebContents(sender)
}
