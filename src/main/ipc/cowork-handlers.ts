/**
 * Handlers IPC de Cowork (`cowork:*`), Rutinas (`routines:*`) y computer use (`computer:*`).
 * Contrato en src/shared/ipc-cowork.ts; expuesto en `window.api.cowork`.
 */
import { BrowserWindow, Notification, dialog, shell, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '@shared/ipc'
import type {
  CoworkEventChannel,
  CoworkEventContract,
  CoworkInvokeChannel,
  CoworkRequest,
  CoworkResponse
} from '@shared/ipc-cowork'
import { CoworkManager } from '../cowork/manager'
import { importFilesInto, previewFile } from '../cowork/files'
import { assertSafeToOpen } from '../cowork/open-policy'
import { CoworkProjectsStore, deleteMemory, getMemory, saveMemory } from '../cowork/projects'
import { KeepAwakeService } from '../cowork/keep-awake'
import { ComputerService } from '../computer/service'
import { ComputerOverlay } from '../computer/overlay'
import { abortFullAccessSessions } from '../computer/abort'
import { SchedulerService, type SchedulerDeps } from '../scheduler/service'
import { previewSchedule } from '../scheduler/schedule'
import { guardInvoke, IpcGuardError } from './guard'

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
  computer: ComputerService
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
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<CoworkResponse<C>>> => {
    try {
      const req = guardInvoke(event, channel, args) as CoworkRequest<C>
      return { ok: true, data: await fn(req, event) }
    } catch (err) {
      if (err instanceof IpcGuardError) return { ok: false, code: err.kind, error: err.message }
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
  const projects = new CoworkProjectsStore()
  const keepAwake = new KeepAwakeService()
  const computer = new ComputerService()
  // Overlay "la IA está controlando tu Mac" (borde, onda de clics, píldora con Detener).
  const overlay = new ComputerOverlay({
    instant: computer.instant,
    hideOnCapture: process.env.OPENDESK_OVERLAY_HIDE_ON_CAPTURE === '1'
  })
  computer.captureGuard = () => overlay.beforeCapture()
  const cowork = new CoworkManager({
    corsOrigins: deps.corsOrigins,
    computer: { mcpConfig: () => computer.mcpConfig(), info: () => computer.info(), planGateUrl: () => computer.planGateUrl() }
  })
  // Kill-switch desde main: aborta las sesiones de TODOS los servidores de acceso total (y detiene
  // el servidor si no responde), sin depender de la vista que muestre el renderer.
  computer.abortSessions = () =>
    abortFullAccessSessions(cowork.fullAccessConnections(), (srv) => cowork.stop(srv.folder, true))
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

  // ── Item 5: Lapis nunca se bloquea a sí misma y se aparta de en medio mientras el agente actúa ──
  // Mientras una tarea de acceso total está trabajando, la ventana principal se minimiza (la
  // píldora + el overlay siguen visibles): así nunca queda en primer plano robándole el foco a
  // Spotlight/la app que el agente está usando, y el usuario ve el escritorio real, no Lapis. Se
  // restaura sola al terminar, si hay un error, al pulsar Detener, o si el usuario la necesita
  // (p.ej. abre la tarjeta "Editar" desde la píldora). Solo restaura si fue ELLA quien minimizó
  // (no toca una minimización manual del usuario).
  let minimizedByFullAccess = false
  const hideMainWindowForTask = (): void => {
    const win = getWindow()
    if (!win || win.isDestroyed() || win.isMinimized()) return
    minimizedByFullAccess = true
    win.minimize()
  }
  const restoreMainWindowIfHidden = (opts: { focus?: boolean } = {}): void => {
    if (!minimizedByFullAccess) return
    minimizedByFullAccess = false
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    if (opts.focus) win.focus()
  }

  cowork.on('server', (info) => {
    send('cowork:server', info)
    if (info.fullAccess && (info.state === 'stopped' || info.state === 'error')) {
      overlay.serverGone()
      restoreMainWindowIfHidden()
    }
  })
  cowork.on('networkBlocked', (ev) => send('cowork:networkBlocked', ev))
  scheduler.on('changed', (list) => send('routines:changed', list))
  scheduler.on('run', (run) => send('routines:run', run))
  computer.on('action', (ev) => {
    send('computer:action', ev)
    overlay.handleAction(ev)
  })
  computer.on('killState', (st) => send('computer:killState', st))
  computer.on('stopped', (ev) => {
    send('computer:stopped', ev)
    overlay.stopped()
    restoreMainWindowIfHidden()
  })
  // Tarjeta "¿Permitir que el agente use X?" (herramienta MCP request_access): se difunde a todas
  // las ventanas (la principal, secundaria) y a la píldora (primaria, ver overlay.ts);
  // `computer:respondAccess` la resuelve. Además, notificación nativa con acción "Revisar" (si el
  // usuario no tiene el foco en Lapis) y aviso a la píldora para el estado "Esperando tu permiso".
  computer.on('requestAccess', (req) => {
    send('computer:accessRequest', req)
    overlay.showAccessRequest(req)
    try {
      const n = new Notification({
        title: req.plan ? 'Plan y permisos pendientes' : '¿Permitir que el agente use estas apps?',
        body: req.apps.map((a) => a.name).join(', ') + (req.reason ? ` — ${req.reason}` : ''),
        actions: process.platform === 'darwin' ? [{ type: 'button', text: 'Revisar' }] : undefined
      })
      n.on('click', () => restoreMainWindowIfHidden({ focus: true }))
      n.on('action', () => restoreMainWindowIfHidden({ focus: true }))
      n.show()
    } catch (err) {
      console.error('[computer] notificación de request_access:', err)
    }
  })
  computer.on('requestAccessResolved', () => overlay.clearAccessRequest())
  // Tras los listeners: si el atajo global no se registra, `killState` llega a la UI (que además
  // lo consulta con `computer:state` al montar Cowork, por si la ventana aún no existía).
  computer.init()

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
  handle(ipcMain, 'cowork:start', ({ folder, fullAccess }) => cowork.start(folder, fullAccess === true))
  handle(ipcMain, 'cowork:grantFullAccess', ({ folder }) => cowork.grantFullAccess(folder))
  handle(ipcMain, 'cowork:revokeFullAccess', ({ folder }) => cowork.revokeFullAccess(folder))
  handle(ipcMain, 'cowork:stop', ({ folder, fullAccess }) => cowork.stop(folder, fullAccess))
  handle(ipcMain, 'cowork:servers', () => cowork.listServers())
  handle(ipcMain, 'cowork:deliverables', ({ folder, since }) => cowork.deliverables(folder, since))
  handle(ipcMain, 'cowork:reveal', ({ path }) => {
    shell.showItemInFolder(cowork.assertInsideApproved(path))
  })
  handle(ipcMain, 'cowork:openPath', async ({ path }) => {
    const real = cowork.assertInsideApproved(path)
    assertSafeToOpen(real) // ejecutables/lanzadores: solo "Mostrar en Finder" (S4)
    const err = await shell.openPath(real)
    if (err) throw new Error(err)
  })
  handle(ipcMain, 'cowork:importFiles', async ({ folder }, event) => {
    const root = cowork.assertInsideApproved(folder)
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Adjuntar archivos a la tarea',
      buttonLabel: 'Adjuntar',
      message: 'Los archivos se copiarán a la carpeta de Cowork.',
      properties: ['openFile', 'multiSelections']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled) return []
    return importFilesInto(root, res.filePaths)
  })
  handle(ipcMain, 'cowork:previewFile', ({ path, maxBytes }) => previewFile(cowork.assertInsideApproved(path), maxBytes))

  // ── Proyecto (por carpeta) y memoria ──
  handle(ipcMain, 'cowork:project:get', ({ folder }) => projects.get(cowork.assertInsideApproved(folder)))
  handle(ipcMain, 'cowork:project:save', ({ folder, name, instructions }) =>
    projects.save(cowork.assertInsideApproved(folder), { name, instructions })
  )
  handle(ipcMain, 'cowork:memory:get', ({ folder }) => getMemory(cowork.assertInsideApproved(folder)))
  handle(ipcMain, 'cowork:memory:save', ({ folder, content }) => saveMemory(cowork.assertInsideApproved(folder), content))
  handle(ipcMain, 'cowork:memory:delete', ({ folder }) => deleteMemory(cowork.assertInsideApproved(folder)))

  // ── Red de Cowork (egress) ──
  handle(ipcMain, 'cowork:network:state', () => cowork.networkState())
  handle(ipcMain, 'cowork:network:setToggle', ({ key, value }) => cowork.networkSetToggle(key, value))
  handle(ipcMain, 'cowork:network:setHost', ({ host, decision }) => cowork.networkSetHost(host, decision))
  handle(ipcMain, 'cowork:network:allowOnce', ({ folder, host }) => {
    cowork.networkAllowOnce(cowork.assertInsideApproved(folder), host)
  })

  // ── Borrado (Seatbelt file-write-unlink) ──
  handle(ipcMain, 'cowork:deleteGrant:get', ({ folder }) => cowork.hasDeleteGrant(cowork.assertInsideApproved(folder)))
  handle(ipcMain, 'cowork:deleteGrant:set', async ({ folder, allowed }) => {
    const f = cowork.assertInsideApproved(folder)
    await cowork.setDeleteGrant(f, allowed)
    return cowork.hasDeleteGrant(f)
  })

  // ── Rutinas ──
  handle(ipcMain, 'routines:list', () => scheduler.list())
  handle(ipcMain, 'routines:save', (input) => scheduler.saveRoutine(input))
  handle(ipcMain, 'routines:delete', ({ id }) => scheduler.delete(id))
  handle(ipcMain, 'routines:toggle', ({ id, enabled }) => scheduler.toggle(id, enabled))
  handle(ipcMain, 'routines:runNow', ({ id }) => scheduler.runNow(id))
  handle(ipcMain, 'routines:history', (req) => scheduler.history(req?.id, req?.limit))
  handle(ipcMain, 'routines:preview', ({ schedule }) => previewSchedule(schedule, 3))

  // ── Computer use ──
  handle(ipcMain, 'computer:status', () => computer.status())
  handle(ipcMain, 'computer:requestPermissions', () => computer.requestPermissions())
  handle(ipcMain, 'computer:stop', async () => {
    await computer.stop()
  })
  handle(ipcMain, 'computer:resume', () => computer.resume())
  handle(ipcMain, 'computer:state', () => computer.state())
  // Plan → Aprobar → Ejecutar: una tarea de acceso total que empieza a trabajar solo "pide" el
  // modo control; el borde, la píldora de control y la minimización de Lapis llegan recién
  // cuando el usuario aprueba el plan (evento `planApproved`).
  let sessionWanted: { label?: string } | null = null
  const enterControlMode = (): void => {
    if (!sessionWanted) return
    overlay.setSession(true, sessionWanted.label)
    hideMainWindowForTask()
  }
  computer.on('planApproved', enterControlMode)
  handle(ipcMain, 'computer:session', (req) => {
    const active = req?.active === true
    if (active) {
      sessionWanted = { label: typeof req?.label === 'string' ? req.label : undefined }
      if (computer.isPlanApproved()) enterControlMode()
    } else {
      sessionWanted = null
      overlay.setSession(false)
      restoreMainWindowIfHidden()
      // Cada tarea nueva necesita su propio plan aprobado (flujo Plan → Aprobar → Ejecutar).
      computer.resetPlanApproval()
    }
  })
  // ── Concesión por app ──
  handle(ipcMain, 'computer:grants', () => computer.grants.snapshot())
  handle(ipcMain, 'computer:setGrant', ({ bundleId, name, tier }) => {
    computer.grants.grant(bundleId, name, tier)
    return computer.grants.snapshot()
  })
  handle(ipcMain, 'computer:revokeGrant', ({ bundleId }) => {
    computer.grants.revoke(bundleId)
    return computer.grants.snapshot()
  })
  handle(ipcMain, 'computer:denyApp', ({ bundleId, name }) => {
    computer.grants.deny(bundleId)
    // El nombre no se usa al denegar (no hay AppGrant para una app denegada), pero se valida igual.
    void name
    return computer.grants.snapshot()
  })
  handle(ipcMain, 'computer:undenyApp', ({ bundleId }) => {
    computer.grants.undeny(bundleId)
    return computer.grants.snapshot()
  })
  handle(ipcMain, 'computer:respondAccess', ({ id, decisions, feedback }) => {
    computer.resolveAccessRequest(id, decisions, feedback)
  })
  handle(ipcMain, 'computer:showMainWindow', () => {
    restoreMainWindowIfHidden({ focus: true })
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // ── Mantener el Mac despierto ──
  handle(ipcMain, 'cowork:keepAwakeState', () => keepAwake.state())
  handle(ipcMain, 'cowork:keepAwakeSetting', ({ enabled }) => keepAwake.setEnabled(enabled))
  handle(ipcMain, 'cowork:keepAwakeActive', ({ active }) => keepAwake.setActive(active))

  scheduler.start()

  return {
    cowork,
    computer,
    scheduler,
    shutdown: async () => {
      scheduler.stop()
      await cowork.stopAll()
      overlay.dispose()
      computer.dispose()
      keepAwake.dispose()
    },
    killSync: () => cowork.killAllSync()
  }
}
