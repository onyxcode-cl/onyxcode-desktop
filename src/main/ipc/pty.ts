import type { IpcMain } from 'electron'
import { notImplemented } from './handle'

/** Terminal integrada (fase 2): implementar con node-pty en src/main/pty/. */
export function registerPtyHandlers(ipcMain: IpcMain): void {
  notImplemented(ipcMain, 'pty:create')
  notImplemented(ipcMain, 'pty:write')
  notImplemented(ipcMain, 'pty:resize')
  notImplemented(ipcMain, 'pty:kill')
}
