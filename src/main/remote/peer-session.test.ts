import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, type HostFrame } from '@shared/remote/protocol'
import { DevicesStore } from './devices-store'
import { PeerSession } from './peer-session'
import type { RtcChannel } from './rtc'
import type { RemoteBackend } from './whitelist'

class FakeChannel implements RtcChannel {
  sent: HostFrame[] = []
  open = true
  closed = false
  private msg: ((raw: unknown) => void) | null = null
  private cls: (() => void) | null = null
  send(text: string): void {
    this.sent.push(JSON.parse(text) as HostFrame)
  }
  close(): void {
    this.closed = true
    this.open = false
  }
  isOpen(): boolean {
    return this.open
  }
  onOpen(cb: () => void): void {
    cb()
  }
  onMessage(cb: (raw: unknown) => void): void {
    this.msg = cb
  }
  onClose(cb: () => void): void {
    this.cls = cb
  }
  recv(raw: unknown): void {
    this.msg?.(typeof raw === 'string' ? raw : JSON.stringify(raw))
  }
  drop(): void {
    this.open = false
    this.cls?.()
  }
  last(): HostFrame | undefined {
    return this.sent[this.sent.length - 1]
  }
}

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString()
}

function fakeBackend(): RemoteBackend & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    listSessions: async () => {
      calls.push('list')
      return { sessions: [], permissions: [] }
    },
    messages: async () => ({ sessionId: 'ses_1', messages: [], hasMore: false }),
    prompt: async (id, text) => void calls.push(`prompt:${id}:${text}`),
    abort: async (id) => void calls.push(`abort:${id}`),
    replyPermission: async (id, r) => void calls.push(`reply:${id}:${r}`)
  }
}

let dir: string
let devices: DevicesStore
beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'peer-'))
  devices = new DevicesStore(join(dir, 'remote.bin'), safe)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(10)
}

function resumeSession(ch: FakeChannel, backend = fakeBackend(), onAuthed: (id: string) => boolean = () => true) {
  const { id, secret } = devices.add('Pixel')
  const ended: string[] = []
  const s = new PeerSession({
    channel: ch,
    kind: 'resume',
    deviceId: id,
    code: '123456',
    devices,
    backend,
    confirmPair: async () => false,
    onAuthed,
    onEnd: (r) => void ended.push(r)
  })
  s.start()
  return { s, id, secret, backend, ended }
}

describe('PeerSession: reconexión con secreto de dispositivo', () => {
  it('autentica por el canal y luego atiende la lista blanca', async () => {
    const ch = new FakeChannel()
    const { s, id, secret, backend } = resumeSession(ch)
    ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    expect(ch.last()).toEqual({ t: 'authed' })
    expect(s.authed).toBe(true)
    ch.recv({ t: 'req', id: 1, m: 'session.abort', p: { sessionId: 'ses_1' } })
    await flush()
    expect(backend.calls).toContain('abort:ses_1')
    expect(ch.last()).toEqual({ t: 'res', id: 1, ok: true, m: 'session.abort', result: { aborted: true } })
  })

  it('secreto incorrecto: auth-failed y se cierra, sin atender nada', async () => {
    const ch = new FakeChannel()
    const { s, id, backend, ended } = resumeSession(ch)
    ch.recv({ t: 'auth', deviceId: id, secret: 'B'.repeat(43) })
    await flush()
    expect(ch.sent[0]).toEqual({ t: 'auth-failed' })
    expect(s.state).toBe('closed')
    ch.recv({ t: 'req', id: 2, m: 'sessions.list', p: {} })
    await flush()
    expect(backend.calls).toEqual([])
    expect(ended).toEqual(['auth-failed'])
  })

  it('antes de autenticar, una petición es violación y no llega al motor', async () => {
    const ch = new FakeChannel()
    const { backend } = resumeSession(ch)
    ch.recv({ t: 'req', id: 1, m: 'sessions.list', p: {} })
    await flush()
    expect(backend.calls).toEqual([])
    expect(ch.sent).toEqual([])
  })

  it('sin auth en 10 s se despide por timeout', async () => {
    const ch = new FakeChannel()
    resumeSession(ch)
    await vi.advanceTimersByTimeAsync(LIMITS.authTimeoutMs + 10)
    expect(ch.sent[0]).toEqual({ t: 'bye', reason: 'timeout' })
  })

  it('3 violaciones cortan con bye violations', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch)
    ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    ch.recv({ t: 'req', id: 1, m: 'session.delete', p: {} })
    ch.recv('no json')
    ch.recv({ t: 'req', id: 2, m: 'permission.reply', p: { requestId: 'per_1', reply: 'always' } })
    await flush()
    expect(ch.sent.some((f) => f.t === 'bye' && f.reason === 'violations')).toBe(true)
  })

  it('binario y tramas gigantes cuentan como violación', async () => {
    const ch = new FakeChannel()
    const { id, secret, backend } = resumeSession(ch)
    ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    ch.recv(new Uint8Array(4))
    ch.recv('x'.repeat(LIMITS.maxFrameBytes + 1))
    ch.recv({ t: 'req', id: 3, m: 'sessions.list', p: {} })
    await flush()
    expect(backend.calls).toEqual(['list'])
    // dos violaciones: aún conectado
    expect(ch.sent.some((f) => f.t === 'bye')).toBe(false)
  })

  it('más de 6 prompts por minuto: rate-limited', async () => {
    const ch = new FakeChannel()
    const { id, secret, backend } = resumeSession(ch)
    ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    for (let i = 1; i <= 7; i++) ch.recv({ t: 'req', id: i, m: 'session.prompt', p: { sessionId: 'ses_1', text: 'hola' } })
    await flush()
    expect(backend.calls.filter((c) => c.startsWith('prompt')).length).toBe(LIMITS.promptsPerMinute)
    expect(ch.sent.some((f) => f.t === 'res' && !f.ok && f.error.code === 'rate-limited')).toBe(true)
  })

  it('otro celular ya conectado: bye other-device', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch, fakeBackend(), () => false)
    ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['authed', 'bye'])
  })
})

describe('PeerSession: vinculación', () => {
  const pairSession = (ch: FakeChannel, confirm: () => Promise<boolean>, code: string | null = '654321') => {
    const ended: string[] = []
    const s = new PeerSession({
      channel: ch,
      kind: 'pair',
      deviceName: 'iPhone',
      code,
      devices,
      backend: fakeBackend(),
      confirmPair: confirm,
      onAuthed: () => true,
      onEnd: (r) => void ended.push(r)
    })
    s.start()
    return { s, ended }
  }

  it('si el dueño acepta, entrega deviceId y secreto POR EL CANAL', async () => {
    const ch = new FakeChannel()
    const { s } = pairSession(ch, async () => true)
    await flush()
    expect(ch.sent[0]).toEqual({ t: 'pair-pending' })
    const paired = ch.sent[1]
    expect(paired.t).toBe('paired')
    if (paired.t !== 'paired') throw new Error('x')
    expect(devices.verify(paired.deviceId, paired.deviceSecret)).toBe(true)
    expect(s.authed).toBe(true)
  })

  it('si el dueño rechaza no se crea ningún dispositivo', async () => {
    const ch = new FakeChannel()
    pairSession(ch, async () => false)
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['pair-pending', 'denied'])
    expect(devices.list()).toHaveLength(0)
  })

  it('sin huellas DTLS (sin código) se rechaza sin preguntar', async () => {
    const ch = new FakeChannel()
    const confirm = vi.fn(async () => true)
    pairSession(ch, confirm, null)
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(ch.sent[0]).toEqual({ t: 'denied', reason: 'rejected' })
  })

  it('con 3 dispositivos ya vinculados: denied limit', async () => {
    for (let i = 0; i < LIMITS.maxDevices; i++) devices.add(`d${i}`)
    const ch = new FakeChannel()
    pairSession(ch, async () => true)
    await flush()
    expect(ch.sent[0]).toEqual({ t: 'denied', reason: 'limit' })
  })

  it('sin respuesta del dueño en 60 s: denied', async () => {
    const ch = new FakeChannel()
    pairSession(ch, () => new Promise<boolean>(() => undefined))
    await vi.advanceTimersByTimeAsync(LIMITS.confirmTtlMs + 10)
    expect(ch.sent.map((f) => f.t)).toEqual(['pair-pending', 'denied'])
  })

  it('mientras espera confirmación no atiende peticiones', async () => {
    const ch = new FakeChannel()
    pairSession(ch, () => new Promise<boolean>(() => undefined))
    await flush()
    ch.recv({ t: 'req', id: 1, m: 'sessions.list', p: {} })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['pair-pending'])
  })
})

// ── Protocolo v2 (multiplexor) cableado en la sesión ──

class BufferedChannel extends FakeChannel {
  buffered = 0
  lowAt = 0
  lowCb: (() => void) | null = null
  bufferedAmount(): number {
    return this.buffered
  }
  setBufferedAmountLowThreshold(n: number): void {
    this.lowAt = n
  }
  onBufferedAmountLow(cb: () => void): void {
    this.lowCb = cb
  }
}

describe('PeerSession: protocolo v2', () => {
  const authed = async (ch: FakeChannel, extra: Partial<ConstructorParameters<typeof PeerSession>[0]> = {}) => {
    const { id, secret } = devices.add('Pixel')
    const s = new PeerSession({
      channel: ch,
      kind: 'resume',
      deviceId: id,
      code: '123456',
      devices,
      backend: fakeBackend(),
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined,
      ...extra
    })
    s.start()
    ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    ch.sent.length = 0
    return s
  }

  it('antes de autenticar, call/http/sub/chunk son violación y no se responde nada', async () => {
    const ch = new FakeChannel()
    resumeSession(ch)
    ch.recv({ t: 'call', id: 1, ch: 'tasks:list' })
    ch.recv({ t: 'chunk', id: 1, n: 0, last: true, d: 'x' })
    ch.recv({ t: 'sub', id: 2, eng: 'main' })
    await flush()
    expect(ch.sent.some((f) => f.t === 'bye' && f.reason === 'violations')).toBe(true)
    expect(ch.sent.some((f) => f.t === 'res')).toBe(false)
  })

  it('sin despachador inyectado, toda llamada v2 responde unavailable (el motor no se expone)', async () => {
    const ch = new FakeChannel()
    await authed(ch)
    ch.recv({ t: 'call', id: 1, ch: 'tasks:list' })
    ch.recv({ t: 'http', id: 2, eng: 'main', method: 'GET', path: '/session' })
    await flush()
    expect(ch.sent).toEqual([
      { t: 'res', id: 1, ok: false, error: { code: 'unavailable' } },
      { t: 'res', id: 2, ok: false, error: { code: 'unavailable' } }
    ])
  })

  it('con el despachador de prueba: call, http y cancelación; la lista blanca anterior sigue igual', async () => {
    const ch = new FakeChannel()
    const aborted: number[] = []
    await authed(ch, {
      dispatch: {
        call: async (req) => ({ eco: req.p }),
        http: (_req, ctx) =>
          new Promise(() => {
            ctx.signal.addEventListener('abort', () => aborted.push(ctx.id))
          })
      }
    })
    ch.recv({ t: 'call', id: 1, ch: 'test:eco', p: { a: 1 } })
    ch.recv({ t: 'http', id: 2, eng: 'main', method: 'GET', path: '/x' })
    await flush()
    expect(ch.sent).toEqual([{ t: 'res', id: 1, ok: true, data: { eco: { a: 1 } } }])
    ch.recv({ t: 'cancel', id: 2 })
    await flush()
    expect(aborted).toEqual([2])
    ch.recv({ t: 'req', id: 3, m: 'session.abort', p: { sessionId: 'ses_1' } })
    await flush()
    expect(ch.last()).toEqual({ t: 'res', id: 3, ok: true, m: 'session.abort', result: { aborted: true } })
  })

  it('ids repetidos o decrecientes y trozos huérfanos suman violaciones hasta cortar', async () => {
    const ch = new FakeChannel()
    await authed(ch, { dispatch: { call: async () => 1, http: async () => 1 } })
    ch.recv({ t: 'call', id: 5, ch: 'test:a' })
    ch.recv({ t: 'call', id: 5, ch: 'test:a' })
    ch.recv({ t: 'chunk', id: 9, n: 0, last: true, d: 'x' })
    ch.recv({ t: 'call', id: 4, ch: 'test:a' })
    await flush()
    expect(ch.sent.some((f) => f.t === 'bye' && f.reason === 'violations')).toBe(true)
  })

  it('respeta bufferedAmount: con el canal lleno solo sale control y lo demás espera a onBufferedAmountLow', async () => {
    const ch = new BufferedChannel()
    await authed(ch, { dispatch: { call: async () => 'ok', http: async () => 'ok' } })
    expect(ch.lowAt).toBeGreaterThan(0)
    ch.buffered = 300 * 1024 // por encima de la marca alta, por debajo de la dura
    ch.recv({ t: 'call', id: 1, ch: 'test:a' })
    ch.recv({ t: 'req', id: 2, m: 'sessions.list', p: {} })
    await flush()
    expect(ch.sent.filter((f) => f.t === 'res')).toEqual([]) // respuestas esperan
    ch.recv({ t: 'ping' })
    expect(ch.last()).toEqual({ t: 'pong' }) // el control pasa
    ch.buffered = 0
    ch.lowCb?.()
    expect(
      ch.sent
        .filter((f) => f.t === 'res')
        .map((f) => (f as { id: number }).id)
        .sort()
    ).toEqual([1, 2])
  })

  it('un cubo propio limita call/http/sub (40/s, ráfaga 120) y el exceso es violación', async () => {
    const ch = new FakeChannel()
    await authed(ch, { dispatch: { call: async () => 1, http: async () => 1 } })
    for (let i = 1; i <= LIMITS.callBurst + 5; i++) ch.recv({ t: 'call', id: i, ch: 'test:a' })
    await flush()
    expect(ch.sent.filter((f) => f.t === 'res').length).toBeLessThanOrEqual(LIMITS.callBurst)
    expect(ch.sent.some((f) => f.t === 'bye' && f.reason === 'violations')).toBe(true)
  })
})
