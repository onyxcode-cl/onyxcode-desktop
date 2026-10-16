import { app, clipboard, dialog, shell, type IpcMain } from 'electron'
import { t } from '@shared/i18n'
import { accessSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OPENCODE_LINKS, openCodeInstallCommand } from '@shared/opencode-links'
import { getOpencodeInfo, validateOpencodeBin } from '../opencode/binary'
import { useBundledEngine } from '../opencode/use-bundled'
import { bundledOpencodePath, resolveOpencodeAsync } from '../opencode/server'
import { settingsStore } from '../store'
import { handle } from './handle'
import { windowOfSender } from './sender-window'

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Canales del asistente de primer uso. La app NUNCA ejecuta un instalador: el comando solo se copia. */
export function registerOnboardingHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'app:opencodeInfo', async () => {
    const resolved = await resolveOpencodeAsync()
    return getOpencodeInfo(() => resolved, bundledOpencodePath() !== null)
  })

  handle(ipcMain, 'app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  handle(ipcMain, 'app:opencodeAction', async ({ action }) => {
    if (action === 'copyInstall') clipboard.writeText(openCodeInstallCommand(process.platform))
    else await shell.openExternal(OPENCODE_LINKS[action])
  })

  handle(ipcMain, 'app:pickOpencodeBin', async (_req, event) => {
    const win = windowOfSender(event.sender)
    const defaultPath = join(homedir(), '.opencode', 'bin')
    const options = {
      title: t('merr.dialog.pickBinary'),
      properties: ['openFile', 'showHiddenFiles'] as Array<'openFile' | 'showHiddenFiles'>,
      ...(existsSync(defaultPath) ? { defaultPath } : {})
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { status: 'canceled' as const }
    const check = await validateOpencodeBin(picked.filePaths[0])
    if (!check.ok) return { status: 'invalid' as const, error: check.error }
    settingsStore.set({ opencodeBin: check.path })
    return {
      status: 'ok' as const,
      info: await resolveOpencodeAsync().then((resolved) => getOpencodeInfo(() => resolved, bundledOpencodePath() !== null))
    }
  })

  handle(ipcMain, 'app:useBundledEngine', () =>
    useBundledEngine({
      bundled: bundledOpencodePath,
      envBin: () => process.env.OPENCODE_BIN,
      isExecutable: isExecutableFile,
      clearConfigured: () => settingsStore.set({ opencodeBin: '' }),
      resolve: () => resolveOpencodeAsync(),
      describe: (resolved) => getOpencodeInfo(() => resolved, true)
    })
  )
}
