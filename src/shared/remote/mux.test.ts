import { describe, expect, it } from 'vitest'
import { LIMITS, isMuxClientFrame, isMuxHostFrame, parseClientFrame, parseHostFrame, utf8Length } from './protocol'
import {
  BUFFER,
  EventLog,
  Mux,
  MuxCallError,
  MuxError,
  Outbox,
  PRIO,
  splitText,
  type DispatchCtx,
  type MuxDispatch,
  type SubHandlers
} from './mux'

// ── Arnés: dos extremos unidos por «cables» con ancho de banda y reloj simulados ──

class Wire {
  private q: Array<{ text: string; left: number }> = []
  buffered = 0
  sizes: number[] = []
  types: Array<{ at: number; t: string; id?: number; bytes: number }> = []
  lowCb: (() => void) | null = null
  /** Si devuelve `true`, la trama no se entrega: queda retenida hasta `release()`. */
  hold: (text: string) => boolean = () => false
  held: string[] = []

  constructor(
    private readonly clock: { now: number },
    private readonly bytesPerMs: number,
    private readonly deliver: (text: string) => void
  ) {}

  send(text: string): boolean {
    const bytes = utf8Length(text)
    this.sizes.push(bytes)
    const head = text.slice(0, 80)
    const t = /"t":"([a-z]+)"/.exec(head)?.[1] ?? '?'
    const id = /"(?:id|s)":(\d+)/.exec(head)?.[1]
    this.types.push({ at: this.clock.now, t, id: id === undefined ? undefined : Number(id), bytes })
    this.buffered += bytes
    this.q.push({ text, left: bytes })
    return true
  }

  bufferedAmount(): number {
    return this.buffered
  }

  step(): void {
    let budget = this.bytesPerMs
    const before = this.buffered
    while (budget > 0 && this.q.length > 0) {
      const h = this.q[0]
      const use = Math.min(budget, h.left)
      h.left -= use
      budget -= use
      this.buffered -= use
      if (h.left === 0) {
        this.q.shift()
        if (this.hold(h.text)) this.held.push(h.text)
        else this.deliver(h.text)
      }
    }
    if (before >= BUFFER.low && this.buffered < BUFFER.low) this.lowCb?.()
  }

  release(): void {
    const all = this.held.splice(0)
    for (const t of all) this.deliver(t)
  }
}

interface TestDispatch extends MuxDispatch {
  calls: Array<{ ch: string; p: unknown; id: number }>
  https: Array<{ eng: string; path: string; body?: string }>
  signals: Map<number, AbortSignal>
  resolvers: Map<number, (v: unknown) => void>
}

function makeDispatch(): TestDispatch {
  const d: TestDispatch = {
    calls: [],
    https: [],
    signals: new Map(),
    resolvers: new Map(),
    call(req, ctx: DispatchCtx) {
      d.calls.push({ ch: req.ch, p: req.p, id: ctx.id })
      d.signals.set(ctx.id, ctx.signal)
      if (req.ch === 'echo') return Promise.resolve(req.p)
      if (req.ch === 'deny') return Promise.reject(new MuxError('forbidden'))
      if (req.ch === 'boom') return Promise.reject(new Error('secreto interno'))
      if (req.ch === 'big') return Promise.resolve('x'.repeat((req.p as number) ?? 0))
      return new Promise((resolve) => d.resolvers.set(ctx.id, resolve)) // 'slow'
    },
    http(req, ctx) {
      d.https.push({ eng: req.eng, path: req.path, body: req.body })
      d.signals.set(ctx.id, ctx.signal)
      return Promise.resolve({ status: 200, len: (req.body ?? '').length })
    }
  }
  return d
}

function setup(
  opts: { bytesPerMs?: number; dispatch?: MuxDispatch | null; log?: EventLog; hostOnly?: boolean; canEmit?: () => boolean } = {}
) {
  const clock = { now: 1_000_000 }
  const violations: { host: string[]; client: string[] } = { host: [], client: [] }
  const dispatch = opts.dispatch === null ? undefined : (opts.dispatch ?? makeDispatch())
  const log = opts.log ?? new EventLog(() => clock.now)
  const rate = opts.bytesPerMs ?? 10_000
  const peers: { host?: Mux; client?: Mux } = {}
  const toHost = new Wire(clock, rate, (text) => {
    const p = parseClientFrame(text)
    if (!p.ok) return void violations.host.push(`parse:${p.reason}`)
    if (isMuxClientFrame(p.value)) peers.host?.receive(p.value, utf8Length(text))
  })
  const toClient = new Wire(clock, rate, (text) => {
    const p = parseHostFrame(text)
    if (!p.ok) return void violations.client.push(`parse:${p.reason}`)
    if (isMuxHostFrame(p.value)) peers.client?.receive(p.value, utf8Length(text))
  })
  const hostOut = new Outbox(toClient)
  const clientOut = new Outbox(toHost)
  toClient.lowCb = () => hostOut.pump()
  toHost.lowCb = () => clientOut.pump()
  const host = (peers.host = new Mux({
    role: 'host',
    out: hostOut,
    dispatch: dispatch as MuxDispatch | undefined,
    events: log,
    canEmit: opts.canEmit,
    urgent: (f) => f.t === 'call' && f.ch === 'permission',
    onViolation: (r) => void violations.host.push(r)
  }))
  const client = (peers.client = new Mux({
    role: 'client',
    out: clientOut,
    urgent: (f) => f.t === 'call' && f.ch === 'permission',
    onViolation: (r) => void violations.client.push(r)
  }))
  const run = async (ms: number): Promise<void> => {
    for (let i = 0; i < ms; i++) {
      clock.now++
      toHost.step()
      toClient.step()
      for (let k = 0; k < 4; k++) await null
    }
  }
  const until = async (cond: () => boolean, maxMs = 5000): Promise<void> => {
    for (let i = 0; i < maxMs && !cond(); i += 5) await run(5)
  }
  const wait = async <T>(p: Promise<T>, maxMs = 30_000): Promise<T> => {
    let settled = false
    p.then(
      () => (settled = true),
      () => (settled = true)
    )
    for (let i = 0; i < maxMs && !settled; i += 5) await run(5)
    return p
  }
  return {
    wait,
    clock,
    host,
    client,
    toHost,
    toClient,
    hostOut,
    clientOut,
    dispatch: dispatch as TestDispatch,
    log,
    violations,
    run,
    until
  }
}

const handlers = (): SubHandlers & {
  events: Array<{ seq: number; name?: string; p?: unknown }>
  resets: number[]
  ready: number[]
  ends: string[]
} => {
  const h = {
    events: [] as Array<{ seq: number; name?: string; p?: unknown }>,
    resets: [] as number[],
    ready: [] as number[],
    ends: [] as string[],
    onReady: (s: number) => void h.ready.push(s),
    onEvent: (e: { seq: number; ch?: string; oc?: string; p?: unknown }) => void h.events.push({ seq: e.seq, name: e.ch ?? e.oc, p: e.p }),
    onReset: (s: number) => void h.resets.push(s),
    onEnd: (w: string) => void h.ends.push(w)
  }
  return h
}

// ── Trozos ──

describe('splitText', () => {
  it('cada trozo escapado cabe en 56 KiB y la unión devuelve el texto (comillas, controles, emoji)', () => {
    const text = ('a"b\\c\n\u0001é€😀'.repeat(20_000) + '\ud800x').slice(0)
    const pieces = splitText(text)
    expect(pieces.length).toBeGreaterThan(5)
    let joined = ''
    for (const p of pieces) {
      const d = text.slice(p.start, p.end)
      expect(JSON.stringify(d).length - 2).toBeLessThanOrEqual(LIMITS.chunkBytes)
      expect(p.bytes).toBe(utf8Length(d))
      joined += d
    }
    expect(joined).toBe(text)
  })

  it('no separa un par sustituto', () => {
    const text = '😀'.repeat(30_000)
    for (const p of splitText(text)) {
      expect(text.charCodeAt(p.start) & 0xfc00).toBe(0xd800)
      expect(text.charCodeAt(p.end - 1) & 0xfc00).toBe(0xdc00)
    }
  })
})

// ── Llamadas, trozos y 10 MB ──

describe('call / http', () => {
  it('llamada pequeña de ida y vuelta, y el error del despachador sale sin detalles internos', async () => {
    const t = setup()
    expect(await t.wait(t.client.call('echo', { hola: 1 }))).toEqual({ hola: 1 })
    await expect(t.wait(t.client.call('deny'))).rejects.toMatchObject({ code: 'forbidden' })
    const boom = t.wait(t.client.call('boom'))
    await expect(boom).rejects.toMatchObject({ code: 'failed' })
    await boom.catch((e: MuxCallError) => expect(e.detail).toBeUndefined())
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('http llega con el cuerpo intacto', async () => {
    const t = setup()
    const r = t.client.http({
      eng: 'main',
      method: 'POST',
      path: '/session',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json' }
    })
    expect(await t.wait(r)).toEqual({ status: 200, len: 7 })
    expect(t.dispatch.https[0]).toMatchObject({ eng: 'main', path: '/session', body: '{"a":1}' })
  })

  it('10 MB de subida y bajadas de 2 x 5 MB, sin pasar de 64 KiB por trama y con ensamblado exacto', { timeout: 120_000 }, async () => {
    const t = setup({ bytesPerMs: 20_000 })
    const body = 'La ñandú comió "pan" '.repeat(Math.ceil((10 * 1024 * 1024) / 21)).slice(0, 10 * 1024 * 1024)
    const up = t.client.http({ eng: 'main', method: 'POST', path: '/upload', body })
    const down1 = t.client.call('big', 5 * 1024 * 1024)
    const down2 = t.client.call('big', 5 * 1024 * 1024)
    const [r1, r2, upRes] = await t.wait(Promise.all([down1, down2, up]), 60_000)
    expect((r1 as string).length).toBe(5 * 1024 * 1024)
    expect(r2).toBe(r1)
    expect(t.dispatch.https[0].body).toBe(body)
    expect(upRes).toEqual({ status: 200, len: body.length })
    for (const s of [...t.toHost.sizes, ...t.toClient.sizes]) expect(s).toBeLessThanOrEqual(LIMITS.maxFrameBytes)
    expect(t.toHost.types.filter((x) => x.t === 'chunk').length).toBeGreaterThanOrEqual(180)
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('un eco de 7,9 MB cruza ambas direcciones sin pasar de 64 KiB por trama', { timeout: 120_000 }, async () => {
    const t = setup({ bytesPerMs: 20_000 })
    const text = 'z'.repeat(7_900_000)
    const r = t.client.call('echo', text)
    expect(await t.wait(r, 60_000)).toBe(text)
    for (const s of [...t.toHost.sizes, ...t.toClient.sizes]) expect(s).toBeLessThanOrEqual(LIMITS.maxFrameBytes)
  })

  it('respuesta mayor de 8 MiB = too-large; subida mayor de 16 MiB = too-large local', async () => {
    const t = setup({ bytesPerMs: 100_000 })
    const r = t.client.call('big', 8 * 1024 * 1024 + 10)
    r.catch(() => undefined)
    await t.run(100)
    await expect(r).rejects.toMatchObject({ code: 'too-large' })
    await expect(t.client.call('echo', 'y'.repeat(LIMITS.maxUploadBytes + 1))).rejects.toMatchObject({ code: 'too-large' })
  })

  it('sin despachador todo se rechaza con unavailable (el motor no se expone)', async () => {
    const t = setup({ dispatch: null })
    await expect(t.wait(t.client.call('echo', 1))).rejects.toMatchObject({ code: 'unavailable' })
    const s = handlers()
    t.client.subscribe('main', s)
    await t.run(20)
    expect(s.ends).toEqual(['unavailable'])
  })
})

// ── Crédito ──

describe('control de flujo por crédito', () => {
  it('sin crédito el emisor se detiene en la ventana de 256 KiB y sigue al recibirlo', async () => {
    const t = setup()
    t.toClient.hold = (text) => text.startsWith('{"t":"credit"')
    const body = 'q'.repeat(2 * 1024 * 1024)
    const up = t.client.http({ eng: 'main', method: 'POST', path: '/u', body })
    await t.run(1500)
    const sent = t.toHost.types.filter((x) => x.t === 'chunk').reduce((n, x) => n + x.bytes, 0)
    expect(sent).toBeLessThanOrEqual(LIMITS.creditWindowBytes)
    expect(sent).toBeGreaterThan(LIMITS.creditWindowBytes - LIMITS.maxFrameBytes)
    expect(t.dispatch.https).toHaveLength(0)
    t.toClient.hold = () => false
    t.toClient.release()
    expect(await t.wait(up, 60_000)).toEqual({ status: 200, len: body.length })
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('un credit mayor que lo enviado sin confirmar es violación; crédito de algo terminado se ignora', async () => {
    const t = setup()
    const r = t.client.call('echo', 1)
    await t.wait(r)
    t.host.receive({ t: 'credit', id: 1, bytes: 5 }, 30)
    expect(t.violations.host).toEqual([])
    // Subida en curso (retenida) y crédito inventado.
    t.toClient.hold = (x) => x.startsWith('{"t":"credit"')
    void t.client.http({ eng: 'main', method: 'POST', path: '/u', body: 'w'.repeat(500_000) }).catch(() => undefined)
    await t.run(50)
    const id = t.toHost.types.find((x) => x.t === 'http')?.id as number
    t.client.receive({ t: 'credit', id, bytes: 10_000_000 }, 30)
    expect(t.violations.client).toEqual(['credit'])
  })

  it('el receptor devuelve crédito en bloques de al menos 32 KiB mientras ensambla', () => {
    const t = setup()
    t.host.receive({ t: 'call', id: 1, ch: 'echo', ck: 2_000_000 }, 40)
    const d = 'a'.repeat(LIMITS.chunkBytes)
    for (let n = 0; n < 6; n++) t.host.receive({ t: 'chunk', id: 1, n, last: false, d }, 57_000)
    const credits = t.toClient.types.filter((x) => x.t === 'credit')
    expect(credits).toHaveLength(6)
    expect(t.violations.host).toEqual([])
    expect(t.dispatch.calls).toHaveLength(0)
  })
})

// ── Cancelación ──

describe('cancelación', () => {
  it('abortar una llamada en vuelo avisa al despachador y descarta su resultado', async () => {
    const t = setup()
    const ac = new AbortController()
    const r = t.client.call('slow', null, { signal: ac.signal })
    r.catch(() => undefined)
    await t.until(() => t.dispatch.calls.length === 1)
    ac.abort()
    await expect(r).rejects.toMatchObject({ name: 'AbortError', code: 'cancelled' })
    await t.run(20)
    expect(t.dispatch.signals.get(t.dispatch.calls[0].id)?.aborted).toBe(true)
    t.dispatch.resolvers.get(t.dispatch.calls[0].id)?.('tarde')
    const before = t.toClient.types.length
    await t.run(20)
    expect(t.toClient.types.length).toBe(before) // nada que enviar
    expect(t.host.inFlight).toBe(0)
    expect(t.client.inFlight).toBe(0)
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('abortar a mitad de una subida descarta el ensamblado; los trozos tardíos no son violación', async () => {
    const t = setup()
    const ac = new AbortController()
    const r = t.client.http({ eng: 'main', method: 'POST', path: '/u', body: 'm'.repeat(3_000_000) }, { signal: ac.signal })
    r.catch(() => undefined)
    await t.run(60)
    ac.abort()
    await t.run(400)
    await expect(r).rejects.toMatchObject({ code: 'cancelled' })
    expect(t.dispatch.https).toHaveLength(0)
    expect(t.violations).toEqual({ host: [], client: [] })
    expect(t.hostOut.pending + t.clientOut.pending).toBe(0)
  })

  it('cancelar una llamada en cola la saca sin enviarla', async () => {
    const t = setup()
    const rs = Array.from({ length: 32 }, () => {
      const p = t.client.call('slow')
      p.catch(() => undefined)
      return p
    })
    const ac = new AbortController()
    const queued = t.client.call('echo', 1, { signal: ac.signal })
    queued.catch(() => undefined)
    ac.abort()
    await expect(queued).rejects.toMatchObject({ code: 'cancelled' })
    t.client.close()
    await expect(rs[0]).rejects.toMatchObject({ code: 'disconnected' })
  })

  it('cerrar la conexión falla lo que iba en vuelo con disconnected y aborta al despachador', async () => {
    const t = setup()
    const r = t.client.call('slow')
    r.catch(() => undefined)
    const s = handlers()
    t.client.subscribe('main', s)
    await t.until(() => t.dispatch.calls.length === 1 && s.ready.length === 1)
    t.client.close()
    t.host.close()
    await expect(r).rejects.toMatchObject({ code: 'disconnected' })
    expect(s.ends).toEqual(['disconnected'])
    expect(t.dispatch.signals.get(t.dispatch.calls[0].id)?.aborted).toBe(true)
    await expect(t.client.call('echo')).rejects.toMatchObject({ code: 'disconnected' })
  })
})

// ── Límites ──

describe('límites', () => {
  it('máx. 32 llamadas en vuelo: la 33 espera en el cliente y sale al liberarse un hueco', async () => {
    const t = setup()
    const rs = Array.from({ length: 33 }, (_, i) => t.client.call('slow', i))
    await t.until(() => t.dispatch.calls.length === 32)
    expect(t.client.inFlight).toBe(32)
    await t.run(50)
    expect(t.dispatch.calls).toHaveLength(32)
    t.dispatch.resolvers.get(t.dispatch.calls[0].id)?.('uno')
    await t.until(() => t.dispatch.calls.length === 33)
    expect(await rs[0]).toBe('uno')
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('el host responde busy a la llamada 33 recibida y no cuenta como violación', async () => {
    const t = setup()
    for (let id = 1; id <= 33; id++) t.host.receive({ t: 'call', id, ch: 'slow' }, 30)
    expect(t.dispatch.calls).toHaveLength(32)
    expect(t.toClient.types.at(-1)).toMatchObject({ t: 'res', id: 33 })
    expect(t.violations.host).toEqual([])
  })

  it('máx. 6 streams: el séptimo termina con busy', async () => {
    const t = setup()
    const hs = Array.from({ length: 7 }, () => handlers())
    hs.forEach((h, i) => t.client.subscribe(`main${i}`, h))
    await t.run(30)
    expect(t.client.streams).toBe(6)
    expect(hs.filter((h) => h.ready.length === 1)).toHaveLength(6)
    expect(hs[6].ends).toEqual(['busy'])
  })

  it('el host rechaza un stream sobrante y el motor no permitido (forbidden)', async () => {
    const d = makeDispatch()
    d.allowSub = (eng) => eng === 'main'
    const t = setup({ dispatch: d })
    const s = handlers()
    t.client.subscribe('task/zzz', s)
    await t.run(20)
    expect(s.ends).toEqual(['forbidden'])
  })

  it('subida anunciada mayor de 16 MiB: no pasa el validador', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'call', id: 1, ch: 'x', ck: LIMITS.maxUploadBytes + 1 })).ok).toBe(false)
    expect(parseHostFrame(JSON.stringify({ t: 'res', id: 1, ok: true, ck: LIMITS.maxDownloadBytes + 1 })).ok).toBe(false)
  })

  it('el ensamblado simultáneo tiene tope global (32 MiB): el exceso recibe busy', () => {
    const t = setup()
    for (let id = 1; id <= 3; id++) t.host.receive({ t: 'call', id, ch: 'echo', ck: LIMITS.maxUploadBytes }, 40)
    // 2 x 16 MiB = 32 MiB caben; el tercero no.
    expect(t.toClient.types.filter((x) => x.t === 'res' && x.id === 3)).toHaveLength(1)
    expect(t.violations.host).toEqual([])
  })
})

// ── Tramas inválidas, fuera de orden y duplicadas ──

describe('tramas inválidas', () => {
  const frame = (o: unknown): string => JSON.stringify(o)

  it('el validador rechaza claves de más, ids, canales, rutas y cabeceras malos', () => {
    const bad: unknown[] = [
      { t: 'call', id: 0, ch: 'a' },
      { t: 'call', id: 1, ch: '1abc' },
      { t: 'call', id: 1, ch: 'a', extra: 1 },
      { t: 'call', id: 1, ch: 'a', p: 1, ck: 5 },
      { t: 'http', id: 1, eng: 'main', method: 'TRACE', path: '/x' },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: 'x' },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '/a/../b' },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '/a/%2e%2e/b' },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '//x' },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '/x?y=1' },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '/x', headers: { authorization: 'Basic x' } },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '/x', headers: { accept: 'a\nb' } },
      { t: 'http', id: 1, eng: 'main', method: 'GET', path: '/x', query: { a: 1 } },
      { t: 'http', id: 1, eng: '../x', method: 'GET', path: '/x' },
      { t: 'sub', id: 1, eng: 'main', since: -1 },
      { t: 'sub', id: 1, eng: 'main', since: 1.5 },
      { t: 'cancel', id: 1, x: 1 },
      { t: 'credit', id: 1, bytes: 0 },
      { t: 'chunk', id: 1, n: 0, last: 'no', d: 'a' },
      { t: 'chunk', id: 1, n: 0, last: true, d: '' },
      { t: 'chunk', id: 1, n: 0, last: true, d: 'a'.repeat(LIMITS.chunkBytes + 1) },
      { t: 'chunk', id: 1, n: -1, last: true, d: 'a' }
    ]
    for (const b of bad) expect(parseClientFrame(frame(b)).ok, JSON.stringify(b)).toBe(false)
    const good: unknown[] = [
      { t: 'call', id: 1, ch: 'tasks:list' },
      { t: 'call', id: 1, ch: 'a', p: { x: [1, 2] } },
      { t: 'call', id: 1, ch: 'a', ck: 100 },
      {
        t: 'http',
        id: 2,
        eng: 'task/abc',
        method: 'GET',
        path: '/session/ses_1/message',
        query: { limit: '20' },
        headers: { accept: 'text/event-stream' }
      },
      { t: 'sub', id: 3, eng: 'main', since: 0 },
      { t: 'cancel', id: 3 },
      { t: 'credit', id: 3, bytes: 1000 },
      { t: 'chunk', id: 3, n: 0, last: true, d: 'hola' }
    ]
    for (const g of good) expect(parseClientFrame(frame(g)).ok, JSON.stringify(g)).toBe(true)
  })

  it('el validador del host: res v2, ev, reset; y distingue el res del protocolo anterior', () => {
    expect(parseHostFrame(frame({ t: 'res', id: 1, ok: true, data: { a: 1 } })).ok).toBe(true)
    expect(parseHostFrame(frame({ t: 'res', id: 1, ok: false, error: { code: 'busy', msg: 'x' } })).ok).toBe(true)
    expect(parseHostFrame(frame({ t: 'res', id: 1, ok: false, error: { code: 'nope' } })).ok).toBe(false)
    expect(parseHostFrame(frame({ t: 'res', id: 1, ok: true, data: 1, ck: 5 })).ok).toBe(false)
    expect(parseHostFrame(frame({ t: 'ev', s: 1, seq: 1, oc: 'session.updated', p: {} })).ok).toBe(true)
    expect(parseHostFrame(frame({ t: 'ev', s: 1, seq: 1, ch: 'a', oc: 'b' })).ok).toBe(false)
    expect(parseHostFrame(frame({ t: 'ev', s: 1, seq: 0, ch: 'a' })).ok).toBe(false)
    expect(parseHostFrame(frame({ t: 'reset', s: 1, seq: 4 })).ok).toBe(true)
    const legacy = parseHostFrame(frame({ t: 'res', id: 1, ok: true, m: 'session.abort', result: { aborted: true } }))
    expect(legacy.ok && isMuxHostFrame(legacy.value)).toBe(false)
    const v2 = parseHostFrame(frame({ t: 'res', id: 1, ok: true, data: 1 }))
    expect(v2.ok && isMuxHostFrame(v2.value)).toBe(true)
  })

  it('id repetido o que no crece es violación y no llega al despachador', () => {
    const t = setup()
    t.host.receive({ t: 'call', id: 5, ch: 'echo' }, 30)
    t.host.receive({ t: 'call', id: 5, ch: 'echo' }, 30)
    t.host.receive({ t: 'http', id: 3, eng: 'main', method: 'GET', path: '/x' }, 30)
    expect(t.violations.host).toEqual(['id-not-increasing', 'id-not-increasing'])
    expect(t.dispatch.calls).toHaveLength(1)
    expect(t.dispatch.https).toHaveLength(0)
  })

  it('trozo huérfano, fuera de orden, de más o de tamaño distinto al anunciado', () => {
    const t = setup()
    t.host.receive({ t: 'chunk', id: 9, n: 0, last: true, d: 'x' }, 50)
    expect(t.violations.host).toEqual(['chunk-orphan'])
    t.host.receive({ t: 'call', id: 1, ch: 'echo', ck: 10 }, 30)
    t.host.receive({ t: 'chunk', id: 1, n: 1, last: false, d: 'abc' }, 50)
    expect(t.violations.host.at(-1)).toBe('chunk-order')
    t.host.receive({ t: 'call', id: 2, ch: 'echo', ck: 3 }, 30)
    t.host.receive({ t: 'chunk', id: 2, n: 0, last: false, d: 'abcd' }, 50)
    expect(t.violations.host.at(-1)).toBe('chunk-overflow')
    t.host.receive({ t: 'call', id: 3, ch: 'echo', ck: 5 }, 30)
    t.host.receive({ t: 'chunk', id: 3, n: 0, last: true, d: 'abc' }, 50)
    expect(t.violations.host.at(-1)).toBe('chunk-size')
    t.host.receive({ t: 'call', id: 4, ch: 'echo', ck: 4 }, 30)
    t.host.receive({ t: 'chunk', id: 4, n: 0, last: true, d: '{bad' }, 50)
    expect(t.violations.host.at(-1)).toBe('bad-json')
    expect(t.dispatch.calls).toHaveLength(0)
  })

  it('el cliente trata como violación una respuesta sin llamada, un ev sin stream o antes del acuse', async () => {
    const t = setup()
    t.client.receive({ t: 'res', id: 77, ok: true, data: 1 }, 30)
    t.client.receive({ t: 'ev', s: 5, seq: 1, oc: 'x' }, 30)
    t.client.receive({ t: 'reset', s: 5, seq: 1 }, 30)
    expect(t.violations.client).toEqual(['res-unknown', 'ev-unknown-stream', 'reset-unknown-stream'])
    const s = handlers()
    const sub = t.client.subscribe('main', s)
    t.client.receive({ t: 'ev', s: sub.id, seq: 1, oc: 'x' }, 30)
    expect(t.violations.client.at(-1)).toBe('ev-before-ack')
    expect(t.host.inFlight).toBe(0)
  })

  it('roles: el cliente no acepta call y el host no acepta ev', () => {
    const t = setup()
    t.client.receive({ t: 'call', id: 1, ch: 'echo' }, 30)
    t.host.receive({ t: 'ev', s: 1, seq: 1, oc: 'x' }, 30)
    expect(t.violations.client).toEqual(['role'])
    expect(t.violations.host).toEqual(['role'])
  })
})

// ── Eventos, secuencias y reanudación ──

describe('eventos y reanudación', () => {
  it('los eventos llegan en orden con seq creciente por motor', async () => {
    const t = setup()
    const h = handlers()
    t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    t.log.append('main', { oc: 'message.updated', p: { n: 1 } })
    t.log.append('main', { ch: 'tasks:event', p: { n: 2 } })
    t.log.append('task/a', { oc: 'otro' })
    await t.run(10)
    expect(h.events).toEqual([
      { seq: 1, name: 'message.updated', p: { n: 1 } },
      { seq: 2, name: 'tasks:event', p: { n: 2 } }
    ])
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('reanuda tras reconectar: since=3 entrega 4..n sin huecos ni repetidos (otro Mux, mismo búfer)', async () => {
    const log = new EventLog(() => 0)
    const t1 = setup({ log })
    const h1 = handlers()
    const s1 = t1.client.subscribe('main', h1)
    await t1.until(() => h1.ready.length === 1)
    for (let i = 1; i <= 3; i++) log.append('main', { oc: 'e', p: i })
    await t1.run(10)
    expect(s1.lastSeq).toBe(3)
    t1.client.close()
    t1.host.close()
    for (let i = 4; i <= 7; i++) log.append('main', { oc: 'e', p: i })
    const t2 = setup({ log })
    const h2 = handlers()
    t2.client.subscribe('main', h2, 3)
    await t2.until(() => h2.events.length === 4)
    expect(h2.events.map((e) => e.seq)).toEqual([4, 5, 6, 7])
    expect(h2.resets).toEqual([])
    log.append('main', { oc: 'e', p: 8 })
    await t2.run(10)
    expect(h2.events.at(-1)?.seq).toBe(8)
    expect(t2.violations).toEqual({ host: [], client: [] })
  })

  it('endSubs (bloqueo): un res de error por suscripción, el cliente termina sin violación y no llega ningún ev más', async () => {
    const t = setup()
    const a = handlers()
    const b = handlers()
    t.client.subscribe('main', a)
    t.client.subscribe('main', b)
    await t.until(() => a.ready.length === 1 && b.ready.length === 1)
    t.log.append('main', { oc: 'e', p: 1 })
    await t.run(10)
    expect(a.events).toHaveLength(1)
    t.host.endSubs('forbidden', 'locked')
    await t.run(10)
    expect(a.ends).toEqual(['forbidden'])
    expect(b.ends).toEqual(['forbidden'])
    expect(t.host.streams).toBe(0)
    expect(t.client.streams).toBe(0)
    t.log.append('main', { oc: 'e', p: 2 })
    await t.run(20)
    expect(a.events).toHaveLength(1)
    expect(b.events).toHaveLength(1)
    expect(t.violations).toEqual({ host: [], client: [] })
    // Para volver a recibir hay que suscribirse de nuevo (con `since`) y llega lo pendiente.
    const c = handlers()
    t.client.subscribe('main', c, 1)
    await t.until(() => c.events.length === 1)
    expect(c.events.map((e) => e.seq)).toEqual([2])
  })

  it('endSubs descarta los eventos que seguían en cola de salida (canal lleno): tras bloquear no sale ni uno', async () => {
    const t = setup()
    const h = handlers()
    t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    t.toClient.buffered = 300 * 1024 // por encima de la marca alta: los eventos esperan en la cola
    t.log.append('main', { oc: 'e', p: 1 })
    t.log.append('main', { oc: 'e', p: 2 })
    expect(t.hostOut.pending).toBeGreaterThan(0)
    t.host.endSubs()
    t.toClient.buffered = 0
    t.hostOut.pump()
    await t.run(20)
    expect(h.events).toEqual([])
    expect(h.ends).toEqual(['forbidden'])
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('canEmit en false: drain no envía nada (defensa en profundidad)', async () => {
    let open = true
    const t = setup({ canEmit: () => open })
    const h = handlers()
    t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    open = false
    t.log.append('main', { oc: 'e', p: 1 })
    await t.run(20)
    expect(h.events).toEqual([])
  })

  it('un res de error sobre una suscripción ya lista es un cierre normal, no res-unknown', async () => {
    const t = setup()
    const h = handlers()
    t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    t.client.receive({ t: 'res', id: 1, ok: false, error: { code: 'forbidden' } }, 40)
    expect(h.ends).toEqual(['forbidden'])
    expect(t.violations.client).toEqual([])
  })

  it('hueco por antigüedad (30 s), por tamaño (2 MiB), por el futuro (reinicio) y por evento enorme = reset', async () => {
    const clock = { now: 0 }
    const log = new EventLog(() => clock.now)
    for (let i = 1; i <= 5; i++) log.append('main', { oc: 'e', p: i })
    clock.now = LIMITS.eventRingMs + 1
    log.append('main', { oc: 'e', p: 6 })
    // since=2: el 3 ya caducó -> reset al head (6); since=5: el 6 sigue.
    const a = setup({ log })
    const ha = handlers()
    a.client.subscribe('main', ha, 2)
    await a.until(() => ha.resets.length === 1)
    expect(ha.resets).toEqual([6])
    expect(ha.events).toEqual([])
    const b = setup({ log })
    const hb = handlers()
    b.client.subscribe('main', hb, 5)
    await b.until(() => hb.events.length === 1)
    expect(hb.events[0]).toMatchObject({ seq: 6 })
    // Futuro (el Mac se reinició): since mayor que el head.
    const c = setup({ log })
    const hc = handlers()
    c.client.subscribe('main', hc, 999)
    await c.until(() => hc.resets.length === 1)
    expect(hc.resets).toEqual([6])
    // Tamaño: 2 MiB.
    const big = new EventLog(() => 0)
    const blob = 'b'.repeat(40_000)
    for (let i = 0; i < 80; i++) big.append('main', { oc: 'e', p: blob })
    const d = setup({ log: big })
    const hd = handlers()
    d.client.subscribe('main', hd, 1)
    await d.until(() => hd.resets.length === 1)
    expect(hd.resets).toEqual([80])
    // Evento que no cabe en una trama: lápida -> reset (no se envía ni se rompe el flujo).
    const huge = new EventLog(() => 0)
    const e = setup({ log: huge })
    const he = handlers()
    e.client.subscribe('main', he)
    await e.until(() => he.ready.length === 1)
    huge.append('main', { oc: 'e', p: 'h'.repeat(70_000) })
    huge.append('main', { oc: 'e', p: 'ok' })
    await e.run(20)
    expect(he.resets).toEqual([1])
    expect(he.events).toEqual([{ seq: 2, name: 'e', p: 'ok' }])
    expect(e.violations).toEqual({ host: [], client: [] })
  })

  it('un evento repetido (seq anterior) se descarta; un salto es violación', async () => {
    const t = setup()
    const h = handlers()
    const sub = t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    t.client.receive({ t: 'ev', s: sub.id, seq: 1, oc: 'a' }, 40)
    t.client.receive({ t: 'ev', s: sub.id, seq: 1, oc: 'a' }, 40)
    expect(h.events).toHaveLength(1)
    expect(t.violations.client).toEqual([])
    t.client.receive({ t: 'ev', s: sub.id, seq: 5, oc: 'a' }, 40)
    expect(t.violations.client).toEqual(['ev-gap'])
  })

  it('un stream cancelado deja de recibir y sus eventos tardíos no son violación', async () => {
    const t = setup()
    const h = handlers()
    const sub = t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    sub.cancel()
    t.log.append('main', { oc: 'e' })
    await t.run(10)
    expect(h.events).toEqual([])
    expect(t.host.streams).toBe(0)
    t.client.receive({ t: 'ev', s: sub.id, seq: 1, oc: 'e' }, 40)
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('crédito del stream: un cliente que no consume no recibe más de 256 KiB y no se pierde nada al volver', async () => {
    const log = new EventLog(() => 0, LIMITS.eventRingMs, 64 * 1024 * 1024)
    const t = setup({ log })
    const h = handlers()
    t.client.subscribe('main', h)
    await t.until(() => h.ready.length === 1)
    t.toHost.hold = (x) => x.startsWith('{"t":"credit"')
    const payload = 'p'.repeat(10_000)
    for (let i = 0; i < 60; i++) log.append('main', { oc: 'e', p: payload })
    await t.run(200)
    const sent = t.toClient.types.filter((x) => x.t === 'ev').reduce((n, x) => n + x.bytes, 0)
    expect(sent).toBeLessThanOrEqual(LIMITS.creditWindowBytes)
    t.toHost.hold = () => false
    t.toHost.release()
    await t.until(() => h.events.length === 60)
    expect(h.events.map((e) => e.seq)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
    expect(t.violations).toEqual({ host: [], client: [] })
  })
})

// ── Prioridad ──

describe('planificador de prioridad', () => {
  it('un evento adelanta a una descarga de ~8 MB en curso en menos de 50 ms simulados', async () => {
    const t = setup({ bytesPerMs: 10_000 }) // ~10 MB/s
    const h = handlers()
    let eventAt = -1
    t.client.subscribe('main', {
      ...h,
      onEvent: (e) => {
        h.onEvent(e)
        eventAt = t.clock.now
      }
    })
    await t.until(() => h.ready.length === 1)
    let done = false
    const big = t.client.call('big', 8_000_000)
    void big.then(() => (done = true))
    await t.run(100)
    expect(done).toBe(false)
    expect(t.toClient.types.some((x) => x.t === 'chunk')).toBe(true)
    const start = t.clock.now
    t.log.append('main', { oc: 'permission.asked', p: { id: 'per_1' } })
    await t.until(() => eventAt >= 0, 500)
    expect(eventAt - start).toBeLessThan(50)
    expect(done).toBe(false) // la descarga seguía cuando llegó el evento
    await t.until(() => done, 20_000)
    expect(t.violations).toEqual({ host: [], client: [] })
  })

  it('control (permiso urgente) > evento > respuesta > bulk en la misma cola', () => {
    const sent: string[] = []
    const out = new Outbox({ send: (x) => (sent.push(x), true), bufferedAmount: () => BUFFER.high })
    out.enqueue(PRIO.response, 'respuesta')
    out.enqueue(PRIO.event, 'evento')
    let n = 0
    out.addBulk({ key: 1, next: () => (n++ < 2 ? { text: 'bulk' } : 'done') })
    out.enqueue(PRIO.control, 'control')
    expect(sent).toEqual(['control']) // por encima de la marca alta solo sale control
    const open = { buffered: 0 }
    const out2 = new Outbox({ send: (x) => (sent.push(x), true), bufferedAmount: () => open.buffered })
    sent.length = 0
    out2.enqueue(PRIO.event, 'evento')
    out2.enqueue(PRIO.response, 'respuesta')
    out2.enqueue(PRIO.control, 'control')
    expect(sent[0]).toBe('evento') // al encolar sin competencia sale al instante
  })

  it('con el canal lleno, al liberarse salen primero control, luego eventos, respuestas y por último bulk', () => {
    const sent: string[] = []
    const st = { buffered: BUFFER.high }
    const out = new Outbox({ send: (x) => (sent.push(x), true), bufferedAmount: () => st.buffered })
    let n = 0
    out.addBulk({ key: 1, next: () => (n++ < 2 ? { text: 'bulk' } : 'done') })
    out.enqueue(PRIO.response, 'respuesta')
    out.enqueue(PRIO.event, 'evento')
    out.enqueue(PRIO.control, 'control') // sale ya: el control pasa hasta la marca dura
    expect(sent).toEqual(['control'])
    st.buffered = 0
    out.pump()
    expect(sent).toEqual(['control', 'evento', 'respuesta', 'bulk', 'bulk'])
  })

  it('los bloques grandes se intercalan por turnos entre transferencias', () => {
    const sent: string[] = []
    const st = { buffered: BUFFER.high }
    const out = new Outbox({ send: (x) => (sent.push(x), true), bufferedAmount: () => st.buffered })
    const src = (key: number, n: number) => {
      let i = 0
      return { key, next: () => (i < n ? { text: `${key}:${i++}` } : ('done' as const)) }
    }
    out.addBulk(src(1, 4))
    out.addBulk(src(2, 4))
    out.addBulk(src(3, 2))
    expect(sent).toEqual([])
    st.buffered = 0
    out.pump()
    expect(sent).toEqual(['1:0', '2:0', '3:0', '1:1', '2:1', '3:1', '1:2', '2:2', '1:3', '2:3'])
  })

  it('el envío respeta bufferedAmount: nunca más de la marca alta + una trama en el búfer', async () => {
    const t = setup({ bytesPerMs: 5_000 })
    let max = 0
    const orig = t.toClient.send.bind(t.toClient)
    t.toClient.send = (x: string) => {
      const r = orig(x)
      max = Math.max(max, t.toClient.buffered)
      return r
    }
    const r = t.client.call('big', 3_000_000)
    await t.until(() => t.dispatch.calls.length === 1, 100)
    await t.until(() => false, 300)
    expect(max).toBeLessThanOrEqual(BUFFER.high + LIMITS.maxFrameBytes)
    expect(max).toBeGreaterThan(BUFFER.low)
    await t.until(() => false, 1)
    void r.catch(() => undefined)
  })
})
