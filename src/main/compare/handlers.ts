/**
 * Canales IPC `compare:*` (solo la ventana principal; el celular los tiene prohibidos, clase 'X').
 * El renderer pasa ids e índices; las rutas y las ramas las decide y guarda `CompareService`.
 */
import { app, dialog, type BrowserWindow, type IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CODE_EVENTS, type CodeInvokeContract } from '@shared/ipc-code'
import type { OpencodeConnection } from '@shared/types'
import { t } from '@shared/i18n'
import { makeInvokeHandler } from '../ipc/handle'
import { publishTo } from '../ipc/event-bus'
import { createSdkEngine } from './engine'
import { CompareGitError } from './git'
import { ManifestStore } from './manifest'
import { CompareError, CompareService } from './service'

export interface CompareHandlerDeps {
  getMainConnection: () => Promise<Pick<OpencodeConnection, 'baseUrl' | 'authorization'>>
  getMainWindow: () => BrowserWindow | null
  chatDirectory: string
  /** Versión del motor (para la exportación); `null` si no se conoce. */
  cliVersion?: () => string | null
}

const on = makeInvokeHandler<CodeInvokeContract>({
  withCode: true,
  silent: (err) => err instanceof CompareError || err instanceof CompareGitError
})

export function registerCompareHandlers(ipcMain: IpcMain, deps: CompareHandlerDeps): CompareService {
  const svc = new CompareService({
    store: new ManifestStore(join(app.getPath('userData'), 'compare')),
    engine: async () => createSdkEngine(await deps.getMainConnection()),
    chatDirectory: deps.chatDirectory,
    cliVersion: deps.cliVersion,
    onChange: (m) => {
      const win = deps.getMainWindow()
      if (win) publishTo(win, CODE_EVENTS.compareChanged, m)
    }
  })

  on(ipcMain, 'compare:list', () => svc.list())
  on(ipcMain, 'compare:preflight', (r) => svc.preflight(r.cwd))
  on(ipcMain, 'compare:start', (r) => svc.start(r))
  on(ipcMain, 'compare:cancel', (r) => svc.cancel(r.id, r.index))
  on(ipcMain, 'compare:retry', (r) => svc.retry(r.id, r.index))
  on(ipcMain, 'compare:diff', (r) => svc.diff(r.id, r.index))
  on(ipcMain, 'compare:adopt', (r) => svc.adopt(r.id, r.index, r.force === true))
  on(ipcMain, 'compare:discard', (r) => svc.discard(r.id, r.index))
  on(ipcMain, 'compare:close', (r) => svc.close(r.id))
  on(ipcMain, 'compare:exportBench', async (r) => {
    const { fileName, json } = await svc.buildBench(r.id)
    // La ruta sale SOLO del diálogo nativo: el renderer no la manda nunca.
    const win = deps.getMainWindow()
    const opts = {
      title: t('merr.compare.exportTitle'),
      defaultPath: join(app.getPath('documents'), fileName),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, json, { encoding: 'utf8', mode: 0o600 })
    return { path: res.filePath }
  })

  // Recuperación al arrancar: marca lo interrumpido y poda worktrees huérfanos; no borra nada.
  void svc.recover().catch((err: unknown) => console.warn('[compare] recuperación', err))
  app.on('will-quit', () => svc.dispose())
  return svc
}
