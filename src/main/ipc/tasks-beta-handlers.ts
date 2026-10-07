/**
 * Handler `tasks:winBeta`: consentimiento de la beta opcional de Tareas en Windows (decisión del dueño, 2026-10-07).
 *
 * Se registra AUNQUE `tasksWin` esté apagada (es la única forma de encenderla), pero solo en win32 con la puerta de compilación
 * `TASKS_WIN_BUILD`; en el resto de plataformas lo cubre un stub de `unsupported-handlers.ts`. No depende de `TasksManager` ni de
 * ningún submódulo de Tareas. El consentimiento vive en `userData/tasks-win-beta-consent.json` (lo escribe SOLO este handler, tras
 * casilla + armado de 600 ms que exige `main`); aceptar o revocar pide reiniciar, porque `tasksWin` se calcula al arrancar.
 */
import type { IpcMain } from 'electron'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import type { TasksWinBetaAction, TasksWinBetaState } from '@shared/ipc-tasks'
import { createTasksWinBetaController, createTasksWinBetaStore, TASKS_WIN_BETA_CONSENT_VERSION } from '../tasks/tasks-win-beta-consent'
import { makeTasksHandle } from './tasks-handle'

/** ¿Se registra el handler real (y no el stub)? Windows y puerta de compilación encendida. */
export function tasksWinBetaHandled(platform: string, build: boolean = TASKS_WIN_BUILD): boolean {
  return platform === 'win32' && build === true
}

/** Respuesta neutra de plataformas/builds sin la función (también la usa el stub). */
export function unavailableWinBeta(): TasksWinBetaState {
  return {
    available: false,
    consent: false,
    version: TASKS_WIN_BETA_CONSENT_VERSION,
    stale: false,
    armed: false,
    active: false,
    restartRequired: false
  }
}

export interface TasksBetaDeps {
  /** `app.getPath('userData')`. */
  userDataDir: string
  platform: string
  /** Por defecto `TASKS_WIN_BUILD`; las pruebas lo inyectan. */
  build?: boolean
  /** `tasksWin` efectiva de ESTE arranque. */
  active: boolean
  /** Reinicia la app (`app.relaunch()` + salir). Solo se llama si hay un cambio pendiente. */
  relaunch: () => void
  now?: () => number
}

/** Registra `tasks:winBeta`. Devuelve `false` (sin registrar nada) si la plataforma/build no la tiene. */
export function registerTasksBetaHandlers(ipcMain: IpcMain, deps: TasksBetaDeps): boolean {
  if (!tasksWinBetaHandled(deps.platform, deps.build)) return false
  const store = createTasksWinBetaStore(deps.userDataDir)
  const controller = createTasksWinBetaController(store, deps.now)
  const state = (granted?: boolean): TasksWinBetaState => {
    const v = controller.view()
    return {
      available: true,
      consent: v.consent,
      version: v.version,
      stale: v.stale,
      armed: controller.armed(),
      active: deps.active,
      // Lo que arrancó esta instancia (`active`) frente al consentimiento de ahora: si difieren, falta reiniciar.
      restartRequired: v.consent !== deps.active,
      ...(granted === undefined ? {} : { granted })
    }
  }
  const act = (action: TasksWinBetaAction): TasksWinBetaState => {
    let granted: boolean | undefined
    switch (action) {
      case 'view':
        break
      case 'show':
        controller.show()
        break
      case 'check':
        controller.setChecked(true)
        break
      case 'uncheck':
        controller.setChecked(false)
        break
      case 'accept':
        granted = controller.confirm()
        break
      case 'revoke':
        controller.revoke()
        break
      case 'restart': {
        const s = state()
        if (s.restartRequired) deps.relaunch()
        return s
      }
    }
    return state(granted)
  }
  makeTasksHandle(ipcMain)('tasks:winBeta', ({ action }) => act(action))
  return true
}
