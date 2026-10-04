/**
 * Los shims sobre el multiplexor REAL (`@shared/remote/mux`, el mismo código que el Mac y el celular): trozos de subida y de
 * bajada, base64, cancelación, SSE con `EventLog` y reanudación por `seq`, y errores del despachador del Mac.
 */
import { describe, expect, it } from 'vitest'
import { isMuxClientFrame, isMuxHostFrame, parseClientFrame, parseHostFrame, utf8Length } from '@shared/remote/protocol'
import {
  EventLog,
  Mux,
  MuxError,
  Outbox,
  type DispatchCtx,
  type HttpRequest,
  type MuxDispatch,
  type SubHandlers,
  type Subscription
} from '@shared/remote/mux'
import type { LinkStatus, RemoteLink } from '@shared/remote/link'
import { createEngineFetch } from './engine-fetch'
import { EventsHub } from './events-hub'
import { buildRemoteWindowApi } from './ipc-shim'

const text = (c: string): string => `err:${c}`

/** Dos multiplexores unidos por una «línea» en memoria (entrega asíncrona, sin límites de ancho de banda). */
function connect(dispatch: MuxDispatch, log: EventLog): { client: Mux; host: Mux; violations: string[] } {
  const violations: string[] = []
  const peers: { host?: Mux; client?: Mux } = {}
  const hostOut = new Outbox({
    send: (t) => {
      queueMicrotask(() => {
        const p = parseHostFrame(t)
        if (p.ok && isMuxHostFrame(p.value)) peers.client?.receive(p.value, utf8Length(t))
      })
      return true
    }
  })
  const clientOut = new Outbox({
    send: (t) => {
      queueMicrotask(() => {
        const p = parseClientFrame(t)
        if (p.ok && isMuxClientFrame(p.value)) peers.host?.receive(p.value, utf8Length(t))
      })
      return true
    }
  })
  peers.host = new Mux({ role: 'host', out: hostOut, dispatch, events: log, onViolation: (r) => void violations.push(`host:${r}`) })
  peers.client = new Mux({ role: 'client', out: clientOut, onViolation: (r) => void violations.push(`client:${r}`) })
  return { client: peers.client, host: peers.host, violations }
}

/** Enlace que usa el multiplexor actual (como el arranque ligero: cambia al reconectar). */
class MuxLink implements RemoteLink {
  mux: Mux | null = null
  state: LinkStatus = 'offline'
  private readonly ls = new Set<(s: LinkStatus) => void>()
  status = (): LinkStatus => this.state
  onStatus(fn: (s: LinkStatus) => void): () => void {
    this.ls.add(fn)
    return () => this.ls.delete(fn)
  }
  attach(m: Mux): void {
    this.mux = m
    this.state = 'online'
    for (const fn of [...this.ls]) fn('online')
  }
  drop(): void {
    this.mux?.close()
    this.mux = null
    this.state = 'reconnecting'
    for (const fn of [...this.ls]) fn('reconnecting')
  }
  call = (ch: string, p?: unknown, signal?: AbortSignal): Promise<unknown> =>
    this.mux ? this.mux.call(ch, p, { signal }) : Promise.reject(new Error('offline'))
  http = (req: HttpRequest, signal?: AbortSignal): Promise<unknown> =>
    this.mux ? this.mux.http(req, { signal }) : Promise.reject(new Error('offline'))
  subscribe = (eng: string, h: SubHandlers, since?: number): Subscription | null => this.mux?.subscribe(eng, h, since) ?? null
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Seen {
  https: HttpRequest[]
  signals: AbortSignal[]
}

function hostDispatch(
  seen: Seen,
  handlers: Partial<Record<string, (r: HttpRequest, ctx: DispatchCtx) => Promise<unknown>>> = {}
): MuxDispatch {
  return {
    call: async (req) => {
      if (req.ch === 'settings:get') return { language: 'es' }
      if (req.ch === 'tasks:pickFolder') throw new MuxError('forbidden', 'out-of-scope')
      if (req.ch === 'tasks:start') throw new MuxError('forbidden', 'rejected')
      throw new MuxError('failed', 'canal de prueba')
    },
    http: async (req, ctx) => {
      seen.https.push(req)
      seen.signals.push(ctx.signal)
      const h = handlers[req.path]
      if (h) return h(req, ctx)
      return { status: 200, contentType: 'application/json', body: JSON.stringify({ path: req.path, len: (req.body ?? '').length }) }
    }
  }
}

describe('shims sobre el multiplexor real', () => {
  it('IPC: invoke ↔ call con respuesta desenvuelta y errores del Mac tipados', async () => {
    const link = new MuxLink()
    const hub = new EventsHub(link)
    const api = buildRemoteWindowApi({ link, events: hub, text })
    const { client } = connect(hostDispatch({ https: [], signals: [] }), new EventLog())
    link.attach(client)
    expect(await api.invoke('settings:get')).toEqual({ ok: true, data: { language: 'es' } })
    expect(await api.tasks.invoke('tasks:pickFolder')).toEqual({ ok: false, code: 'FORBIDDEN', error: 'err:forbidden' })
    expect(await api.tasks.invoke('tasks:start', { folder: '/x' } as never)).toEqual({ ok: false, code: 'FORBIDDEN', error: 'err:denied' })
    expect(await api.invoke('app:info')).toMatchObject({ ok: false, error: 'canal de prueba' })
    link.drop()
    expect(await api.invoke('settings:get')).toEqual({ ok: false, code: 'ERROR', error: 'err:disconnected' })
  })

  it('fetch: cuerpo de subida de 600 KB y respuesta de 3 MB (trozos de ida y vuelta) y binario en base64', async () => {
    const link = new MuxLink()
    const hub = new EventsHub(link)
    const f = createEngineFetch({ link, events: hub, text })
    const big = 'ñ😀'.repeat(150_000)
    const bytes = new Uint8Array(1_500_000).map((_, i) => (i * 31) % 256)
    const seen: Seen = { https: [], signals: [] }
    const { client, violations } = connect(
      hostDispatch(seen, {
        '/big': async () => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ blob: big.repeat(3) }) }),
        '/img': async () => ({ status: 200, contentType: 'image/png', body: Buffer.from(bytes).toString('base64'), encoding: 'base64' })
      }),
      new EventLog()
    )
    link.attach(client)
    const up = JSON.stringify({ parts: [{ type: 'text', text: big }] })
    const r1 = await f('onyx://engine/main/session/s1/prompt_async', { method: 'POST', body: up })
    expect(((await r1.json()) as { len: number }).len).toBe(up.length)
    expect(seen.https[0]?.body).toBe(up)
    const r2 = await f('onyx://engine/main/big')
    expect(((await r2.json()) as { blob: string }).blob.length).toBe(big.length * 3)
    const r3 = await f('onyx://engine/main/img')
    expect(new Uint8Array(await r3.arrayBuffer())).toEqual(bytes)
    expect(violations).toEqual([])
  }, 20_000)

  it('AbortSignal envía `cancel`: el despachador del Mac ve su señal abortada y el fetch rechaza con AbortError', async () => {
    const link = new MuxLink()
    const hub = new EventsHub(link)
    const f = createEngineFetch({ link, events: hub, text })
    const seen: Seen = { https: [], signals: [] }
    const { client } = connect(hostDispatch(seen, { '/slow': () => new Promise(() => undefined) }), new EventLog())
    link.attach(client)
    const ac = new AbortController()
    const p = f('onyx://engine/main/slow', { signal: ac.signal }).catch((e: unknown) => e)
    await tick()
    expect(seen.signals[0]?.aborted).toBe(false)
    ac.abort()
    expect((await p) as Error).toMatchObject({ name: 'AbortError' })
    await tick()
    expect(seen.signals[0]?.aborted).toBe(true)
  })

  it('SSE: el Mac publica en el EventLog y el stream recibe; al caer el canal el stream falla y, al volver, se reabre con resincronización', async () => {
    const log = new EventLog()
    const link = new MuxLink()
    const hub = new EventsHub(link)
    const f = createEngineFetch({ link, events: hub, text })
    const d = hostDispatch({ https: [], signals: [] })
    let conn = connect(d, log)
    link.attach(conn.client)
    const res = await f('onyx://engine/main/global/event')
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    const read = async (): Promise<string> => (await reader.read()).value ?? ''
    expect(await read()).toContain('server.connected')
    log.append('main', { oc: 'session.created', p: { directory: '/p', properties: { info: { id: 's1' } } } })
    const frame = await read()
    expect(frame).toContain('"type":"session.created"')
    expect(frame).toContain('id: 1')
    // Se cae la conexión: el stream falla con error tipado (el bucle de lib/opencode.ts lo reabre).
    link.drop()
    await expect(reader.read()).rejects.toMatchObject({ code: 'disconnected' })
    // Mientras estaba caída llegaron eventos; al volver, un stream nuevo reanuda sin huecos.
    log.append('main', { oc: 'session.updated', p: { directory: '/p', properties: {} } })
    conn = connect(d, log)
    link.attach(conn.client)
    const res2 = await f('onyx://engine/main/global/event')
    const r2 = res2.body!.pipeThrough(new TextDecoderStream()).getReader()
    expect((await r2.read()).value).toContain('server.connected')
    log.append('main', { oc: 'session.idle', p: { directory: '/p', properties: {} } })
    expect((await r2.read()).value).toContain('session.idle')
    expect(conn.violations).toEqual([])
  })

  it('eventos IPC (`ch`) reanudan por `since` tras reconectar: no se pierde el ocurrido mientras estaba caído', async () => {
    const log = new EventLog()
    const link = new MuxLink()
    const hub = new EventsHub(link)
    const api = buildRemoteWindowApi({ link, events: hub, text })
    const d = hostDispatch({ https: [], signals: [] })
    const got: unknown[] = []
    link.attach(connect(d, log).client)
    api.on('opencode:status', (p) => got.push(p))
    await tick()
    log.append('main', { ch: 'opencode:status', p: { n: 1 } })
    await tick()
    expect(got).toEqual([{ n: 1 }])
    link.drop()
    log.append('main', { ch: 'opencode:status', p: { n: 2 } })
    link.attach(connect(d, log).client)
    await tick(20)
    log.append('main', { ch: 'opencode:status', p: { n: 3 } })
    await tick()
    expect(got).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })
})
