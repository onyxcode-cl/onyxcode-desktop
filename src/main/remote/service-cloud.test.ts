/**
 * Modo «También fuera de casa» de extremo a extremo SIN red real: el servicio de conexión es `FakeCloud` (ws en 127.0.0.1 con el
 * mismo `RoomCore` del Worker), el celular hace su señalización por un `ws` real y el DataChannel es un doble (como en
 * `service.test.ts`). Se prueba el transporte de nube + `RemoteService` + `PeerSession` juntos.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { pairRoom, pairSecretFromCode, roomOfToken } from '@shared/remote/cloud'
import { pairId } from '@shared/remote/handshake'
import type { HostFrame, IceServerSpec } from '@shared/remote/protocol'
import type { RemotePolicyView, RemoteState } from '@shared/ipc-remote'
import { DevicesStore } from './devices-store'
import { NO_ORG_POLICY } from './org-policy'
import type { RtcAnswerer, RtcChannel, RtcFactory } from './rtc'
import { RemoteService } from './service'
import { FakeCloud } from './signaling/fake-cloud'
import { LanSignalingServer } from './signaling/lan-server'
import { CloudSignalingTransport } from './signaling/worker-client'
import type { SignalingTransport } from './signaling/types'
import { pairAs, resumeAs } from './test-handshake'
import type { EventSource } from './events'
import type { RemoteBackend } from './whitelist'

const FP = (h: string): string => `v=0\r\na=fingerprint:sha-256 ${h.repeat(32).match(/../g)!.join(':').toUpperCase()}\r\n`

class Chan implements RtcChannel {
  sent: HostFrame[] = []
  private m: ((r: unknown) => void) | null = null
  private o: (() => void) | null = null
  send(t: string): void {
    this.sent.push(JSON.parse(t) as HostFrame)
  }
  close(): void {}
  isOpen(): boolean {
    return true
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
  type: string | null = 'host'
  private ans: ((s: string) => void) | null = null
  private ch: ((c: RtcChannel) => void) | null = null
  constructor(readonly opts: { bindAddress?: string; iceServers?: IceServerSpec[] }) {}
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
  selectedType(): string | null {
    return this.type
  }
  close(): void {
    this.closed = true
  }
  openChannel(): void {
    this.ch?.(this.channel)
    this.channel.fireOpen()
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

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: tiempo agotado')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let dir: string
let cloud: FakeCloud
let base: string
let answerers: Answerer[]
let pairReqs: Array<{ requestId: string; deviceName: string; code: string }>
let states: RemoteState[]
let lanTransports: number
const phones: WebSocket[] = []

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'svc-cloud-'))
  cloud = new FakeCloud()
  base = await cloud.start()
  answerers = []
  pairReqs = []
  states = []
  lanTransports = 0
})
afterEach(async () => {
  for (const p of phones.splice(0)) p.terminate()
  await cloud.stop()
  rmSync(dir, { recursive: true, force: true })
})

interface Opts {
  policy?: () => RemotePolicyView
  paused?: () => boolean
  cloudPrefs?: boolean
  devices?: DevicesStore
  audit?: (e: { kind: string }) => void
}

function make(o: Opts = {}) {
  const devices = o.devices ?? new DevicesStore(join(dir, 'remote.bin'), safe)
  if (o.cloudPrefs !== false) devices.setCloudPrefs({ connection: 'cloud' })
  const rtc: RtcFactory = {
    createAnswerer: (opts) => {
      const a = new Answerer(opts)
      answerers.push(a)
      return a
    }
  }
  const policy = o.policy ?? (() => NO_ORG_POLICY)
  const svc = new RemoteService({
    devices,
    loadRtc: async () => rtc,
    getLanIp: () => '192.168.1.20',
    createTransport: (_ip, mode): SignalingTransport => {
      if (mode === 'cloud')
        return new CloudSignalingTransport({
          baseUrl: base,
          hostToken: () => devices.hostToken(),
          allowed: () => {
            const p = policy()
            return !p.blocked && p.allowOutsideNetwork && !p.requirePasskey && !(o.paused?.() ?? false)
          },
          pingMs: 60_000
        })
      lanTransports++
      return new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir })
    },
    backend,
    getEventClient: () => null,
    qr: () => [[true]],
    onChanged: (s) => states.push(s),
    onPairRequest: (r) => pairReqs.push(r),
    policy,
    cloudPaused: o.paused,
    audit: o.audit as never,
    caps: () => ['entry']
  })
  return { svc, devices }
}

/** Un celular: señalización por ws real a una sala; devuelve lo que recibe. */
function phoneAt(room: string, origin = 'https://remoto.onyxcode.cl') {
  const ws = new WebSocket(`${base}/v1/peer/${room}`, { origin })
  phones.push(ws)
  const got: Array<Record<string, unknown>> = []
  ws.on('message', (d) => got.push(JSON.parse(d.toString('utf8')) as Record<string, unknown>))
  ws.on('error', () => undefined)
  const send = (o: unknown): void => ws.send(JSON.stringify(o))
  return { ws, got, send, ready: () => until(() => ws.readyState === WebSocket.OPEN) }
}

const codeOf = (s: RemoteState): string => s.pairing!.code!
const qOf = (s: RemoteState): string => pairSecretFromCode(codeOf(s))!

/** Pasa la señalización de un celular hasta tener el canal (doble) abierto. */
async function negotiate(ph: ReturnType<typeof phoneAt>, hello: Record<string, unknown>): Promise<Answerer> {
  await ph.ready()
  ph.send(hello)
  await until(() => ph.got.some((f) => f.t === 'ready'))
  const before = answerers.length
  ph.send({ t: 'offer', sdp: FP('ab') })
  await until(() => answerers.length > before && ph.got.some((f) => f.t === 'answer'))
  const a = answerers[answerers.length - 1]
  a.openChannel()
  return a
}

describe('RemoteService en modo nube', () => {
  it('start: sin IP local, QR con el código de 16 caracteres (#c=) y el mismo código para escribir; dos sockets (sala del Mac y de vinculación)', async () => {
    const { svc } = make()
    const s = await svc.start()
    expect(s.mode).toBe('pairing')
    expect(s.connection).toBe('cloud')
    expect(s.pairing!.url).toMatch(/^https:\/\/remoto\.onyxcode\.cl\/#c=[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
    expect(s.pairing!.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
    expect(s.pairing!.url.endsWith(s.pairing!.code!)).toBe(true)
    expect(JSON.stringify(s)).not.toContain(qOf(s)) // q no sale del Mac ni en el estado
    await until(() => cloud.openHosts === 2)
    await until(() => svc.getState().cloudStatus === 'online')
    await svc.stopAll()
  })

  it('vinculación completa por la nube: mismo código de 6 dígitos, confirmación local y paired con la sala', async () => {
    const { svc, devices } = make()
    const s = await svc.start()
    const q = qOf(s)
    await until(() => cloud.openHosts === 2)
    const ph = phoneAt(pairRoom(q))
    const a = await negotiate(ph, { t: 'hello', v: 4, mode: 'pair', qid: pairId(q), deviceName: 'iPhone' })
    // STUN siempre, sin servidores propios ni IP a la que ligarse
    expect(a.opts.bindAddress).toBeUndefined()
    expect(a.opts.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }])
    const phone = pairAs(a.channel, { q, v: 4 })
    await until(() => pairReqs.length === 1)
    expect(a.channel.sent.map((f) => f.t).slice(0, 2)).toEqual(['hs2', 'pair-pending'])
    expect(a.channel.sent[1]).toMatchObject({ caps: ['entry'] })
    expect(phone.proofOk()).toBe(true)
    expect(phone.sas()).toBe(pairReqs[0].code)
    svc.confirmPair(pairReqs[0].requestId, true)
    await until(() => a.channel.sent.some((f) => f.t === 'paired'))
    const paired = a.channel.sent.find((f) => f.t === 'paired') as { room?: string }
    expect(paired.room).toBe(roomOfToken(devices.hostToken()!))
    expect(devices.list()).toHaveLength(1)
    // la sala de vinculación se cerró al consumirse el QR (queda solo la del Mac)
    await until(() => cloud.openHosts === 1)
    await svc.stopAll()
  })

  async function pairOne(svc: RemoteService, devices: DevicesStore): Promise<{ id: string; secret: string; room: string }> {
    const s = await svc.start()
    const q = qOf(s)
    await until(() => cloud.openHosts === 2)
    const ph = phoneAt(pairRoom(q))
    const a = await negotiate(ph, { t: 'hello', v: 4, mode: 'pair', qid: pairId(q), deviceName: 'Pixel' })
    pairAs(a.channel, { q, v: 4 })
    await until(() => pairReqs.length > 0)
    svc.confirmPair(pairReqs.at(-1)!.requestId, true)
    await until(() => a.channel.sent.some((f) => f.t === 'paired'))
    const f = a.channel.sent.find((x) => x.t === 'paired') as { deviceId: string; deviceSecret: string; room: string }
    expect(devices.get(f.deviceId)).not.toBeNull()
    return { id: f.deviceId, secret: f.deviceSecret, room: f.room }
  }

  it('reconexión desde fuera: resume por la sala del Mac, sin diálogo en el Mac', async () => {
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    pairReqs.length = 0
    const ph = phoneAt(dev.room)
    const a = await negotiate(ph, { t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    resumeAs(a.channel, { deviceId: dev.id, secret: dev.secret, v: 4 })
    await until(() => a.channel.sent.some((f) => f.t === 'authed'))
    expect(a.channel.sent.find((f) => f.t === 'authed')).toMatchObject({ caps: ['entry'] })
    expect(pairReqs).toHaveLength(0)
    expect(svc.getState().devices[0].connected).toBe(true)
    await svc.stopAll()
  })

  it('un celular v3 por la nube funciona, pero no recibe caps', async () => {
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    const ph = phoneAt(dev.room)
    const a = await negotiate(ph, { t: 'hello', v: 3, mode: 'resume', deviceId: dev.id })
    resumeAs(a.channel, { deviceId: dev.id, secret: dev.secret })
    await until(() => a.channel.sent.some((f) => f.t === 'authed'))
    expect(a.channel.sent.find((f) => f.t === 'authed')).not.toHaveProperty('caps')
    await svc.stopAll()
  })

  it('resume por la sala de vinculación se rechaza; pair por la sala del Mac también', async () => {
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    const s = await svc.newPairing()
    const q = qOf(s)
    await until(() => cloud.openHosts === 2)
    const viaPair = phoneAt(pairRoom(q))
    await viaPair.ready()
    viaPair.send({ t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    await until(() => viaPair.got.length > 0)
    expect(viaPair.got[0]).toEqual({ t: 'error', code: 'invalid' })
    const viaMain = phoneAt(dev.room)
    await viaMain.ready()
    viaMain.send({ t: 'hello', v: 4, mode: 'pair', qid: pairId(q), deviceName: 'x' })
    await until(() => viaMain.got.length > 0)
    expect(viaMain.got[0]).toEqual({ t: 'error', code: 'invalid' })
    // y esos intentos no gastaron el QR
    expect(svc.getState().pairing).not.toBeNull()
    await svc.stopAll()
  })

  it('dispositivo revocado: invalid', async () => {
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    svc.revoke(dev.id)
    const ph = phoneAt(dev.room)
    await ph.ready()
    ph.send({ t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    await until(() => ph.got.length > 0)
    expect(ph.got[0]).toEqual({ t: 'error', code: 'invalid' })
    await svc.stopAll()
  })

  it('«Quitar todos» renueva la sala: la dirección anterior ya no contesta y el Mac reabre con la nueva', async () => {
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    const oldRoom = dev.room
    svc.revokeAll()
    await until(() => roomOfToken(devices.hostToken()!) !== oldRoom)
    await until(() => cloud.openHosts >= 1 && svc.getState().cloudStatus === 'online')
    const ph = phoneAt(oldRoom)
    await until(() => ph.got.length > 0)
    expect(ph.got[0]).toEqual({ t: 'error', code: 'host-offline' })
    await svc.stopAll()
  })

  it('TURN: grant solo tras authorize verdadero; los servidores llegan al respondedor junto al STUN', async () => {
    const servers: IceServerSpec[] = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }]
    cloud.turn = servers
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    // un hello rechazado no recibe TURN
    const bad = phoneAt(dev.room)
    await bad.ready()
    bad.send({ t: 'hello', v: 4, mode: 'resume', deviceId: 'f'.repeat(32) })
    await until(() => bad.got.length > 0)
    expect(bad.got.map((f) => f.t)).toEqual(['error'])
    // uno válido sí
    const ph = phoneAt(dev.room)
    const a = await negotiate(ph, { t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    expect(ph.got.map((f) => f.t).slice(0, 2)).toEqual(['turn', 'ready'])
    expect(a.opts.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }, ...servers])
    await svc.stopAll()
  })

  it('allowRelay=false: sin TURN aunque el servicio lo tenga', async () => {
    cloud.turn = [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }]
    const policy = (): RemotePolicyView => ({ ...NO_ORG_POLICY, managed: true, allowRelay: false })
    const { svc, devices } = make({ policy })
    const dev = await pairOne(svc, devices)
    const ph = phoneAt(dev.room)
    const a = await negotiate(ph, { t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    expect(ph.got.some((f) => f.t === 'turn')).toBe(false)
    expect(a.opts.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }])
    await svc.stopAll()
  })

  it('«vía relé» se refleja en el estado cuando la pila dice relay', async () => {
    const { svc, devices } = make()
    const dev = await pairOne(svc, devices)
    const ph = phoneAt(dev.room)
    await ph.ready()
    ph.send({ t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    await until(() => ph.got.some((f) => f.t === 'ready'))
    ph.send({ t: 'offer', sdp: FP('ab') })
    await until(() => answerers.length > 1)
    const a = answerers.at(-1)!
    a.type = 'relay'
    a.openChannel()
    resumeAs(a.channel, { deviceId: dev.id, secret: dev.secret, v: 4 })
    await until(() => svc.getState().relayInUse === true)
    await svc.stopAll()
  })

  it('sitio en pausa (vigilancia): el Mac deja de contestar por la nube (el celular ve «Mac no disponible»)', async () => {
    const pausedBox = { v: false }
    const { svc, devices } = make({ paused: () => pausedBox.v })
    const dev = await pairOne(svc, devices)
    pausedBox.v = true
    expect(svc.getState().cloudStatus).toBe('paused')
    const ph = phoneAt(dev.room)
    await ph.ready()
    ph.send({ t: 'hello', v: 4, mode: 'resume', deviceId: dev.id })
    await until(() => ph.got.length > 0)
    // Nadie recibe `ready`: el socket del Mac se cerró (política/vigilancia) o su `hello` se rechazó.
    expect(ph.got.some((f) => f.t === 'ready')).toBe(false)
    expect(cloud.openHosts).toBe(0)
    await svc.stopAll()
  })

  it('«Cortar todo» cierra los sockets de salida y apaga «Disponible fuera de casa»', async () => {
    const { svc, devices } = make()
    await pairOne(svc, devices)
    await svc.setAway(true)
    expect(devices.getCloudPrefs().away).toBe(true)
    await svc.stopAll()
    expect(devices.getCloudPrefs()).toMatchObject({ connection: 'cloud', away: false })
    await until(() => cloud.openHosts === 0)
    expect(svc.getState()).toMatchObject({ mode: 'off', away: false })
  })

  it('«Disponible fuera de casa»: arranca sin QR al abrir la app y no se apaga por inactividad; sin él, sí hay plazo', async () => {
    const { svc, devices } = make()
    await pairOne(svc, devices)
    await svc.stopAll()
    await until(() => cloud.openHosts === 0)
    // sin away: nada arranca solo
    expect((await svc.autoStartAway()).mode).toBe('off')
    devices.setCloudPrefs({ away: true })
    const s = await svc.autoStartAway()
    expect(s.mode).toBe('active')
    expect(s.pairing).toBeNull()
    expect(s.idleStopAt).toBeNull()
    await until(() => cloud.openHosts === 1)
    // sin celulares vinculados tampoco arranca
    await svc.dispose()
    expect(devices.getCloudPrefs().away).toBe(true) // salir de la app NO apaga away
    devices.revokeAll()
    expect((await svc.autoStartAway()).mode).toBe('off')
    // sin away, activar a mano sí tiene el apagado por inactividad
    devices.setCloudPrefs({ away: false })
    const manual = await svc.start()
    expect(manual.idleStopAt).not.toBeNull()
    await svc.stopAll()
  })

  it('política allowOutsideNetwork=false: se queda en la red local, sin ningún socket hacia el servicio, y lo explica', async () => {
    const policy = (): RemotePolicyView => ({ ...NO_ORG_POLICY, managed: true, allowOutsideNetwork: false })
    const { svc } = make({ policy })
    const s = await svc.start()
    expect(lanTransports).toBe(1)
    expect(cloud.hostConnections).toBe(0)
    expect(s.outsideBlocked).toBe('policy')
    expect(s.pairing!.url).toMatch(/^http:\/\//)
    expect(s.pairing!.code).toBeUndefined()
    await svc.stopAll()
  })

  it('requirePasskey (aún sin passkeys): el modo nube no se activa', async () => {
    const policy = (): RemotePolicyView => ({ ...NO_ORG_POLICY, managed: true, allowOutsideNetwork: true, requirePasskey: true })
    const { svc } = make({ policy })
    const s = await svc.start()
    expect(cloud.hostConnections).toBe(0)
    expect(s.outsideBlocked).toBe('passkey-required')
    await svc.stopAll()
  })

  it('la política que se cierra con el modo nube en marcha corta el socket al instante', async () => {
    const box = { allowed: true }
    const policy = (): RemotePolicyView => ({ ...NO_ORG_POLICY, managed: true, allowOutsideNetwork: box.allowed })
    const audits: string[] = []
    const devices = new DevicesStore(join(dir, 'remote.bin'), safe)
    devices.setCloudPrefs({ connection: 'cloud' })
    const rtc: RtcFactory = { createAnswerer: (o) => new Answerer(o) }
    const svc = new RemoteService({
      devices,
      loadRtc: async () => rtc,
      getLanIp: () => null,
      createTransport: () =>
        new CloudSignalingTransport({ baseUrl: base, hostToken: () => devices.hostToken(), allowed: () => box.allowed }),
      backend,
      getEventClient: () => null,
      qr: () => [[true]],
      onChanged: () => undefined,
      onPairRequest: () => undefined,
      policy,
      audit: (e) => audits.push(e.kind)
    })
    await svc.start()
    await until(() => cloud.openHosts === 2)
    box.allowed = false
    svc.applyPolicy()
    await until(() => cloud.openHosts === 0)
    expect(svc.getState().mode).toBe('off')
    expect(audits).toContain('policy-blocked')
  })

  it('la auditoría registra el encendido, el cambio de modo y «Disponible fuera de casa» (sin secretos)', async () => {
    const kinds: Array<{ kind: string; why?: string }> = []
    const { svc } = make({ audit: (e) => kinds.push(e as { kind: string }) })
    await svc.start()
    await svc.setAway(true)
    await svc.setAway(true) // sin cambio: no se vuelve a anotar
    await svc.setConnection('lan')
    await svc.stopAll()
    expect(kinds.map((k) => k.kind).filter((k) => k !== 'stopped')).toEqual([
      'cloud-started',
      'away-enabled',
      'connection-changed',
      'away-disabled'
    ])
    expect(kinds.find((k) => k.kind === 'connection-changed')?.why).toBe('lan')
    expect(JSON.stringify(kinds)).not.toMatch(/[A-Za-z0-9_-]{43}/)
  })

  it('cambiar el modo con el servicio en marcha lo reinicia con el modo nuevo', async () => {
    const { svc } = make()
    await svc.start()
    await until(() => cloud.openHosts === 2)
    const s = await svc.setConnection('lan')
    expect(lanTransports).toBe(1)
    expect(s.connection).toBe('lan')
    expect(s.pairing!.url).toMatch(/^http:\/\//)
    await until(() => cloud.openHosts === 0)
    await svc.stopAll()
  })

  it('suspender cierra el socket y despertar lo reabre; el estado lo refleja', async () => {
    const { svc } = make()
    await svc.start()
    await until(() => svc.getState().cloudStatus === 'online')
    svc.onPower(true)
    await until(() => cloud.openHosts === 0)
    expect(svc.getState().cloudStatus).toBe('offline')
    svc.onPower(false)
    await until(() => cloud.openHosts === 2)
    await until(() => svc.getState().cloudStatus === 'online')
    await svc.stopAll()
  })
})
