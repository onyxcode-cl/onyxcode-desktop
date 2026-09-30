import { BrowserWindow, clipboard, dialog, shell, type IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OPENCODE_INSTALL_COMMAND, OPENCODE_LINKS } from '@shared/opencode-links'
import { getOpencodeInfo, validateOpencodeBin } from '../opencode/binary'
import { resolveOpencodeAsync } from '../opencode/server'
import { settingsStore } from '../store'
import { handle } from './handle'

/** Canales del asistente de primer uso. La app NUNCA ejecuta un instalador: el comando solo se copia. */
export function registerOnboardingHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'app:opencodeInfo', async () => {
    const resolved = await resolveOpencodeAsync()
    return getOpencodeInfo(() => resolved)
  })

  handle(ipcMain, 'app:opencodeAction', async ({ action }) => {
    if (action === 'copyInstall') clipboard.writeText(OPENCODE_INSTALL_COMMAND)
    else await shell.openExternal(OPENCODE_LINKS[action])
  })

  handle(ipcMain, 'app:pickOpencodeBin', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = join(homedir(), '.opencode', 'bin')
    const options = {
      title: 'Elegir el binario de OpenCode',
      properties: ['openFile', 'showHiddenFiles'] as Array<'openFile' | 'showHiddenFiles'>,
      ...(existsSync(defaultPath) ? { defaultPath } : {})
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { status: 'canceled' as const }
    const check = await validateOpencodeBin(picked.filePaths[0])
    if (!check.ok) return { status: 'invalid' as const, error: check.error }
    settingsStore.set({ opencodeBin: check.path })
    return { status: 'ok' as const, info: await resolveOpencodeAsync().then((resolved) => getOpencodeInfo(() => resolved)) }
  })
}
