import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MuxError, type MuxDispatch } from '@shared/remote/mux'
import type { HostFrame } from '@shared/remote/protocol'
import type { ConnectionDecision } from './access-gate'
import type { AuditInput } from './audit'
import { DevicesStore } from './devices-store'
import { PeerSession, type PeerAccess } from './peer-session'
import type { RtcChannel } from './rtc'
import type { RemoteBackend } from './whitelist'

class Chan implements RtcChannel {
  sent: HostFrame[] = []
  open = true
  private msg: ((raw: unknown) => void) | null = null
  send(text: string): void {
    this.sent.push(JSON.parse(text) as HostFrame)
  }
  close(): void {
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
  onClose(): void {}
  recv(o: unknown): void {
    this.msg?.(JSON.stringify(o))
  }
  has(pred: (f: HostFrame) => boolean): boolean {
    return this.sent.some(pred)
  }
}

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Buffer.from(s).reverse()),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString()
}
const backend: RemoteBackend = {
  listSessions: async () => ({ sessions: [], permissions: [] }),
  messages: async () => ({ sessionId: 'ses_1', messages: [], hasMore: false }),
  prompt: async () => undefined,
  abort: async () => undefined,
  replyPermission: async () => undefined
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

let dir: string
let devices: DevicesStore
let audits: AuditInput[]
let decisions: ConnectionDecision[]
let revoked: string[]
let calls: string[]
let clock: number
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peer-acc-'))
  devices = new DevicesStore(join(dir, 'remote.bin'), safe, { N: 16, r: 8, p: 1 })
  audits = []
  decisions = []
  revoked = []
  calls = []
  clock = 5_000_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const dispatch: MuxDispatch = {
  call: async (req) => {
    calls.push(req.ch)
    if (req.ch === 'remote:confirmAction') throw new MuxError('forbidden')
    return { ok: req.ch }
  },
  http: async () => 'x'
}

function access(over: Partial<PeerAccess> = {}): PeerAccess {
  return {
    confirmConnection: async () => decisions.shift() ?? { approved: true, outcome: 'approved' },
    trusted: () => false,
    lastActiveAt: () => null,
    noteActive: () => undefined,
    onRevokeDevice: (id) => void revoked.push(id),
    onChange: () => undefined,
    audit: (e) => void audits.push(e),
    ...over
  }
}

function pairSession(ch: Chan, acc: PeerAccess): PeerSession {
  const s = new PeerSession({
    channel: ch,
    kind: 'pair',
    deviceName: 'iPhone',
    code: '123456',
    devices,
    backend,
    confirmPair: async () => true,
    onAuthed: () => true,
    onEnd: () => undefined,
    dispatch,
    access: acc,
    clock: () => clock
  })
  s.start()
  return s
}

function resumeSession(ch: Chan, id: string, secret: string, acc: PeerAccess): PeerSession {
  const s = new PeerSession({
    channel: ch,
    kind: 'resume',
    deviceId: id,
    code: '123456',
    devices,
    backend,
    confirmPair: async () => false,
    onAuthed: () => true,
    onEnd: () => undefined,
    dispatch,
    access: acc,
    clock: () => clock
  })
  s.start()
  ch.recv({ t: 'auth', deviceId: id, secret })
  return s
}

describe('PeerSession con control de acceso', () => {
  it('vinculación: sin PIN no hay acceso a nada salvo el flujo de PIN; al fijarlo se abre', async () => {
    const ch = new Chan()
    const s = pairSession(ch, access())
    await settle()
    expect(ch.has((f) => f.t === 'paired')).toBe(true)
    expect(ch.has((f) => f.t === 'locked' && f.why === 'pin-set')).toBe(true)
    expect(s.accessView).toBe('pin')

    // Llamadas v2 y v1: rechazadas sin llegar al despachador ni al motor.
    ch.recv({ t: 'call', id: 1, ch: 'app:info' })
    ch.recv({ t: 'req', id: 2, m: 'sessions.list', p: {} })
    ch.recv({ t: 'sub', id: 3, eng: 'main' })
    await settle()
    expect(calls).toEqual([])
    expect(ch.has((f) => f.t === 'res' && f.id === 1 && !f.ok)).toBe(true)
    expect(ch.has((f) => f.t === 'res' && f.id === 2 && !f.ok)).toBe(true)

    ch.recv({ t: 'pin-set', pin: '246810' })
    await settle()
    expect(ch.has((f) => f.t === 'unlocked')).toBe(true)
    expect(s.accessView).toBe('open')
    expect(devices.list()[0]?.pin).toBeTruthy()
    ch.recv({ t: 'call', id: 4, ch: 'app:info' })
    await settle()
    expect(calls).toEqual(['app:info'])
    expect(audits.map((a) => a.kind)).toEqual(expect.arrayContaining(['paired', 'pin-set']))
  })

  it('reconexión: espera confirmación (sin acceso), luego PIN; los eventos no salen mientras no esté abierto', async () => {
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    let release!: (d: ConnectionDecision) => void
    const ch = new Chan()
    const s = resumeSession(ch, id, secret, access({ confirmConnection: () => new Promise((r) => (release = r)) }))
    await settle()
    expect(ch.has((f) => f.t === 'authed')).toBe(true)
    expect(ch.has((f) => f.t === 'locked' && f.why === 'confirm')).toBe(true)
    expect(s.accessView).toBe('awaiting')
    ch.recv({ t: 'call', id: 1, ch: 'app:info' })
    ch.recv({ t: 'pin-verify', pin: '246810' })
    await settle()
    expect(calls).toEqual([])
    expect(s.accessView).toBe('awaiting')
    s.sendEvent({ e: 'session.removed', sessionId: 'ses_1' })
    expect(ch.has((f) => f.t === 'evt')).toBe(false)

    release({ approved: true, outcome: 'approved' })
    await settle()
    expect(s.accessView).toBe('pin')
    ch.recv({ t: 'pin-verify', pin: '246810' })
    await settle()
    expect(s.accessView).toBe('open')
    s.sendEvent({ e: 'session.removed', sessionId: 'ses_1' })
    expect(ch.has((f) => f.t === 'evt')).toBe(true)
  })

  it('el Mac rechaza la conexión: denied y se cierra, sin acceso', async () => {
    const { id, secret } = devices.add('Pixel')
    decisions.push({ approved: false, outcome: 'rejected' })
    const ch = new Chan()
    const s = resumeSession(ch, id, secret, access())
    await settle()
    expect(ch.has((f) => f.t === 'denied' && f.reason === 'rejected')).toBe(true)
    expect(s.state).toBe('closed')
    expect(calls).toEqual([])
  })

  it('5 PIN incorrectos revocan al dispositivo (por el servicio) y quedan auditados', async () => {
    const { id, secret } = devices.add('Pixel')
    await devices.setPin(id, '246810')
    const ch = new Chan()
    resumeSession(ch, id, secret, access({ trusted: () => true }))
    await settle()
    for (let i = 0; i < 5; i++) {
      ch.recv({ t: 'pin-verify', pin: '000000' })
      await settle()
      clock += 60_000
    }
    expect(revoked).toEqual([id])
    expect(audits.filter((a) => a.kind === 'pin-fail')).toHaveLength(5)
    expect(JSON.stringify(audits)).not.toContain('000000')
    expect(JSON.stringify(audits)).not.toContain('246810')
  })

  it('rechazo de la política (forbidden) queda auditado solo con canal y clase', async () => {
    const ch = new Chan()
    pairSession(ch, access())
    await settle()
    ch.recv({ t: 'pin-set', pin: '246810' })
    await settle()
    ch.recv({ t: 'call', id: 1, ch: 'remote:confirmAction', p: { requestId: 'a', accept: true, secreto: '/Users/ben/x' } })
    await settle()
    const e = audits.find((a) => a.kind === 'policy-denied')
    expect(e).toMatchObject({ ch: 'remote:confirmAction', cls: 'X' })
    expect(JSON.stringify(audits)).not.toContain('/Users/ben')
    expect(JSON.stringify(audits)).not.toContain('secreto')
  })

  it('pin-set/pin-verify antes de autenticar son una violación', async () => {
    const { id } = devices.add('Pixel')
    const ch = new Chan()
    const s = new PeerSession({
      channel: ch,
      kind: 'resume',
      deviceId: id,
      code: '1',
      devices,
      backend,
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined,
      access: access()
    })
    s.start()
    for (let i = 0; i < 3; i++) ch.recv({ t: 'pin-verify', pin: '123456' })
    await settle()
    expect(ch.has((f) => f.t === 'bye' && f.reason === 'violations')).toBe(true)
  })
})
