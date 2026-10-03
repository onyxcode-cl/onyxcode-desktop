/**
 * Puerta de acceso de UNA conexión del celular ya autenticada (secreto de dispositivo verificado). Sin ella el canal no da
 * acceso a nada salvo su propio flujo:
 *
 *   conexión nueva ─► [confirm] el dueño aprueba en el Mac (o hay «recordar 12 h» vigente)
 *                 ─► [pin-set] el dispositivo aún no tiene PIN: lo fija ya (se guarda solo su hash scrypt)
 *                 ─► [pin-verify] el PIN se verifica DENTRO del canal (salvo reconexión con actividad reciente)
 *                 ─► [open] acceso. Tras 5 min sin llamadas vuelve a [pin-verify] (`inactive`).
 *
 *  - 5 fallos de PIN seguidos (persistidos) revocan el dispositivo; cada fallo añade un retardo creciente (1, 2, 4… hasta 30 s)
 *    durante el cual no se admiten intentos (no se verifican ni cuentan).
 *  - Bloqueado por inactividad solo se atienden lecturas (`isRead`); sin clasificador no se atiende nada.
 *  - Reloj y temporizadores inyectables (pruebas con reloj falso). Nunca se registra el PIN ni su hash.
 */
import { LIMITS } from '@shared/remote/protocol'
import type { DeniedReason, HostFrame, LockWhy, PinFrame } from '@shared/remote/protocol'
import { MuxError, type CallRequest, type DispatchCtx, type HttpRequest, type MuxDispatch } from '@shared/remote/mux'
import type { AuditInput } from './audit'

export type GateState = 'confirm' | 'set-pin' | 'verify-pin' | 'open'
/** Estado visible en Ajustes: esperando confirmación, falta PIN / PIN pedido, bloqueado por inactividad, abierto. */
export type AccessView = 'awaiting' | 'pin' | 'locked' | 'open'

export interface GateDevices {
  hasPin(id: string): boolean
  setPin(id: string, pin: string): Promise<boolean>
  verifyPin(id: string, pin: string): Promise<boolean>
  recordPinFail(id: string): number
  clearPinFails(id: string): void
}

export interface ConnectionDecision {
  approved: boolean
  outcome: 'approved' | 'rejected' | 'expired' | 'cancelled' | 'busy' | 'rate-limited'
}

export interface AccessGateOptions {
  deviceId: string
  /** Recién vinculado (el dueño ya confirmó la vinculación): no se pide confirmar la conexión. */
  fresh: boolean
  devices: GateDevices
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  /** ¿Hay una confirmación de conexión vigente («recordar 12 h»)? */
  trusted: () => boolean
  /** Pide al dueño confirmar esta conexión en el Mac (cola de confirmaciones). */
  confirmConnection: () => Promise<ConnectionDecision>
  send: (f: HostFrame) => void
  /** Cambió el estado visible (Ajustes). */
  onChange: () => void
  /** El Mac rechazó o dejó caducar la conexión: se cierra con `denied`. */
  onDenied: (reason: DeniedReason) => void
  /** 5 fallos de PIN: revocar el dispositivo. */
  onRevoke: () => void
  audit: (e: AuditInput) => void
  /** Última actividad de este dispositivo en una conexión anterior (para no pedir PIN al reconectar en caliente). */
  lastActiveAt?: number | null
  noteActive?: (t: number) => void
  inactivityMs?: number
}

export const PIN_DELAY_CAP_MS = 30_000

/** Retardo tras el fallo n-ésimo: 1 s, 2 s, 4 s… con tope. */
export function pinDelayMs(fails: number): number {
  return Math.min(1000 * 2 ** Math.max(0, fails - 1), PIN_DELAY_CAP_MS)
}

export class AccessGate {
  private _state: GateState = 'confirm'
  private inactive = false
  private lastTouch = 0
  private blockedUntil = 0
  private busy = false
  private timer: unknown = null
  private disposed = false
  private readonly inactivityMs: number

  constructor(private readonly o: AccessGateOptions) {
    this.inactivityMs = o.inactivityMs ?? LIMITS.inactivityLockMs
  }

  get state(): GateState {
    this.check()
    return this._state
  }

  get isOpen(): boolean {
    return this.state === 'open'
  }

  get view(): AccessView {
    const s = this.state
    return s === 'open' ? 'open' : s === 'confirm' ? 'awaiting' : this.inactive ? 'locked' : 'pin'
  }

  private why(): LockWhy {
    return this._state === 'confirm' ? 'confirm' : this._state === 'set-pin' ? 'pin-set' : this.inactive ? 'inactive' : 'pin-verify'
  }

  private sendLocked(extra: { retryMs?: number; left?: number } = {}): void {
    this.o.send({ t: 'locked', why: this.why(), ...extra })
  }

  /** Arranca el flujo (tras enviar `authed`/`paired`). */
  start(): void {
    const needConfirm = !this.o.fresh && !this.o.trusted()
    if (needConfirm) {
      this._state = 'confirm'
      this.sendLocked()
      this.o.onChange()
      void this.runConfirm()
      return
    }
    this.afterConfirm()
  }

  private async runConfirm(): Promise<void> {
    let d: ConnectionDecision
    try {
      d = await this.o.confirmConnection()
    } catch {
      d = { approved: false, outcome: 'rejected' }
    }
    if (this.disposed) return
    if (!d.approved) return this.o.onDenied(d.outcome === 'expired' ? 'timeout' : 'rejected')
    this.afterConfirm()
  }

  private afterConfirm(): void {
    const { deviceId, devices } = this.o
    if (!devices.hasPin(deviceId)) {
      this._state = 'set-pin'
    } else {
      const last = this.o.lastActiveAt
      const warm = !this.o.fresh && typeof last === 'number' && this.o.now() >= last && this.o.now() - last < this.inactivityMs
      if (warm) return this.open()
      this._state = 'verify-pin'
    }
    this.sendLocked()
    this.o.onChange()
  }

  private open(): void {
    this._state = 'open'
    this.inactive = false
    this.blockedUntil = 0
    this.lastTouch = this.o.now()
    this.o.noteActive?.(this.lastTouch)
    this.o.send({ t: 'unlocked' })
    this.arm()
    this.o.onChange()
  }

  // ── PIN ──

  async onPin(f: PinFrame): Promise<void> {
    if (this.disposed) return
    const s = this.state
    if (f.t === 'pin-set') {
      if (s !== 'set-pin' || this.busy) return this.sendLocked()
      this.busy = true
      try {
        const ok = await this.o.devices.setPin(this.o.deviceId, f.pin)
        if (this.disposed) return
        if (!ok) return this.sendLocked()
        this.o.audit({ kind: 'pin-set' })
        this.open()
      } catch {
        if (!this.disposed) this.sendLocked()
      } finally {
        this.busy = false
      }
      return
    }
    if (s !== 'verify-pin' || this.busy) return this.sendLocked()
    const wait = this.blockedUntil - this.o.now()
    if (wait > 0) return this.sendLocked({ retryMs: wait })
    this.busy = true
    try {
      const ok = await this.o.devices.verifyPin(this.o.deviceId, f.pin)
      if (this.disposed) return
      if (ok) {
        this.o.devices.clearPinFails(this.o.deviceId)
        this.open()
        return
      }
      const n = this.o.devices.recordPinFail(this.o.deviceId)
      this.o.audit({ kind: 'pin-fail', n })
      if (n >= LIMITS.pinMaxFails) {
        this.o.onRevoke()
        return
      }
      const retryMs = pinDelayMs(n)
      this.blockedUntil = this.o.now() + retryMs
      this.sendLocked({ retryMs, left: LIMITS.pinMaxFails - n })
    } catch {
      if (!this.disposed) this.sendLocked()
    } finally {
      this.busy = false
    }
  }

  // ── actividad y bloqueo ──

  /** El celular hizo una llamada atendida: reinicia el reloj de inactividad. */
  touch(): void {
    if (this._state !== 'open') return
    this.lastTouch = this.o.now()
    this.o.noteActive?.(this.lastTouch)
  }

  /** Pasa a `verify-pin` si ya pasó el tiempo de inactividad. */
  private check(): void {
    if (this._state === 'open' && !this.disposed && this.o.now() - this.lastTouch >= this.inactivityMs) this.lock()
  }

  /**
   * Bloqueo manual pedido por el celular («Bloquear ahora»). A diferencia del de inactividad, no atiende ni lecturas hasta
   * verificar el PIN. Solo tiene efecto con el acceso abierto (si no, ya está bloqueado).
   */
  lockNow(): void {
    if (this.disposed || this._state !== 'open') return
    this.lock(false)
  }

  private lock(inactive = true): void {
    this._state = 'verify-pin'
    this.inactive = inactive
    this.blockedUntil = 0
    this.o.audit({ kind: 'locked' })
    this.sendLocked()
    this.o.onChange()
  }

  private arm(): void {
    if (this.timer) this.o.clearTimer(this.timer)
    this.timer = this.o.setTimer(
      () => {
        this.timer = null
        if (this.disposed || this._state !== 'open') return
        const left = this.inactivityMs - (this.o.now() - this.lastTouch)
        if (left > 0) return this.arm()
        this.lock()
      },
      Math.max(1000, this.inactivityMs - (this.o.now() - this.lastTouch))
    )
  }

  /** ¿Se atiende esta llamada? Abierto: sí. Bloqueado por inactividad: solo lecturas. Otro estado: no. */
  canServe(isRead: boolean): boolean {
    const s = this.state
    if (s === 'open') return true
    return s === 'verify-pin' && this.inactive && isRead
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) this.o.clearTimer(this.timer)
    this.timer = null
  }
}

/**
 * Envuelve el despachador del multiplexor: sin acceso abierto responde `forbidden` (el `locked` ya explica por qué) y
 * cuenta la actividad. `onPolicyDenied` recibe el rechazo de la política (`forbidden`) para la auditoría, solo con el canal.
 */
export function guardDispatch(
  inner: MuxDispatch | undefined,
  gate: AccessGate,
  opts: {
    isRead?: (r: CallRequest | HttpRequest) => boolean
    onPolicyDenied?: (r: { ch: string; cls: 'X' }) => void
  } = {}
): MuxDispatch | undefined {
  if (!inner) return inner
  const run = async (r: CallRequest | HttpRequest, ch: string, fn: () => Promise<unknown>): Promise<unknown> => {
    if (!gate.canServe(opts.isRead?.(r) ?? false)) throw new MuxError('forbidden', 'locked')
    gate.touch()
    try {
      return await fn()
    } catch (err) {
      if (err instanceof MuxError && err.code === 'forbidden') opts.onPolicyDenied?.({ ch, cls: 'X' })
      throw err
    }
  }
  return {
    call: (req: CallRequest, ctx: DispatchCtx) => run(req, req.ch, () => inner.call(req, ctx)),
    http: (req: HttpRequest, ctx: DispatchCtx) => run(req, `${req.method} /${req.path.split('/')[1] ?? ''}`, () => inner.http(req, ctx)),
    allowSub: (eng: string) => gate.isOpen && (inner.allowSub ? inner.allowSub(eng) : true)
  }
}
