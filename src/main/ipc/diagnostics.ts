import { app, BrowserWindow, clipboard, dialog, type IpcMain } from 'electron'
import { chmod, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { DiagnosticsService } from '../diagnostics/service'
import { appOpencodeConfigPath } from '../extras/mcp-config'
import type { OpencodeServer } from '../opencode/server'
import { handle } from './handle'

/**
 * Diagnóstico: registros del motor para Ajustes › Diagnóstico. Los handlers solo devuelven lo que sale de
 * `DiagnosticsService` (ya redactado); aquí no se lee ningún registro directamente.
 */
export function registerDiagnosticsHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  const service = new DiagnosticsService({
    userData: app.getPath('userData'),
    home: homedir(),
    mcpConfigPath: appOpencodeConfigPath(),
    server,
    versions: () => ({
      [app.getName()]: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      sistema: `${process.platform} ${process.arch}`
    }),
    now: () => Date.now()
  })

  handle(ipcMain, 'diag:logs', ({ source, maxLines }) => service.getLogs(source, maxLines))

  handle(ipcMain, 'diag:copy', ({ source }) => {
    const { text, lines } = service.getText(source)
    clipboard.writeText(text)
    return { lines }
  })

  handle(ipcMain, 'diag:export', async () => {
    const { text, fileName } = service.getExport()
    const parent = BrowserWindow.getFocusedWindow()
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar diagnóstico',
      defaultPath: fileName,
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    }
    const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return { saved: false }
    await writeFile(r.filePath, text, { encoding: 'utf8', mode: 0o600 })
    // `mode` solo cuenta al crear el archivo: si ya existía, se deja en 0600 igualmente.
    await chmod(r.filePath, 0o600)
    return { saved: true }
  })
}
