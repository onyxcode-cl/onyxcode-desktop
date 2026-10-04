import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS, type HostFrame } from '@shared/remote/protocol'
import type { RemoteConfirmRequest, RemotePolicyView } from '@shared/ipc-remote'
import type { AuditInput } from './audit'
import { ConfirmHost } from './confirm-host'
import { DevicesStore } from './devices-store'
import { NO_ORG_POLICY } from './org-policy'
import type { RtcAnswerer, RtcChannel } from './rtc'
import { RemoteService } from './service'
import type { SignalHello, SignalingPeer, SignalingStartOptions, SignalingTransport } from './signaling/types'
import { resumeAs } from './test-handshake'
import type { RemoteBackend } from './whitelist'
import type { EventSource } from './events'

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Buffer.from(s).reverse()),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString()
}

let dir: string
let devices: DevicesStore
let audits: AuditInput[]
let clock: number
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'svc-acc-'))
  devices = new DevicesStore(join(dir, 'remote.bin'), safe, { N: 16, r: 8, p: 1 })
  audits = []
  clock = 9_000_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function service(): RemoteService {
  const confirmHost = new ConfirmHost({ sendToWindow: () => true, dismissInWindow: () => undefined, fallback: async () => false })
  return new RemoteService({
    devices,
    loadRtc: async () => {
      throw new Error('no')
    },
    getLanIp: () => null,
    createTransport: () => {
      throw new Error('no')
    },
    backend: {} as RemoteBackend & EventSource,
    getEventClient: () => null,
    qr: () => [],
    onChanged: () => undefined,
    onPairRequest: () => undefined,
    now: () => clock,
    confirmHost,
    audit: (e) => void audits.push(e)
  })
}

describe('RemoteService: recordar 12 h, PIN y auditoría', () => {
  it('«Recordar 12 h» por dispositivo con reloj falso: aparece en el estado y caduca', () => {
    const s = service()
    const { id } = devices.add('Pixel')
    expect(s.getState().devices[0]).toMatchObject({ id, trustUntil: null, hasPin: false, access: null })
    s.setRemember(id, true)
    expect(s.getState().devices[0]?.trustUntil).toBe(clock + LIMITS.rememberMs)
    clock += LIMITS.rememberMs + 1
    expect(s.getState().devices[0]?.trustUntil).toBeNull()
    s.setRemember(id, true)
    s.setRemember(id, false)
    expect(s.getState().devices[0]?.trustUntil).toBeNull()
  })

  it('restablecer el PIN lo borra, queda auditado y el estado nunca lo expone', async () => {
    const s = service()
    const { id } = devices.add('Pixel')
    await devices.setPin(id, '918273')
    const st = s.getState().devices[0]!
    expect(st.hasPin).toBe(true)
    expect(JSON.stringify(s.getState())).not.toContain('918273')
    expect(JSON.stringify(s.getState())).not.toMatch(/"(pin|hash|salt)"/)
    s.resetPin(id)
    expect(s.getState().devices[0]?.hasPin).toBe(false)
    expect(audits).toEqual([expect.objectContaining({ kind: 'pin-reset', device: st.fingerprint })])
  })

  it('revocar audita sin secretos y borra el dispositivo', () => {
    const s = service()
    const { id } = devices.add('Pixel')
    s.revoke(id)
    expect(s.getState().devices).toEqual([])
    expect(audits).toEqual([expect.objectContaining({ kind: 'revoked', name: 'Pixel' })])
  })
})

// ── Confirmación por conexión opcional (v3), «secreto robado» y H6, con el servicio y el handshake reales ──

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
  has(pred: (f: HostFrame) => boolean): boolean {
    return this.sent.some(pred)
  }
}

class Answerer implements RtcAnswerer {
  channel = new Chan()
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

class Transport implements SignalingTransport {
  opts: SignalingStartOptions | null = null
  cb: ((p: SignalingPeer) => void) | null = null
  async start(o: SignalingStartOptions): Promise<{ origin: string }> {
    this.opts = o
    return { origin: 'http://192.168.1.20:5555' }
  }
  onPeer(cb: (p: SignalingPeer) => void): void {
    this.cb = cb
  }
  async stop(): Promise<void> {}
}

const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function rig(policy?: () => RemotePolicyView) {
  const transport = new Transport()
  const answerers: Answerer[] = []
  const requests: RemoteConfirmRequest[] = []
  const confirmHost = new ConfirmHost({
    sendToWindow: (info) => {
      requests.push(info)
      return true
    },
    dismissInWindow: () => undefined,
    fallback: async () => false
  })
  const svc = new RemoteService({
    devices,
    loadRtc: async () => ({
      createAnswerer: () => {
        const a = new Answerer()
        answerers.push(a)
        return a
      }
    }),
    getLanIp: () => '192.168.1.20',
    createTransport: () => transport,
    backend: {} as RemoteBackend & EventSource,
    getEventClient: () => null,
    qr: () => [[true]],
    onChanged: () => undefined,
    onPairRequest: () => undefined,
    now: () => clock,
    confirmHost,
    audit: (e) => void audits.push(e),
    policy
  })
  /** Un celular ya vinculado se conecta y completa el handshake. */
  const connect = (id: string, secret: string): { answerer: Answerer; channel: Chan } => {
    const hello: SignalHello = { t: 'hello', v: 3, mode: 'resume', deviceId: id }
    expect(transport.opts!.authorize(hello)).toBe(true)
    const peer = new Peer(hello)
    transport.cb!(peer)
    peer.offer!(FP('ab'))
    const answerer = answerers[answerers.length - 1]
    answerer.openChannel()
    resumeAs(answerer.channel, { deviceId: id, secret })
    return { answerer, channel: answerer.channel }
  }
  const approve = (remember = false): void => {
    const r = requests.shift()
    if (!r) throw new Error('no hay confirmación pendiente')
    confirmHost.answer(r.requestId, true, remember)
  }
  return { svc, requests, connect, approve, answerers }
}

describe('RemoteService: confirmación por conexión opcional (v3)', () => {
  it('con PIN y el ajuste apagado (por defecto): ningún diálogo en el Mac; pide el PIN y abre con él', async () => {
    const { svc, requests, connect } = rig()
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    await svc.start()
    expect(svc.getState()).toMatchObject({ confirmEachConnection: false, confirmEachForced: false })
    const { channel } = connect(id, secret)
    await settle()
    expect(requests).toHaveLength(0)
    expect(channel.has((f) => f.t === 'locked' && f.why === 'pin-verify')).toBe(true)
    expect(channel.has((f) => f.t === 'locked' && f.why === 'confirm')).toBe(false)
    channel.recv({ t: 'pin-verify', pin: '246810' })
    await settle()
    expect(channel.has((f) => f.t === 'unlocked')).toBe(true)
    expect(audits.some((a) => a.kind === 'connected')).toBe(true)
  })

  it('con el ajuste encendido: pide confirmación (comportamiento anterior) y «Recordar 12 h» sigue funcionando', async () => {
    const { svc, requests, connect, approve } = rig()
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    await svc.start()
    expect(svc.setConfirmEach(true).confirmEachConnection).toBe(true)
    const first = connect(id, secret)
    await settle()
    expect(requests).toHaveLength(1)
    expect(first.channel.has((f) => f.t === 'locked' && f.why === 'confirm')).toBe(true)
    approve(true)
    await settle()
    expect(devices.trustedUntil(id)).toBe(clock + LIMITS.rememberMs)
    expect(first.channel.has((f) => f.t === 'locked' && f.why === 'pin-verify')).toBe(true)
    // Reconexión dentro de las 12 h: ya no pregunta.
    const second = connect(id, secret)
    await settle()
    expect(requests).toHaveLength(0)
    expect(second.channel.has((f) => f.t === 'locked' && f.why === 'pin-verify')).toBe(true)
  })

  it('apagar el ajuste borra «Recordar 12 h» de todos', async () => {
    const { svc } = rig()
    const { id } = devices.add('Pixel')
    svc.setConfirmEach(true)
    svc.setRemember(id, true)
    expect(devices.trustedUntil(id)).not.toBeNull()
    svc.setConfirmEach(false)
    expect(devices.trustedUntil(id)).toBeNull()
    expect(devices.getPrefs().confirmEachConnection).toBe(false)
  })

  it('política requireConnectionConfirm:true: pide aunque el ajuste esté apagado y el usuario no puede quitarlo', async () => {
    const pol: RemotePolicyView = { ...NO_ORG_POLICY, managed: true, requireConnectionConfirm: true }
    const { svc, requests, connect } = rig(() => pol)
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    await svc.start()
    expect(svc.getState()).toMatchObject({ confirmEachConnection: true, confirmEachForced: true })
    expect(svc.setConfirmEach(false)).toMatchObject({ confirmEachConnection: true, confirmEachForced: true })
    expect(devices.getPrefs().confirmEachConnection).toBe(false) // no se tocó
    connect(id, secret)
    await settle()
    expect(requests).toHaveLength(1)
  })

  it('dispositivo SIN PIN: siempre pide confirmación aunque el ajuste esté apagado', async () => {
    const { svc, requests, connect } = rig()
    const { id, secret } = devices.add('Pixel')
    await svc.start()
    const { channel } = connect(id, secret)
    await settle()
    expect(requests).toHaveLength(1)
    expect(channel.has((f) => f.t === 'locked' && f.why === 'confirm')).toBe(true)
    expect(channel.has((f) => f.t === 'unlocked')).toBe(false)
  })

  it('secreto robado sin PIN: entra en el canal pero queda en pin-verify; call/sub forbidden; 5 PIN malos revocan; nunca unlocked', async () => {
    const { svc, requests, connect } = rig()
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    await svc.start()
    const { channel } = connect(id, secret)
    await settle()
    expect(requests).toHaveLength(0)
    channel.recv({ t: 'call', id: 1, ch: 'app:info' })
    channel.recv({ t: 'sub', id: 2, eng: 'main' })
    await settle()
    expect(channel.has((f) => f.t === 'res' && f.id === 1 && !f.ok)).toBe(true)
    expect(channel.has((f) => f.t === 'res' && f.id === 2 && !f.ok)).toBe(true)
    for (let i = 0; i < 5; i++) {
      channel.recv({ t: 'pin-verify', pin: '000000' })
      await settle()
      clock += 60_000
    }
    expect(devices.get(id)).toBeNull()
    expect(channel.has((f) => f.t === 'unlocked')).toBe(false)
  })

  it('H6: «Cortar todo» borra «Recordar 12 h» y la actividad reciente; al reactivar pide PIN (sin reconexión en caliente) y confirma', async () => {
    const { svc, requests, connect, approve } = rig()
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    await svc.start()
    svc.setConfirmEach(true)
    const first = connect(id, secret)
    await settle()
    approve(true)
    await settle()
    first.channel.recv({ t: 'pin-verify', pin: '246810' })
    await settle()
    expect(first.channel.has((f) => f.t === 'unlocked')).toBe(true)
    expect(devices.trustedUntil(id)).not.toBeNull()
    await svc.stopAll()
    expect(devices.trustedUntil(id)).toBeNull()
    await svc.start()
    clock += 30_000 // dentro de los 5 min de actividad reciente: sin el arreglo reconectaría sin PIN
    const second = connect(id, secret)
    await settle()
    expect(requests).toHaveLength(1) // vuelve a pedir confirmación
    expect(second.channel.has((f) => f.t === 'unlocked')).toBe(false)
    approve(false)
    await settle()
    expect(second.channel.has((f) => f.t === 'locked' && f.why === 'pin-verify')).toBe(true)
    expect(second.channel.has((f) => f.t === 'unlocked')).toBe(false)
  })

  it('H6: «Quitar todos» deja el dispositivo inexistente (el hello ya no pasa) y no queda actividad que reutilizar', async () => {
    const { svc, connect, requests } = rig()
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    await svc.start()
    const first = connect(id, secret)
    await settle()
    first.channel.recv({ t: 'pin-verify', pin: '246810' })
    await settle()
    expect(first.channel.has((f) => f.t === 'unlocked')).toBe(true)
    svc.revokeAll()
    await settle()
    expect(devices.list()).toHaveLength(0)
    expect(requests).toHaveLength(0)
    expect(svc.getState().devices).toHaveLength(0)
  })
})
