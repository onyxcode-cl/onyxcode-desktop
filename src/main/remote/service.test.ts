import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, type HostFrame } from '@shared/remote/protocol'
import type { RemotePolicyView, RemoteState } from '@shared/ipc-remote'
import type { AuditInput } from './audit'
import { NO_ORG_POLICY, invalidRemotePolicy } from './org-policy'
import { DevicesStore } from './devices-store'
import type { RtcAnswerer, RtcChannel, RtcFactory } from './rtc'
import { POLICY_POLL_MS, RemoteService } from './service'
import type { SignalHello, SignalingPeer, SignalingStartOptions, SignalingTransport } from './signaling/types'
import type { RemoteBackend } from './whitelist'
import type { EventSource } from './events'
import { createEngineHost, type RemoteEngineHost } from './engine-host'

const FP = (h: string): string => `v=0\r\na=fingerprint:sha-256 ${h.repeat(32).match(/../g)!.join(':').toUpperCase()}\r\n`

class Chan implements RtcChannel {
  sent: HostFrame[] = []
  open = true
  private m: ((r: unknown) => void) | null = null
  private o: (() => void) | null = null
  send(t: string): void {
    this.sent.push(JSON.parse(t) as HostFrame)
  }
  close(): void {
    this.open = false
  }
  isOpen(): boolean {
    return this.open
  }
  onOpen(cb: () => void): void {
    this.o = cb
  }
  onMessage(cb: (r: unknown) => void): void {
    this.m = cb
  }
  onClose(): void {}
  fireOpen(): void {
    this.o?.()
  }
  recv(o: unknown): void {
    this.m?.(JSON.stringify(o))
  }
}

class Answerer implements RtcAnswerer {
  channel = new Chan()
  closed = false
  private ans: ((s: string) => void) | null = null
  private ch: ((c: RtcChannel) => void) | null = null
  start(): void {
    this.ans?.(FP('cd'))
  }
  onAnswer(cb: (s: string) => void): void {
    this.ans = cb
  }
  onCandidate(): void {}
  onChannel(cb: (c: RtcChannel) => void): void {
    this.ch = cb
  }
  onGone(): void {}
  addRemoteCandidate(): void {}
  close(): void {
    this.closed = true
  }
  openChannel(): void {
    this.ch?.(this.channel)
    this.channel.fireOpen()
  }
}

class FakePeer implements SignalingPeer {
  offer: ((s: string) => void) | null = null
  closed = false
  answerer: Answerer | null = null
  constructor(readonly hello: SignalHello) {}
  sendAnswer(): void {}
  sendIce(): void {}
  onOffer(cb: (s: string) => void): void {
    this.offer = cb
  }
  onIce(): void {}
  onClose(): void {}
  close(): void {
    this.closed = true
  }
}

class FakeTransport implements SignalingTransport {
  opts: SignalingStartOptions | null = null
  cb: ((p: SignalingPeer) => void) | null = null
  stopped = false
  async start(o: SignalingStartOptions): Promise<{ origin: string }> {
    this.opts = o
    return { origin: 'http://192.168.1.20:5555' }
  }
  onPeer(cb: (p: SignalingPeer) => void): void {
    this.cb = cb
  }
  async stop(): Promise<void> {
    this.stopped = true
  }
}

const safe = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
const backend = {
  listSessions: async () => ({ sessions: [], permissions: [] }),
  messages: async () => ({ sessionId: 's', messages: [], hasMore: false }),
  prompt: async () => undefined,
  abort: async () => undefined,
  replyPermission: async () => undefined,
  scopeSession: async () => null,
  loadMessage: async () => null,
  cachedSession: () => null,
  forgetSession: () => undefined,
  setCachedStatus: () => undefined,
  applySessionInfo: () => null
} satisfies RemoteBackend & EventSource

let dir: string
let transport: FakeTransport
let answerers: Answerer[]
let states: RemoteState[]
let pairReqs: Array<{ requestId: string; deviceName: string; code: string }>
let ip: string | null

function make(
  opts: { devices?: DevicesStore; engine?: RemoteEngineHost; policy?: () => RemotePolicyView; audit?: (e: AuditInput) => void } = {}
): { svc: RemoteService; devices: DevicesStore } {
  const devices = opts.devices ?? new DevicesStore(join(dir, 'remote.bin'), safe)
  const rtc: RtcFactory = {
    createAnswerer: () => {
      const a = new Answerer()
      answerers.push(a)
      return a
    }
  }
  const svc = new RemoteService({
    engine: opts.engine,
    devices,
    loadRtc: async () => rtc,
    getLanIp: () => ip,
    createTransport: () => transport,
    backend,
    getEventClient: () => null,
    qr: () => [[true]],
    onChanged: (s) => states.push(s),
    onPairRequest: (r) => pairReqs.push(r),
    policy: opts.policy,
    audit: opts.audit
  })
  return { svc, devices }
}

const secretOf = (s: RemoteState): string => new URL(s.pairing!.url).hash.replace('#s=', '')

/** Simula que un celular llega hasta abrir el canal. */
function connectPhone(hello: SignalHello): { peer: FakePeer; answerer: Answerer } {
  expect(transport.opts!.authorize(hello)).toBe(true)
  const peer = new FakePeer(hello)
  transport.cb!(peer)
  peer.offer!(FP('ab'))
  const answerer = answerers[answerers.length - 1]
  answerer.openChannel()
  return { peer, answerer }
}

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'svc-'))
  transport = new FakeTransport()
  answerers = []
  states = []
  pairReqs = []
  ip = '192.168.1.20'
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('RemoteService', () => {
  it('apagado por defecto: sin transporte ni QR', () => {
    const { svc } = make()
    const s = svc.getState()
    expect(s).toMatchObject({ available: true, mode: 'off', pairing: null })
    expect(transport.opts).toBeNull()
  })

  it('sin red privada no abre nada', async () => {
    ip = null
    const { svc } = make()
    const s = await svc.start()
    expect(s.mode).toBe('off')
    expect(s.error).toBe('no-network')
    expect(transport.opts).toBeNull()
  })

  it('sin safeStorage la función queda no disponible', async () => {
    const devices = new DevicesStore(join(dir, 'remote.bin'), { ...safe, isEncryptionAvailable: () => false })
    const { svc } = make({ devices })
    const s = await svc.start()
    expect(s).toMatchObject({ available: false, unavailable: 'no-safe-storage', mode: 'off' })
    expect(transport.opts).toBeNull()
  })

  it('start: modo vinculando con QR de 32 B y el secreto no queda en el estado de otros modos', async () => {
    const { svc } = make()
    const s = await svc.start()
    expect(s.mode).toBe('pairing')
    expect(s.pairing!.url).toMatch(/^http:\/\/192\.168\.1\.20:5555\/#s=[A-Za-z0-9_-]{43}$/)
    expect(s.pairing!.expiresAt).toBeGreaterThan(Date.now())
    expect(s.idleStopAt).not.toBeNull()
  })

  it('el secreto sirve una sola vez y el QR deja de valer', async () => {
    const { svc } = make()
    const secret = secretOf(await svc.start())
    const hello: SignalHello = { t: 'hello', v: 1, mode: 'pair', secret, deviceName: 'Pixel' }
    expect(transport.opts!.authorize(hello)).toBe(true)
    expect(transport.opts!.authorize(hello)).toBe(false)
  })

  it('a los 120 s el QR caduca y el modo pasa a activo', async () => {
    const { svc } = make()
    const secret = secretOf(await svc.start())
    await vi.advanceTimersByTimeAsync(LIMITS.pairingTtlMs + 100)
    const s = svc.getState()
    expect(s).toMatchObject({ mode: 'active', pairing: null, pairingExpired: true })
    expect(transport.opts!.authorize({ t: 'hello', v: 1, mode: 'pair', secret, deviceName: 'x' })).toBe(false)
    const again = await svc.newPairing()
    expect(again.pairing).not.toBeNull()
    expect(again.pairingExpired).toBe(false)
  })

  it('vinculación completa con confirmación local y código idéntico', async () => {
    const { svc, devices } = make()
    const secret = secretOf(await svc.start())
    const { answerer } = connectPhone({ t: 'hello', v: 1, mode: 'pair', secret, deviceName: 'iPhone' })
    await vi.advanceTimersByTimeAsync(5)
    expect(answerer.channel.sent[0]).toEqual({ t: 'pair-pending' })
    expect(pairReqs).toHaveLength(1)
    expect(pairReqs[0]).toMatchObject({ deviceName: 'iPhone' })
    expect(pairReqs[0].code).toMatch(/^\d{6}$/)
    expect(svc.getState().pendingPair?.code).toBe(pairReqs[0].code)
    // nada se guardó todavía
    expect(devices.list()).toHaveLength(0)
    svc.confirmPair(pairReqs[0].requestId, true)
    await vi.advanceTimersByTimeAsync(5)
    const paired = answerer.channel.sent[1]
    expect(paired.t).toBe('paired')
    expect(devices.list()).toHaveLength(1)
    const st = svc.getState()
    expect(st.pendingPair).toBeNull()
    expect(st.devices[0]).toMatchObject({ name: 'iPhone', connected: true })
    expect(st.mode).toBe('active')
  })

  it('un celular reconocido se reconecta con el secreto por el canal; otro dispositivo es rechazado', async () => {
    const { svc, devices } = make()
    const a = devices.add('A')
    const b = devices.add('B')
    await svc.start()
    const first = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    first.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    expect(first.answerer.channel.sent[0]).toMatchObject({ t: 'authed' })
    const second = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: b.id })
    second.answerer.channel.recv({ t: 'auth', deviceId: b.id, secret: b.secret })
    await vi.advanceTimersByTimeAsync(5)
    expect(second.answerer.channel.sent.map((f) => f.t)).toEqual(['authed', 'bye'])
    expect(svc.getState().devices.find((d) => d.id === a.id)!.connected).toBe(true)
    // un dispositivo desconocido ni siquiera pasa el hello
    expect(transport.opts!.authorize({ t: 'hello', v: 1, mode: 'resume', deviceId: 'f'.repeat(32) })).toBe(false)
  })

  it('revocar desconecta al celular y borra el dispositivo', async () => {
    const { svc, devices } = make()
    const a = devices.add('A')
    await svc.start()
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    svc.revoke(a.id)
    await vi.advanceTimersByTimeAsync(5)
    expect(c.answerer.channel.sent.some((f) => f.t === 'bye' && f.reason === 'revoked')).toBe(true)
    expect(devices.list()).toHaveLength(0)
    expect(transport.opts!.authorize({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })).toBe(false)
  })

  it('«Cortar todo»: despide, cierra transporte y peers, anula el QR', async () => {
    const { svc, devices } = make()
    const a = devices.add('A')
    const secret = secretOf(await svc.start())
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    const done = svc.stopAll()
    await vi.advanceTimersByTimeAsync(400)
    const s = await done
    expect(s).toMatchObject({ mode: 'off', pairing: null })
    expect(transport.stopped).toBe(true)
    expect(c.answerer.channel.sent.some((f) => f.t === 'bye' && f.reason === 'stopped')).toBe(true)
    expect(c.answerer.closed).toBe(true)
    expect(transport.opts!.authorize({ t: 'hello', v: 1, mode: 'pair', secret, deviceName: 'x' })).toBe(false)
    expect(transport.opts!.authorize({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })).toBe(false)
  })

  it('se apaga solo a los 30 min sin conexiones', async () => {
    const { svc } = make()
    await svc.start()
    await vi.advanceTimersByTimeAsync(LIMITS.idleShutdownMs + 1000)
    expect(svc.getState().mode).toBe('off')
    expect(transport.stopped).toBe(true)
  })

  it('con un celular conectado no corre el temporizador de inactividad', async () => {
    const { svc, devices } = make()
    const a = devices.add('A')
    await svc.start()
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(LIMITS.idleShutdownMs + 1000)
    expect(svc.getState().mode).not.toBe('off')
    expect(svc.getState().idleStopAt).toBeNull()
  })

  it('motor v2: el despachador real deniega por defecto, el hub vive con el celular y se cierra al irse', async () => {
    let opened = 0
    const engine = createEngineHost({
      getMain: async () => ({ baseUrl: 'http://127.0.0.1:1', authorization: 'Basic eHg6eXk=', username: 'x', chatDirectory: '/c' }),
      loadScope: async () => ({ allowedDirs: [], chatDirs: [], fullAccessDirs: [] }),
      invoke: async () => ({ ok: true, data: null }),
      open: async () => {
        opened++
        return (async function* () {
          await new Promise(() => undefined)
        })()
      }
    })
    const { svc, devices } = make({ engine })
    const a = devices.add('A')
    await svc.start()
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    expect(engine.hub.running).toBe(false)
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    expect(engine.hub.running).toBe(true)
    // Canal desconocido y remote:* → forbidden (nunca unavailable: el despachador real está cableado).
    c.answerer.channel.recv({ t: 'call', id: 1, ch: 'x:desconocido', p: {} })
    c.answerer.channel.recv({ t: 'call', id: 2, ch: 'remote:stop' })
    await vi.advanceTimersByTimeAsync(5)
    const res = c.answerer.channel.sent.filter((f) => f.t === 'res') as Array<{ id: number; ok: boolean; error?: { code: string } }>
    expect(res.find((r) => r.id === 1)?.error?.code).toBe('forbidden')
    expect(res.find((r) => r.id === 2)?.error?.code).toBe('forbidden')
    // `sub` abre UN stream de subida bajo demanda; un motor inexistente se rechaza.
    c.answerer.channel.recv({ t: 'sub', id: 3, eng: 'main' })
    c.answerer.channel.recv({ t: 'sub', id: 4, eng: 'task/inexistente1' })
    await vi.advanceTimersByTimeAsync(5)
    expect(opened).toBe(1)
    const done = svc.stopAll()
    await vi.advanceTimersByTimeAsync(400)
    await done
    expect(engine.hub.running).toBe(false)
    expect(engine.hub.engines()).toEqual([])
  })
})

describe('RemoteService: política de la organización y caducidad', () => {
  const pol = (over: Partial<RemotePolicyView> = {}): RemotePolicyView => ({ ...NO_ORG_POLICY, managed: true, ...over })

  it('política que bloquea: no se puede activar y el estado lo explica', async () => {
    const { svc } = make({ policy: () => pol({ blocked: 'disabled' }) })
    const s = await svc.start()
    expect(s).toMatchObject({ available: false, unavailable: 'policy', mode: 'off', policy: { blocked: 'disabled' } })
    expect(transport.opts).toBeNull()
  })

  it('archivo de política inválido: bloqueado (fail closed)', async () => {
    const { svc } = make({ policy: () => invalidRemotePolicy() })
    expect(svc.getState()).toMatchObject({ available: false, unavailable: 'policy', policy: { blocked: 'invalid' } })
    expect((await svc.start()).mode).toBe('off')
  })

  it('aplicación en caliente: enabled:false corta la conexión viva sin reiniciar', async () => {
    let current = pol()
    const audits: AuditInput[] = []
    const { svc, devices } = make({ policy: () => current, audit: (e) => void audits.push(e) })
    const a = devices.add('A')
    await svc.start()
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    expect(svc.getState().devices[0]?.connected).toBe(true)
    current = pol({ blocked: 'disabled' })
    await vi.advanceTimersByTimeAsync(POLICY_POLL_MS + 500)
    expect(svc.getState().mode).toBe('off')
    expect(transport.stopped).toBe(true)
    expect(c.answerer.channel.sent.some((f) => f.t === 'bye' && f.reason === 'stopped')).toBe(true)
    expect(audits.some((e) => e.kind === 'policy-blocked')).toBe(true)
  })

  it('una conexión nueva también relee la política (authorize)', async () => {
    let current = pol()
    const { svc, devices } = make({ policy: () => current })
    const a = devices.add('A')
    await svc.start()
    current = pol({ blocked: 'invalid' })
    expect(transport.opts!.authorize({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })).toBe(false)
    await vi.advanceTimersByTimeAsync(5)
    expect(svc.getState().mode).toBe('off')
  })

  it('sin «recordar»: «Cortar todo» borra los vínculos', async () => {
    const { svc, devices } = make({ policy: () => pol({ allowRemember: false }) })
    devices.add('A')
    await svc.start()
    // al activar ya se borran los de antes
    expect(devices.list()).toHaveLength(0)
    devices.add('B')
    await svc.stopAll()
    expect(devices.list()).toHaveLength(0)
  })

  it('el tope de la política recorta la caducidad que se ve en Ajustes', () => {
    const { svc, devices } = make({ policy: () => pol({ deviceTtlDays: 30 }) })
    const { id } = devices.add('A', Date.now(), 365)
    const d = svc.getState().devices.find((x) => x.id === id)!
    expect(d.ttlDays).toBe(365)
    expect(d.expiresAt).toBe(Date.now() + 30 * 86_400_000)
  })

  it('«Revocar todos» despide al celular conectado y vacía la lista', async () => {
    const audits: AuditInput[] = []
    const { svc, devices } = make({ audit: (e) => void audits.push(e) })
    const a = devices.add('A')
    devices.add('B')
    await svc.start()
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    const s = svc.revokeAll()
    await vi.advanceTimersByTimeAsync(5)
    expect(s.devices).toHaveLength(0)
    expect(devices.list()).toHaveLength(0)
    expect(c.answerer.channel.sent.some((f) => f.t === 'bye' && f.reason === 'revoked')).toBe(true)
    expect(audits).toContainEqual({ kind: 'revoked-all', n: 2 })
  })

  it('un vínculo caducado se rechaza con `expired`, queda visible y se puede quitar', async () => {
    const { svc, devices } = make()
    const a = devices.add('A', Date.now(), 30)
    await svc.start()
    vi.setSystemTime(Date.now() + 31 * 86_400_000)
    expect(svc.getState().devices[0]).toMatchObject({ id: a.id, expired: true })
    const c = connectPhone({ t: 'hello', v: 1, mode: 'resume', deviceId: a.id })
    c.answerer.channel.recv({ t: 'auth', deviceId: a.id, secret: a.secret })
    await vi.advanceTimersByTimeAsync(5)
    expect(c.answerer.channel.sent[0]).toEqual({ t: 'auth-failed', why: 'expired' })
    expect(svc.revoke(a.id).devices).toHaveLength(0)
  })
})
