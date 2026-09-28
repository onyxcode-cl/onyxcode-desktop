import type { IpcMain } from 'electron'
import { notImplemented } from './handle'

/** Rutinas programadas (fase 3): implementar en src/main/scheduler/ (userData/routines.json). */
export function registerSchedulerHandlers(ipcMain: IpcMain): void {
  notImplemented(ipcMain, 'scheduler:list')
  notImplemented(ipcMain, 'scheduler:save')
  notImplemented(ipcMain, 'scheduler:delete')
  notImplemented(ipcMain, 'scheduler:runNow')
}
