/**
 * Secreto de un solo uso del código QR (v3). El secreto `q` solo vive en la URL del QR que ve el dueño y en el celular que
 * lo escanea: NUNCA viaja por la señalización. El `hello` lleva solo `qid = pairId(q)` y el canal se autentica con
 * `pairKey(q)` (`@shared/remote/handshake`). Aquí se guarda `{ qid, key }` en memoria (derivaciones de un solo sentido de `q`).
 *
 *  - Caduca a los 120 s.
 *  - Reconocer el `qid` (`match`) NO consume el QR: un `qid` ajeno suma un fallo y 5 fallos (de `qid` o de vinculación) lo anulan.
 *    Así un vecino de la red no puede quemar el QR con un solo intento, y adivinar el `qid` (256 bits) es inviable.
 *  - Un único intento de vinculación en curso (`reserve`/`release`). Solo un `hs3` correcto lo consume (`consume`).
 *  - Reloj inyectable. Comparaciones en tiempo constante.
 */
import { randomBytes } from 'node:crypto'
import { constantTimeEqual, toBase64Url } from '@shared/remote/code'
import { pairId, pairKey } from '@shared/remote/handshake'
import { LIMITS } from '@shared/remote/protocol'
import type { Clock } from './rate-limit'

export interface PairingToken {
  /** Secreto `q` en claro (base64url, 43 caracteres) para armar la URL del QR. */
  secret: string
  expiresAt: number
}

interface Live {
  qid: string
  key: Uint8Array
  expiresAt: number
  fails: number
  reserved: boolean
}

export class PairingManager {
  private live: Live | null = null

  /** `onExhausted`: el QR se anuló por demasiados fallos (para que el servicio lo refleje en Ajustes). */
  constructor(
    private readonly now: Clock = Date.now,
    private readonly onExhausted: () => void = () => undefined
  ) {}

  /** Crea un secreto nuevo (el anterior deja de valer). */
  create(): PairingToken {
    const secret = toBase64Url(randomBytes(LIMITS.secretBytes))
    this.live = { qid: pairId(secret), key: pairKey(secret), expiresAt: this.now() + LIMITS.pairingTtlMs, fails: 0, reserved: false }
    return { secret, expiresAt: this.live.expiresAt }
  }

  private current(): Live | null {
    const l = this.live
    return l && this.now() <= l.expiresAt ? l : null
  }

  /** Suma un fallo; con `pairMaxFails` el QR se anula. */
  private fail(l: Live): void {
    l.fails++
    if (l.fails >= LIMITS.pairMaxFails) {
      this.revoke()
      this.onExhausted()
    }
  }

  /**
   * ¿Es el `qid` del QR vigente? NO consume. Un `qid` distinto suma un fallo. Sin QR vigente (o caducado) devuelve `false`
   * sin contar nada: no hay nada que anular.
   */
  match(qid: string): boolean {
    const l = this.current()
    if (!l) return false
    // Se compara siempre con el vigente, sin salida anticipada por contenido.
    if (constantTimeEqual(qid, l.qid)) return true
    this.fail(l)
    return false
  }

  /** ¿Hay un intento de vinculación en curso? */
  get reserved(): boolean {
    return this.current()?.reserved === true
  }

  /** Reserva el único intento en curso y devuelve la clave del canal; `null` si no es el QR, caducó o ya hay otro intento. */
  reserve(qid: string): Uint8Array | null {
    const l = this.current()
    if (!l || l.reserved || !constantTimeEqual(qid, l.qid)) return null
    l.reserved = true
    return l.key
  }

  /** Termina el intento sin éxito. `failed`: cuenta un fallo (handshake roto o canal cerrado a medias). */
  release(failed: boolean): void {
    const l = this.live
    if (!l?.reserved) return
    l.reserved = false
    if (failed) this.fail(l)
  }

  /** Solo tras un `hs3` correcto: el QR deja de valer. `false` si caducó o no había intento reservado. */
  consume(): boolean {
    const l = this.current()
    const ok = !!l && l.reserved
    this.live = null
    return ok
  }

  /** ¿Hay un secreto vigente? */
  get active(): boolean {
    return this.current() !== null
  }

  get expiry(): number | null {
    return this.live ? this.live.expiresAt : null
  }

  /** Anula el secreto (Cortar todo, o demasiados fallos). */
  revoke(): void {
    this.live = null
  }
}
