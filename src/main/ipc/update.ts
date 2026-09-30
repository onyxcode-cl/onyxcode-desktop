import { app, type IpcMain } from 'electron'
import { join } from 'node:path'
import { RELEASES_REPO } from '@shared/brand'
import { resolveUpdateConfig } from '../update/config'
import { UpdateChecker } from '../update/checker'
import { settingsStore } from '../store'
import { bootMarkers } from '../update/boot'
import { broadcast, handle } from './handle'

/** Aviso de versión nueva: servicio en main + canales `app:updateState|checkUpdates|dismissUpdate`. */
export function registerUpdateHandlers(ipcMain: IpcMain): UpdateChecker {
  const checker = new UpdateChecker({
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    },
    currentVersion: app.getVersion(),
    config: resolveUpdateConfig({ isPackaged: app.isPackaged, env: process.env, repo: RELEASES_REPO }),
    isEnabled: () => settingsStore.get().checkUpdates,
    stateFile: join(app.getPath('userData'), 'update-check.json'),
    onState: (s) => broadcast('app:updateState', s)
  })

  handle(ipcMain, 'app:updateState', () => checker.getState())
  handle(ipcMain, 'app:checkUpdates', () => checker.check(true))
  handle(ipcMain, 'app:dismissUpdate', ({ version }) => checker.dismiss(version))
  handle(ipcMain, 'app:bootConfirm', () => bootMarkers()?.confirmed())

  let wasEnabled = settingsStore.get().checkUpdates
  settingsStore.onChange((s) => {
    if (s.checkUpdates === wasEnabled) return
    wasEnabled = s.checkUpdates
    checker.refresh()
    if (s.checkUpdates) void checker.check(false)
  })

  checker.start()
  return checker
}
