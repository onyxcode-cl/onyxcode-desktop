/**
 * Límites de internet del servidor del túnel. TODAS las peticiones llegan desde 127.0.0.1 (las conecta `cloudflared`): la IP real
 * del visitante viene en `Cf-Connecting-Ip`/`X-Forwarded-For`, que un proceso local puede falsificar. Por eso esa IP se usa SOLO
 * como pista para el límite de ritmo por visitante (jamás para autenticar) y los límites GLOBALES son los que de verdad protegen.
 */
import { isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import { TRAVEL_LIMITS } from '@shared/remote/travel'

/** Ventana deslizante: cuántos sucesos en los últimos `windowMs`. */
class Window {
  private hits: number[] = []
  constructor(
    private readonly windowMs: number,
    private readonly max: number
  ) {}
  /** Registra un suceso; `false` si ya se superó el máximo (el suceso rechazado no cuenta). */
  hit(now: number): boolean {
    const from = now - this.windowMs
    while (this.hits.length > 0 && this.hits[0] <= from) this.hits.shift()
    if (this.hits.length >= this.max) return false
    this.hits.push(now)
    return true
  }
  /** Descarta lo caducado; `true` si ya no queda nada. */
  prune(now: number): boolean {
    const from = now - this.windowMs
    while (this.hits.length > 0 && this.hits[0] <= from) this.hits.shift()
    return this.hits.length === 0
  }
}

/** Visitante «pista»: la IP de `Cf-Connecting-Ip` (o la primera de `X-Forwarded-For`) si es una IP válida; si no, `unknown`. */
export function visitorHint(headers: IncomingHttpHeaders): string {
  const cf = headers['cf-connecting-ip']
  const xff = headers['x-forwarded-for']
  const raw = (typeof cf === 'string' ? cf : typeof xff === 'string' ? xff.split(',')[0] : '').trim()
  return raw && isIP(raw) !== 0 ? raw.toLowerCase() : 'unknown'
}

export class TunnelLimits {
  private readonly httpIp = new Map<string, Window>()
  private readonly upIp = new Map<string, Window>()
  private readonly httpAll = new Window(10_000, TRAVEL_LIMITS.httpPer10sGlobal)
  private readonly upAll = new Window(60_000, TRAVEL_LIMITS.upgradesPerMinGlobal)
  private readonly gateFails = new Window(60_000, TRAVEL_LIMITS.gateFailuresPerMin)
  private gateLockedUntil = 0
  private failTotal = 0
  private sweepAt = 0

  constructor(private readonly clock: () => number = Date.now) {}

  private per(map: Map<string, Window>, key: string, windowMs: number, max: number): Window {
    let w = map.get(key)
    if (!w) {
      // Tope de visitantes distintos en memoria: un atacante no puede llenarla con IP inventadas.
      if (map.size >= 1000) map.delete(map.keys().next().value as string)
      w = new Window(windowMs, max)
      map.set(key, w)
    }
    return w
  }

  private sweep(now: number): void {
    if (now < this.sweepAt) return
    this.sweepAt = now + 30_000
    for (const m of [this.httpIp, this.upIp]) for (const [k, w] of m) if (w.prune(now)) m.delete(k)
  }

  /** ¿Cabe otra petición HTTP de este visitante? (60/10 s por visitante, 200/10 s global). */
  http(visitor: string): boolean {
    const now = this.clock()
    this.sweep(now)
    if (!this.per(this.httpIp, visitor, 10_000, TRAVEL_LIMITS.httpPer10sPerIp).hit(now)) return false
    return this.httpAll.hit(now)
  }

  /** ¿Cabe otro upgrade de WebSocket? (10/min por visitante, 30/min global). */
  upgrade(visitor: string): boolean {
    const now = this.clock()
    if (!this.per(this.upIp, visitor, 60_000, TRAVEL_LIMITS.upgradesPerMinPerIp).hit(now)) return false
    return this.upAll.hit(now)
  }

  /** ¿La puerta `/k/*` está bloqueada por exceso de fallos? (nunca afecta a quien ya tiene galleta: esas rutas no pasan por aquí). */
  gateLocked(): boolean {
    return this.clock() < this.gateLockedUntil
  }

  /** Un `/k/<T>` erróneo. Devuelve `true` si con este se activó el bloqueo (20/min global → 429 durante 60 s). */
  gateFail(): boolean {
    this.failTotal++
    if (!this.gateFails.hit(this.clock())) {
      this.gateLockedUntil = this.clock() + TRAVEL_LIMITS.gateLockMs
      return true
    }
    return false
  }

  get failures(): number {
    return this.failTotal
  }
}
