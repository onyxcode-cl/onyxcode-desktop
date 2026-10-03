/**
 * Secreto de un solo uso del código QR. Se guarda SOLO su sha256 (el secreto en claro únicamente vive en la
 * URL del QR que ve el dueño), caduca a los 120 s y se consume en el primer `hello` aunque falle
 * (comparación en tiempo constante). Reloj inyectable.
 */
import { randomBytes } from 'node:crypto'
import { constantTimeEqual, sha256Hex, toBase64Url } from '@shared/remote/code'
import { LIMITS } from '@shared/remote/protocol'
import type { Clock } from './rate-limit'

export interface PairingToken {
  /** Secreto en claro (base64url, 43 caracteres) para armar la URL del QR. */
  secret: string
  expiresAt: number
}

export class PairingManager {
  private hash: string | null = null
  private expiresAt = 0

  constructor(private readonly now: Clock = Date.now) {}

  /** Crea un secreto nuevo (el anterior deja de valer). */
  create(): PairingToken {
    const secret = toBase64Url(randomBytes(LIMITS.secretBytes))
    this.hash = sha256Hex(secret)
    this.expiresAt = this.now() + LIMITS.pairingTtlMs
    return { secret, expiresAt: this.expiresAt }
  }

  /**
   * Comprueba y CONSUME: tras cualquier llamada (acierte o falle) no queda secreto vigente.
   * Así un atacante no puede reintentar adivinarlo.
   */
  consume(candidate: string): boolean {
    const hash = this.hash
    const expiresAt = this.expiresAt
    this.hash = null
    this.expiresAt = 0
    if (!hash) return false
    // Se calcula y compara siempre (también si caducó) para no distinguir los casos por tiempo.
    const same = constantTimeEqual(sha256Hex(candidate), hash)
    return same && this.now() <= expiresAt
  }

  /** ¿Hay un secreto vigente? */
  get active(): boolean {
    return this.hash !== null && this.now() <= this.expiresAt
  }

  get expiry(): number | null {
    return this.hash ? this.expiresAt : null
  }

  /** Anula el secreto (Cortar todo). */
  revoke(): void {
    this.hash = null
    this.expiresAt = 0
  }
}
