/**
 * Handlers IPC de extras (`extras:*`, `mcp:*`). Registrar en main con:
 *   registerExtrasHandlers(ipcMain, { server, createMainWindow, getMainWindow })
 * Además inicializa atajo global de Quick Entry y bandeja (idempotente).
 */
import { app, shell, type IpcMain } from 'electron'
import { release } from 'node:os'
import type { IpcExtrasInvokeContract } from '@shared/ipc-extras'
import type { OpencodeServer } from '../opencode/server'
import { broadcastExtras, getPrefsState, initExtras } from '../extras'
import { openArtifact } from '../extras/artifact-window'
import { ensureAppOpencodeConfig, readAppMcpConfig, removeMcpServer, saveMcpServer, setMcpServerEnabled } from '../extras/mcp-config'
import { extrasPrefs } from '../extras/prefs'
import {
  deliverQuickPrompt,
  hideQuickEntry,
  registerQuickEntryShortcut,
  takePendingPrompt,
  toggleQuickEntry,
  unregisterQuickEntryShortcut
} from '../extras/quick-entry'
import type { MainWindowDeps } from '../extras/windows'
import { makeInvokeHandler } from './handle'

export interface ExtrasDeps extends MainWindowDeps {
  server: OpencodeServer
}

const handle = makeInvokeHandler<IpcExtrasInvokeContract>({ withCode: false })

/**
 * Recarga la config del sidecar sin reiniciar el proceso (`POST /global/dispose`).
 * Verificado: tras editar el archivo de OPENCODE_CONFIG, `/mcp` refleja los cambios.
 */
async function reloadOpencodeConfig(server: OpencodeServer): Promise<void> {
  const conn = server.getConnection()
  if (!conn) return
  try {
    const res = await fetch(`${conn.baseUrl}/global/dispose`, {
      method: 'POST',
      headers: { authorization: conn.authorization },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) console.warn(`[extras] /global/dispose respondió ${res.status}`)
  } catch (err) {
    console.warn('[extras] no se pudo recargar la config de OpenCode:', err)
  }
}

export function registerExtrasHandlers(ipcMain: IpcMain, deps: ExtrasDeps): void {
  ensureAppOpencodeConfig()

  handle(ipcMain, 'extras:getPrefs', () => getPrefsState())
  handle(ipcMain, 'extras:setPrefs', (patch) => {
    extrasPrefs.set(patch ?? {})
    return getPrefsState()
  })
  handle(ipcMain, 'extras:versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: release()
  }))
  handle(ipcMain, 'extras:openArtifact', (payload) => {
    if (!payload || typeof payload.html !== 'string') throw new Error('Artifact sin HTML')
    openArtifact({ title: String(payload.title ?? ''), html: payload.html })
  })
  handle(ipcMain, 'extras:quickSubmit', (req) => {
    if (!req || typeof req.text !== 'string') throw new Error('Prompt inválido')
    deliverQuickPrompt(deps, { text: req.text })
  })
  handle(ipcMain, 'extras:quickHide', () => hideQuickEntry())
  handle(ipcMain, 'extras:quickToggle', () => toggleQuickEntry())
  handle(ipcMain, 'extras:suspendShortcut', ({ suspended }) => {
    if (suspended) unregisterQuickEntryShortcut()
    else registerQuickEntryShortcut(extrasPrefs.get().quickEntryShortcut)
  })
  handle(ipcMain, 'extras:takePendingPrompt', () => takePendingPrompt())

  const afterMcpChange = async (): Promise<ReturnType<typeof readAppMcpConfig>> => {
    const cfg = readAppMcpConfig()
    await reloadOpencodeConfig(deps.server)
    broadcastExtras('mcp:changed', cfg)
    return cfg
  }

  handle(ipcMain, 'mcp:getConfig', () => readAppMcpConfig())
  handle(ipcMain, 'mcp:save', async ({ name, entry, previousName }) => {
    saveMcpServer(name, entry, previousName)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:remove', async ({ name }) => {
    removeMcpServer(name)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:setEnabled', async ({ name, enabled }) => {
    setMcpServerEnabled(name, enabled)
    return afterMcpChange()
  })
  handle(ipcMain, 'mcp:revealConfig', () => {
    shell.showItemInFolder(ensureAppOpencodeConfig())
  })

  initExtras(deps)
}
