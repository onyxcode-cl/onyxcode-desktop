/**
 * Handlers IPC de Cowork (`cowork:*`), Rutinas (`routines:*`) y computer use (`computer:*`).
 * Contrato en src/shared/ipc-cowork.ts; expuesto en `window.api.cowork`.
 */
import { BrowserWindow, Notification, app, dialog, shell, type IpcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CoworkEventChannel, CoworkEventContract } from '@shared/ipc-cowork'
import type { NotifyTarget } from '@shared/types'
import { settingsStore } from '../store'
import { CoworkManager } from '../cowork/manager'
import { importFilesInto, previewFile } from '../cowork/files'
import { assertSafeToOpen } from '../cowork/open-policy'
import { CoworkProjectsStore, deleteMemory, getMemory, saveMemory } from '../cowork/projects'
import { KeepAwakeService } from '../cowork/keep-awake'
import { normalizeCoworkPrefs } from '../cowork/prefs'
import { extrasPrefs } from '../extras/prefs'
import { ComputerService } from '../computer/service'
import { ComputerOverlay } from '../computer/overlay'
import { AssistWindow } from '../computer/assist-window'
import { SkillRecorder } from '../computer/recorder'
import { AppVisibility } from '../computer/app-visibility'
import { SYSTEM_EXEMPT_BUNDLE_IDS } from '../computer/grants'
import { abortFullAccessSessions } from '../computer/abort'
import { getAutoApprover } from '../cowork/auto-approver'
import { SchedulerService, type SchedulerDeps } from '../scheduler/service'
import { previewSchedule } from '../scheduler/schedule'
import { makeCoworkHandle, type CoworkIpcContext, type CoworkSubmodule } from './cowork-handle'
import { registerCoworkFoldersHandlers } from './cowork-folders-handlers'
import { registerCoworkLifecycleHandlers } from './cowork-lifecycle-handlers'
import { registerCoworkProjectHandlers } from './cowork-project-handlers'
import { registerCoworkFilesHandlers } from './cowork-files-handlers'
import { registerCoworkAutoHandlers } from './cowork-auto-handlers'
import { registerCoworkBrowserHandlers } from './cowork-browser-handlers'

/**
 * ¿Debe salir la notificación nativa de una petición de permisos (`request_access`)?
 * Respeta el interruptor global de notificaciones y `prefs.notify.approval` de Cowork. Las
 * preferencias las gestiona `cowork-lifecycle-handlers.ts` (con caché en memoria); aquí se lee
 * el JSON en cada petición (sin caché, así siempre refleja el último cambio) y se normaliza con la
 * misma función. Ante cualquier fallo de lectura vale el valor por defecto (activada).
 */
function approvalNotificationsEnabled(): boolean {
  try {
    if (!extrasPrefs.get().notificationsEnabled) return false
  } catch {
    // sin preferencias globales legibles: se sigue con las de Cowork
  }
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'cowork-prefs.json'), 'utf8'))
  } catch {
    // archivo ausente o ilegible: valores por defecto
  }
  return normalizeCoworkPrefs(raw).notify.approval
}

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
  // Lote C: ventana "assist" (globo de Teach mode + píldora de grabar una skill), grabadora de
  // skills y ocultar/mostrar las demás apps mientras el agente controla la pantalla.
  const assist = new AssistWindow()
  const recorder = new SkillRecorder(() => computer.helperPath(), join(app.getPath('userData'), 'skill-recordings'))
  const appVisibility = new AppVisibility(() => computer.helperPath(), join(app.getPath('userData'), 'computer-hidden.json'))
  recorder.purgeOld()
  // Recuperación tras un crash: si quedó un archivo de una sesión anterior que no cerró bien, vuelve
  // a mostrar esas apps (independiente de `unhideOnFinish`: es limpieza, no una preferencia).
  void appVisibility.recoverAtStartup()
  // Modo auto (Lote C, C3): antes de mostrar la tarjeta `request_access`/`request_full_control`,
  // se le da la oportunidad de conceder "Solo ver" efímero sin preguntar (≤1,5 s, ver service.ts).
  computer.autoAccess = (q) => getAutoApprover()?.considerAccess(q) ?? Promise.resolve(null)
  /** Bundle ids que NUNCA se ocultan: apps con concesión, las exentas del sistema y Finder. */
  const keepVisibleBundleIds = (): string[] => [
    ...computer.grants.snapshot().grants.map((g) => g.bundleId),
    ...SYSTEM_EXEMPT_BUNDLE_IDS,
    'com.apple.finder'
  ]
  const maybeUnhideApps = (): void => {
    if (computer.prefs.get().unhideOnFinish) void appVisibility.unhide()
  }
  const cowork = new CoworkManager({
    corsOrigins: deps.corsOrigins,
    computer: { mcpConfig: () => computer.mcpConfig(), info: () => computer.info(), planGateUrl: () => computer.planGateUrl() }
  })
  // Kill-switch desde main: aborta las sesiones de TODOS los servidores de Control total (y detiene
  // el servidor si no responde), sin depender de la vista que muestre el renderer.
  computer.abortSessions = () =>
    abortFullAccessSessions(cowork.fullAccessConnections(), (srv) => cowork.stop(srv.folder, true))
  // Abre una tarea/sesión en la ventana principal (clic en una notificación): la trae al frente y
  // avisa al renderer con `app:openTarget` (mismo canal que usa `ipc/notify.ts`).
  const openTarget = (target: NotifyTarget): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (!win.webContents.isDestroyed()) win.webContents.send('app:openTarget', target)
  }
  const scheduler = new SchedulerService({
    getMainConnection: deps.getMainConnection,
    chatDirectory: deps.chatDirectory,
    cowork,
    projects,
    getSettings: () => settingsStore.get(),
    openTarget
  })

  const send = <C extends CoworkEventChannel>(channel: C, payload: CoworkEventContract[C]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  // Contexto compartido con los submódulos de handlers (carpetas, ciclo de vida, proyecto, archivos).
  const handle = makeCoworkHandle(ipcMain)
  const ctx: CoworkIpcContext = { handle, send, getWindow, cowork, computer, scheduler, projects, keepAwake }

  // ── Item 5: Lapis nunca se bloquea a sí misma y se aparta de en medio mientras el agente actúa ──
  // Mientras una tarea de Control total está trabajando, la ventana principal se minimiza (la
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
    maybeUnhideApps()
  })
  // Lote C: Teach mode (globo junto al elemento) y "Grabar una skill" (píldora arriba, bajo la de
  // control): la ventana `assist` los muestra; `computer:record*` además se difunden para que la
  // ventana principal pinte la tarjeta de revisión (`RecordSkill.tsx`, C5).
  computer.on('teachStep', (step) => assist.showTeach(step))
  computer.on('teachClear', () => assist.clearTeach())
  recorder.on('state', (st) => {
    assist.showRecording(st)
    send('computer:recordState', st)
  })
  recorder.on('done', (rec) => send('computer:recordDone', rec))
  // Un takeover aprobado (`request_full_control`) pone a esa sesión al mando del ratón y el
  // teclado en segundo plano: si "Ocultar las demás apps" está activo, se ocultan igual que en
  // Control total (B.7 del plan).
  computer.on('foreground', () => {
    if (computer.prefs.get().hideOtherApps) void appVisibility.hide(keepVisibleBundleIds())
  })
  // Tarjeta "¿Permitir que el agente use X?" (herramienta MCP request_access): se difunde a todas
  // las ventanas y a la píldora (que la muestra solo si la app no está al frente, ver overlay.ts);
  // `computer:respondAccess` la resuelve. Además, notificación nativa con acción "Revisar" (si el
  // usuario no tiene el foco en Lapis) y aviso a la píldora para el estado "Esperando tu permiso".
  // ¿La ventana principal está al frente? Entonces su tarjeta es la única (la píldora no la duplica);
  // si no (minimizada, oculta o el agente se llevó el foco a otra app), la píldora muestra la tarjeta.
  const mainIsFront = (): boolean => {
    const w = getWindow()
    return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
  }
  const boundWindows = new WeakSet<BrowserWindow>()
  const followMainFocus = (): void => {
    const w = getWindow()
    if (!w || w.isDestroyed() || boundWindows.has(w)) return
    boundWindows.add(w)
    const sync = (): void => overlay.setRequestFloating(!mainIsFront())
    w.on('focus', sync)
    w.on('blur', sync)
    w.on('minimize', sync)
    w.on('restore', sync)
    w.on('show', sync)
    w.on('hide', sync)
  }
  computer.on('requestAccess', (req) => {
    send('computer:accessRequest', req)
    followMainFocus()
    overlay.showAccessRequest(req, !mainIsFront())
    if (!approvalNotificationsEnabled()) return
    try {
      const n = new Notification({
        title: req.plan ? 'Plan y permisos pendientes' : '¿Permitir que el agente use estas apps?',
        body:
          (req.apps.length ? req.apps.map((a) => a.name).join(', ') : 'Plan sin apps (terminal, archivos o web)') +
          (req.reason ? ` — ${req.reason}` : ''),
        actions: process.platform === 'darwin' ? [{ type: 'button', text: 'Revisar' }] : undefined
      })
      n.on('click', () => restoreMainWindowIfHidden({ focus: true }))
      n.on('action', () => restoreMainWindowIfHidden({ focus: true }))
      n.show()
    } catch (err) {
      console.error('[computer] notificación de request_access:', err)
    }
  })
  // Resuelta (desde la ventana, la píldora o Detener): la píldora la cierra y las ventanas también
  // (si se respondió desde la píldora, la tarjeta de la ventana principal queda obsoleta).
  computer.on('requestAccessResolved', ({ id }) => {
    overlay.clearAccessRequest()
    send('computer:accessResolved', { id })
  })
  // Aprobación del plan por sesión (aprobado / revocado): el renderer pinta "Plan aprobado · Revocar".
  computer.on('planState', (st) => send('computer:planState', st))
  // Tras los listeners: si el atajo global no se registra, `killState` llega a la UI (que además
  // lo consulta con `computer:state` al montar Cowork, por si la ventana aún no existía).
  computer.init()

  // ── Cowork ──
  handle('cowork:pickFolder', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Elegir carpeta para Cowork',
      buttonLabel: 'Elegir',
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle('cowork:listFolders', () => cowork.listFolders())
  handle('cowork:approveFolder', ({ folder }) => cowork.approveFolder(folder))
  handle('cowork:removeFolder', ({ folder }) => cowork.removeFolder(folder))
  handle('cowork:start', ({ folder, fullAccess }) => cowork.start(folder, fullAccess === true))
  handle('cowork:grantFullAccess', ({ folder }) => cowork.grantFullAccess(folder))
  handle('cowork:revokeFullAccess', ({ folder }) => cowork.revokeFullAccess(folder))
  handle('cowork:stop', ({ folder, fullAccess }) => cowork.stop(folder, fullAccess))
  handle('cowork:servers', () => cowork.listServers())
  handle('cowork:deliverables', ({ folder, since }) => cowork.deliverables(folder, since))
  handle('cowork:reveal', ({ path }) => {
    shell.showItemInFolder(cowork.assertInsideApproved(path))
  })
  handle('cowork:openPath', async ({ path }) => {
    const real = cowork.assertInsideApproved(path)
    assertSafeToOpen(real) // ejecutables/lanzadores: solo "Mostrar en Finder" (S4)
    const err = await shell.openPath(real)
    if (err) throw new Error(err)
  })
  handle('cowork:importFiles', async ({ folder }, event) => {
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
  handle('cowork:previewFile', ({ path, maxBytes }) => previewFile(cowork.assertInsideApproved(path), maxBytes))

  // ── Proyecto (por carpeta) y memoria ──
  handle('cowork:project:get', ({ folder }) => projects.get(cowork.assertInsideApproved(folder)))
  // `rest` lleva también `links` y `memoryEnabled` (Lote B): `projects.save` los toma cuando W2-D los soporte.
  handle('cowork:project:save', ({ folder, ...rest }) => projects.save(cowork.assertInsideApproved(folder), rest))
  handle('cowork:memory:get', ({ folder }) => getMemory(cowork.assertInsideApproved(folder)))
  handle('cowork:memory:save', ({ folder, content }) => saveMemory(cowork.assertInsideApproved(folder), content))
  handle('cowork:memory:delete', ({ folder }) => deleteMemory(cowork.assertInsideApproved(folder)))

  // ── Red de Cowork (egress) ──
  handle('cowork:network:state', () => cowork.networkState())
  handle('cowork:network:setToggle', ({ key, value }) => cowork.networkSetToggle(key, value))
  handle('cowork:network:setHost', ({ host, decision }) => cowork.networkSetHost(host, decision))
  handle('cowork:network:allowOnce', ({ folder, host }) => {
    cowork.networkAllowOnce(cowork.assertInsideApproved(folder), host)
  })

  // ── Borrado (Seatbelt file-write-unlink) ──
  handle('cowork:deleteGrant:get', ({ folder }) => cowork.hasDeleteGrant(cowork.assertInsideApproved(folder)))
  handle('cowork:deleteGrant:set', async ({ folder, allowed }) => {
    const f = cowork.assertInsideApproved(folder)
    await cowork.setDeleteGrant(f, allowed)
    return cowork.hasDeleteGrant(f)
  })

  // ── Rutinas ──
  handle('routines:list', () => scheduler.list())
  handle('routines:save', (input) => scheduler.saveRoutine(input))
  handle('routines:delete', ({ id }) => scheduler.delete(id))
  handle('routines:toggle', ({ id, enabled }) => scheduler.toggle(id, enabled))
  handle('routines:runNow', ({ id }) => scheduler.runNow(id))
  handle('routines:history', (req) => scheduler.history(req?.id, req?.limit))
  handle('routines:preview', ({ schedule }) => previewSchedule(schedule, 3))

  // ── Computer use ──
  handle('computer:status', () => computer.status())
  handle('computer:requestPermissions', () => computer.requestPermissions())
  handle('computer:stop', async () => {
    await computer.stop()
  })
  handle('computer:resume', () => computer.resume())
  handle('computer:state', () => computer.state())
  // Plan → Aprobar → Ejecutar: una tarea de Control total que empieza a trabajar solo "pide" el
  // modo control; el borde, la píldora de control y la minimización de Lapis llegan recién
  // cuando el usuario aprueba el plan (evento `planApproved`). La aprobación es POR SESIÓN: dura
  // toda la tarea (seguimientos incluidos) hasta Revocar, Detener o archivar/borrar la tarea.
  let sessionWanted: { label?: string; sessionId?: string } | null = null
  const enterControlMode = (): void => {
    if (!sessionWanted) return
    overlay.setSession(true, sessionWanted.label)
    hideMainWindowForTask()
    // Lote C: "Ocultar las demás apps" solo en modo "Control de la pantalla" (en segundo plano no
    // se oculta ni se minimiza nada; ver B.7 del plan). El takeover (`request_full_control`) las
    // oculta aparte, en el listener de `computer.on('foreground', …)`.
    const prefs = computer.prefs.get()
    if (prefs.mode === 'full' && prefs.hideOtherApps) void appVisibility.hide(keepVisibleBundleIds())
  }
  computer.on('planApproved', (ev) => {
    // Entra en modo control si la aprobación es de la tarea ocupada (o no se puede saber de cuál es).
    if (!sessionWanted) return
    if (!ev.sessionId || !sessionWanted.sessionId || ev.sessionId === sessionWanted.sessionId) enterControlMode()
  })
  handle('computer:session', (req) => {
    const active = req?.active === true
    if (active) {
      sessionWanted = {
        label: typeof req?.label === 'string' ? req.label : undefined,
        sessionId: typeof req?.sessionId === 'string' ? req.sessionId : undefined
      }
      if (computer.isPlanApproved(sessionWanted.sessionId)) enterControlMode()
    } else {
      sessionWanted = null
      overlay.setSession(false)
      restoreMainWindowIfHidden()
      maybeUnhideApps()
      // Ya NO se revoca la aprobación: un seguimiento en la misma tarea no vuelve a pedir el plan.
      // Solo se apaga el respaldo global (modo legado, si falló la inyección de la sesión).
      computer.endLegacyPlan()
    }
  })
  handle('computer:revokePlan', ({ sessionId }) => {
    computer.revokePlan(sessionId)
  })
  handle('computer:approvedPlans', () => computer.approvedPlanSessions())
  // ── Concesión por app ──
  handle('computer:grants', () => computer.grants.snapshot())
  handle('computer:setGrant', ({ bundleId, name, tier }) => {
    computer.grants.grant(bundleId, name, tier)
    return computer.grants.snapshot()
  })
  handle('computer:revokeGrant', ({ bundleId }) => {
    computer.grants.revoke(bundleId)
    return computer.grants.snapshot()
  })
  handle('computer:denyApp', ({ bundleId, name }) => {
    computer.grants.deny(bundleId)
    // El nombre no se usa al denegar (no hay AppGrant para una app denegada), pero se valida igual.
    void name
    return computer.grants.snapshot()
  })
  handle('computer:undenyApp', ({ bundleId }) => {
    computer.grants.undeny(bundleId)
    return computer.grants.snapshot()
  })
  handle('computer:respondAccess', ({ id, decisions, feedback, approvePlan, cancel }) => {
    computer.resolveAccessRequest(id, decisions, { feedback, approvePlan, cancel })
  })
  handle('computer:showMainWindow', () => {
    restoreMainWindowIfHidden({ focus: true })
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // ── Lote C: preferencias, Teach mode y grabar una skill ──
  handle('computer:prefs:get', () => computer.prefs.get())
  handle('computer:prefs:set', (patch) => computer.prefs.set(patch))
  // Rol `assist`: la respuesta a un paso de Teach mode ("Siguiente"/"Salir de la guía").
  handle('computer:teachRespond', ({ id, action }) => {
    computer.resolveTeach(id, action)
  })
  handle('computer:record:start', ({ mic }) => recorder.start(mic))
  // Rol `assist`: "Terminar"/"Descartar" en la píldora de grabación.
  handle('computer:record:stop', (req) => recorder.stop(req?.discard === true))
  handle('computer:record:state', () => recorder.state())
  handle('computer:record:prepare', ({ id, folder, includeTyped }) => {
    const root = cowork.assertInsideApproved(folder)
    return recorder.prepare(id, root, includeTyped)
  })

  // ── Mantener el Mac despierto ──
  handle('cowork:keepAwakeState', () => keepAwake.state())
  handle('cowork:keepAwakeSetting', ({ enabled }) => keepAwake.setEnabled(enabled))
  handle('cowork:keepAwakeActive', ({ active }) => keepAwake.setActive(active))

  // ── Lote B/C: submódulos (carpetas, ciclo de vida, proyecto/MCP/reglas, archivos, Modo auto,
  // navegador propio) ──
  const submodules: CoworkSubmodule[] = [
    registerCoworkFoldersHandlers(ctx),
    registerCoworkLifecycleHandlers(ctx),
    registerCoworkProjectHandlers(ctx),
    registerCoworkFilesHandlers(ctx),
    registerCoworkAutoHandlers(ctx),
    registerCoworkBrowserHandlers(ctx)
  ]

  scheduler.start()

  return {
    cowork,
    computer,
    scheduler,
    shutdown: async () => {
      scheduler.stop()
      // Los submódulos (p.ej. el monitor) se detienen antes de parar los servidores.
      await Promise.all(submodules.map((m) => Promise.resolve(m.dispose?.()).catch((err) => console.error('[cowork] dispose:', err))))
      await cowork.stopAll()
      overlay.dispose()
      recorder.dispose()
      assist.dispose()
      maybeUnhideApps()
      computer.dispose()
      keepAwake.dispose()
    },
    killSync: () => cowork.killAllSync()
  }
}
