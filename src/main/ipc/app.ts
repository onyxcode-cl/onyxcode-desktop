import { app, shell, type IpcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { APP_NAME } from '@shared/brand'
import { handle, IpcError } from './handle'

export function registerAppHandlers(ipcMain: IpcMain, ctx: { chatDirectory: string }): void {
  handle(ipcMain, 'app:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    chatDirectory: ctx.chatDirectory,
    isDev: is.dev
  }))

  handle(ipcMain, 'app:openExternal', async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) throw new IpcError('ERROR', 'Solo se permiten URLs http(s)')
    await shell.openExternal(url)
  })
}
