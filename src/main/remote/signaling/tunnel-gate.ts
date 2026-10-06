/**
 * Puerta previa del servidor del túnel. El enlace público es adivinable por quien conozca el host, así que ANTES de servir nada
 * se exige la galleta de la puerta: `T` (16 bytes aleatorios, uno por túnel, solo en memoria) llega en la ruta del QR
 * `GET /k/<T>`, que responde `303 → /` con `Set-Cookie: __Host-lazunoxk=<T>; Secure; HttpOnly; SameSite=Lax; Path=/`. Sin galleta válida
 * TODO (incluido `/` y `/ws`) devuelve el mismo 404. `T` es antiabuso, no una credencial: viaja a Cloudflare. La autenticación real
 * sigue siendo el protocolo v3 + PIN.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { TRAVEL_GATE_COOKIE, TRAVEL_LIMITS } from '@shared/remote/travel'

const b64u = (b: Buffer): string => b.toString('base64url')
const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

/** Comparación en tiempo constante (se compara el hash de ambos: misma longitud siempre). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

export class TunnelGate {
  private t: string

  constructor(private readonly rand: (n: number) => Buffer = randomBytes) {
    this.t = b64u(rand(16))
  }

  /** `T`: 22 caracteres base64url. */
  get token(): string {
    return this.t
  }

  /** `T` nueva (túnel relanzado con otro nombre): la anterior deja de valer ya. */
  rotate(): void {
    this.t = b64u(this.rand(16))
  }

  /** ¿`candidate` (lo que vino tras `/k/`) es `T`? */
  matches(candidate: string): boolean {
    return candidate.length === this.token.length && safeEqual(candidate, this.token)
  }

  /** ¿La cabecera `Cookie` trae la galleta válida? */
  check(cookieHeader: string | undefined): boolean {
    if (!cookieHeader) return false
    for (const part of cookieHeader.split(';')) {
      const i = part.indexOf('=')
      if (i < 0) continue
      if (part.slice(0, i).trim() !== TRAVEL_GATE_COOKIE) continue
      const v = part.slice(i + 1).trim()
      if (v.length === this.token.length && safeEqual(v, this.token)) return true
    }
    return false
  }

  /** Valor de `Set-Cookie`: `__Host-` exige `Secure`, `Path=/` y nada de `Domain`. */
  setCookie(maxAgeSec: number = TRAVEL_LIMITS.cookieMaxAgeSec): string {
    return `${TRAVEL_GATE_COOKIE}=${this.token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(1, Math.trunc(maxAgeSec))}`
  }
}

/** `nonce` de la autocomprobación del Mac: de un solo uso y de vida corta. */
export class ProbeNonces {
  private readonly live = new Map<string, number>()
  constructor(
    private readonly clock: () => number = Date.now,
    private readonly ttlMs: number = TRAVEL_LIMITS.probeTtlMs
  ) {}

  issue(): string {
    const now = this.clock()
    for (const [k, t] of this.live) if (t <= now) this.live.delete(k)
    if (this.live.size >= 8) this.live.delete(this.live.keys().next().value as string)
    const n = b64u(randomBytes(16))
    this.live.set(n, now + this.ttlMs)
    return n
  }

  /** Consume el nonce: `true` solo la primera vez y dentro del plazo. */
  consume(n: string): boolean {
    const until = this.live.get(n)
    if (until === undefined) return false
    this.live.delete(n)
    return until > this.clock()
  }
}
