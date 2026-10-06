/**
 * Selección del backend de aislamiento de Tareas.
 *
 *  - macOS: Seatbelt (`sandbox-exec`), o ninguno si no existe (igual que siempre).
 *  - Windows: SOLO el backend de la distro WSL de Tareas y SOLO si todo lo siguiente es cierto (falla CERRADO: nunca `none`):
 *      1. la bandera efectiva `tasksWin` (`resolveTasksWin`: compilación + opción del usuario/desarrollo + política);
 *      2. la constante de compilación `TASKS_WIN_BUILD` (se vuelve a comprobar aquí, no solo en `tasksWin`);
 *      3. el informe de ataques del PC en verde (`provider.report()`);
 *      4. el pin y la carga instalables (`provider.create()` devuelve `null` si falta alguno).
 *    La distro instalada y sana la comprueba `startTasksServer` con `backend.status()` (`TasksSandboxNotReady`).
 *  - Resto de plataformas: sin aislamiento (esas plataformas no ofrecen Tareas).
 * Este archivo no importa el backend de Windows: lo trae el llamador por `provider` (así macOS no carga ese código).
 */
import { t } from '@shared/i18n'
import { noneBackend } from './none'
import { seatbeltAvailable, seatbeltBackend } from './seatbelt'
import type { SandboxBackend, SandboxState } from './types'

/** Por qué no hay backend de Windows (para el mensaje y para las pruebas). */
export type WinBackendBlock = 'flag' | 'build' | 'provider' | 'report' | 'backend'

export class WinBackendUnavailable extends Error {
  readonly block: WinBackendBlock
  constructor(block: WinBackendBlock) {
    super(t('merr.task.winBackendUnavailable', { reason: block }))
    this.name = 'WinBackendUnavailable'
    this.block = block
  }
}

/** La distro no está lista (`status().state !== 'ready'`): la interfaz la traduce a «preparar», «reparar» o el texto de la organización. */
export class TasksSandboxNotReady extends Error {
  readonly state: SandboxState
  readonly detail?: string
  constructor(st: { state: SandboxState; detail?: string }) {
    super(t('merr.task.sandboxNotReady', { state: st.state }))
    this.name = 'TasksSandboxNotReady'
    this.state = st.state
    this.detail = st.detail
  }
}

/** Lo que `main` aporta para construir el backend de Windows. Todo lo que no sea exactamente lo esperado cuenta como «no». */
export interface WinBackendProvider {
  /** Constante de compilación `TASKS_WIN_BUILD` (la real en producción; las pruebas la inyectan). */
  build: boolean
  /** Informe de ataques del PC presente, en verde y que coincide con el pin y la carga que lleva esta app. */
  report(): Promise<boolean>
  /** Backend con sus dependencias reales, o `null` si falta el pin, la carga, `%LOCALAPPDATA%`… */
  create(): SandboxBackend | null
}

export interface SelectBackendOptions {
  /** Bandera efectiva `tasksWin`. Ausente = apagada. */
  tasksWin?: boolean
  /** Constructor del backend de Windows. Ausente = no hay backend (cierra). */
  win?: WinBackendProvider
}

export async function selectBackend(platform: string = process.platform, opts: SelectBackendOptions = {}): Promise<SandboxBackend> {
  if (platform === 'win32') {
    if (opts.tasksWin !== true) throw new WinBackendUnavailable('flag')
    const win = opts.win
    if (!win) throw new WinBackendUnavailable('provider')
    if (win.build !== true) throw new WinBackendUnavailable('build')
    let reportOk = false
    try {
      reportOk = (await win.report()) === true
    } catch {
      reportOk = false
    }
    if (!reportOk) throw new WinBackendUnavailable('report')
    let backend: SandboxBackend | null = null
    try {
      backend = win.create()
    } catch {
      backend = null
    }
    if (!backend || backend.id !== 'wsl') throw new WinBackendUnavailable('backend')
    return backend
  }
  if (platform === 'darwin' && seatbeltAvailable()) return seatbeltBackend
  return noneBackend
}
