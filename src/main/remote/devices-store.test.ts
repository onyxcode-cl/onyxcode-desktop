import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS } from '@shared/remote/protocol'
import { AuditLog } from './audit'
import { DAY_MS, DevicesLimitError, DevicesStore, toDeviceInfo, type SafeStorageLike } from './devices-store'

/** Cifrado de prueba: invierte los bytes (no es claro, y distinto de un JSON). */
function fakeSafe(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
    decryptString: (b) => Buffer.from(b).reverse().toString('utf8')
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-dev-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('DevicesStore', () => {
  it('guarda cifrado y solo el hash del secreto', () => {
    const file = join(dir, 'remote.bin')
    const s = new DevicesStore(file, fakeSafe())
    const { id, secret } = s.add('iPhone de Ana')
    const raw = readFileSync(file)
    expect(raw.toString('utf8')).not.toContain('iPhone')
    expect(raw.toString('utf8')).not.toContain(secret)
    expect(Buffer.from(raw).reverse().toString('utf8')).not.toContain(secret)
    expect(s.verify(id, secret)).toBe(true)
    expect(s.verify(id, 'A'.repeat(43))).toBe(false)
    expect(s.verify('0'.repeat(32), secret)).toBe(false)
  })

  it('persiste entre instancias y respeta el máximo de 3', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, fakeSafe())
    for (let i = 0; i < LIMITS.maxDevices; i++) a.add(`d${i}`)
    expect(() => a.add('extra')).toThrow(DevicesLimitError)
    const b = new DevicesStore(file, fakeSafe())
    expect(b.list()).toHaveLength(LIMITS.maxDevices)
  })

  it('revocar quita el dispositivo y su secreto deja de valer', () => {
    const s = new DevicesStore(join(dir, 'remote.bin'), fakeSafe())
    const { id, secret } = s.add('Pixel')
    expect(s.revoke(id)).toBe(true)
    expect(s.verify(id, secret)).toBe(false)
    expect(s.revoke(id)).toBe(false)
  })

  it('sin cifrado disponible no escribe nada ni lista nada', () => {
    const file = join(dir, 'remote.bin')
    const s = new DevicesStore(file, fakeSafe(false))
    expect(s.available).toBe(false)
    expect(() => s.add('x')).toThrow()
    expect(() => readFileSync(file)).toThrow()
  })

  it('un archivo corrupto se descarta sin romper', () => {
    const file = join(dir, 'remote.bin')
    new DevicesStore(file, fakeSafe()).add('a')
    const broken = new DevicesStore(file, { ...fakeSafe(), decryptString: () => 'no es json' })
    expect(broken.list()).toEqual([])
  })
})

describe('DevicesStore: caducidad por dispositivo (reloj falso)', () => {
  const T0 = 1_700_000_000_000
  const clockStore = (file: string, t: { now: number }): DevicesStore => new DevicesStore(file, fakeSafe(), undefined, () => t.now)

  it('por defecto caduca a los 90 días del alta y `check` lo distingue de un secreto malo', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    const { id, secret } = s.add('Pixel', t.now)
    expect(s.get(id)).toMatchObject({ ttlDays: 90, renewedAt: T0, lastUsedAt: null })
    expect(s.expiresAt(id)).toBe(T0 + 90 * DAY_MS)
    expect(s.check(id, secret, T0 + 90 * DAY_MS - 1)).toBe('ok')
    expect(s.check(id, secret, T0 + 90 * DAY_MS)).toBe('expired')
    // sin el secreto correcto no se revela si caducó
    expect(s.check(id, 'A'.repeat(43), T0 + 91 * DAY_MS)).toBe('bad')
  })

  it('usar el celular renueva el plazo (touch) y anota lastUsedAt', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    const { id, secret } = s.add('Pixel', T0)
    const day80 = T0 + 80 * DAY_MS
    s.touch(id, day80)
    expect(s.get(id)?.lastUsedAt).toBe(day80)
    expect(s.check(id, secret, T0 + 150 * DAY_MS)).toBe('ok')
    expect(s.check(id, secret, day80 + 90 * DAY_MS)).toBe('expired')
  })

  it('30/90/365 o nunca; un valor no permitido se rechaza; cambiar el plazo renueva desde ahora', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    const { id } = s.add('Pixel', T0)
    expect(s.setTtl(id, 30, T0 + 10 * DAY_MS)).toBe(true)
    expect(s.expiresAt(id)).toBe(T0 + 40 * DAY_MS)
    expect(s.setTtl(id, 7 as never)).toBe(false)
    expect(s.setTtl(id, null, T0)).toBe(true)
    expect(s.expiresAt(id)).toBeNull()
    expect(s.isExpired(id, T0 + 10_000 * DAY_MS)).toBe(false)
    expect(s.setTtl('0'.repeat(32), 30)).toBe(false)
  })

  it('el tope de la política recorta el plazo, también el de «nunca»', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    const a = s.add('A', T0, 365)
    const b = s.add('B', T0, null)
    expect(s.expiresAt(a.id, 30)).toBe(T0 + 30 * DAY_MS)
    expect(s.expiresAt(b.id, 30)).toBe(T0 + 30 * DAY_MS)
    expect(s.expiresAt(b.id)).toBeNull()
    expect(toDeviceInfo(s.get(a.id)!, false, null, T0 + 31 * DAY_MS, 30)).toMatchObject({ expired: true, ttlDays: 365 })
  })

  it('los caducados no ocupan hueco al vincular (pruneExpired)', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    for (let i = 0; i < LIMITS.maxDevices; i++) s.add(`d${i}`, T0, 30)
    expect(() => s.add('x', T0 + DAY_MS)).toThrow(DevicesLimitError)
    expect(s.add('nuevo', T0 + 31 * DAY_MS).id).toBeTruthy()
    expect(s.list().map((d) => d.name)).toEqual(['nuevo'])
  })

  it('«revocar todos» vacía la lista y persiste', () => {
    const file = join(dir, 'remote.bin')
    const s = clockStore(file, { now: T0 })
    s.add('a')
    s.add('b')
    expect(s.revokeAll()).toBe(2)
    expect(s.revokeAll()).toBe(0)
    expect(clockStore(file, { now: T0 }).list()).toEqual([])
  })

  it('migra el formato anterior (lastSeenAt, sin ttlDays): 90 días desde ahora, y lo reescribe', () => {
    const file = join(dir, 'remote.bin')
    const safe = fakeSafe()
    const legacy = {
      devices: [{ id: 'a'.repeat(32), name: 'Viejo', secretHash: 'b'.repeat(64), createdAt: 5, lastSeenAt: 7 }],
      port: 4321
    }
    writeFileSync(file, safe.encryptString(JSON.stringify(legacy)))
    const t = { now: T0 }
    const s = new DevicesStore(file, safe, undefined, () => t.now)
    expect(s.list()[0]).toMatchObject({ lastUsedAt: 7, ttlDays: 90, renewedAt: T0, createdAt: 5 })
    expect(s.getPort()).toBe(4321)
    // reescrito: otra instancia posterior ve la misma ventana (no se reinicia en cada arranque)
    t.now = T0 + 50 * DAY_MS
    const again = new DevicesStore(file, safe, undefined, () => t.now)
    expect(again.get('a'.repeat(32))?.renewedAt).toBe(T0)
    const raw = JSON.parse(safe.decryptString(readFileSync(file))) as { devices: Array<Record<string, unknown>> }
    expect(raw.devices[0]).toMatchObject({ ttlDays: 90, renewedAt: T0 })
    expect(raw.devices[0]).not.toHaveProperty('lastSeenAt')
  })

  it('valores raros en `ttlDays` caen al valor por defecto; `null` se respeta', () => {
    const file = join(dir, 'remote.bin')
    const safe = fakeSafe()
    const mk = (n: number, ttl: unknown): Record<string, unknown> => ({
      id: String(n).repeat(32),
      name: 'x',
      secretHash: 'c'.repeat(64),
      createdAt: 1,
      lastUsedAt: null,
      ttlDays: ttl,
      renewedAt: T0
    })
    writeFileSync(file, safe.encryptString(JSON.stringify({ devices: [mk(1, 7), mk(2, null), mk(3, 365)] })))
    const s = new DevicesStore(file, safe, undefined, () => T0)
    expect(s.list().map((d) => d.ttlDays)).toEqual([90, null, 365])
  })

  it('el secreto no aparece en claro: ni en disco, ni en el estado, ni en la auditoría', () => {
    const file = join(dir, 'remote.bin')
    const s = clockStore(file, { now: T0 })
    const { id, secret } = s.add('iPhone', T0)
    s.touch(id, T0 + 1)
    const audit = new AuditLog(join(dir, 'audit.jsonl'))
    audit.append({ kind: 'expired', device: 'abcdef12', name: 'iPhone' })
    audit.append({ kind: 'revoked-all', n: 1 })
    const info = JSON.stringify(toDeviceInfo(s.get(id)!, false, null, T0))
    const everything = [
      info,
      readFileSync(file).toString('utf8'),
      readFileSync(join(dir, 'audit.jsonl'), 'utf8'),
      JSON.stringify(s.list())
    ].join('\n')
    expect(everything).not.toContain(secret)
    // el registro guarda solo el hash (64 hex), nunca el secreto
    expect(s.get(id)?.secretHash).toMatch(/^[0-9a-f]{64}$/)
    expect(s.get(id)?.secretHash).not.toBe(secret)
    expect(info).not.toContain(s.get(id)!.secretHash)
  })
})
