import type { IpcMain } from 'electron'
import type { OpencodeServer } from '../opencode/server'
import type { MainWindowDeps } from '../extras/windows'
import { registerAppHandlers } from './app'
import { registerNotifyHandlers } from './notify'
import { registerOpencodeHandlers } from './opencode'
import { registerSettingsHandlers } from './settings'

export interface IpcContext extends MainWindowDeps {
  server: OpencodeServer
  chatDirectory: string
}

/** Registra todos los módulos IPC. Un módulo nuevo = una línea aquí. */
export function registerAllHandlers(ipcMain: IpcMain, ctx: IpcContext): void {
  registerAppHandlers(ipcMain, ctx)
  registerOpencodeHandlers(ipcMain, ctx.server)
  registerSettingsHandlers(ipcMain)
  registerNotifyHandlers(ipcMain, ctx)
}
