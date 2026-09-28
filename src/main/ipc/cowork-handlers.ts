/**
 * Handlers IPC de Cowork (`cowork:*`) y Rutinas (`routines:*`).
 * Contrato en src/shared/ipc-cowork.ts; expuesto en `window.api.cowork`.
 */
import { BrowserWindow, dialog, shell, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '@shared/ipc'
import type {
  CoworkEventChannel,
  CoworkEventContract,
  CoworkInvokeChannel,
  CoworkRequest,
  CoworkResponse
} from '@shared/ipc-cowork'
import { CoworkManager } from '../cowork/manager'
import { SchedulerService, type SchedulerDeps } from '../scheduler/service'
import { previewSchedule } from '../scheduler/schedule'

export interface CoworkHandlerDeps {
  /** Conexión al sidecar principal (p.ej. `() => server.start()`). */
  getMainConnection: SchedulerDeps['getMainConnection']
  /** userData/chat-workspace. */
  chatDirectory: string
  /** Orígenes CORS extra para los servidores de Cowork (dev server de Vite). */
  corsOrigins?: string[]
}

export interface CoworkModule {
  cowork: CoworkManager
  scheduler: SchedulerService
  /** Llamar en before-quit. */
  shutdown: () => Promise<void>
  /** Llamar en process.on('exit'). */
  killSync: () => void
}

type Handler<C extends CoworkInvokeChannel> = (
  req: CoworkRequest<C>,
  event: IpcMainInvokeEvent
) => CoworkResponse<C> | Promise<CoworkResponse<C>>

function handle<C extends CoworkInvokeChannel>(ipcMain: IpcMain, channel: C, fn: Handler<C>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, req: CoworkRequest<C>): Promise<IpcResult<CoworkResponse<C>>> => {
    try {
      return { ok: true, data: await fn(req, event) }
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, code: 'ERROR', error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/**
 * Registra los canales `cowork:*` y `routines:*`, crea el gestor de Cowork y arranca el
 * scheduler. Devuelve el módulo para apagarlo al salir.
 */
export function registerCoworkHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  deps: CoworkHandlerDeps
): CoworkModule {
  const cowork = new CoworkManager({ corsOrigins: deps.corsOrigins })
  const scheduler = new SchedulerService({
    getMainConnection: deps.getMainConnection,
    chatDirectory: deps.chatDirectory,
    cowork
  })

  const send = <C extends CoworkEventChannel>(channel: C, payload: CoworkEventContract[C]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
  cowork.on('server', (info) => send('cowork:server', info))
  scheduler.on('changed', (list) => send('routines:changed', list))
  scheduler.on('run', (run) => send('routines:run', run))

  // ── Cowork ──
  handle(ipcMain, 'cowork:pickFolder', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Elegir carpeta para Cowork',
      buttonLabel: 'Elegir',
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(ipcMain, 'cowork:listFolders', () => cowork.listFolders())
  handle(ipcMain, 'cowork:approveFolder', ({ folder }) => cowork.approveFolder(folder))
  handle(ipcMain, 'cowork:removeFolder', ({ folder }) => cowork.removeFolder(folder))
  handle(ipcMain, 'cowork:start', ({ folder }) => cowork.start(folder))
  handle(ipcMain, 'cowork:stop', ({ folder }) => cowork.stop(folder))
  handle(ipcMain, 'cowork:servers', () => cowork.listServers())
  handle(ipcMain, 'cowork:deliverables', ({ folder, since }) => cowork.deliverables(folder, since))
  handle(ipcMain, 'cowork:reveal', ({ path }) => {
    shell.showItemInFolder(cowork.assertInsideApproved(path))
  })
  handle(ipcMain, 'cowork:openPath', async ({ path }) => {
    const err = await shell.openPath(cowork.assertInsideApproved(path))
    if (err) throw new Error(err)
  })

  // ── Rutinas ──
  handle(ipcMain, 'routines:list', () => scheduler.list())
  handle(ipcMain, 'routines:save', (input) => scheduler.saveRoutine(input))
  handle(ipcMain, 'routines:delete', ({ id }) => scheduler.delete(id))
  handle(ipcMain, 'routines:toggle', ({ id, enabled }) => scheduler.toggle(id, enabled))
  handle(ipcMain, 'routines:runNow', ({ id }) => scheduler.runNow(id))
  handle(ipcMain, 'routines:history', (req) => scheduler.history(req?.id, req?.limit))
  handle(ipcMain, 'routines:preview', ({ schedule }) => previewSchedule(schedule, 3))

  scheduler.start()

  return {
    cowork,
    scheduler,
    shutdown: async () => {
      scheduler.stop()
      await cowork.stopAll()
    },
    killSync: () => cowork.killAllSync()
  }
}
