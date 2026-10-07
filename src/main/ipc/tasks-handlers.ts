/**
 * Handlers IPC de Tareas (`tasks:*`), Rutinas (`routines:*`) y computer use (`computer:*`).
 * Contrato en src/shared/ipc-tasks.ts; expuesto en `window.api.tasks`.
 */
import { t } from '@shared/i18n'
import { type BrowserWindow, dialog, shell, type IpcMain } from 'electron'
import type { TasksEventChannel, TasksEventContract } from '@shared/ipc-tasks'
import type { NotifyTarget } from '@shared/types'
import { settingsStore } from '../store'
import { TasksManager } from '../tasks/manager'
import { importFilesInto, previewFile } from '../tasks/files'
import { assertSafeToOpen } from '../tasks/open-policy'
import { TasksProjectsStore, deleteMemory, getMemory, saveMemory } from '../tasks/projects'
import { KeepAwakeService } from '../tasks/keep-awake'
import type { ComputerService } from '../computer/service'
import type { WinBackendProvider } from '../tasks/backends'
import { createComputerParts, wireComputer } from './tasks-computer-wiring'
import { SchedulerService, type SchedulerDeps } from '../scheduler/service'
import { registerRoutineChannels } from './routines-handlers'
import { emit, emitTo } from './event-bus'
import { makeTasksHandle, type TasksIpcContext, type TasksSubmodule } from './tasks-handle'
import { registerTasksFoldersHandlers } from './tasks-folders-handlers'
import { registerTasksLifecycleHandlers } from './tasks-lifecycle-handlers'
import { registerTasksProjectHandlers } from './tasks-project-handlers'
import { registerTasksFilesHandlers } from './tasks-files-handlers'
import { registerTasksAutoHandlers } from './tasks-auto-handlers'
import { registerTasksSandboxHandlers } from './tasks-sandbox-handlers'
import { createRestorePoints, registerTasksRestoreHandlers } from './tasks-restore-handlers'
import { windowOfSender } from './sender-window'

export interface TasksHandlerDeps {
  /** Conexión al sidecar principal (p.ej. `() => server.start()`). */
  getMainConnection: SchedulerDeps['getMainConnection']
  /** userData/chat-workspace. */
  chatDirectory: string
  /** Orígenes CORS extra para los servidores de Tareas (dev server de Vite). */
  corsOrigins?: string[]
  /**
   * ¿Hay Control del PC (`caps.computer`)? Ausente = sí (macOS, como siempre). Con `false` NO se construye ni se cablea nada
   * de `computer:*` (helper nativo, overlay, atajo global, grabadora…): los stubs de `unsupported-handlers` los cubren.
   */
  computer?: boolean
  /** Bandera efectiva `tasksWin` y proveedor del backend de Windows (los calcula `main/index.ts`). */
  tasksWin?: boolean
  /** Bandera efectiva `computerWin` (Control del PC en Windows; solo con `tasksWin` y el helper). */
  computerWin?: boolean
  winBackend?: WinBackendProvider
}

export interface TasksModule {
  tasks: TasksManager
  /** Ausente sin Control del PC (`caps.computer` apagada). */
  computer?: ComputerService
  scheduler: SchedulerService
  /** Llamar en before-quit. */
  shutdown: () => Promise<void>
  /** Nº de tareas en curso ahora mismo (para confirmar al salir). */
  busyTaskCount: () => number
  /** Llamar en process.on('exit'). */
  killSync: () => void
}

/**
 * Registra los canales `tasks:*` y `routines:*`, crea el gestor de Tareas y arranca el
 * scheduler. Devuelve el módulo para apagarlo al salir.
 */
export function registerTasksHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, deps: TasksHandlerDeps): TasksModule {
  const projects = new TasksProjectsStore()
  const keepAwake = new KeepAwakeService()
  const cu = deps.computer === false ? null : createComputerParts()
  const computer = cu?.computer
  const tasks = new TasksManager({
    corsOrigins: deps.corsOrigins,
    computer: computer
      ? { mcpConfig: () => computer.mcpConfig(), info: () => computer.info(), planGateUrl: () => computer.planGateUrl() }
      : undefined,
    tasksWin: deps.tasksWin,
    computerWin: deps.computerWin,
    winBackend: deps.winBackend
  })
  // Abre una tarea/sesión en la ventana principal (clic en una notificación): la trae al frente y
  // avisa al renderer con `app:openTarget` (mismo canal que usa `ipc/notify.ts`).
  const openTarget = (target: NotifyTarget): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    emitTo(win, 'app:openTarget', target)
  }
  const scheduler = new SchedulerService({
    getMainConnection: deps.getMainConnection,
    chatDirectory: deps.chatDirectory,
    tasks,
    projects,
    getSettings: () => settingsStore.get(),
    openTarget
  })

  const send = <C extends TasksEventChannel>(channel: C, payload: TasksEventContract[C]): void => {
    emit(channel, payload)
  }

  // Contexto compartido con los submódulos de handlers (carpetas, ciclo de vida, proyecto, archivos).
  const handle = makeTasksHandle(ipcMain)
  const ctx: TasksIpcContext = {
    handle,
    send,
    getWindow,
    tasks,
    computer,
    scheduler,
    projects,
    keepAwake,
    restore: createRestorePoints(),
    isFolderBusy: () => false,
    busyTaskCount: () => 0
  }

  tasks.on('server', (info) => send('tasks:server', info))
  tasks.on('networkBlocked', (ev) => send('tasks:networkBlocked', ev))
  scheduler.on('changed', (list) => send('routines:changed', list))
  scheduler.on('run', (run) => send('routines:run', run))

  // ── Tareas ──
  handle('tasks:pickFolder', async (_req, event) => {
    const win = windowOfSender(event.sender) ?? getWindow()
    const options: Electron.OpenDialogOptions = {
      title: t('merr.dialog.pickFolder'),
      buttonLabel: t('merr.dialog.pick'),
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle('tasks:listFolders', () => tasks.listFolders())
  handle('tasks:approveFolder', async ({ folder }) => {
    await tasks.refreshPolicy() // Windows: unidades al día antes de decidir (macOS: sin efecto)
    return tasks.approveFolder(folder)
  })
  handle('tasks:removeFolder', ({ folder }) => tasks.removeFolder(folder))
  handle('tasks:start', ({ folder, fullAccess }) => tasks.start(folder, fullAccess === true))
  handle('tasks:grantFullAccess', ({ folder }) => tasks.grantFullAccess(folder))
  handle('tasks:revokeFullAccess', ({ folder }) => tasks.revokeFullAccess(folder))
  handle('tasks:fullAccess:state', () => tasks.fullAccessState())
  handle('tasks:fullAccess:consent', () => {
    tasks.grantFullAccessConsent()
    return tasks.fullAccessState()
  })
  handle('tasks:fullAccess:revokeAll', async () => {
    await tasks.revokeFullAccessConsent()
    return tasks.fullAccessState()
  })
  handle('tasks:deliverables', ({ folder, since }) => tasks.deliverables(folder, since))
  handle('tasks:reveal', ({ path }) => {
    shell.showItemInFolder(tasks.assertInsideApproved(path))
  })
  handle('tasks:openPath', async ({ path }) => {
    const real = tasks.assertInsideApproved(path)
    assertSafeToOpen(real) // ejecutables/lanzadores: solo "Mostrar en Finder" (S4)
    const err = await shell.openPath(real)
    if (err) throw new Error(err)
  })
  handle('tasks:importFiles', async ({ folder }, event) => {
    const root = tasks.assertInsideApproved(folder)
    const win = windowOfSender(event.sender) ?? getWindow()
    const options: Electron.OpenDialogOptions = {
      title: t('merr.dialog.attachTitle'),
      buttonLabel: t('merr.dialog.attachButton'),
      message: t('merr.dialog.attachMessage'),
      properties: ['openFile', 'multiSelections']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled) return []
    return importFilesInto(root, res.filePaths)
  })
  handle('tasks:previewFile', ({ path, maxBytes }) => previewFile(tasks.assertInsideApproved(path), maxBytes))

  // ── Proyecto (por carpeta) y memoria ──
  handle('tasks:project:get', ({ folder }) => projects.get(tasks.assertInsideApproved(folder)))
  // `rest` lleva también `links` y `memoryEnabled` (Lote B): `projects.save` los toma cuando W2-D los soporte.
  handle('tasks:project:save', ({ folder, ...rest }) => projects.save(tasks.assertInsideApproved(folder), rest))
  handle('tasks:memory:get', ({ folder }) => getMemory(tasks.assertInsideApproved(folder)))
  handle('tasks:memory:save', ({ folder, content }) => saveMemory(tasks.assertInsideApproved(folder), content))
  handle('tasks:memory:delete', ({ folder }) => deleteMemory(tasks.assertInsideApproved(folder)))

  // ── Red de Tareas (egress) ──
  handle('tasks:network:state', () => tasks.networkState())
  handle('tasks:network:setToggle', ({ key, value }) => tasks.networkSetToggle(key, value))
  handle('tasks:network:setHost', ({ host, decision }) => tasks.networkSetHost(host, decision))
  handle('tasks:network:allowOnce', ({ folder, host }) => {
    tasks.networkAllowOnce(tasks.assertInsideApproved(folder), host)
  })

  // ── Borrado (Seatbelt file-write-unlink) ──
  handle('tasks:deleteGrant:get', ({ folder }) => tasks.hasDeleteGrant(tasks.assertInsideApproved(folder)))
  handle('tasks:deleteGrant:set', async ({ folder, allowed }) => {
    const f = tasks.assertInsideApproved(folder)
    await tasks.setDeleteGrant(f, allowed)
    return tasks.hasDeleteGrant(f)
  })

  // ── Rutinas ──
  registerRoutineChannels(handle, scheduler)

  // ── Mantener el Mac despierto ──
  handle('tasks:keepAwakeState', () => keepAwake.state())
  handle('tasks:keepAwakeSetting', ({ enabled }) => keepAwake.setEnabled(enabled))
  handle('tasks:keepAwakeActive', ({ active }) => keepAwake.setActive(active))

  // ── Computer use (solo con `caps.computer`) ──
  const computerWiring = cu ? wireComputer(cu, { tasks, send, handle, getWindow }) : null

  // ── Lote B/C: submódulos (carpetas, ciclo de vida, proyecto/MCP/reglas, archivos, Modo auto) ──
  const submodules: TasksSubmodule[] = [
    registerTasksFoldersHandlers(ctx),
    registerTasksLifecycleHandlers(ctx),
    registerTasksProjectHandlers(ctx),
    registerTasksFilesHandlers(ctx),
    registerTasksAutoHandlers(ctx),
    registerTasksRestoreHandlers(ctx),
    registerTasksSandboxHandlers(ctx, { tasksWin: deps.tasksWin, winBackend: deps.winBackend })
  ]

  scheduler.start()

  return {
    tasks,
    computer,
    scheduler,
    shutdown: async () => {
      scheduler.stop()
      // Los submódulos (p.ej. el monitor) se detienen antes de parar los servidores.
      await Promise.all(submodules.map((m) => Promise.resolve(m.dispose?.()).catch((err) => console.error('[tasks] dispose:', err))))
      await tasks.stopAll()
      computerWiring?.dispose()
      keepAwake.dispose()
    },
    busyTaskCount: () => ctx.busyTaskCount(),
    killSync: () => tasks.killAllSync()
  }
}
