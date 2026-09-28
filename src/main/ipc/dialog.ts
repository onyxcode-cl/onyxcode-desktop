import { BrowserWindow, dialog, type IpcMain } from 'electron'
import { settingsStore } from '../store'
import { handle } from './handle'

export function registerDialogHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'dialog:openFolder', async (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: req?.title ?? 'Abrir carpeta',
      defaultPath: req?.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? null : (result.filePaths[0] ?? null)
    if (path) settingsStore.addRecentFolder(path)
    return path
  })
}
