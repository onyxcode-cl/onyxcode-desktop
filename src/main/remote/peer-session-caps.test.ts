import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase64Url } from '@shared/remote/code'
import { pairId, pairKey } from '@shared/remote/handshake'
import type { HostFrame, RemoteCap } from '@shared/remote/protocol'
import { DevicesStore } from './devices-store'
import { PeerSession } from './peer-session'
import { TEST_FPS, pairAs, resumeAs } from './test-handshake'
import type { RtcChannel } from './rtc'

class Ch implements RtcChannel {
  sent: HostFrame[] = []
  private msg: ((raw: unknown) => void) | null = null
  send(text: string): void {
    this.sent.push(JSON.parse(text) as HostFrame)
  }
  close(): void {}
  isOpen(): boolean {
    return true
  }
  onOpen(cb: () => void): void {
    cb()
  }
  onMessage(cb: (raw: unknown) => void): void {
    this.msg = cb
  }
  onClose(): void {}
  recv(raw: unknown): void {
    this.msg?.(typeof raw === 'string' ? raw : JSON.stringify(raw))
  }
}

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString()
}
const backend = {
  listSessions: async () => ({ sessions: [], permissions: [] }),
  messages: async () => ({ sessionId: 's', messages: [], hasMore: false }),
  prompt: async () => undefined,
  abort: async () => undefined,
  replyPermission: async () => undefined
}
const ROOM = 'R'.repeat(43)
const Q = toBase64Url(new Uint8Array(32).fill(5))

let dir: string
let devices: DevicesStore
beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'peer-caps-'))
  devices = new DevicesStore(join(dir, 'remote.bin'), safe)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})
const flush = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(10))
const find = (ch: Ch, t: string): HostFrame | undefined => ch.sent.find((f) => f.t === t)

describe('PeerSession: caps y room (protocolo v4)', () => {
  const caps = (): RemoteCap[] => ['entry']

  function resume(v: number | undefined) {
    const ch = new Ch()
    const { id, secret } = devices.add('Pixel')
    const s = new PeerSession({
      channel: ch,
      kind: 'resume',
      deviceId: id,
      fps: TEST_FPS,
      devices,
      backend,
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined,
      caps
    })
    s.start()
    resumeAs(ch, { deviceId: id, secret, v })
    return ch
  }

  it('un celular v4 recibe caps en authed', async () => {
    const ch = resume(4)
    await flush()
    expect(find(ch, 'authed')).toMatchObject({ t: 'authed', caps: ['entry'] })
  })

  it('un celular v3 recibe el authed de siempre, sin caps', async () => {
    const ch = resume(3)
    await flush()
    const f = find(ch, 'authed')
    expect(f).toBeDefined()
    expect(f).not.toHaveProperty('caps')
  })

  function pair(v: number) {
    const ch = new Ch()
    const s = new PeerSession({
      channel: ch,
      kind: 'pair',
      deviceName: 'Pixel',
      fps: TEST_FPS,
      qid: pairId(Q),
      pairKey: pairKey(Q),
      devices,
      backend,
      confirmPair: async () => true,
      onAuthed: () => true,
      onEnd: () => undefined,
      caps,
      room: () => ROOM
    })
    s.start()
    pairAs(ch, { q: Q, v })
    return ch
  }

  it('vinculación v4: pair-pending con caps y paired con room', async () => {
    const ch = pair(4)
    await flush()
    expect(find(ch, 'pair-pending')).toMatchObject({ caps: ['entry'] })
    expect(find(ch, 'paired')).toMatchObject({ t: 'paired', room: ROOM })
  })

  it('vinculación v3: sin caps ni room', async () => {
    const ch = pair(3)
    await flush()
    expect(find(ch, 'pair-pending')).not.toHaveProperty('caps')
    expect(find(ch, 'paired')).not.toHaveProperty('room')
  })
})

describe('PeerSession: entry (protocolo v4)', () => {
  const ENTRY = { v: '0.3.0', js: 'assets/a.js', files: [{ p: 'assets/a.js', sri: `sha384-${'A'.repeat(64)}` }] }

  function resume(v: number | undefined, withEntry = true, withCap = true) {
    const ch = new Ch()
    const { id, secret } = devices.add('Pixel')
    const s = new PeerSession({
      channel: ch,
      kind: 'resume',
      deviceId: id,
      fps: TEST_FPS,
      devices,
      backend,
      confirmPair: async () => false,
      onAuthed: () => true,
      onEnd: () => undefined,
      caps: () => (withCap ? ['entry'] : []),
      entry: withEntry ? () => ENTRY : undefined
    })
    s.start()
    resumeAs(ch, { deviceId: id, secret, v })
    return ch
  }

  it('un celular v4 con la capacidad recibe entry una sola vez', async () => {
    const ch = resume(4)
    await flush()
    expect(ch.sent.filter((f) => f.t === 'entry')).toEqual([{ t: 'entry', ...ENTRY }])
  })

  it('un celular v3, sin la capacidad o sin lista no recibe nada', async () => {
    for (const ch of [resume(3), resume(4, true, false), resume(4, false)]) {
      await flush()
      expect(ch.sent.some((f) => f.t === 'entry')).toBe(false)
    }
  })
})
