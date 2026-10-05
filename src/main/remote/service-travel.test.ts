/**
 * `RemoteService` en MODO VIAJE (túnel rápido sin cuenta). Parte 1: transporte doble (control total del túnel, reloj falso) para las
 * reglas del servicio: bloqueos, QR `/k/<T>#s=<q>`, PIN obligatorio, sin confirmación en el Mac, vínculo efímero, cierres y política.
 * Parte 2: con el transporte REAL y el `cloudflared` falso (proceso de verdad): cierra sin procesos y relanza con URL nueva.
 * Nada de red real, ni de Cloudflare ni de internet.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { pairId } from '@shared/remote/handshake'
import { LIMITS, PROTOCOL_VERSION, type HostFrame } from '@shared/remote/protocol'
import { TRAVEL_STUN_URLS, type TravelBinaryState } from '@shared/remote/travel'
import type { RemotePolicyView, RemoteState } from '@shared/ipc-remote'
import { macOnly } from '../../test/platform'
import type { AuditInput } from './audit'
import { ConfirmHost } from './confirm-host'
import { DevicesStore } from './devices-store'
import { parseRemotePolicy } from './org-policy'
import type { RtcAnswerer, RtcChannel } from './rtc'
import { RemoteService } from './service'
import type { SignalHello, SignalingPeer, SignalingStartOptions, SignalingTransport } from './signaling/types'
import { pairAs, resumeAs } from './test-handshake'
import type { EventSource } from './events'
import type { RemoteBackend } from './whitelist'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData, getAppPath: () => process.cwd() } }))

import { realCloudflaredDeps } from './tunnel/real-deps'
import { fakeValue, makeFakeBinary } from './tunnel/test-fake'
import { TunnelSignalingTransport } from './signaling/tunnel-transport'
import type { HttpGet } from './signaling/tunnel-selfcheck'

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Buffer.from(s).reverse()),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString()
}
const FP = (h: string): string => `v=0\r\na=fingerprint:sha-256 ${h.repeat(32).match(/../g)!.join(':').toUpperCase()}\r\n`
// Esperas que NO usan temporizadores (sirven también con el reloj falso de `vi.useFakeTimers`): ceden el turno con `setImmediate`.
const yieldNow = (): Promise<void> => new Promise((r) => setImmediate(r))
async function settle(ms = 30): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) await yieldNow()
}
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: tiempo agotado')
    await yieldNow()
  }
}

class Chan implements RtcChannel {
  sent: HostFrame[] = []
  open = true
  private m: ((r: unknown) => void) | null = null
  private o: (() => void) | null = null
  private c: (() => void) | null = null
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
  onClose(cb: () => void): void {
    this.c = cb
  }
  fireOpen(): void {
    this.o?.()
  }
  fireClose(): void {
    this.open = false
    this.c?.()
  }
  recv(o: unknown): void {
    this.m?.(JSON.stringify(o))
  }
  has(pred: (f: HostFrame) => boolean): boolean {
    return this.sent.some(pred)
  }
}
class Answerer implements RtcAnswerer {
  channel = new Chan()
  private ans: ((s: string) => void) | null = null
  private ch: ((c: RtcChannel) => void) | null = null
  constructor(readonly opts: { bindAddress?: string; iceServers?: unknown[] }) {}
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
  close(): void {}
  openChannel(): void {
    this.ch?.(this.channel)
    this.channel.fireOpen()
  }
}
class Peer implements SignalingPeer {
  offer: ((s: string) => void) | null = null
  constructor(readonly hello: SignalHello) {}
  sendAnswer(): void {}
  sendIce(): void {}
  onOffer(cb: (s: string) => void): void {
    this.offer = cb
  }
  onIce(): void {}
  onClose(): void {}
  close(): void {}
}

/** Transporte doble con el contrato de viaje (token, fase, reinicio, caída). */
class StubTunnel implements SignalingTransport {
  opts: SignalingStartOptions | null = null
  cb: ((p: SignalingPeer) => void) | null = null
  stopped = 0
  origin = 'https://alpha-beta-gamma-delta.trycloudflare.com'
  token: string | null = 'T'.repeat(22)
  ph: 'idle' | 'starting' | 'checking' | 'online' | 'connecting' | 'retrying' | 'failed' = 'idle'
  err: string | null = null
  restartCb: ((o: string) => void) | null = null
  failCb: ((e: string) => void) | null = null
  gate: Promise<void> | null = null
  async start(o: SignalingStartOptions): Promise<{ origin: string }> {
    this.opts = o
    this.ph = 'starting'
    if (this.gate) await this.gate
    this.ph = 'online'
    return { origin: this.origin }
  }
  onPeer(cb: (p: SignalingPeer) => void): void {
    this.cb = cb
  }
  async stop(): Promise<void> {
    this.stopped++
    this.ph = 'idle'
    this.token = null
  }
  status(): 'online' | 'connecting' | 'offline' {
    return this.ph === 'online' ? 'online' : 'connecting'
  }
  travelToken(): string | null {
    return this.token
  }
  phase(): StubTunnel['ph'] {
    return this.ph
  }
  lastError(): string | null {
    return this.err
  }
  onRestart(cb: (o: string) => void): void {
    this.restartCb = cb
  }
  onFail(cb: (e: string) => void): void {
    this.failCb = cb
  }
}

let dir = ''
let devices: DevicesStore
let audits: AuditInput[]
let clock: number
let states: RemoteState[]
let pairReqs: Array<{ requestId: string; code: string; deviceName: string }>
let confirmRequests: unknown[]
let answerers: Answerer[]
let stub: StubTunnel
let created: Array<{ ip: string; mode: string | undefined }>
let binary: TravelBinaryState
let installs: number
let installResult: { ok: boolean; error?: string }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'svc-travel-'))
  userData = dir
  devices = new DevicesStore(join(dir, 'remote.bin'), safe, { N: 16, r: 8, p: 1 })
  devices.setCloudPrefs({ connection: 'travel' })
  audits = []
  clock = 50_000_000
  states = []
  pairReqs = []
  confirmRequests = []
  answerers = []
  stub = new StubTunnel()
  created = []
  binary = 'ready'
  installs = 0
  installResult = { ok: true }
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function rig(o: { policy?: () => RemotePolicyView; transport?: () => SignalingTransport; travel?: boolean } = {}) {
  const confirmHost = new ConfirmHost({
    sendToWindow: (info) => (confirmRequests.push(info), true),
    dismissInWindow: () => undefined,
    fallback: async () => false
  })
  const svc = new RemoteService({
    devices,
    loadRtc: async () => ({
      createAnswerer: (opts) => {
        const a = new Answerer(opts)
        answerers.push(a)
        return a
      }
    }),
    getLanIp: () => '192.168.1.20',
    createTransport: (ip, mode) => {
      created.push({ ip, mode })
      return o.transport ? o.transport() : stub
    },
    backend: {} as RemoteBackend & EventSource,
    getEventClient: () => null,
    qr: () => [[true]],
    onChanged: (s) => states.push(s),
    onPairRequest: (r) => pairReqs.push(r),
    now: () => clock,
    confirmHost,
    audit: (e) => void audits.push(e),
    policy: o.policy,
    travel:
      o.travel === false
        ? undefined
        : {
            binaryState: () => binary,
            install: async () => {
              installs++
              await settle(20)
              if (installResult.ok) binary = 'ready'
              return installResult
            }
          }
  })
  return svc
}

const qOf = (s: RemoteState): string => /#s=([A-Za-z0-9_-]+)$/.exec(s.pairing!.url)![1]
const kinds = (): string[] => audits.map((a) => a.kind)

/** Un celular se vincula (sin pasar por la red: el transporte es doble) y fija su PIN. */
async function pairPhone(
  svc: RemoteService,
  s: RemoteState,
  pin = '246810'
): Promise<{ id: string; secret: string; channel: Chan; answerer: Answerer }> {
  const q = qOf(s)
  const hello: SignalHello = { t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', qid: pairId(q), deviceName: 'Pixel' }
  expect(stub.opts!.authorize(hello)).toBe(true)
  const peer = new Peer(hello)
  stub.cb!(peer)
  peer.offer!(FP('ab'))
  const answerer = answerers[answerers.length - 1]
  answerer.openChannel()
  pairAs(answerer.channel, { q })
  await until(() => pairReqs.length > 0)
  svc.confirmPair(pairReqs.at(-1)!.requestId, true)
  await until(() => answerer.channel.has((f) => f.t === 'paired'))
  const paired = answerer.channel.sent.find((f) => f.t === 'paired') as { deviceId: string; deviceSecret: string }
  answerer.channel.recv({ t: 'pin-set', pin })
  await until(() => answerer.channel.has((f) => f.t === 'unlocked'))
  return { id: paired.deviceId, secret: paired.deviceSecret, channel: answerer.channel, answerer }
}

function reconnect(id: string, secret: string): { channel: Chan; answerer: Answerer } {
  const hello: SignalHello = { t: 'hello', v: PROTOCOL_VERSION, mode: 'resume', deviceId: id }
  expect(stub.opts!.authorize(hello)).toBe(true)
  const peer = new Peer(hello)
  stub.cb!(peer)
  peer.offer!(FP('ab'))
  const answerer = answerers[answerers.length - 1]
  answerer.openChannel()
  resumeAs(answerer.channel, { deviceId: id, secret })
  return { channel: answerer.channel, answerer }
}

describe('modo viaje: antes de abrir', () => {
  it('con «viaje» elegido y el binario sin instalar: no se crea ningún transporte; Ajustes lo explica', async () => {
    binary = 'missing'
    const svc = rig()
    expect(svc.getState()).toMatchObject({ connection: 'travel', travel: { status: 'idle', keep: 'idle30', binary: 'missing' } })
    const s = await svc.start()
    expect(created).toEqual([])
    expect(s.mode).toBe('off')
    expect(s.travel).toMatchObject({ status: 'failed', error: 'no-binary', binary: 'missing' })
    expect(s.error).toBe('travel:no-binary')
  })

  it('sin dependencias de viaje (plataforma sin binario) el modo está bloqueado por política', async () => {
    const svc = rig({ travel: false })
    const s = await svc.start()
    expect(created).toEqual([])
    expect(s.travel?.blocked).toBe('policy')
  })

  const blocks: Array<[string, Record<string, unknown> | null, 'policy' | 'confirm-required' | 'passkey-required']> = [
    ['allowTravelMode=false', { remote: { allowTravelMode: false } }, 'policy'],
    ['archivo sin la clave (cerrado)', { remote: {} }, 'policy'],
    ['archivo sin bloque remote (cerrado)', {}, 'policy'],
    ['requireConnectionConfirm', { remote: { allowTravelMode: true, requireConnectionConfirm: true } }, 'confirm-required'],
    ['requirePasskey', { remote: { allowTravelMode: true, requirePasskey: true } }, 'passkey-required']
  ]
  for (const [name, raw, why] of blocks)
    it(`política «${name}»: no se abre ni puerto ni proceso (travel.blocked=${why})`, async () => {
      const svc = rig({ policy: () => parseRemotePolicy(raw) })
      const s = await svc.start()
      expect(created).toEqual([])
      expect(s.mode).toBe('off')
      expect(s.travel?.blocked).toBe(why)
      expect(s.error).toBe(`travel-blocked:${why}`)
    })

  it('el ajuste «confirmar cada conexión» del usuario también lo bloquea', async () => {
    devices.setPrefs({ confirmEachConnection: true })
    const svc = rig()
    const s = await svc.start()
    expect(created).toEqual([])
    expect(s.travel?.blocked).toBe('confirm-required')
  })

  it('con allowTravelMode=true explícito sí abre', async () => {
    const svc = rig({ policy: () => parseRemotePolicy({ remote: { allowTravelMode: true, travelMaxHours: 6 } }) })
    const s = await svc.start()
    expect(created).toEqual([{ ip: '', mode: 'travel' }])
    expect(s.mode).toBe('pairing')
    expect(s.travel?.blocked).toBeUndefined()
  })
})

describe('modo viaje: QR y estado', () => {
  it('start: sin IP local, QR `/k/<T>#s=<q>`, estado en línea sin T ni q, vida máxima acotada', async () => {
    const svc = rig()
    const s = await svc.start()
    expect(created).toEqual([{ ip: '', mode: 'travel' }])
    expect(s.mode).toBe('pairing')
    expect(s.connection).toBe('travel')
    expect(s.pairing!.url).toBe(`${stub.origin}/k/${stub.token}#s=${qOf(s)}`)
    expect(s.travel).toMatchObject({
      status: 'online',
      url: stub.origin,
      keep: 'idle30',
      binary: 'ready',
      expiresAt: clock + 24 * 3_600_000
    })
    // La puerta T y el secreto q solo están en el enlace del QR: ni en el estado del túnel ni en el resto.
    const rest = JSON.stringify({ ...s, pairing: null })
    expect(rest).not.toContain(stub.token as string)
    expect(rest).not.toContain(qOf(s))
    expect(audits).toContainEqual({ kind: 'travel-started', why: 'idle30' })
    await svc.stopAll()
  })

  it('mientras el túnel se abre Ajustes ve la fase (starting) y no hay QR hasta que está listo', async () => {
    let release!: () => void
    stub.gate = new Promise<void>((r) => (release = r))
    const svc = rig()
    const p = svc.start()
    await settle()
    expect(svc.getState().mode).toBe('off')
    expect(svc.getState().travel?.status).toBe('starting')
    expect(svc.getState().pairing).toBeNull()
    release()
    const s = await p
    expect(s.travel?.status).toBe('online')
    expect(s.pairing).not.toBeNull()
    await svc.stopAll()
  })

  it('si no hay `T` (túnel reiniciándose) el QR no se muestra', async () => {
    const svc = rig()
    await svc.start()
    stub.token = null
    stub.ph = 'retrying'
    expect(svc.getState().pairing).toBeNull()
    expect(svc.getState().travel?.status).toBe('retrying')
    await svc.stopAll()
  })

  it('un fallo al abrir deja el código en `travel.error` y no deja QR', async () => {
    const bad = new StubTunnel()
    bad.start = async () => {
      throw Object.assign(new Error('rate'), { code: 'rate' })
    }
    const svc = rig({ transport: () => bad })
    const s = await svc.start()
    expect(s.mode).toBe('off')
    expect(s.travel).toMatchObject({ status: 'failed', error: 'rate' })
    expect(s.pairing).toBeNull()
    expect(bad.stopped).toBe(1)
  })
})

describe('modo viaje: vinculación y reconexión desde fuera', () => {
  it('vincula con STUN públicos (sin IP local ni TURN), crea un vínculo efímero `travel` y exige el PIN', async () => {
    const svc = rig()
    const s = await svc.start()
    const ph = await pairPhone(svc, s)
    const a = ph.answerer
    expect(a.opts.bindAddress).toBeUndefined()
    expect(a.opts.iceServers).toEqual([{ urls: [...TRAVEL_STUN_URLS] }])
    const rec = devices.get(ph.id)!
    expect(rec.kind).toBe('travel')
    expect(rec.expiresAt).toBe(clock + 24 * 3_600_000)
    expect(devices.hasPin(ph.id)).toBe(true)
    expect(svc.getState().devices[0]).toMatchObject({ id: ph.id, kind: 'travel', hasPin: true, expiresAt: clock + 24 * 3_600_000 })
    expect(a.channel.has((f) => f.t === 'locked' && f.why === 'pin-set')).toBe(true)
    // Vincular ya pide el código de 6 dígitos al dueño (ese diálogo es de la vinculación, no de cada conexión).
    expect(pairReqs).toHaveLength(1)
    expect(kinds()).toContain('paired')
    await svc.stopAll()
  })

  it('reconecta con el PIN SIN confirmación en el Mac', async () => {
    const svc = rig()
    const s = await svc.start()
    const ph = await pairPhone(svc, s)
    ph.channel.fireClose()
    await settle()
    // Pasado el plazo de actividad reciente (5 min) la reconexión pide el PIN; antes es «en caliente» y no lo pide.
    clock += LIMITS.inactivityLockMs + 1000
    const again = reconnect(ph.id, ph.secret)
    await settle()
    expect(confirmRequests).toHaveLength(0)
    expect(again.channel.has((f) => f.t === 'locked' && f.why === 'pin-verify')).toBe(true)
    expect(again.channel.has((f) => f.t === 'locked' && f.why === 'confirm')).toBe(false)
    again.channel.recv({ t: 'pin-verify', pin: '246810' })
    await settle()
    expect(again.channel.has((f) => f.t === 'unlocked')).toBe(true)
    await svc.stopAll()
  })

  it('un vínculo de viaje SIN PIN no puede reconectar (lejos de casa nadie confirmaría)', async () => {
    const svc = rig()
    const s = await svc.start()
    const q = qOf(s)
    // Se simula un vínculo de viaje que no llegó a fijar PIN.
    const { id } = devices.add('Pixel', clock, undefined, null, 3, { kind: 'travel', expiresAt: clock + 3_600_000 })
    expect(stub.opts!.authorize({ t: 'hello', v: PROTOCOL_VERSION, mode: 'resume', deviceId: id })).toBe(false)
    await devices.setPin(id, '123456')
    expect(stub.opts!.authorize({ t: 'hello', v: PROTOCOL_VERSION, mode: 'resume', deviceId: id })).toBe(true)
    expect(q).toBeTruthy()
    await svc.stopAll()
  })

  it('los vínculos normales (LAN/nube) no entran por el túnel de viaje', async () => {
    const svc = rig()
    await svc.start()
    const lan = devices.add('Mac vecino').id
    await devices.setPin(lan, '123456')
    expect(stub.opts!.authorize({ t: 'hello', v: PROTOCOL_VERSION, mode: 'resume', deviceId: lan })).toBe(false)
    await svc.stopAll()
  })

  it('al revés: un vínculo de viaje no sirve en «Solo esta red»', async () => {
    const { id } = devices.add('Pixel', clock, undefined, null, 3, { kind: 'travel' })
    await devices.setPin(id, '123456')
    devices.setCloudPrefs({ connection: 'lan' })
    const svc = rig()
    await svc.start()
    // `start()` borra los vínculos de viaje que quedaran de antes.
    expect(devices.get(id)).toBeNull()
    await svc.stopAll()
  })

  it('el celular que se va sin fijar su PIN pierde el vínculo (no serviría para reconectar)', async () => {
    const svc = rig()
    const s = await svc.start()
    const q = qOf(s)
    const hello: SignalHello = { t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', qid: pairId(q), deviceName: 'Pixel' }
    expect(stub.opts!.authorize(hello)).toBe(true)
    const peer = new Peer(hello)
    stub.cb!(peer)
    peer.offer!(FP('ab'))
    const a = answerers.at(-1)!
    a.openChannel()
    pairAs(a.channel, { q })
    await until(() => pairReqs.length > 0)
    svc.confirmPair(pairReqs.at(-1)!.requestId, true)
    await until(() => a.channel.has((f) => f.t === 'paired'))
    expect(devices.list()).toHaveLength(1)
    a.channel.fireClose() // se va sin `pin-set`
    await until(() => devices.list().length === 0)
    await svc.stopAll()
  })

  it('máximo UN vínculo de viaje a la vez', async () => {
    const svc = rig()
    const s = await svc.start()
    await pairPhone(svc, s)
    expect(() => devices.add('Otro', clock, undefined, null, 3, { kind: 'travel' })).toThrow('devices-limit')
    await svc.stopAll()
  })
})

describe('modo viaje: cierres', () => {
  it('«Cortar todo» con el celular conectado: bye travel-ended, vínculo borrado, túnel parado, auditado', async () => {
    const svc = rig()
    const s = await svc.start()
    const ph = await pairPhone(svc, s)
    expect(devices.list()).toHaveLength(1)
    const st = await svc.stopAll()
    expect(ph.channel.sent.some((f) => f.t === 'bye' && f.reason === 'travel-ended')).toBe(true)
    expect(devices.list()).toHaveLength(0)
    expect(stub.stopped).toBe(1)
    expect(st.mode).toBe('off')
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'user' })
    expect(st.travel).toMatchObject({ status: 'idle' })
  })

  it('salir de la app (dispose): corta, borra el vínculo y audita quit', async () => {
    const svc = rig()
    const s = await svc.start()
    await pairPhone(svc, s)
    await svc.dispose()
    expect(devices.list()).toHaveLength(0)
    expect(stub.stopped).toBe(1)
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'quit' })
  })

  it('a los 30 min sin conexiones se cierra solo (reloj falso)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const svc = rig()
    const s = await svc.start()
    expect(s.idleStopAt).toBe(clock + LIMITS.idleShutdownMs)
    await vi.advanceTimersByTimeAsync(LIMITS.idleShutdownMs - 1000)
    expect(svc.getState().mode).toBe('pairing')
    await vi.advanceTimersByTimeAsync(2000)
    expect(svc.getState().mode).toBe('off')
    expect(stub.stopped).toBe(1)
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'idle' })
  })

  it('«Mantener abierto 4 h»: sin cierre por inactividad; a las 4 h se corta aunque haya alguien conectado', async () => {
    devices.setCloudPrefs({ travelKeep: 'h4' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const svc = rig()
    const s = await svc.start()
    expect(s.idleStopAt).toBeNull()
    expect(s.travel).toMatchObject({ keep: 'h4', expiresAt: clock + 4 * 3_600_000 })
    const ph = await pairPhone(svc, s)
    clock += 4 * 3_600_000
    await vi.advanceTimersByTimeAsync(4 * 3_600_000 + 1000)
    expect(svc.getState().mode).toBe('off')
    expect(ph.channel.sent.some((f) => f.t === 'bye' && f.reason === 'travel-ended')).toBe(true)
    expect(devices.list()).toHaveLength(0)
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'expired' })
  })

  it('el tope `travelMaxHours` de la política manda sobre «Mantener abierto»', async () => {
    devices.setCloudPrefs({ travelKeep: 'h24' })
    const svc = rig({ policy: () => parseRemotePolicy({ remote: { allowTravelMode: true, travelMaxHours: 3 } }) })
    const s = await svc.start()
    expect(s.travel?.expiresAt).toBe(clock + 3 * 3_600_000)
    await svc.stopAll()
  })

  it('cambiar «Mantener abierto» en caliente recalcula el tope', async () => {
    const svc = rig()
    await svc.start()
    const s = svc.setTravelKeep('h12')
    expect(s.travel).toMatchObject({ keep: 'h12', expiresAt: clock + 12 * 3_600_000 })
    expect(s.idleStopAt).toBeNull()
    expect(svc.setTravelKeep('idle30').idleStopAt).not.toBeNull()
    expect(svc.setTravelKeep('forever' as never).travel?.keep).toBe('idle30')
    await svc.stopAll()
  })

  it('la política pasa a `false` en caliente: corte inmediato (policy-blocked), vínculo borrado', async () => {
    let allow = true
    const svc = rig({ policy: () => parseRemotePolicy({ remote: { allowTravelMode: allow } }) })
    const s = await svc.start()
    const ph = await pairPhone(svc, s)
    allow = false
    svc.applyPolicy()
    await until(() => svc.getState().mode === 'off')
    await settle(300)
    expect(ph.channel.sent.some((f) => f.t === 'bye' && f.reason === 'travel-ended')).toBe(true)
    expect(devices.list()).toHaveLength(0)
    expect(stub.stopped).toBe(1)
    expect(kinds()).toContain('policy-blocked')
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'policy' })
  })

  it('encender «confirmar cada conexión» con el túnel abierto lo cierra', async () => {
    const svc = rig()
    await svc.start()
    svc.setConfirmEach(true)
    await until(() => svc.getState().mode === 'off')
    expect(stub.stopped).toBe(1)
  })

  it('cambiar a «Solo esta red» con el túnel abierto lo cierra y arranca la red local', async () => {
    const svc = rig()
    const s = await svc.start()
    const ph = await pairPhone(svc, s)
    const lan = new StubTunnel()
    lan.origin = 'http://192.168.1.20:5555'
    created.length = 0
    const svc2 = svc
    await svc2.setConnection('lan')
    expect(ph.channel.sent.some((f) => f.t === 'bye' && f.reason === 'travel-ended')).toBe(true)
    expect(devices.list().filter((d) => d.kind === 'travel')).toHaveLength(0)
    expect(created).toEqual([{ ip: '192.168.1.20', mode: 'lan' }])
    await svc.stopAll()
    expect(lan.stopped).toBe(0)
  })
})

describe('modo viaje: relanzamiento y caída del túnel', () => {
  it('URL nueva: revoca los vínculos del túnel anterior, avisa, audita y da QR nuevo con otra T', async () => {
    const svc = rig()
    const s = await svc.start()
    const ph = await pairPhone(svc, s)
    const oldQ = qOf(s)
    stub.origin = 'https://new-name-after-restart-now.trycloudflare.com'
    stub.token = 'N'.repeat(22)
    stub.restartCb!(stub.origin)
    const st = svc.getState()
    expect(devices.list()).toHaveLength(0)
    expect(ph.channel.sent.some((f) => f.t === 'bye' && f.reason === 'travel-ended')).toBe(true)
    expect(audits).toContainEqual({ kind: 'travel-url-changed' })
    expect(st.pairing!.url).toBe(`${stub.origin}/k/${'N'.repeat(22)}#s=${qOf(st)}`)
    expect(qOf(st)).not.toBe(oldQ)
    expect(st.travel?.url).toBe(stub.origin)
    await svc.stopAll()
  })

  it('el túnel se rinde: se corta todo y Ajustes enseña el error', async () => {
    const svc = rig()
    const s = await svc.start()
    await pairPhone(svc, s)
    stub.failCb!('rate')
    await until(() => svc.getState().travel?.error === 'rate')
    const st = svc.getState()
    expect(st.mode).toBe('off')
    expect(st.travel).toMatchObject({ status: 'failed', error: 'rate' })
    expect(devices.list()).toHaveLength(0)
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'crash' })
    // Un código raro se normaliza.
    const again = rig()
    await again.start()
    stub.failCb!('<script>')
    await until(() => again.getState().travel?.error === 'exited:1')
  })

  it('el estado refleja `connecting`/`offline` del túnel', async () => {
    const svc = rig()
    await svc.start()
    stub.ph = 'connecting'
    expect(svc.getState().travel?.status).toBe('connecting')
    stub.ph = 'failed'
    stub.err = 'timeout'
    expect(svc.getState().travel).toMatchObject({ status: 'failed', error: 'timeout' })
    stub.ph = 'online'
    await svc.stopAll()
  })
})

describe('modo viaje: conexión directa que no abre', () => {
  it('oferta sin canal: se cuenta, se audita travel-ice-failed y Ajustes lo ve (directFailures)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const svc = rig()
    const s = await svc.start()
    const hello: SignalHello = { t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', qid: pairId(qOf(s)), deviceName: 'Pixel' }
    const peer = new Peer(hello)
    stub.cb!(peer)
    peer.offer!(FP('ab')) // llega la oferta, el canal nunca se abre
    await vi.advanceTimersByTimeAsync(26_000)
    expect(audits).toContainEqual({ kind: 'travel-ice-failed' })
    expect(svc.getState().travel?.directFailures).toBe(1)
    await svc.stopAll()
  })
})

describe('modo viaje: instalar el binario', () => {
  it('con el permiso de la política instala; sin él NO hay petición', async () => {
    binary = 'missing'
    const ok = rig()
    expect((await ok.travelInstall()).ok).toBe(true)
    expect(installs).toBe(1)
    expect(ok.getState().travel?.binary).toBe('ready')
    for (const raw of [{ remote: { allowTravelMode: true, allowTravelDownload: false } }, { remote: { allowTravelMode: false } }, {}]) {
      installs = 0
      const denied = rig({ policy: () => parseRemotePolicy(raw) })
      expect(await denied.travelInstall()).toEqual({ ok: false, error: 'policy' })
      expect(installs).toBe(0)
    }
  })
  it('durante la descarga el estado es `downloading` y una segunda petición es `busy`', async () => {
    binary = 'missing'
    const svc = rig()
    const p = svc.travelInstall()
    await settle(5)
    expect(svc.getState().travel?.status).toBe('downloading')
    expect(await svc.travelInstall()).toEqual({ ok: false, error: 'busy' })
    await p
    expect(svc.getState().travel?.status).toBe('idle')
  })
  it('un fallo se devuelve como código y no rompe', async () => {
    binary = 'missing'
    installResult = { ok: false, error: 'bad-hash' }
    expect(await rig().travelInstall()).toEqual({ ok: false, error: 'bad-hash' })
  })
})

describe('el celular no puede tocar el modo viaje', () => {
  it('los canales de viaje (`remote:*`) se rechazan como cualquier otro canal de administración', async () => {
    const { decide } = await import('./policy')
    const ctx = { allowedDirs: [], chatDirs: [], fullAccessDirs: [] } as never
    for (const channel of ['remote:travelInstall', 'remote:setTravelKeep', 'remote:setConnection', 'remote:start', 'remote:stop'])
      expect(decide({ kind: 'ipc', channel, payload: { consent: true, keep: 'h4' } } as never, ctx), channel).toEqual({
        allow: false,
        reason: 'forbidden'
      })
  })
})

// ── Parte 2: transporte REAL + cloudflared FALSO ──

describe.skipIf(!macOnly)('modo viaje con el cloudflared falso (proceso real)', { timeout: 40_000 }, () => {
  const MARK = ['cloudflared', 'test'].join('-')
  const psAll = (): string[] => execFileSync('/bin/ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  const noFake = (): boolean => !psAll().some((l) => l.includes(`${dir}/bin/${MARK}/cloudflared`) && !/\bzsh\b|vitest/.test(l))
  let lines: string[]
  const phones: WebSocket[] = []
  afterEach(() => {
    for (const p of phones.splice(0)) p.terminate()
  })

  function viaProxy(): HttpGet {
    return (url, headers) =>
      new Promise((resolve, reject) => {
        const u = new URL(url)
        const r = request(
          { host: '127.0.0.1', port: Number(fakeValue(lines, 'FAKE_PROXY_PORT')), path: u.pathname, headers: { ...headers, Host: u.host } },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
          }
        )
        r.on('error', reject)
        r.end()
      })
  }

  function realRig(mode: string) {
    lines = []
    const pwa = join(dir, 'pwa')
    mkdirSync(pwa, { recursive: true })
    writeFileSync(join(pwa, 'index.html'), '<!doctype html><html><head><title>pwa</title></head></html>')
    const bin = makeFakeBinary(dir, mode)
    let transport: TunnelSignalingTransport | null = null
    const svc = new RemoteService({
      devices,
      loadRtc: async () => ({ createAnswerer: (o) => new Answerer(o) }),
      getLanIp: () => null,
      createTransport: () => {
        transport = new TunnelSignalingTransport({
          pwaDir: pwa,
          ensureBinary: async () => bin,
          homeDir: join(dir, 'cloudflared', 'home'),
          deps: realCloudflaredDeps,
          audit: (e) => audits.push(e),
          httpGet: viaProxy(),
          onProcessLine: (l) => lines.push(l),
          backoff: () => 50,
          stopGraceMs: 800,
          selfCheckMaxMs: 3000
        })
        return transport
      },
      backend: {} as RemoteBackend & EventSource,
      getEventClient: () => null,
      qr: () => [[true]],
      onChanged: (s) => states.push(s),
      onPairRequest: () => undefined,
      now: () => clock,
      audit: (e) => void audits.push(e),
      travel: { binaryState: () => 'ready', install: async () => ({ ok: true }) }
    })
    return { svc, transport: () => transport as unknown as TunnelSignalingTransport }
  }

  it('abre, el celular entra por la puerta + WebSocket; «Cortar todo» deja el sistema SIN procesos y borra el vínculo', async () => {
    const { svc } = realRig('ok')
    const s = await svc.start()
    expect(s.mode).toBe('pairing')
    expect(s.travel?.status).toBe('online')
    const url = new URL(s.pairing!.url)
    expect(url.pathname).toMatch(/^\/k\/[A-Za-z0-9_-]{22}$/)
    expect(url.hash).toMatch(/^#s=/)
    // El celular por «internet»: la puerta, la PWA y el WebSocket con el Origin del túnel.
    const get = (path: string, cookie?: string): Promise<{ status: number; cookie: string }> =>
      new Promise((resolve, reject) => {
        const r = request(
          {
            host: '127.0.0.1',
            port: Number(fakeValue(lines, 'FAKE_PROXY_PORT')),
            path,
            headers: { Host: url.host, ...(cookie ? { Cookie: cookie } : {}) }
          },
          (res) => (res.resume(), resolve({ status: res.statusCode ?? 0, cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] }))
        )
        r.on('error', reject)
        r.end()
      })
    const gate = await get(url.pathname)
    expect(gate.status).toBe(303)
    expect((await get('/')).status).toBe(404)
    expect((await get('/', gate.cookie)).status).toBe(200)
    const ws = new WebSocket(`ws://127.0.0.1:${fakeValue(lines, 'FAKE_PROXY_PORT')}/ws`, {
      headers: { Host: url.host, Origin: url.origin, Cookie: gate.cookie }
    })
    phones.push(ws)
    await new Promise<void>((r, j) => (ws.once('open', () => r()), ws.once('error', j)))
    ws.close()
    // «Cortar todo»: sin procesos.
    await svc.stopAll()
    await until(noFake, 8000)
    expect(svc.getState().mode).toBe('off')
    expect(audits).toContainEqual({ kind: 'travel-stopped', why: 'user' })
  })

  it('el proceso muere solo: el servicio se entera, revoca, da QR nuevo con otra URL y T, y al final no queda nada', async () => {
    const { svc } = realRig('exit-after:900')
    const s = await svc.start()
    const first = s.pairing!.url
    const { id } = devices.add('Pixel', clock, undefined, null, 3, { kind: 'travel', expiresAt: clock + 3_600_000 })
    await until(() => audits.some((a) => a.kind === 'travel-url-changed'), 15_000)
    expect(devices.get(id)).toBeNull()
    const st = svc.getState()
    expect(st.pairing!.url).not.toBe(first)
    expect(new URL(st.pairing!.url).pathname).not.toBe(new URL(first).pathname) // otra T
    await svc.dispose()
    await until(noFake, 8000)
  })

  it('autocomprobación que detecta una página alterada: no se abre el modo y no queda nada', async () => {
    const { svc } = realRig('inject')
    const s = await svc.start()
    expect(s.mode).toBe('off')
    expect(s.travel).toMatchObject({ status: 'failed', error: 'site-mismatch' })
    expect(s.pairing).toBeNull()
    expect(audits).toContainEqual({ kind: 'site-mismatch', why: 'tunnel' })
    await until(noFake, 8000)
  })
})
