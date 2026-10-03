import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, type HostFrame } from '@shared/remote/protocol'
import { MuxError, type MuxDispatch } from '@shared/remote/mux'
import { AccessGate, guardDispatch, pinDelayMs, type AccessGateOptions, type ConnectionDecision } from './access-gate'
import type { AuditInput } from './audit'
import { DevicesStore } from './devices-store'

const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf8')
}
const FAST = { N: 16, r: 8, p: 1 }

let dir: string
let file: string
let store: DevicesStore
let clock: number
let sent: HostFrame[]
let audits: AuditInput[]
let revoked: string[]
let denied: string[]
let timers: Array<{ at: number; fn: () => void; id: number }>
let nextTimer: number
let confirmResult: ConnectionDecision
let confirmCalls: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-'))
  file = join(dir, 'remote.bin')
  store = new DevicesStore(file, safe, FAST)
  clock = 1_000_000
  sent = []
  audits = []
  revoked = []
  denied = []
  timers = []
  nextTimer = 1
  confirmResult = { approved: true, outcome: 'approved' }
  confirmCalls = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Avanza el reloj falso y dispara los temporizadores vencidos. */
function advance(ms: number): void {
  clock += ms
  for (const t of [...timers].filter((x) => x.at <= clock)) {
    timers = timers.filter((x) => x.id !== t.id)
    t.fn()
  }
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 25))

function gate(deviceId: string, extra: Partial<AccessGateOptions> = {}): AccessGate {
  return new AccessGate({
    deviceId,
    fresh: false,
    devices: store,
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.push({ at: clock + ms, fn, id })
      return id
    },
    clearTimer: (h) => {
      timers = timers.filter((t) => t.id !== h)
    },
    trusted: () => false,
    confirmConnection: async () => {
      confirmCalls++
      return confirmResult
    },
    send: (f) => void sent.push(f),
    onChange: () => undefined,
    onDenied: (r) => void denied.push(r),
    onRevoke: () => void revoked.push('x'),
    audit: (e) => void audits.push(e),
    ...extra
  })
}
const last = (): HostFrame | undefined => sent[sent.length - 1]

async function withPin(pin = '482913'): Promise<string> {
  const { id } = store.add('Pixel')
  await store.setPin(id, pin)
  return id
}

describe('AccessGate: vinculación nueva y PIN', () => {
  it('recién vinculado: pide fijar el PIN, no confirma la conexión y no deja pasar nada antes', async () => {
    const { id } = store.add('iPhone')
    const g = gate(id, { fresh: true })
    g.start()
    expect(last()).toEqual({ t: 'locked', why: 'pin-set' })
    expect(confirmCalls).toBe(0)
    expect(g.canServe(true)).toBe(false)
    expect(g.canServe(false)).toBe(false)
    await g.onPin({ t: 'pin-set', pin: '482913' })
    expect(g.isOpen).toBe(true)
    expect(last()).toEqual({ t: 'unlocked' })
    expect(store.hasPin(id)).toBe(true)
    expect(audits.map((a) => a.kind)).toContain('pin-set')
  })

  it('no se puede cambiar el PIN con pin-set si ya existe', async () => {
    const id = await withPin('111111')
    const g = gate(id, { fresh: true })
    g.start()
    expect(last()).toMatchObject({ t: 'locked', why: 'pin-verify' })
    await g.onPin({ t: 'pin-set', pin: '222222' })
    expect(g.isOpen).toBe(false)
    expect(await store.verifyPin(id, '111111')).toBe(true)
    expect(await store.verifyPin(id, '222222')).toBe(false)
  })

  it('el PIN no se guarda en claro: ni en disco, ni en la auditoría, ni en los logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    const { id } = store.add('iPhone')
    const g = gate(id, { fresh: true })
    g.start()
    await g.onPin({ t: 'pin-set', pin: '735190' })
    const bad = gate(id)
    bad.start()
    await bad.onPin({ t: 'pin-verify', pin: '000000' })
    const raw = readFileSync(file)
    for (const text of [raw.toString('utf8'), Buffer.from(raw).reverse().toString('utf8'), JSON.stringify(audits), JSON.stringify(sent)]) {
      expect(text).not.toContain('735190')
      expect(text).not.toContain('"000000"')
    }
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain('735190')
      s.mockRestore()
    }
  })

  it('verifica el PIN dentro del canal y abre; los fallos se cuentan y se borran al acertar', async () => {
    const id = await withPin()
    const g = gate(id, { fresh: true })
    g.start()
    await g.onPin({ t: 'pin-verify', pin: '000000' })
    expect(g.isOpen).toBe(false)
    expect(last()).toEqual({ t: 'locked', why: 'pin-verify', retryMs: 1000, left: 4 })
    expect(store.pinFails(id)).toBe(1)
    advance(1001)
    await g.onPin({ t: 'pin-verify', pin: '482913' })
    expect(g.isOpen).toBe(true)
    expect(store.pinFails(id)).toBe(0)
  })

  it('retardo creciente: durante la espera no se verifica ni cuenta', async () => {
    expect([1, 2, 3, 4].map(pinDelayMs)).toEqual([1000, 2000, 4000, 8000])
    expect(pinDelayMs(50)).toBe(30_000)
    const id = await withPin()
    const g = gate(id, { fresh: true })
    g.start()
    await g.onPin({ t: 'pin-verify', pin: '000000' }) // fallo 1: espera 1 s
    await g.onPin({ t: 'pin-verify', pin: '482913' }) // dentro de la espera: ni siquiera se prueba el correcto
    expect(g.isOpen).toBe(false)
    expect(last()).toMatchObject({ t: 'locked', retryMs: 1000 })
    expect(store.pinFails(id)).toBe(1)
    advance(1000)
    await g.onPin({ t: 'pin-verify', pin: '111111' }) // fallo 2: espera 2 s
    expect(last()).toMatchObject({ t: 'locked', retryMs: 2000, left: 3 })
  })

  it('5 fallos seguidos revocan el dispositivo (y el contador sobrevive a reconectar)', async () => {
    const id = await withPin()
    let g = gate(id, { fresh: true })
    g.start()
    for (let i = 0; i < 3; i++) {
      await g.onPin({ t: 'pin-verify', pin: '000000' })
      advance(60_000)
    }
    // Reconexión: otra puerta, mismo dispositivo.
    g.dispose()
    g = gate(id, { fresh: true })
    g.start()
    await g.onPin({ t: 'pin-verify', pin: '000000' })
    advance(60_000)
    expect(revoked).toEqual([])
    await g.onPin({ t: 'pin-verify', pin: '000000' })
    expect(revoked).toEqual(['x'])
    expect(audits.filter((a) => a.kind === 'pin-fail').map((a) => a.n)).toEqual([1, 2, 3, 4, 5])
    expect(store.pinFails(id)).toBe(LIMITS.pinMaxFails)
  })

  it('un PIN mal formado nunca abre', async () => {
    const id = await withPin()
    const g = gate(id, { fresh: true })
    g.start()
    await g.onPin({ t: 'pin-verify', pin: '12345' })
    expect(g.isOpen).toBe(false)
  })
})

describe('AccessGate: bloqueo por inactividad (reloj falso)', () => {
  async function open(): Promise<{ g: AccessGate; id: string }> {
    const id = await withPin()
    const g = gate(id, { fresh: true })
    g.start()
    await g.onPin({ t: 'pin-verify', pin: '482913' })
    expect(g.isOpen).toBe(true)
    return { g, id }
  }

  it('a los 5 min sin llamadas se bloquea, avisa y pide el PIN', async () => {
    const { g } = await open()
    advance(LIMITS.inactivityLockMs - 1000)
    expect(g.isOpen).toBe(true)
    advance(1000)
    expect(g.isOpen).toBe(false)
    expect(last()).toEqual({ t: 'locked', why: 'inactive' })
    expect(g.view).toBe('locked')
    expect(audits.some((a) => a.kind === 'locked')).toBe(true)
    await g.onPin({ t: 'pin-verify', pin: '482913' })
    expect(g.isOpen).toBe(true)
  })

  it('la actividad aplaza el bloqueo; sin temporizador también se detecta al llegar una llamada', async () => {
    const { g } = await open()
    advance(4 * 60_000)
    g.touch()
    advance(4 * 60_000)
    expect(g.isOpen).toBe(true)
    clock += 5 * 60_000 // el temporizador no corrió (p. ej. Mac dormido), pero el reloj sí
    expect(g.canServe(false)).toBe(false)
    expect(g.view).toBe('locked')
  })

  it('bloqueado: descarta lo que no es lectura y atiende lecturas solo si hay clasificador', async () => {
    const { g } = await open()
    const inner: MuxDispatch = { call: vi.fn(async () => 'ok'), http: vi.fn(async () => 'ok') }
    const read = (r: object): boolean => 'ch' in r && r.ch === 'app:info'
    const guarded = guardDispatch(inner, g, { isRead: read })!
    const ctx = { id: 1, signal: new AbortController().signal }
    expect(await guarded.call({ ch: 'git:commit', p: {} }, ctx)).toBe('ok')
    advance(LIMITS.inactivityLockMs)
    await expect(guarded.call({ ch: 'git:commit', p: {} }, ctx)).rejects.toBeInstanceOf(MuxError)
    expect(await guarded.call({ ch: 'app:info', p: null }, ctx)).toBe('ok')
    expect(guarded.allowSub?.('main')).toBe(false)
    const strict = guardDispatch(inner, g)!
    await expect(strict.call({ ch: 'app:info', p: null }, ctx)).rejects.toMatchObject({ code: 'forbidden' })
    expect(inner.call).toHaveBeenCalledTimes(2)
  })
})

describe('AccessGate: confirmar cada conexión nueva (D3) y «recordar 12 h»', () => {
  it('reconexión sin confianza: espera confirmación sin acceso; al aprobar sigue al PIN', async () => {
    const id = await withPin()
    let resolve!: (d: ConnectionDecision) => void
    const g = gate(id, { confirmConnection: () => new Promise((r) => (resolve = r)) })
    g.start()
    expect(last()).toEqual({ t: 'locked', why: 'confirm' })
    expect(g.view).toBe('awaiting')
    expect(g.canServe(true)).toBe(false)
    await g.onPin({ t: 'pin-verify', pin: '482913' }) // aún no toca: no abre
    expect(g.isOpen).toBe(false)
    resolve({ approved: true, outcome: 'approved' })
    await settle()
    expect(last()).toMatchObject({ t: 'locked', why: 'pin-verify' })
    await g.onPin({ t: 'pin-verify', pin: '482913' })
    expect(g.isOpen).toBe(true)
  })

  it('rechazada o caducada: se cierra con denied y nunca se abre', async () => {
    const id = await withPin()
    confirmResult = { approved: false, outcome: 'rejected' }
    const g = gate(id)
    g.start()
    await settle()
    expect(denied).toEqual(['rejected'])
    expect(g.isOpen).toBe(false)
    confirmResult = { approved: false, outcome: 'expired' }
    const g2 = gate(id)
    g2.start()
    await settle()
    expect(denied).toEqual(['rejected', 'timeout'])
  })

  it('con confirmación vigente (12 h) no vuelve a preguntar, pero el PIN sigue haciendo falta', async () => {
    const id = await withPin()
    const g = gate(id, { trusted: () => true })
    g.start()
    expect(confirmCalls).toBe(0)
    expect(last()).toMatchObject({ t: 'locked', why: 'pin-verify' })
    expect(g.canServe(true)).toBe(false)
  })

  it('«recordar 12 h» vale 12 h con reloj falso y caduca', () => {
    const { id } = store.add('Pixel')
    expect(store.trustedUntil(id)).toBeNull()
    store.setTrust(id, clock + LIMITS.rememberMs)
    const trusted = (): boolean => (store.trustedUntil(id) ?? 0) > clock
    expect(trusted()).toBe(true)
    clock += LIMITS.rememberMs - 1
    expect(trusted()).toBe(true)
    clock += 2
    expect(trusted()).toBe(false)
    store.setTrust(id, clock + 1000)
    store.setTrust(id, null)
    expect(trusted()).toBe(false)
    // Persiste entre instancias.
    store.setTrust(id, clock + 5000)
    expect(new DevicesStore(file, safe, FAST).trustedUntil(id)).toBe(clock + 5000)
  })

  it('reconexión en caliente (actividad hace <5 min): no vuelve a pedir PIN; en frío sí', async () => {
    const id = await withPin()
    const warm = gate(id, { trusted: () => true, lastActiveAt: clock - 60_000 })
    warm.start()
    expect(warm.isOpen).toBe(true)
    const cold = gate(id, { trusted: () => true, lastActiveAt: clock - 6 * 60_000 })
    cold.start()
    expect(cold.isOpen).toBe(false)
  })

  it('dispositivo ya vinculado sin PIN (versión anterior): confirma y luego debe fijarlo', async () => {
    const { id } = store.add('Viejo')
    const g = gate(id)
    g.start()
    await settle()
    expect(last()).toEqual({ t: 'locked', why: 'pin-set' })
  })
})
