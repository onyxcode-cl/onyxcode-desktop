import { nativeTheme, type IpcMain } from 'electron'
import { forgetSavedPermissions } from '../opencode/permission-store'
import { readHooks, writeHooks } from '../opencode/user-hooks-store'
import { settingsStore } from '../store'
import { broadcast, handle } from './handle'

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'settings:get', () => settingsStore.get())
  handle(ipcMain, 'settings:set', (patch) => settingsStore.set(patch))
  handle(ipcMain, 'settings:forgetAlways', () => ({ removed: forgetSavedPermissions() }))
  handle(ipcMain, 'settings:hooksRead', () => readHooks())
  handle(ipcMain, 'settings:hooksWrite', ({ text }) => writeHooks(text))
  handle(ipcMain, 'settings:addRecentFolder', ({ path }) => settingsStore.addRecentFolder(path))

  nativeTheme.themeSource = settingsStore.get().theme
  settingsStore.onChange((settings) => {
    nativeTheme.themeSource = settings.theme
    broadcast('settings:changed', settings)
  })
}
