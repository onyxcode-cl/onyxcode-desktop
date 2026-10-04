import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { toBase64Url } from '@shared/remote/code'
import { ClientHandshake, pairId, pairKey, type Fps } from '@shared/remote/handshake'
import { LIMITS, parseHostFrame, type HostFrame } from '@shared/remote/protocol'
import type { AuditInput } from './audit'
import { DevicesStore } from './devices-store'
import { PeerSession } from './peer-session'
import { TEST_FPS, pairAs, resumeAs } from './test-handshake'
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
    fps: TEST_FPS,
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
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    expect(ch.last()).toMatchObject({ t: 'authed' })
    expect(s.authed).toBe(true)
    ch.recv({ t: 'req', id: 1, m: 'session.abort', p: { sessionId: 'ses_1' } })
    await flush()
    expect(backend.calls).toContain('abort:ses_1')
    expect(ch.last()).toEqual({ t: 'res', id: 1, ok: true, m: 'session.abort', result: { aborted: true } })
  })

  it('secreto incorrecto: auth-failed y se cierra, sin atender nada', async () => {
    const ch = new FakeChannel()
    const { s, id, backend, ended } = resumeSession(ch)
    resumeAs(ch, { deviceId: id, secret: 'B'.repeat(43) })
    await flush()
    expect(ch.sent[0]).toMatchObject({ t: 'hs2' })
    ch.sent.shift()
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

  it('sin hs1/hs3 en 10 s se despide por timeout', async () => {
    const ch = new FakeChannel()
    resumeSession(ch)
    await vi.advanceTimersByTimeAsync(LIMITS.authTimeoutMs + 10)
    expect(ch.sent[0]).toEqual({ t: 'bye', reason: 'timeout' })
  })

  it('3 violaciones cortan con bye violations', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch)
    resumeAs(ch, { deviceId: id, secret })
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
    resumeAs(ch, { deviceId: id, secret })
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
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    for (let i = 1; i <= 7; i++) ch.recv({ t: 'req', id: i, m: 'session.prompt', p: { sessionId: 'ses_1', text: 'hola' } })
    await flush()
    expect(backend.calls.filter((c) => c.startsWith('prompt')).length).toBe(LIMITS.promptsPerMinute)
    expect(ch.sent.some((f) => f.t === 'res' && !f.ok && f.error.code === 'rate-limited')).toBe(true)
  })

  it('otro celular ya conectado: bye other-device', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch, fakeBackend(), () => false)
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'authed', 'bye'])
  })
})

describe('PeerSession: vinculación', () => {
  const Q = toBase64Url(new Uint8Array(randomBytes(32)))
  const pairSession = (
    ch: FakeChannel,
    confirm: (info: { deviceName: string; code: string }) => Promise<boolean>,
    fps: Fps | null = TEST_FPS
  ) => {
    const ended: string[] = []
    const proofs: boolean[] = []
    const s = new PeerSession({
      channel: ch,
      kind: 'pair',
      deviceName: 'iPhone',
      fps,
      qid: pairId(Q),
      pairKey: pairKey(Q),
      onPairProof: (ok) => void proofs.push(ok),
      devices,
      backend: fakeBackend(),
      confirmPair: confirm,
      onAuthed: () => true,
      onEnd: (r) => void ended.push(r)
    })
    s.start()
    return { s, ended, proofs }
  }

  it('si el dueño acepta, entrega deviceId y secreto POR EL CANAL, y los dos códigos coinciden', async () => {
    const ch = new FakeChannel()
    let macCode = ''
    const { s, proofs } = pairSession(ch, async (i) => {
      macCode = i.code
      return true
    })
    const phone = pairAs(ch, { q: Q })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'pair-pending', 'paired'])
    expect(proofs).toEqual([true])
    expect(phone.proofOk()).toBe(true)
    expect(phone.sas()).toBe(macCode)
    expect(macCode).toMatch(/^\d{6}$/)
    const paired = ch.sent[2]
    if (paired.t !== 'paired') throw new Error('x')
    // El secreto entregado sirve para el handshake de reconexión (el Mac solo guarda su hash).
    expect(devices.authKey(paired.deviceId)).not.toBeNull()
    expect(s.authed).toBe(true)
    // El secreto de dispositivo viaja una sola vez, y el del QR nunca.
    expect(JSON.stringify(ch.sent).split(paired.deviceSecret).length - 1).toBe(1)
    expect(JSON.stringify(ch.sent)).not.toContain(Q)
  })

  it('si el dueño rechaza no se crea ningún dispositivo', async () => {
    const ch = new FakeChannel()
    pairSession(ch, async () => false)
    pairAs(ch, { q: Q })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'pair-pending', 'denied'])
    expect(devices.list()).toHaveLength(0)
  })

  it('sin huellas DTLS estrictas se rechaza sin preguntar ni responder al handshake', async () => {
    const ch = new FakeChannel()
    const confirm = vi.fn(async () => true)
    const { proofs } = pairSession(ch, confirm, null)
    pairAs(ch, { q: Q })
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(ch.sent[0]).toEqual({ t: 'denied', reason: 'rejected' })
    expect(proofs).toEqual([false])
  })

  it('con otra clave de QR (hs3 malo): denied, el intento cuenta como fallo y no se pregunta', async () => {
    const ch = new FakeChannel()
    const confirm = vi.fn(async () => true)
    const { proofs } = pairSession(ch, confirm)
    pairAs(ch, { q: toBase64Url(new Uint8Array(randomBytes(32))) })
    await flush()
    // El `qid` del hs1 no es el esperado: violación inmediata del handshake.
    expect(confirm).not.toHaveBeenCalled()
    expect(ch.sent.map((f) => f.t)).toEqual(['denied'])
    expect(proofs).toEqual([false])
  })

  it('intermediario que NO conoce q: con el qid correcto pero otra clave, hs3 falla', async () => {
    const ch = new FakeChannel()
    const confirm = vi.fn(async () => true)
    const { proofs } = pairSession(ch, confirm)
    // El intermediario sabe el qid (viaja por la señalización) pero no q: su clave de canal es otra.
    const fake = new ClientHandshake({
      mode: 'pair',
      q: toBase64Url(new Uint8Array(randomBytes(32))),
      fps: TEST_FPS,
      rand: (n) => new Uint8Array(randomBytes(n))
    })
    const hello = fake.hello()
    ch.recv({ ...hello, id: pairId(Q) })
    const hs2 = ch.sent.find((f) => f.t === 'hs2')
    if (!hs2 || hs2.t !== 'hs2') throw new Error('sin hs2')
    ch.recv(fake.onChallenge(hs2))
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'denied'])
    expect(proofs).toEqual([false])
    expect(devices.list()).toHaveLength(0)
  })

  it('con 3 dispositivos ya vinculados: denied limit', async () => {
    for (let i = 0; i < LIMITS.maxDevices; i++) devices.add(`d${i}`)
    const ch = new FakeChannel()
    pairSession(ch, async () => true)
    pairAs(ch, { q: Q })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'denied'])
    expect(ch.sent[1]).toEqual({ t: 'denied', reason: 'limit' })
  })

  it('sin respuesta del dueño en 60 s: denied', async () => {
    const ch = new FakeChannel()
    pairSession(ch, () => new Promise<boolean>(() => undefined))
    pairAs(ch, { q: Q })
    await vi.advanceTimersByTimeAsync(LIMITS.confirmTtlMs + 10)
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'pair-pending', 'denied'])
  })

  it('mientras espera confirmación no atiende peticiones', async () => {
    const ch = new FakeChannel()
    pairSession(ch, () => new Promise<boolean>(() => undefined))
    pairAs(ch, { q: Q })
    await flush()
    ch.recv({ t: 'req', id: 1, m: 'sessions.list', p: {} })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'pair-pending'])
  })

  it('sin hs3 en 10 s: bye timeout y el intento cuenta como fallo', async () => {
    const ch = new FakeChannel()
    const { proofs } = pairSession(ch, async () => true)
    await vi.advanceTimersByTimeAsync(LIMITS.authTimeoutMs + 10)
    expect(ch.sent[0]).toEqual({ t: 'bye', reason: 'timeout' })
    expect(proofs).toEqual([false])
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
      fps: TEST_FPS,
      devices,
      backend: fakeBackend(),
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined,
      ...extra
    })
    s.start()
    resumeAs(ch, { deviceId: id, secret })
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

describe('PeerSession: caducidad del vínculo', () => {
  const DAY = 86_400_000

  it('authed lleva expiresAt (el vigente, sin renovar) y no avisa si quedaba plazo de sobra', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch)
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    const f = ch.sent.find((x) => x.t === 'authed') as { expiresAt?: number; expiring?: boolean }
    expect(f.expiresAt).toBe(devices.expiresAt(id))
    expect(f.expiring).toBeUndefined()
  })

  it('caducado: auth-failed con why=expired y prueba válida para el celular; no se autentica', async () => {
    const ch = new FakeChannel()
    const { s, id, secret, ended } = resumeSession(ch)
    vi.setSystemTime(Date.now() + 91 * DAY)
    const phone = resumeAs(ch, { deviceId: id, secret })
    await flush()
    const f = ch.sent.find((x) => x.t === 'auth-failed')
    expect(f).toMatchObject({ t: 'auth-failed', why: 'expired' })
    expect(phone.proofOk()).toBe(true)
    expect(s.authed).toBe(false)
    expect(ended).toEqual(['expired'])
    expect(devices.get(id)?.lastUsedAt).toBeNull()
  })

  it('a punto de caducar (≤ 7 días): authed avisa con expiring y trae el plazo vigente (sin renovar)', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch)
    const before = devices.expiresAt(id) as number
    vi.setSystemTime(Date.now() + 85 * DAY)
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    const f = ch.sent.find((x) => x.t === 'authed') as { expiresAt: number; expiring?: boolean }
    expect(f.expiring).toBe(true)
    expect(f.expiresAt).toBe(before)
  })

  it('con «nunca» no hay expiresAt ni aviso', async () => {
    const ch = new FakeChannel()
    const { id, secret } = resumeSession(ch)
    devices.setTtl(id, null)
    vi.setSystemTime(Date.now() + 5000 * DAY)
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    expect(ch.sent.find((x) => x.t === 'authed')).toMatchObject({ t: 'authed' })
    expect(ch.sent.find((x) => x.t === 'authed')).not.toHaveProperty('expiresAt')
  })

  it('un secreto incorrecto en un vínculo caducado NO revela que caducó (ni da prueba)', async () => {
    const ch = new FakeChannel()
    const { id } = resumeSession(ch)
    vi.setSystemTime(Date.now() + 91 * DAY)
    resumeAs(ch, { deviceId: id, secret: 'B'.repeat(43) })
    await flush()
    expect(ch.sent.find((f) => f.t === 'auth-failed')).toEqual({ t: 'auth-failed' })
  })
})

describe('PeerSession: handshake v3 (reconexión)', () => {
  const audited = (): { audits: AuditInput[]; access: NonNullable<ConstructorParameters<typeof PeerSession>[0]['access']> } => {
    const audits: AuditInput[] = []
    return {
      audits,
      access: {
        confirmConnection: async () => ({ approved: true, outcome: 'approved' as const }),
        trusted: () => true,
        lastActiveAt: () => null,
        noteActive: () => undefined,
        onRevokeDevice: () => undefined,
        onChange: () => undefined,
        audit: (e) => void audits.push(e)
      }
    }
  }
  const mk = (ch: FakeChannel, extra: Partial<ConstructorParameters<typeof PeerSession>[0]> = {}) => {
    const { id, secret } = devices.add('Pixel')
    const ended: string[] = []
    const s = new PeerSession({
      channel: ch,
      kind: 'resume',
      deviceId: id,
      fps: TEST_FPS,
      devices,
      backend: fakeBackend(),
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: (r) => void ended.push(r),
      ...extra
    })
    s.start()
    return { s, id, secret, ended }
  }

  it('el secreto (ni su hash) no aparece en ninguna trama enviada, y el celular verifica la prueba del Mac', async () => {
    const ch = new FakeChannel()
    const { id, secret } = mk(ch)
    const phone = resumeAs(ch, { deviceId: id, secret })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'authed'])
    const wire = JSON.stringify(ch.sent)
    expect(wire).not.toContain(secret)
    expect(wire).not.toContain(devices.get(id)!.secretHash)
    expect(phone.proofOk()).toBe(true)
  })

  it('de extremo a extremo: cada trama del Mac pasa el validador del celular (reconexión y vinculación) y el celular verifica la prueba', async () => {
    const ch = new FakeChannel()
    const { id, secret } = mk(ch)
    const phone = resumeAs(ch, { deviceId: id, secret })
    await flush()
    for (const f of ch.sent) expect(parseHostFrame(JSON.stringify(f)).ok).toBe(true)
    expect(phone.proofOk()).toBe(true)

    const q = toBase64Url(new Uint8Array(randomBytes(32)))
    const ch2 = new FakeChannel()
    new PeerSession({
      channel: ch2,
      kind: 'pair',
      deviceName: 'iPhone',
      fps: TEST_FPS,
      qid: pairId(q),
      pairKey: pairKey(q),
      devices,
      backend: fakeBackend(),
      confirmPair: async () => true,
      onAuthed: () => true,
      onEnd: () => undefined
    }).start()
    const p2 = pairAs(ch2, { q })
    await flush()
    for (const f of ch2.sent) expect(parseHostFrame(JSON.stringify(f)).ok).toBe(true)
    expect(p2.proofOk()).toBe(true)
  })

  it('con intermediario (huellas del Mac distintas a las del celular): auth-failed, sin authed y con auditoría auth-bad-proof', async () => {
    const ch = new FakeChannel()
    const { audits, access } = audited()
    const { s, id, secret, ended } = mk(ch, { access })
    // El celular ve {offer: P, answer: M1}; el Mac, {offer: M2, answer: MAC} (valores de TEST_FPS por defecto).
    resumeAs(ch, { deviceId: id, secret, fps: { offer: 'ab'.repeat(32), answer: '11'.repeat(32) } })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'auth-failed'])
    expect(ch.sent[1]).toEqual({ t: 'auth-failed' })
    expect(s.authed).toBe(false)
    expect(ended).toEqual(['auth-failed'])
    expect(audits).toEqual([expect.objectContaining({ kind: 'auth-bad-proof', device: expect.stringMatching(/^[0-9a-f]{8}$/) })])
  })

  it('repetición: un hs3 de otra sesión (otro ns) no autentica', async () => {
    const ch1 = new FakeChannel()
    const a = mk(ch1)
    resumeAs(ch1, { deviceId: a.id, secret: a.secret })
    await flush()
    const hs3 = (ch1 as unknown as { received?: unknown }).received
    void hs3
    // Captura de un handshake válido: se repite hs1 y hs3 sobre una sesión nueva del mismo dispositivo.
    const captured: unknown[] = []
    const ch2 = new FakeChannel()
    const orig = ch2.recv.bind(ch2)
    ch2.recv = (raw: unknown): void => {
      captured.push(typeof raw === 'string' ? JSON.parse(raw) : raw)
      orig(raw)
    }
    const b = new PeerSession({
      channel: ch2,
      kind: 'resume',
      deviceId: a.id,
      fps: TEST_FPS,
      devices,
      backend: fakeBackend(),
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined
    })
    b.start()
    resumeAs(ch2, { deviceId: a.id, secret: a.secret })
    await flush()
    expect(ch2.sent.map((f) => f.t)).toEqual(['hs2', 'authed'])
    // Tercera sesión: se le entregan las MISMAS tramas capturadas.
    const ch3 = new FakeChannel()
    const c = new PeerSession({
      channel: ch3,
      kind: 'resume',
      deviceId: a.id,
      fps: TEST_FPS,
      devices,
      backend: fakeBackend(),
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined
    })
    c.start()
    for (const f of captured) ch3.recv(f)
    await flush()
    expect(ch3.sent.some((f) => f.t === 'authed')).toBe(false)
    expect(ch3.sent.map((f) => f.t)).toContain('auth-failed')
    expect(c.authed).toBe(false)
  })

  it('el auth antiguo ({t:auth, deviceId, secret}) es una trama desconocida: violación, nunca autentica', async () => {
    const ch = new FakeChannel()
    const { s, id, secret } = mk(ch)
    for (let i = 0; i < LIMITS.maxViolations; i++) ch.recv({ t: 'auth', deviceId: id, secret })
    await flush()
    expect(s.authed).toBe(false)
    expect(ch.sent.some((f) => f.t === 'authed')).toBe(false)
    expect(ch.sent.some((f) => f.t === 'bye' && f.reason === 'violations')).toBe(true)
  })

  it('hs3 antes de hs1: corte inmediato con auth-failed', async () => {
    const ch = new FakeChannel()
    const { s, ended } = mk(ch)
    ch.recv({ t: 'hs3', mac: 'A'.repeat(43) })
    await flush()
    expect(ch.sent).toEqual([{ t: 'auth-failed' }])
    expect(s.state).toBe('closed')
    expect(ended).toEqual(['auth-failed'])
  })

  it('un segundo hs1 también corta (un solo intento)', async () => {
    const ch = new FakeChannel()
    const { id, s } = mk(ch)
    const c = new ClientHandshake({
      mode: 'resume',
      deviceId: id,
      secret: 'B'.repeat(43),
      fps: TEST_FPS,
      rand: (n) => new Uint8Array(randomBytes(n))
    })
    ch.recv(c.hello())
    ch.recv(c.hello === undefined ? {} : { t: 'hs1', v: 3, mode: 'resume', id, nc: 'A'.repeat(43) })
    await flush()
    expect(ch.sent.map((f) => f.t)).toEqual(['hs2', 'auth-failed'])
    expect(s.state).toBe('closed')
  })

  it('sin huellas estrictas (fps null): auth-failed sin responder al handshake', async () => {
    const ch = new FakeChannel()
    const { id, secret, ended } = mk(ch, { fps: null })
    resumeAs(ch, { deviceId: id, secret })
    await flush()
    expect(ch.sent).toEqual([{ t: 'auth-failed' }])
    expect(ended).toEqual(['auth-failed'])
  })

  it('un dispositivo que desapareció a mitad (revocado) da auth-failed aunque el celular tenga el secreto', async () => {
    const ch = new FakeChannel()
    const { id, secret } = mk(ch)
    // Se revoca antes de `start()` de una segunda sesión: authKey es null -> clave de relleno.
    devices.revoke(id)
    const ch2 = new FakeChannel()
    const s2 = new PeerSession({
      channel: ch2,
      kind: 'resume',
      deviceId: id,
      fps: TEST_FPS,
      devices,
      backend: fakeBackend(),
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined
    })
    s2.start()
    resumeAs(ch2, { deviceId: id, secret })
    await flush()
    expect(ch2.sent.map((f) => f.t)).toEqual(['hs2', 'auth-failed'])
  })
})
