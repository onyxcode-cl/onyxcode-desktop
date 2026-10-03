/**
 * Cola de confirmaciones en el Mac (F0-T3): las acciones «D» del celular esperan aquí a que el dueño las apruebe.
 *
 * - FIFO: solo la primera se muestra; máx. 2 pendientes (la 3.ª se rechaza como `busy`) y 10 peticiones nuevas por minuto.
 * - Deduplicada por `sha256(canal + payload canónico)` (y dispositivo): repetir la MISMA llamada mientras espera se une a la
 *   pendiente (no gasta hueco ni cupo). La aprobación vale solo para ese `requestId`/llamada; una llamada distinta, aunque
 *   parecida, necesita su propia confirmación. Una aprobación se consume al resolver la promesa: repetir la llamada pide otra.
 * - Rechazo automático a los 90 s de mostrarse; revocar/«Cortar todo» rechaza todo (`cancelAll`).
 * - La interfaz (diálogo, PIN, auditoría: tanda T6) se inyecta con `ConfirmUi`; esta clase no conoce Electron.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { RemoteConfirmRequest, RemoteText } from '@shared/ipc-remote'

export const CONFIRM_LIMITS = {
  maxPending: 2,
  perMinute: 10,
  timeoutMs: 90_000
} as const

export type ConfirmOutcome = 'approved' | 'rejected' | 'expired' | 'cancelled' | 'busy' | 'rate-limited'

export interface ConfirmResult {
  outcome: ConfirmOutcome
  /** sha256 hex de canal + payload canónico: el despachador comprueba que coincide con la llamada que va a ejecutar. */
  digest: string
}

export interface ConfirmUi {
  /** Muestra la confirmación (la primera de la cola). */
  present(info: RemoteConfirmRequest): void
  /** La confirmación ya no está pendiente (resuelta, caducada o cancelada): cerrar el diálogo. */
  dismiss(requestId: string, outcome: ConfirmOutcome): void
}

export interface ConfirmInput {
  deviceId: string
  deviceName: string
  channel: string
  payload: unknown
  summary: RemoteText
  detail?: string[]
}

export interface ConfirmQueueOptions {
  ui: ConfirmUi
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  maxPending?: number
  perMinute?: number
  timeoutMs?: number
}

/** JSON canónico: claves ordenadas, sin `undefined`. Mismo payload lógico → mismo texto. */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`
}

/** `sha256(canal + payload canónico)` en hex. */
export function callDigest(channel: string, payload: unknown): string {
  return createHash('sha256').update(channel).update('\0').update(canonicalJson(payload)).digest('hex')
}

/** 8 hex del sha256 del deviceId (huella visible en el diálogo). */
export function deviceFingerprint(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex').slice(0, 8)
}

interface Pending {
  requestId: string
  key: string
  digest: string
  info: Omit<RemoteConfirmRequest, 'expiresAt' | 'createdAt'>
  createdAt: number
  waiters: Array<(r: ConfirmResult) => void>
  timer: unknown
  shown: boolean
}

export class ConfirmQueue {
  private readonly queue: Pending[] = []
  private readonly starts: number[] = []
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void
  private readonly maxPending: number
  private readonly perMinute: number
  private readonly timeoutMs: number

  constructor(private readonly opts: ConfirmQueueOptions) {
    this.now = opts.now ?? Date.now
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.maxPending = opts.maxPending ?? CONFIRM_LIMITS.maxPending
    this.perMinute = opts.perMinute ?? CONFIRM_LIMITS.perMinute
    this.timeoutMs = opts.timeoutMs ?? CONFIRM_LIMITS.timeoutMs
  }

  get pendingCount(): number {
    return this.queue.length
  }

  /** Pide confirmación. Resuelve cuando el dueño decide, caduca o se cancela; nunca lanza. */
  request(input: ConfirmInput): Promise<ConfirmResult> {
    const digest = callDigest(input.channel, input.payload)
    const key = `${input.deviceId}\0${digest}`
    const same = this.queue.find((p) => p.key === key)
    if (same) return new Promise((resolve) => same.waiters.push(resolve))

    const t = this.now()
    while (this.starts.length > 0 && t - (this.starts[0] as number) >= 60_000) this.starts.shift()
    if (this.starts.length >= this.perMinute) return Promise.resolve({ outcome: 'rate-limited', digest })
    if (this.queue.length >= this.maxPending) return Promise.resolve({ outcome: 'busy', digest })
    this.starts.push(t)

    return new Promise((resolve) => {
      const p: Pending = {
        requestId: randomUUID().replace(/-/g, ''),
        key,
        digest,
        createdAt: t,
        info: {
          requestId: '',
          deviceName: input.deviceName,
          deviceFingerprint: deviceFingerprint(input.deviceId),
          channel: input.channel,
          summary: input.summary,
          detail: input.detail ?? []
        },
        waiters: [resolve],
        timer: undefined,
        shown: false
      }
      p.info.requestId = p.requestId
      this.queue.push(p)
      this.showHead()
    })
  }

  /** Respuesta del dueño (`remote:confirmAction`). `false` si el id no es una confirmación pendiente y mostrada. */
  resolve(requestId: string, accept: boolean): boolean {
    const p = this.queue.find((x) => x.requestId === requestId)
    if (!p || !p.shown) return false
    this.finish(p, accept ? 'approved' : 'rejected')
    return true
  }

  /** Rechaza todo (dispositivo revocado, «Cortar todo», apagado). */
  cancelAll(): void {
    for (const p of [...this.queue]) this.finish(p, 'cancelled')
  }

  /** Rechaza lo pendiente de un dispositivo. */
  cancelDevice(deviceId: string): void {
    for (const p of [...this.queue]) if (p.key.startsWith(`${deviceId}\0`)) this.finish(p, 'cancelled')
  }

  private showHead(): void {
    const head = this.queue[0]
    if (!head || head.shown) return
    head.shown = true
    const shownAt = this.now()
    head.timer = this.setTimer(() => this.finish(head, 'expired'), this.timeoutMs)
    this.opts.ui.present({ ...head.info, createdAt: head.createdAt, expiresAt: shownAt + this.timeoutMs })
  }

  private finish(p: Pending, outcome: ConfirmOutcome): void {
    const i = this.queue.indexOf(p)
    if (i < 0) return
    this.queue.splice(i, 1)
    if (p.timer !== undefined) this.clearTimer(p.timer)
    if (p.shown) this.opts.ui.dismiss(p.requestId, outcome)
    for (const w of p.waiters) w({ outcome, digest: p.digest })
    this.showHead()
  }
}
