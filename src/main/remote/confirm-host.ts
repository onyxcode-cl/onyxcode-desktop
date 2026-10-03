/**
 * Anfitrión de las confirmaciones en el Mac (T6): conecta la `ConfirmQueue` (T3) con la interfaz real.
 *
 *  - `present`: envía `remote:confirmRequest` a la ventana principal; si no hay ventana usable, diálogo nativo SIN padre
 *    (`fallback`) y aviso de bandeja/rebote del Dock (`alert`). Si el diálogo falla, se RECHAZA (nunca se aprueba por error).
 *  - `answer`: respuesta del dueño (`remote:confirmAction`, solo ventana principal) con la opción «recordar 12 h», válida
 *    únicamente en la confirmación de conexión.
 *  - `requestConnection` / `requestAction`: lo que usan el control de acceso (D3) y el despachador (acciones «D»).
 *  - Todo resultado queda en la auditoría (aprobada / rechazada / caducada), sin payloads.
 *
 * No conoce Electron: la ventana, el diálogo y el aviso se inyectan (pruebas con dobles).
 */
import { REMOTE_CONNECT_CHANNEL, type RemoteConfirmRequest, type RemoteText } from '@shared/ipc-remote'
import type { AuditInput } from './audit'
import {
  ConfirmQueue,
  deviceFingerprint,
  type ConfirmInput,
  type ConfirmOutcome,
  type ConfirmQueueOptions,
  type ConfirmResult,
  type ConfirmUi
} from './confirm-queue'

export const CONNECT_CHANNEL = REMOTE_CONNECT_CHANNEL

export interface ConfirmHostDeps {
  /** Envía la confirmación a la ventana principal. `false` = no hay ventana donde mostrarla. */
  sendToWindow(info: RemoteConfirmRequest): boolean
  /** La confirmación ya no está pendiente: cerrar el diálogo de la ventana. */
  dismissInWindow(requestId: string, outcome: ConfirmOutcome): void
  /** Sin ventana: `dialog.showMessageBox` sin padre. `true` = permitir. Si lanza o rechaza, se deniega. */
  fallback(info: RemoteConfirmRequest): Promise<boolean>
  /** Avisa al dueño (rebote del Dock, bandeja). */
  alert?(info: RemoteConfirmRequest): void
  audit?(e: AuditInput): void
  queue?: Omit<ConfirmQueueOptions, 'ui'>
}

export interface ConnectionConfirm {
  deviceId: string
  deviceName: string
  detail?: string[]
}

export interface HostResult extends ConfirmResult {
  /** «Recordar 12 h» marcado (solo en confirmaciones de conexión aprobadas). */
  remember: boolean
}

export class ConfirmHost {
  readonly queue: ConfirmQueue
  private readonly shown = new Map<string, RemoteConfirmRequest>()
  private readonly remembered = new Map<string, boolean>()

  constructor(private readonly d: ConfirmHostDeps) {
    const ui: ConfirmUi = {
      present: (info) => this.present(info),
      dismiss: (id, outcome) => this.dismiss(id, outcome)
    }
    this.queue = new ConfirmQueue({ ...d.queue, ui })
  }

  private present(info: RemoteConfirmRequest): void {
    this.shown.set(info.requestId, info)
    try {
      this.d.alert?.(info)
    } catch {
      /* el aviso es un extra */
    }
    let delivered = false
    try {
      delivered = this.d.sendToWindow(info)
    } catch {
      delivered = false
    }
    if (delivered) return
    // Sin ventana: diálogo nativo sin padre. Cualquier fallo = rechazo.
    let p: Promise<boolean>
    try {
      p = this.d.fallback(info)
    } catch {
      p = Promise.resolve(false)
    }
    void p.then(
      (ok) => this.queue.resolve(info.requestId, ok === true),
      () => this.queue.resolve(info.requestId, false)
    )
  }

  private dismiss(requestId: string, outcome: ConfirmOutcome): void {
    this.shown.delete(requestId)
    try {
      this.d.dismissInWindow(requestId, outcome)
    } catch {
      /* ventana ya cerrada */
    }
  }

  /** Respuesta del dueño (`remote:confirmAction`). */
  answer(requestId: string, accept: boolean, remember = false): boolean {
    const info = this.shown.get(requestId)
    if (!info) return false
    if (accept && remember && info.channel === CONNECT_CHANNEL) this.remembered.set(key(info), true)
    return this.queue.resolve(requestId, accept)
  }

  /** Rechaza lo pendiente de un dispositivo (revocado, desconectado). */
  cancelDevice(deviceId: string): void {
    this.queue.cancelDevice(deviceId)
  }

  /** «Cortar todo». */
  cancelAll(): void {
    this.queue.cancelAll()
  }

  /** Confirmación de una acción «D» del celular (despachador T4). */
  requestAction(input: ConfirmInput): Promise<HostResult> {
    return this.run(input, false)
  }

  /** D3: confirmar una conexión nueva de un dispositivo ya vinculado. */
  requestConnection(c: ConnectionConfirm): Promise<HostResult> {
    const summary: RemoteText = {
      es: `Permitir que «${c.deviceName}» se conecte a tu Mac`,
      en: `Allow “${c.deviceName}” to connect to your Mac`
    }
    return this.run(
      {
        deviceId: c.deviceId,
        deviceName: c.deviceName,
        channel: CONNECT_CHANNEL,
        payload: { connect: c.deviceId },
        summary,
        detail: c.detail
      },
      true
    )
  }

  private async run(input: ConfirmInput, connection: boolean): Promise<HostResult> {
    const res = await this.queue.request(input)
    const fp = `${deviceFingerprint(input.deviceId)}|${input.channel}`
    const remember = connection && res.outcome === 'approved' && this.remembered.get(fp) === true
    this.remembered.delete(fp)
    this.d.audit?.({
      kind: res.outcome === 'approved' ? 'confirm-approved' : res.outcome === 'expired' ? 'confirm-expired' : 'confirm-rejected',
      ...(connection ? {} : { ch: input.channel }),
      device: deviceFingerprint(input.deviceId),
      name: input.deviceName
    })
    return { ...res, remember }
  }
}

function key(info: RemoteConfirmRequest): string {
  return `${info.deviceFingerprint}|${info.channel}`
}
