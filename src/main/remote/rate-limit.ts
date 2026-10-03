/**
 * Límites de uso de una conexión del celular: cubo de fichas para peticiones (10/s, ráfaga 20), tope de
 * prompts por minuto (6) y contador de violaciones (3 = desconexión). Reloj inyectable para las pruebas.
 */
import { LIMITS } from '@shared/remote/protocol'

export type Clock = () => number

export class RateLimiter {
  private tokens: number = LIMITS.requestBurst
  private last: number
  private prompts: number[] = []
  private violationCount = 0
  private callTokens: number = LIMITS.callBurst
  private callLast: number
  private floodTokens: number = LIMITS.frameFloodBurst
  private floodLast: number

  constructor(private readonly now: Clock = Date.now) {
    this.last = now()
    this.callLast = this.last
    this.floodLast = this.last
  }

  /** Cubo de `call`/`http`/`sub` del protocolo v2 (lecturas: 40/s, ráfaga 120). */
  allowCall(): boolean {
    const t = this.now()
    this.callTokens = Math.min(LIMITS.callBurst, this.callTokens + (Math.max(0, t - this.callLast) / 1000) * LIMITS.callsPerSecond)
    this.callLast = t
    if (this.callTokens < 1) return false
    this.callTokens -= 1
    return true
  }

  /** Red de seguridad para `chunk`/`credit`/`cancel` (el volumen real lo limita el crédito). */
  allowFlood(): boolean {
    const t = this.now()
    this.floodTokens = Math.min(
      LIMITS.frameFloodBurst,
      this.floodTokens + (Math.max(0, t - this.floodLast) / 1000) * LIMITS.frameFloodPerSecond
    )
    this.floodLast = t
    if (this.floodTokens < 1) return false
    this.floodTokens -= 1
    return true
  }

  /** ¿Cabe otra petición? Gasta una ficha si sí. */
  allowRequest(): boolean {
    const t = this.now()
    const elapsed = Math.max(0, t - this.last) / 1000
    this.last = t
    this.tokens = Math.min(LIMITS.requestBurst, this.tokens + elapsed * LIMITS.requestsPerSecond)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  /** ¿Cabe otro prompt en la última ventana de un minuto? Lo registra si sí. */
  allowPrompt(): boolean {
    const t = this.now()
    this.prompts = this.prompts.filter((x) => t - x < 60_000)
    if (this.prompts.length >= LIMITS.promptsPerMinute) return false
    this.prompts.push(t)
    return true
  }

  /** Registra una violación; `true` = ya hay que cortar la conexión. */
  violation(): boolean {
    this.violationCount += 1
    return this.violationCount >= LIMITS.maxViolations
  }

  get violations(): number {
    return this.violationCount
  }
}
