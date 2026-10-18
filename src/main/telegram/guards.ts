/**
 * Piezas puras de seguridad del puente con Telegram (reloj inyectable, sin red ni disco):
 *  - `LinkCode`: código de vinculación de 6 dígitos (caduca, un solo uso, intentos limitados con bloqueo).
 *  - `MinuteLimiter`: límite de mensajes entrantes por minuto.
 *  - `ButtonBook`: botones con identificador corto aleatorio (≤ 64 bytes en `callback_data`), con vigencia, un solo uso y
 *    ligados al chat dueño y al permiso.
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { TELEGRAM_LIMITS } from '@shared/telegram'

type Clock = () => number

// ---------------------------------------------------------------- código de vinculación

export type CodeCheck =
  { ok: true } | { ok: false; reason: 'none' | 'expired' | 'locked' | 'wrong'; attemptsLeft: number; lockedUntil: number | null }

export interface LinkCodeLimits {
  ttlMs: number
  maxAttempts: number
  lockMs: number
}

export class LinkCode {
  private code: string | null = null
  private expiresAt = 0
  private fails = 0
  private lockedUntil = 0

  constructor(
    private readonly now: Clock = Date.now,
    private readonly limits: LinkCodeLimits = {
      ttlMs: TELEGRAM_LIMITS.codeTtlMs,
      maxAttempts: TELEGRAM_LIMITS.maxCodeAttempts,
      lockMs: TELEGRAM_LIMITS.lockMs
    },
    private readonly gen: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
  ) {}

  /** Genera un código nuevo (anula el anterior). Durante un bloqueo no se genera uno (devuelve `null`). */
  issue(): string | null {
    if (this.isLocked()) return null
    this.code = this.gen()
    this.expiresAt = this.now() + this.limits.ttlMs
    this.fails = 0
    return this.code
  }

  clear(): void {
    this.code = null
    this.expiresAt = 0
  }

  isLocked(): boolean {
    return this.now() < this.lockedUntil
  }

  /** El código vigente (para mostrarlo en la ventana), o `null` si no hay, caducó o hay bloqueo. */
  current(): { code: string; expiresAt: number } | null {
    if (!this.code || this.now() >= this.expiresAt || this.isLocked()) return null
    return { code: this.code, expiresAt: this.expiresAt }
  }

  get lockUntil(): number | null {
    return this.isLocked() ? this.lockedUntil : null
  }

  attemptsLeft(): number {
    return Math.max(0, this.limits.maxAttempts - this.fails)
  }

  /** Comprueba lo que escribió la persona. Acertar consume el código (un solo uso); fallar suma un intento. */
  check(input: string): CodeCheck {
    if (this.isLocked()) return { ok: false, reason: 'locked', attemptsLeft: 0, lockedUntil: this.lockedUntil }
    if (!this.code) return { ok: false, reason: 'none', attemptsLeft: this.attemptsLeft(), lockedUntil: null }
    if (this.now() >= this.expiresAt) {
      this.code = null
      return { ok: false, reason: 'expired', attemptsLeft: this.attemptsLeft(), lockedUntil: null }
    }
    const a = Buffer.from(input.trim(), 'utf8')
    const b = Buffer.from(this.code, 'utf8')
    const same = a.length === b.length && timingSafeEqual(a, b)
    if (same) {
      this.code = null
      this.fails = 0
      return { ok: true }
    }
    this.fails++
    if (this.fails >= this.limits.maxAttempts) {
      // Tras el bloqueo el código viejo ya no sirve: hay que pedir uno nuevo.
      this.code = null
      this.lockedUntil = this.now() + this.limits.lockMs
      this.fails = 0
      return { ok: false, reason: 'locked', attemptsLeft: 0, lockedUntil: this.lockedUntil }
    }
    return { ok: false, reason: 'wrong', attemptsLeft: this.attemptsLeft(), lockedUntil: null }
  }
}

// ---------------------------------------------------------------- límite por minuto

/** Ventana deslizante: admite como mucho `max` eventos en los últimos 60 s. */
export class MinuteLimiter {
  private stamps: number[] = []
  constructor(
    private readonly max: number,
    private readonly now: Clock = Date.now
  ) {}

  /** `true` si el evento cabe (y lo cuenta). */
  take(): boolean {
    const t = this.now()
    this.stamps = this.stamps.filter((s) => t - s < 60_000)
    if (this.stamps.length >= this.max) return false
    this.stamps.push(t)
    return true
  }
}

// ---------------------------------------------------------------- botones

export type ButtonAction = 'a' | 'r'

export interface ButtonEntry {
  id: string
  permissionId: string
  chatId: number
  createdAt: number
  expiresAt: number
  used: boolean
  /** Quién cerró el permiso (para decir la verdad al pulsar un botón ya gastado). */
  by?: 'telegram' | 'screen' | 'expired'
}

export type ButtonTake =
  | { ok: true; entry: ButtonEntry; action: ButtonAction }
  | { ok: false; reason: 'bad' | 'unknown' | 'wrong-chat' | 'expired' | 'used'; entry?: ButtonEntry }

const CB_RE = /^p:([A-Za-z0-9_-]{12}):([ar])$/

export class ButtonBook {
  private readonly byId = new Map<string, ButtonEntry>()
  private readonly byPerm = new Map<string, string>()

  constructor(
    private readonly now: Clock = Date.now,
    private readonly ttlMs: number = TELEGRAM_LIMITS.buttonTtlMs,
    private readonly max = 200
  ) {}

  /** Identificador corto aleatorio (12 caracteres base64url = 72 bits) para un permiso. Uno por permiso. */
  create(permissionId: string, chatId: number): ButtonEntry {
    this.purge()
    const existing = this.byPerm.get(permissionId)
    if (existing) {
      const e = this.byId.get(existing)
      if (e) return e
    }
    let id = ''
    do id = randomBytes(9).toString('base64url')
    while (this.byId.has(id))
    const t = this.now()
    const entry: ButtonEntry = { id, permissionId, chatId, createdAt: t, expiresAt: t + this.ttlMs, used: false }
    this.byId.set(id, entry)
    this.byPerm.set(permissionId, id)
    return entry
  }

  /** `callback_data` para un botón (nunca pasa de 16 bytes). */
  static data(entry: ButtonEntry, action: ButtonAction): string {
    return `p:${entry.id}:${action}`
  }

  /**
   * Resuelve una pulsación. SOLO la acepta si: el dato tiene la forma esperada, existe, es del chat dueño (que pulsa), no caducó y
   * no se usó. Al aceptarla, la marca como usada de inmediato (un solo uso; `release` la devuelve si el motor no pudo responder).
   */
  take(data: string | undefined, chatId: number): ButtonTake {
    const m = typeof data === 'string' ? CB_RE.exec(data) : null
    if (!m) return { ok: false, reason: 'bad' }
    const entry = this.byId.get(m[1] as string)
    if (!entry) return { ok: false, reason: 'unknown' }
    if (entry.chatId !== chatId) return { ok: false, reason: 'wrong-chat' }
    if (entry.used) return { ok: false, reason: 'used', entry }
    if (this.now() >= entry.expiresAt) return { ok: false, reason: 'expired', entry }
    entry.used = true
    return { ok: true, entry, action: m[2] as ButtonAction }
  }

  /** Devuelve a «sin usar» un botón cuyo intento de responder falló (para poder reintentar antes de que caduque). */
  release(id: string): void {
    const e = this.byId.get(id)
    if (e) e.used = false
  }

  /** Cierra un permiso (lo contestó la pantalla, o ya se atendió): sus botones dejan de valer. */
  retire(permissionId: string, by: ButtonEntry['by'] = 'screen'): ButtonEntry | undefined {
    const id = this.byPerm.get(permissionId)
    const e = id ? this.byId.get(id) : undefined
    if (e) {
      e.used = true
      e.by ??= by
    }
    return e
  }

  forPermission(permissionId: string): ButtonEntry | undefined {
    const id = this.byPerm.get(permissionId)
    return id ? this.byId.get(id) : undefined
  }

  /** Entradas cuya vigencia ya pasó y siguen sin usar (para editar su mensaje: «caducó»). */
  expiredOpen(): ButtonEntry[] {
    const t = this.now()
    return [...this.byId.values()].filter((e) => !e.used && t >= e.expiresAt)
  }

  clear(): void {
    this.byId.clear()
    this.byPerm.clear()
  }

  get size(): number {
    return this.byId.size
  }

  /** Borra las entradas viejas (caducadas hace más de una hora) y recorta si hay demasiadas. */
  private purge(): void {
    const t = this.now()
    for (const [id, e] of this.byId) {
      if (t - e.expiresAt > 3_600_000) {
        this.byId.delete(id)
        this.byPerm.delete(e.permissionId)
      }
    }
    while (this.byId.size >= this.max) {
      const first = this.byId.keys().next().value as string | undefined
      if (first === undefined) break
      const e = this.byId.get(first)
      this.byId.delete(first)
      if (e) this.byPerm.delete(e.permissionId)
    }
  }
}
