/**
 * Concentrador de eventos hacia el celular (F0-T4).
 *
 *  - UN stream de subida por motor, bajo demanda (`ensure(eng)` al llegar un `sub`), con `client.global.event()` del SDK v2
 *    (inyectado como `open`). Cada evento se filtra por ámbito y se recorta (`event-trim.ts`) y se publica en el `EventLog`
 *    de T1 con su `seq`; el log vive en el servicio, entre conexiones, y de él sale `sub{since}` (reanudar sin huecos o `reset`).
 *  - Si el stream de subida se corta y reconecta, se marca un hueco (`markGap`): el celular recibe `reset` y resincroniza.
 *  - El bus de eventos de la app (T2) alimenta el motor `main` con la lista blanca `CELULAR_EVENTS`, también con la ventana cerrada.
 *  - `stop()` (no queda ningún dispositivo conectado) aborta los streams y se da de baja del bus: nada sigue corriendo.
 */
import type { EventLog } from '@shared/remote/mux'
import type { EngineRegistry, EngineTarget } from './engine-registry'
import { isUrgentChannel, remoteEventChannels, trimIpcEvent, trimOcEvent, type TrimDeps } from './event-trim'
import { CELULAR_EVENTS } from './policy'

export interface BusSubscriber {
  channels: ReadonlySet<string>
  trim?: (channel: string, payload: unknown) => unknown | null
  deliver: (channel: string, payload: unknown) => void
}

export interface SseHubOptions {
  log: EventLog
  registry: EngineRegistry
  trim: TrimDeps
  /** Abre el stream de subida del motor (`client.global.event({signal}).stream`). */
  open: (eng: string, target: EngineTarget, signal: AbortSignal) => Promise<AsyncIterable<unknown>>
  /** Alta en el bus de eventos de la app (T2): devuelve la baja. */
  subscribeBus?: (sub: BusSubscriber) => () => void
  /** Espera entre reintentos del stream de subida (ms; crece al doble hasta `maxBackoffMs`). */
  backoffMs?: number
  maxBackoffMs?: number
}

interface Upstream {
  eng: string
  ctl: AbortController
}

export class SseHub {
  private active = false
  private readonly ups = new Map<string, Upstream>()
  private readonly opened = new Set<string>()
  private unsubBus: (() => void) | null = null

  constructor(private readonly o: SseHubOptions) {}

  get running(): boolean {
    return this.active
  }

  /** Motores con stream de subida abierto. */
  engines(): string[] {
    return [...this.ups.keys()]
  }

  /** Hay (al menos) un dispositivo conectado: se engancha al bus de la app. */
  start(): void {
    if (this.active) return
    this.active = true
    const sub = this.o.subscribeBus
    if (sub && !this.unsubBus) {
      this.unsubBus = sub({
        channels: remoteEventChannels(Object.keys(CELULAR_EVENTS)),
        trim: (ch, p) => trimIpcEvent(ch, p, this.o.trim),
        deliver: (ch, p) => {
          this.o.log.append('main', { ch, ...(p === undefined ? {} : { p }), urgent: isUrgentChannel(ch) })
        }
      })
    }
  }

  /** Abre el stream de subida del motor si no está abierto (idempotente). */
  ensure(eng: string): void {
    if (!this.active || this.ups.has(eng) || !this.o.registry.has(eng)) return
    const up: Upstream = { eng, ctl: new AbortController() }
    this.ups.set(eng, up)
    void this.run(up)
  }

  /** Ya no queda ningún dispositivo: cierra todo. */
  stop(): void {
    this.active = false
    this.unsubBus?.()
    this.unsubBus = null
    for (const up of this.ups.values()) up.ctl.abort()
    this.ups.clear()
  }

  private async run(up: Upstream): Promise<void> {
    const { signal } = up.ctl
    let delay = this.o.backoffMs ?? 500
    const max = this.o.maxBackoffMs ?? 15_000
    while (!signal.aborted) {
      try {
        const target = await this.o.registry.resolve(up.eng)
        if (!target) break
        const stream = await this.o.open(up.eng, target, signal)
        // Reconexión (o reapertura tras un apagado): pudo perderse algo → `reset` para quien esté suscrito.
        if (this.opened.has(up.eng)) this.o.log.markGap(up.eng)
        this.opened.add(up.eng)
        delay = this.o.backoffMs ?? 500
        for await (const raw of stream) {
          if (signal.aborted) break
          const ev = trimOcEvent(raw, up.eng, this.o.trim)
          if (ev) this.o.log.append(up.eng, { oc: ev.oc, p: ev.p, urgent: ev.urgent })
        }
      } catch {
        /* se reintenta */
      }
      if (signal.aborted) break
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            resolve()
          },
          { once: true }
        )
      })
      delay = Math.min(delay * 2, max)
    }
    if (this.ups.get(up.eng) === up) this.ups.delete(up.eng)
  }
}
