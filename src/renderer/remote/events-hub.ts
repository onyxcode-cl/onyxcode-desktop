/**
 * Concentrador de eventos del celular: UNA suscripción (`sub`) por motor, compartida por quien la necesite.
 *
 *  - Motor `main`: lleva los eventos IPC del Mac (`ev.ch`, lo que en escritorio es `webContents.send`) y los del motor
 *    OpenCode (`ev.oc`, el SSE de `client.global.event()`). Los primeros alimentan a `window.api.on(...)`; los segundos, a
 *    los `Response` SSE que fabrica `engine-fetch.ts`.
 *  - Motores de tarea (`task/<token>`): solo `oc`, mientras haya algún SSE abierto.
 *
 * Reanudación: se recuerda el último `seq` por motor y, al volver el canal (`online`), se suscribe con `since`. Si el Mac
 * responde con un `seq` menor (se reinició y el búfer ya no existe) o con `reset` (hubo hueco), los SSE abiertos se cierran:
 * el bucle de `lib/opencode.ts` los vuelve a abrir y su `onOpen` dispara `reconnectListeners`, que resincroniza el estado.
 * Los eventos IPC no tienen estado que resincronizar (cada pantalla vuelve a leer al montarse).
 */
import type { LinkStatus, RemoteLink, Subscription } from '@shared/remote/link'

export interface OcEventIn {
  seq: number
  oc: string
  p?: unknown
}

export interface OcStreamHandlers {
  onEvent(ev: OcEventIn): void
  /** Hubo hueco o reinicio del Mac: hay que cerrar el stream para que el cliente resincronice. */
  onReset(): void
  /** La suscripción terminó (`why` = código del multiplexor). */
  onEnd(why: string): void
}

interface Entry {
  eng: string
  sub: Subscription | null
  /** Generación de la suscripción vigente (descarta avisos de una anterior). */
  gen: number
  last: number | undefined
  ready: boolean
  channels: Map<string, Set<(p: unknown) => void>>
  streams: Set<OcStreamHandlers>
  /** Quienes esperan el primer acuse (`openStream`). */
  waiters: Array<{ ok: () => void; fail: (why: string) => void }>
}

export class EventsHub {
  private readonly entries = new Map<string, Entry>()
  private readonly off: () => void

  constructor(private readonly link: RemoteLink) {
    this.off = link.onStatus((s) => this.onStatus(s))
  }

  dispose(): void {
    this.off()
    for (const e of [...this.entries.values()]) this.drop(e)
  }

  /** Número de motores con suscripción (solo para pruebas). */
  get size(): number {
    return this.entries.size
  }

  private entry(eng: string): Entry {
    let e = this.entries.get(eng)
    if (!e) {
      e = { eng, sub: null, gen: 0, last: undefined, ready: false, channels: new Map(), streams: new Set(), waiters: [] }
      this.entries.set(eng, e)
    }
    return e
  }

  private onStatus(s: LinkStatus): void {
    if (s === 'online') for (const e of this.entries.values()) this.ensure(e)
  }

  private ensure(e: Entry): void {
    if (e.sub || this.link.status() !== 'online') return
    if (e.channels.size === 0 && e.streams.size === 0 && e.waiters.length === 0) return
    const gen = ++e.gen
    const sub = this.link.subscribe(
      e.eng,
      {
        onReady: (seq) => {
          if (e.gen !== gen) return
          e.ready = true
          if (e.last !== undefined && seq < e.last) this.resetStreams(e)
          e.last = seq
          const w = e.waiters.splice(0)
          for (const x of w) x.ok()
        },
        onEvent: (ev) => {
          if (e.gen !== gen) return
          e.last = ev.seq
          if (ev.ch !== undefined) {
            for (const fn of [...(e.channels.get(ev.ch) ?? [])]) {
              try {
                fn(ev.p)
              } catch {
                /* un oyente defectuoso no corta a los demás */
              }
            }
          }
          if (ev.oc !== undefined) {
            for (const h of [...e.streams]) {
              try {
                h.onEvent({ seq: ev.seq, oc: ev.oc, p: ev.p })
              } catch {
                /* ídem */
              }
            }
          }
        },
        onReset: (seq) => {
          if (e.gen !== gen) return
          e.last = seq
          this.resetStreams(e)
        },
        onEnd: (why) => {
          if (e.gen !== gen) return
          e.sub = null
          e.ready = false
          const w = e.waiters.splice(0)
          for (const x of w) x.fail(why)
          const streams = [...e.streams]
          e.streams.clear()
          for (const h of streams) h.onEnd(why)
          // Los oyentes IPC siguen: se vuelve a suscribir con `since` cuando el canal esté otra vez en línea.
          if (e.channels.size === 0) this.entries.delete(e.eng)
        }
      },
      e.last
    )
    e.sub = sub
  }

  private resetStreams(e: Entry): void {
    for (const h of [...e.streams]) {
      try {
        h.onReset()
      } catch {
        /* nada */
      }
    }
  }

  private drop(e: Entry): void {
    this.entries.delete(e.eng)
    const sub = e.sub
    e.sub = null
    e.gen++
    sub?.cancel()
  }

  private release(e: Entry): void {
    if (e.channels.size > 0 || e.streams.size > 0 || e.waiters.length > 0) return
    this.drop(e)
  }

  /** Oyente de un canal IPC del Mac (`window.api.on`). Devuelve la baja. */
  onChannel(ch: string, fn: (p: unknown) => void): () => void {
    const e = this.entry('main')
    let set = e.channels.get(ch)
    if (!set) e.channels.set(ch, (set = new Set()))
    set.add(fn)
    this.ensure(e)
    return () => {
      const cur = this.entries.get('main')
      const s = cur?.channels.get(ch)
      if (!cur || !s) return
      s.delete(fn)
      if (s.size === 0) cur.channels.delete(ch)
      this.release(cur)
    }
  }

  /**
   * Abre un stream de eventos del motor. Resuelve con la baja cuando el Mac acusó la suscripción; rechaza si no se puede
   * (canal fuera de línea, bloqueado, motor desconocido, demasiados streams).
   */
  openStream(eng: string, h: OcStreamHandlers, signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'))
      if (this.link.status() !== 'online') return reject(new Error('offline'))
      const e = this.entry(eng)
      let settled = false
      const unsub = (): void => {
        e.streams.delete(h)
        const idx = e.waiters.indexOf(w)
        if (idx >= 0) e.waiters.splice(idx, 1)
        if (this.entries.get(eng) === e) this.release(e)
      }
      const w = {
        ok: () => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          resolve(unsub)
        },
        fail: (why: string) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          e.streams.delete(h)
          reject(new Error(why))
        }
      }
      const onAbort = (): void => {
        if (settled) return
        settled = true
        unsub()
        reject(new Error('aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      e.streams.add(h)
      if (e.ready && e.sub) {
        w.ok()
        return
      }
      e.waiters.push(w)
      this.ensure(e)
      // `ensure` no pudo suscribirse (sin canal): no se queda esperando.
      if (!e.sub) w.fail('offline')
    })
  }
}
