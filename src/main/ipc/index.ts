import type { IpcMain } from 'electron'
import type { OpencodeServer } from '../opencode/server'
import { registerAppHandlers } from './app'
import { registerDialogHandlers } from './dialog'
import { registerGitHandlers } from './git'
import { registerOpencodeHandlers } from './opencode'
import { registerPtyHandlers } from './pty'
import { registerSchedulerHandlers } from './scheduler'
import { registerSettingsHandlers } from './settings'

export interface IpcContext {
  server: OpencodeServer
  chatDirectory: string
}

/** Registra todos los módulos IPC. Un módulo nuevo = una línea aquí. */
export function registerAllHandlers(ipcMain: IpcMain, ctx: IpcContext): void {
  registerAppHandlers(ipcMain, ctx)
  registerOpencodeHandlers(ipcMain, ctx.server)
  registerSettingsHandlers(ipcMain)
  registerDialogHandlers(ipcMain)
  registerPtyHandlers(ipcMain)
  registerGitHandlers(ipcMain)
  registerSchedulerHandlers(ipcMain)
}
