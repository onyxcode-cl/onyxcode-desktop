import { app, BrowserWindow, clipboard, dialog, type IpcMain } from 'electron'
import { t } from '@shared/i18n'
import { chmod, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import { SANDBOX_PROVIDER_IDS } from '@shared/sandbox-providers'
import { getProblemLog, recordProblem } from '../diagnostics/problem-log'
import { DiagnosticsService } from '../diagnostics/service'
import { embeddedBrowserMcp } from '../embedded-browser/mcp-server'
import { appOpencodeConfigPath } from '../extras/mcp-config'
import { knownMcpProxyTokens } from '../tasks/mcp-proxy'
import type { OpencodeServer } from '../opencode/server'
import { appAuthFile } from '../opencode/data-dir'
import { extrasPrefs } from '../extras/prefs'
import { settingsStore } from '../store'
import { sandboxCredentialIds } from '../tasks/sandbox-credentials'
import { handle } from './handle'

/**
 * Diagnóstico: registros del motor para Ajustes › Diagnóstico. Los handlers solo devuelven lo que sale de
 * `DiagnosticsService` (ya redactado); aquí no se lee ningún registro directamente.
 */
export function registerDiagnosticsHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  // Último dato conocido de los proveedores conectados (id + origen), pedido al motor antes de cada informe.
  let connectedCache: { id: string; source: string }[] | null = null
  const refreshProviders = async (): Promise<void> => {
    const conn = server.getConnection()
    if (!conn) return
    try {
      const client = createOpencodeClient({ baseUrl: conn.baseUrl, headers: { Authorization: conn.authorization } })
      const res = await client.config.providers(undefined, { signal: AbortSignal.timeout(3000) })
      connectedCache = res.data ? res.data.providers.map((p) => ({ id: p.id, source: String(p.source) })) : null
    } catch {
      connectedCache = null
    }
  }
  const service = new DiagnosticsService({
    userData: app.getPath('userData'),
    home: homedir(),
    mcpConfigPath: appOpencodeConfigPath(),
    server,
    problems: { readLines: (max) => getProblemLog()?.readLines(max) ?? [] },
    extraSecrets: () => [...embeddedBrowserMcp.knownTokens(), ...knownMcpProxyTokens()],
    versions: () => ({
      [app.getName()]: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      sistema: `${process.platform} ${process.arch}`
    }),
    providers: {
      refresh: refreshProviders,
      connected: () => connectedCache,
      defaultModel: () => settingsStore.get().defaultModel,
      modelsByMode: () => extrasPrefs.get().modelsByMode,
      sandbox: () => ({
        allowed: [...SANDBOX_PROVIDER_IDS],
        credentialed: sandboxCredentialIds(appAuthFile(app.getPath('userData')))
      })
    },
    now: () => Date.now()
  })

  handle(ipcMain, 'diag:logs', async ({ source, maxLines }) => {
    if (source === 'report') await service.refresh()
    return service.getLogs(source, maxLines)
  })

  handle(ipcMain, 'diag:problem', ({ message, stack, origin }) => {
    // Un documento de Chat que no se pudo leer/abrir se anota como aviso del origen «documento»; el resto, como error de la ventana.
    if (origin === 'chat-doc') recordProblem({ source: 'document', level: 'warn', message, stack })
    else recordProblem({ source: 'renderer', message, stack })
  })

  handle(ipcMain, 'diag:copy', async ({ source }) => {
    if (source === 'report') await service.refresh()
    const { text, lines } = service.getText(source)
    clipboard.writeText(text)
    return { lines }
  })

  handle(ipcMain, 'diag:export', async () => {
    await service.refresh()
    const { text, fileName } = service.getExport()
    const parent = BrowserWindow.getFocusedWindow()
    const options: Electron.SaveDialogOptions = {
      title: t('merr.dialog.exportTitle'),
      defaultPath: fileName,
      filters: [{ name: t('merr.dialog.textFilter'), extensions: ['txt'] }]
    }
    const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return { saved: false }
    await writeFile(r.filePath, text, { encoding: 'utf8', mode: 0o600 })
    // `mode` solo cuenta al crear el archivo: si ya existía, se deja en 0600 igualmente.
    await chmod(r.filePath, 0o600)
    return { saved: true }
  })
}
