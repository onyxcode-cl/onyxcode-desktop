/** Enlace falso para las pruebas de los shims: registra lo que se le pide y deja controlar estado, respuestas y eventos. */
import type { HttpRequest, LinkStatus, RemoteLink, SubHandlers, Subscription } from '@shared/remote/link'

export interface FakeSub {
  eng: string
  since: number | undefined
  h: SubHandlers
  cancelled: boolean
}

export class FakeLink implements RemoteLink {
  state: LinkStatus = 'online'
  private readonly listeners = new Set<(s: LinkStatus) => void>()
  readonly calls: Array<{ ch: string; p: unknown; signal?: AbortSignal }> = []
  readonly https: Array<{ req: HttpRequest; signal?: AbortSignal }> = []
  readonly subs: FakeSub[] = []
  onCall: (ch: string, p: unknown, signal?: AbortSignal) => Promise<unknown> = () => Promise.resolve(undefined)
  onHttp: (req: HttpRequest, signal?: AbortSignal) => Promise<unknown> = () =>
    Promise.resolve({ status: 200, contentType: 'application/json', body: '{}' })
  /** `false` = `subscribe` devuelve `null` (sin canal). */
  canSubscribe = true

  status(): LinkStatus {
    return this.state
  }

  onStatus(fn: (s: LinkStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  set(s: LinkStatus): void {
    this.state = s
    for (const fn of [...this.listeners]) fn(s)
  }

  call(ch: string, p?: unknown, signal?: AbortSignal): Promise<unknown> {
    this.calls.push({ ch, p, signal })
    return this.onCall(ch, p, signal)
  }

  http(req: HttpRequest, signal?: AbortSignal): Promise<unknown> {
    this.https.push({ req, signal })
    return this.onHttp(req, signal)
  }

  subscribe(eng: string, h: SubHandlers, since?: number): Subscription | null {
    if (!this.canSubscribe) return null
    const s: FakeSub = { eng, since, h, cancelled: false }
    this.subs.push(s)
    return {
      id: this.subs.length,
      lastSeq: since ?? 0,
      cancel: () => {
        s.cancelled = true
      }
    }
  }

  /** El Mac (o la conexión) termina una suscripción. */
  end(sub: FakeSub, why: string): void {
    sub.cancelled = true
    sub.h.onEnd?.(why as never)
  }

  /** Última suscripción viva a un motor. */
  live(eng: string): FakeSub | undefined {
    return [...this.subs].reverse().find((s) => s.eng === eng && !s.cancelled)
  }
}
