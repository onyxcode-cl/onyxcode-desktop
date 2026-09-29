/**
 * Handlers de actividad, tareas, preferencias y almacenamiento
 * (`tasks:activity`, `tasks:viewing`, `tasks:tasks:*`, `tasks:prefs:*`, `tasks:storage:*`).
 *
 * Aquí vive el `CoworkMonitor` (sondeo de todos los servidores vivos, ver `cowork/monitor.ts`):
 * este archivo le inyecta lo que depende de Electron (notificaciones, ventana, mantener despierto,
 * parada de servidores, revocar planes al archivar) y reenvía su actividad al renderer.
 */
import { app, Notification } from 'electron'
import { realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { CoworkActivitySnapshot } from '@shared/ipc-tasks'
import type { NotifyTarget } from '@shared/types'
import { CoworkMonitor, type MonitorNotifyEvent, type MonitorWindowState } from '../tasks/monitor'
import { getAutoApprover } from '../tasks/auto-approver'
import { CoworkPrefsStore } from '../tasks/prefs'
import { CoworkTasksStore } from '../tasks/tasks-meta'
import { storageClean, storageReport, type StorageEnv } from '../tasks/storage'
import { loadManagedPolicy } from '../tasks/policy'
import { sandboxKey } from '../tasks/sandbox'
import { extrasPrefs } from '../extras/prefs'
import type { CoworkIpcContext, CoworkSubmodule } from './tasks-handle'

/** Tiempo sin tareas de Control total en curso antes de borrar las capturas temporales. */
const SCREENSHOT_CLEAN_DELAY_MS = 60_000

function realOrResolved(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

const NOTIFY_TEXT: Record<MonitorNotifyEvent['kind'], string> = {
  done: 'Tarea terminada',
  approval: 'Una tarea espera tu aprobación',
  question: 'Una tarea tiene una pregunta',
  error: 'Una tarea terminó con un error'
}

export function registerCoworkLifecycleHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, send, getWindow, cowork, computer, keepAwake } = ctx
  const userData = app.getPath('userData')

  const prefs = new CoworkPrefsStore(join(userData, 'tasks-prefs.json'), {
    policyMaxAutoArchiveDays: () => loadManagedPolicy()?.maxAutoArchiveDays
  })
  const tasks = new CoworkTasksStore(join(userData, 'tasks-meta.json'))

  const windowState = (): MonitorWindowState => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return 'none'
    return win.isVisible() && !win.isMinimized() && win.isFocused() ? 'focused' : 'visible'
  }

  // Notificación nativa de una tarea en segundo plano; clic = traer la ventana y abrir la tarea.
  const notify = (ev: MonitorNotifyEvent): void => {
    const extras = extrasPrefs.get()
    if (!extras.notificationsEnabled || !Notification.isSupported()) return
    const label = ev.title.trim() || 'Tarea sin título'
    const n = new Notification({
      title: NOTIFY_TEXT[ev.kind],
      body: `${label} · ${basename(ev.folder)}`,
      silent: !extras.soundEnabled
    })
    n.on('click', () => {
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      const target: NotifyTarget = { mode: 'tasks', id: ev.sessionId, directory: ev.folder, fullAccess: ev.fullAccess }
      if (!win.webContents.isDestroyed()) win.webContents.send('app:openTarget', target)
    })
    n.show()
  }

  // Capturas temporales de Control total: se borran a los 60 s sin tareas de ese modo en curso.
  let shotTimer: ReturnType<typeof setTimeout> | null = null
  const syncScreenshotCleanup = (): void => {
    if (monitor.anyBusyFullAccess()) {
      if (shotTimer) clearTimeout(shotTimer)
      shotTimer = null
      return
    }
    if (shotTimer) return
    shotTimer = setTimeout(() => {
      shotTimer = null
      if (!monitor.anyBusyFullAccess()) computer.cleanScreenshots()
    }, SCREENSHOT_CLEAN_DELAY_MS)
    shotTimer.unref?.()
  }

  const monitor: CoworkMonitor = new CoworkMonitor({
    servers: () => cowork.liveServers(),
    stop: (folder, fullAccess) => cowork.stop(folder, fullAccess),
    prefs,
    tasks,
    notify,
    // Archivada = sin plan aprobado (la puerta de Control total vuelve a pedirlo).
    onArchived: (sessionId) => computer.revokePlan(sessionId),
    onActivity: (snap: CoworkActivitySnapshot) => {
      send('tasks:activity', snap)
      syncScreenshotCleanup()
    },
    onBusyChange: (busy) => {
      keepAwake.setActive(busy, 'monitor')
      syncScreenshotCleanup()
    },
    windowState,
    normalizeFolder: realOrResolved,
    // Lote C: Modo auto (paquete C3); si está desactivado o sin opt-in, no hace nada.
    onPermissions: (s, p) => void getAutoApprover()?.considerPermissions(s, p),
    log: (...args) => console.log(...args)
  })
  cowork.setBeforeSpawn((folder, fullAccess) => monitor.ensureCapacity(folder, fullAccess))
  monitor.start()

  const storageEnv = (): StorageEnv => ({ userData, screenshotsDir: computer.screenshotsDir, sandboxKey })
  const folderPaths = (): string[] => cowork.listFolders().map((f) => f.path)
  const report = () => storageReport(storageEnv(), folderPaths(), cowork.liveServers())

  handle('tasks:activity', () => monitor.snapshot())
  handle('tasks:viewing', ({ folder, fullAccess }) => {
    monitor.setViewing(folder, fullAccess)
  })
  handle('tasks:tasks:list', () => tasks.list())
  handle('tasks:tasks:setMeta', (req) => tasks.set(req))
  handle('tasks:tasks:forget', ({ sessionId }) => {
    tasks.forget(sessionId)
  })
  handle('tasks:prefs:get', () => prefs.get())
  handle('tasks:prefs:set', (patch) => prefs.set(patch))
  handle('tasks:storage:report', () => report())
  handle('tasks:storage:clean', ({ key, scope }) => storageClean(storageEnv(), folderPaths(), cowork.liveServers(), key, scope))
  handle('tasks:storage:cleanScreenshots', () => {
    computer.cleanScreenshots()
    return report()
  })

  return {
    dispose: () => {
      monitor.stop()
      cowork.setBeforeSpawn(null)
      keepAwake.setActive(false, 'monitor')
      if (shotTimer) clearTimeout(shotTimer)
      shotTimer = null
    }
  }
}
