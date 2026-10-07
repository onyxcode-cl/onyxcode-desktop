/**
 * Selección del backend de aislamiento de Tareas.
 *
 *  - macOS: Seatbelt (`sandbox-exec`), o ninguno si no existe (igual que siempre).
 *  - Windows: SOLO el backend de la distro WSL de Tareas y SOLO si todo lo siguiente es cierto (falla CERRADO: nunca `none`):
 *      1. la bandera efectiva `tasksWin` (`resolveTasksWin`: compilación + opción del usuario/desarrollo + política);
 *      2. la constante de compilación `TASKS_WIN_BUILD` (se vuelve a comprobar aquí, no solo en `tasksWin`);
 *      3. la PUERTA de la beta (`provider.gate()`, que sustituye a la guardia de informes por decisión del dueño, 2026-10-07):
 *         consentimiento beta vigente (releído del disco), Lazunox no elevado, pin, huella del paquete incluido, carga y
 *         `state.json` (ver `win-provider.ts`). Se consulta en CADA llamada: revocar el consentimiento cierra el próximo arranque
 *         de servidor aunque el proceso siga vivo (no detiene tareas en curso);
 *      4. el pin y la carga instalables (`provider.create()` devuelve `null` si falta alguno).
 *    La distro instalada y sana la comprueba `startTasksServer` con `backend.status()` (`TasksSandboxNotReady`): la puerta
 *    no la sustituye.
 *  - Resto de plataformas: sin aislamiento (esas plataformas no ofrecen Tareas).
 * Este archivo no importa el backend de Windows: lo trae el llamador por `provider` (así macOS no carga ese código).
 */
import { t, type MsgKey } from '@shared/i18n'
import { noneBackend } from './none'
import { seatbeltAvailable, seatbeltBackend } from './seatbelt'
import type { SandboxBackend, SandboxState } from './types'

/** Por qué no hay backend de Windows (para el mensaje y para las pruebas). */
export type WinBackendBlock = 'flag' | 'build' | 'provider' | 'consent' | 'elevated' | 'bundle' | 'gate' | 'backend'

/** Texto propio de los eslabones de la puerta de la beta; el resto usa el genérico. */
const BLOCK_TEXT: Partial<Record<WinBackendBlock, MsgKey>> = {
  consent: 'merr.task.winBackendUnavailable.consent',
  elevated: 'merr.task.winBackendUnavailable.elevated',
  bundle: 'merr.task.winBackendUnavailable.bundle',
  gate: 'merr.task.winBackendUnavailable.gate'
}

export class WinBackendUnavailable extends Error {
  readonly block: WinBackendBlock
  constructor(block: WinBackendBlock) {
    super(t(BLOCK_TEXT[block] ?? 'merr.task.winBackendUnavailable', { reason: block }))
    this.name = 'WinBackendUnavailable'
    this.block = block
  }
}

/** Qué eslabón de la puerta de la beta cerró (para el mensaje y para las pruebas). */
export type GateReason = 'consent' | 'elevated' | 'pin' | 'bundle' | 'payload' | 'state' | 'policy'
export interface GateResult {
  ok: boolean
  reason?: GateReason
}
/**
 * `run`: arrancar un servidor de Tareas (estricto: exige también `state.json` y la política). `setup`: preparar o consultar la
 * distro (la primera instalación aún no tiene `state.json` y la política la informa el estado `policyDisabled` del backend).
 */
export type GatePurpose = 'run' | 'setup'

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
  /** Puerta de la beta (consentimiento, no elevado, pin, huella del paquete, carga, `state.json`). Falla CERRADO; relee el disco. */
  gate(purpose?: GatePurpose): Promise<GateResult>
  /** Backend con sus dependencias reales, o `null` si falta el pin, la carga, `%LOCALAPPDATA%`… */
  create(): SandboxBackend | null
}

export interface SelectBackendOptions {
  /** Bandera efectiva `tasksWin`. Ausente = apagada. */
  tasksWin?: boolean
  /** Constructor del backend de Windows. Ausente = no hay backend (cierra). */
  win?: WinBackendProvider
  /** Para qué se pide el backend. Ausente = `run` (estricto): solo quien prepara la distro pide `setup`. */
  purpose?: GatePurpose
}

export async function selectBackend(platform: string = process.platform, opts: SelectBackendOptions = {}): Promise<SandboxBackend> {
  if (platform === 'win32') {
    if (opts.tasksWin !== true) throw new WinBackendUnavailable('flag')
    const win = opts.win
    if (!win) throw new WinBackendUnavailable('provider')
    if (win.build !== true) throw new WinBackendUnavailable('build')
    let gate: GateResult | undefined
    try {
      gate = await win.gate(opts.purpose ?? 'run')
    } catch {
      gate = undefined
    }
    if (!gate || gate.ok !== true) {
      const reason = gate && typeof gate === 'object' ? gate.reason : undefined
      throw new WinBackendUnavailable(
        reason === 'consent' ? 'consent' : reason === 'elevated' ? 'elevated' : reason === 'bundle' ? 'bundle' : 'gate'
      )
    }
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
