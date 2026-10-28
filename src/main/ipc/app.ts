import { hostname } from 'node:os'
import { app, shell, type IpcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { DISPLAY_NAME } from '@shared/brand'
import { isUnifiedAppsEnabledFor, isUnifiedWinCapsReady } from '@shared/unified-bridge'
import { isComputerUseDisabled, loadManagedPolicy } from '../tasks/policy'
import { handle, IpcError } from './handle'

export function registerAppHandlers(ipcMain: IpcMain, ctx: { chatDirectory: string }): void {
  handle(ipcMain, 'app:info', () => ({
    name: DISPLAY_NAME,
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    chatDirectory: ctx.chatDirectory,
    isDev: is.dev,
    // Interfaz unificada: bandera(s) de la plataforma (Windows exige ambas y además Control del PC + Tareas aisladas) + la política no
    // apaga Control del PC (falla cerrado).
    unifiedApps:
      isUnifiedAppsEnabledFor(process.platform) &&
      (process.platform !== 'win32' || isUnifiedWinCapsReady()) &&
      !isComputerUseDisabled(loadManagedPolicy())
  }))

  handle(ipcMain, 'app:hostName', () => hostname().slice(0, 100))

  handle(ipcMain, 'app:openExternal', async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) throw new IpcError('ERROR', 'Solo se permiten URLs http(s)')
    await shell.openExternal(url)
  })
}
