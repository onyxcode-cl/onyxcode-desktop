/**
 * Cableado de Control del PC (`computer:*`) del módulo de Tareas: servicio, overlay, ventana de asistencia, grabadora de
 * skills y visibilidad de apps. Se construye SOLO si `caps.computer` (macOS; Windows con `tasksWin` y `computerWin`): sin él
 * no se carga ni se instancia nada del helper nativo, no se registra ningún `computer:*` (los stubs de
 * `unsupported-handlers.ts` responden «no disponible»; un doble `ipcMain.handle` lanzaría) y no se arma el atajo global.
 * Código movido de `tasks-handlers.ts` sin cambios de comportamiento.
 */
import { t } from '@shared/i18n'
import { BrowserWindow, Notification, app, screen } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComputerService } from '../computer/service'
import { ComputerOverlay } from '../computer/overlay'
import { AssistWindow } from '../computer/assist-window'
import { SkillRecorder } from '../computer/recorder'
import { AppVisibility } from '../computer/app-visibility'
import { SYSTEM_EXEMPT_BUNDLE_IDS } from '../computer/grants'
import { abortFullAccessSessions } from '../computer/abort'
import { getAutoApprover } from '../tasks/auto-approver'
import { normalizeTasksPrefs } from '../tasks/prefs'
import { extrasPrefs } from '../extras/prefs'
import type { TasksManager } from '../tasks/manager'
import { IpcError } from './handle'
import type { TasksIpcContext } from './tasks-handle'

/**
 * ¿Debe salir la notificación nativa de una petición de permisos (`request_access`)?
 * Respeta el interruptor global de notificaciones y `prefs.notify.approval` de Tareas. Las
 * preferencias las gestiona `tasks-lifecycle-handlers.ts` (con caché en memoria); aquí se lee
 * el JSON en cada petición (sin caché, así siempre refleja el último cambio) y se normaliza con la
 * misma función. Ante cualquier fallo de lectura vale el valor por defecto (activada).
 */
function approvalNotificationsEnabled(): boolean {
  try {
    if (!extrasPrefs.get().notificationsEnabled) return false
  } catch {
    // sin preferencias globales legibles: se sigue con las de Tareas
  }
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'tasks-prefs.json'), 'utf8'))
  } catch {
    // archivo ausente o ilegible: valores por defecto
  }
  return normalizeTasksPrefs(raw).notify.approval
}

export interface ComputerParts {
  computer: ComputerService
  overlay: ComputerOverlay
  assist: AssistWindow
  recorder: SkillRecorder
  appVisibility: AppVisibility
  keepVisibleBundleIds: () => string[]
  maybeUnhideApps: () => void
}

/** Construye los objetos de Control del PC (nada de esto existe sin `caps.computer`). */
export function createComputerParts(): ComputerParts {
  const computer = new ComputerService()
  // Overlay "la IA está controlando tu Mac" (borde, onda de clics, píldora con Detener).
  const overlay = new ComputerOverlay({
    instant: computer.instant,
    hideOnCapture: process.env.LAZUNOX_OVERLAY_HIDE_ON_CAPTURE === '1',
    // Windows: el helper habla en píxeles físicos; el overlay, en DIP. macOS: sin conversión.
    physicalToDip: computer.ownConsent ? (p) => screen.screenToDipPoint(p) : undefined
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
  /**
   * Bundle ids que NUNCA se ocultan: apps con concesión, las exentas del sistema y Finder. Windows: las claves de las apps con
   * concesión (las exentas por ejecutable las respeta el helper: el shell nunca se minimiza); sin Finder ni bundle ids.
   */
  const keepVisibleBundleIds = (): string[] =>
    computer.ownConsent
      ? [...computer.grants.snapshot().grants.map((g) => g.bundleId)]
      : [...computer.grants.snapshot().grants.map((g) => g.bundleId), ...SYSTEM_EXEMPT_BUNDLE_IDS, 'com.apple.finder']
  const maybeUnhideApps = (): void => {
    if (computer.prefs.get().unhideOnFinish) void appVisibility.unhide()
  }
  return { computer, overlay, assist, recorder, appVisibility, keepVisibleBundleIds, maybeUnhideApps }
}

export interface ComputerWiringDeps {
  tasks: TasksManager
  send: TasksIpcContext['send']
  handle: TasksIpcContext['handle']
  getWindow: () => BrowserWindow | null
}

/** Escuchas y canales `computer:*`. Devuelve lo que hay que apagar al salir. */
export function wireComputer(parts: ComputerParts, deps: ComputerWiringDeps): { dispose: () => void } {
  const { computer, overlay, assist, recorder, appVisibility, keepVisibleBundleIds, maybeUnhideApps } = parts
  const { tasks, send, handle, getWindow } = deps
  // Kill-switch desde main: aborta las sesiones de TODOS los servidores de Control total (y detiene
  // el servidor si no responde), sin depender de la vista que muestre el renderer.
  computer.abortSessions = () => abortFullAccessSessions(tasks.fullAccessConnections(), (srv) => tasks.stop(srv.folder, true))
  // ── Item 5: Lazunox nunca se bloquea a sí misma y se aparta de en medio mientras el agente actúa ──
  // Mientras una tarea de Control total está trabajando, la ventana principal se minimiza (la
  // píldora + el overlay siguen visibles): así nunca queda en primer plano robándole el foco a
  // Spotlight/la app que el agente está usando, y el usuario ve el escritorio real, no Lazunox. Se
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

  tasks.on('server', (info) => {
    if (info.fullAccess && (info.state === 'stopped' || info.state === 'error')) {
      overlay.serverGone()
      restoreMainWindowIfHidden()
    }
  })
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
  // control): la ventana `assist` los muestra; `computer:recordDone` además se difunde para que la
  // ventana principal pinte la tarjeta de revisión (`RecordSkill.tsx`, C5).
  computer.on('teachStep', (step) => assist.showTeach(step))
  computer.on('teachClear', () => assist.clearTeach())
  recorder.on('state', (st) => assist.showRecording(st))
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
  // usuario no tiene el foco en Lazunox) y aviso a la píldora para el estado "Esperando tu permiso".
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
        title: req.plan ? t('merr.notif.planPending') : t('merr.notif.allowApps'),
        body:
          (req.apps.length ? req.apps.map((a) => a.name).join(', ') : t('merr.notif.planNoApps')) + (req.reason ? ` — ${req.reason}` : ''),
        actions: process.platform === 'darwin' ? [{ type: 'button', text: t('merr.notif.review') }] : undefined
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
  // lo consulta con `computer:state` al montar Tareas, por si la ventana aún no existía).
  computer.init()
  // ── Computer use ──
  handle('computer:status', () => computer.status())
  handle('computer:requestPermissions', () => computer.requestPermissions())
  // Windows: consentimiento propio de la app y registro auditable (sin soporte en macOS, que usa TCC y no tiene registro).
  const winOnly = (): void => {
    if (!computer.ownConsent) throw new IpcError('PLATFORM_UNSUPPORTED', t('merr.platform.unsupported'))
  }
  handle('computer:winConsent', ({ action }) => {
    winOnly()
    return computer.winConsent(action)
  })
  handle('computer:auditLog', () => {
    winOnly()
    return computer.auditEntries()
  })
  handle('computer:stop', async () => {
    await computer.stop()
  })
  handle('computer:resume', () => computer.resume())
  handle('computer:state', () => computer.state())
  // Plan → Aprobar → Ejecutar: una tarea de Control total que empieza a trabajar solo "pide" el
  // modo control; el borde, la píldora de control y la minimización de Lazunox llegan recién
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
  // Permiso o pregunta de OpenCode esperando al usuario mientras el control tiene la ventana principal minimizada: la tarjeta
  // solo existe ahí, así que sin esto el agente se quedaba esperando sin ninguna señal visible. Se restaura SIN foco (no le
  // quita el teclado a la app que el agente usa; el agente está bloqueado esperando, no actúa) y se vuelve a minimizar al responder.
  let restoredForPrompt = false
  handle('computer:promptVisible', ({ visible }) => {
    if (visible) {
      if (!minimizedByFullAccess) return
      restoredForPrompt = true
      restoreMainWindowIfHidden()
      const win = getWindow()
      if (win && !win.isDestroyed()) win.moveTop()
    } else if (restoredForPrompt) {
      restoredForPrompt = false
      if (sessionWanted) hideMainWindowForTask()
    }
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
  // Windows (v1): sin «Grabar una skill» (el helper no tiene `record`/`transcribe`): PLATFORM_UNSUPPORTED.
  const noRecordWin = (): void => {
    if (computer.ownConsent) throw new IpcError('PLATFORM_UNSUPPORTED', t('merr.platform.unsupported'))
  }
  handle('computer:record:start', ({ mic }) => {
    noRecordWin()
    return recorder.start(mic)
  })
  // Rol `assist`: "Terminar"/"Descartar" en la píldora de grabación.
  handle('computer:record:stop', (req) => {
    noRecordWin()
    return recorder.stop(req?.discard === true)
  })
  handle('computer:record:prepare', ({ id, folder, includeTyped }) => {
    noRecordWin()
    const root = tasks.assertInsideApproved(folder)
    return recorder.prepare(id, root, includeTyped)
  })

  return {
    dispose: () => {
      overlay.dispose()
      recorder.dispose()
      assist.dispose()
      maybeUnhideApps()
      computer.dispose()
    }
  }
}
