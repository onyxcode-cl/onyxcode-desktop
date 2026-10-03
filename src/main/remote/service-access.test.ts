import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS } from '@shared/remote/protocol'
import type { AuditInput } from './audit'
import { ConfirmHost } from './confirm-host'
import { DevicesStore } from './devices-store'
import { RemoteService } from './service'
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
