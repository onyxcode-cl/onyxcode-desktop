import type { IpcMain } from 'electron'
import { extractOffice } from '../files/office-extract'
import { handle } from './handle'

/**
 * `attach:extractOffice`: convierte a texto un documento de oficina para adjuntarlo al Chat. Solo la ventana principal
 * (por defecto en `CHANNEL_ROLES`); la política remota lo marca X. No escribe en disco ni abre nada.
 */
export function registerAttachHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'attach:extractOffice', (req) => extractOffice(req))
}
