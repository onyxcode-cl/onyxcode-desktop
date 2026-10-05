import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '@shared/remote/code'
import { deviceKey } from '@shared/remote/handshake'
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
    // Del hash solo sale la clave derivada (HKDF): coincide con la que calcula el celular desde su secreto.
    expect(Array.from(s.authKey(id)!)).toEqual(Array.from(deviceKey(sha256Hex(secret))))
    expect(Array.from(s.authKey(id)!)).not.toEqual(Array.from(deviceKey(sha256Hex('A'.repeat(43)))))
    expect(s.authKey('0'.repeat(32))).toBeNull()
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
    expect(secret).toBeTruthy()
    expect(s.authKey(id)).toBeNull()
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

  it('por defecto caduca a los 90 días del alta (`expiryState`)', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    const { id } = s.add('Pixel', t.now)
    expect(s.get(id)).toMatchObject({ ttlDays: 90, renewedAt: T0, lastUsedAt: null })
    expect(s.expiresAt(id)).toBe(T0 + 90 * DAY_MS)
    expect(s.expiryState(id, T0 + 90 * DAY_MS - 1)).toBe('ok')
    expect(s.expiryState(id, T0 + 90 * DAY_MS)).toBe('expired')
  })

  it('usar el celular renueva el plazo (touch) y anota lastUsedAt', () => {
    const t = { now: T0 }
    const s = clockStore(join(dir, 'remote.bin'), t)
    const { id } = s.add('Pixel', T0)
    const day80 = T0 + 80 * DAY_MS
    s.touch(id, day80)
    expect(s.get(id)?.lastUsedAt).toBe(day80)
    expect(s.expiryState(id, T0 + 150 * DAY_MS)).toBe('ok')
    expect(s.expiryState(id, day80 + 90 * DAY_MS)).toBe('expired')
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

  it('hallazgo 2: «aprobar comandos» nace apagado; los vínculos anteriores quedan en false sin romper remote.bin', () => {
    const file = join(dir, 'remote.bin')
    const safe = fakeSafe()
    const base = { name: 'x', secretHash: 'c'.repeat(64), createdAt: 1, lastUsedAt: null, ttlDays: 90, renewedAt: T0 }
    // remote.bin de antes: sin el campo; con valores raros (`'yes'`, `1`) tampoco se enciende.
    writeFileSync(
      file,
      safe.encryptString(
        JSON.stringify({
          devices: [
            { ...base, id: '1'.repeat(32) },
            { ...base, id: '2'.repeat(32), canApproveCommands: 'yes' },
            { ...base, id: '4'.repeat(32), canApproveCommands: true }
          ],
          port: 4321
        })
      )
    )
    const s = new DevicesStore(file, safe, undefined, () => T0)
    expect(s.list().map((d) => s.canApproveCommands(d.id))).toEqual([false, false, true])
    expect(s.list()).toHaveLength(3)
    expect(s.getPort()).toBe(4321)
    const raw = JSON.parse(safe.decryptString(readFileSync(file))) as { devices: Array<Record<string, unknown>> }
    expect(raw.devices[0]).not.toHaveProperty('canApproveCommands')
    // Nuevo dispositivo: apagado. Encender, persistir, apagar y limpiar todos.
    expect(s.revoke('2'.repeat(32))).toBe(true)
    const { id } = s.add('Pixel')
    expect(s.canApproveCommands(id)).toBe(false)
    expect(toDeviceInfo(s.get(id)!, false, null, T0).canApproveCommands).toBe(false)
    expect(s.setCanApproveCommands(id, true)).toBe(true)
    expect(new DevicesStore(file, safe, undefined, () => T0).canApproveCommands(id)).toBe(true)
    expect(s.clearAllApprove().sort()).toEqual([id, '4'.repeat(32)].sort())
    expect(new DevicesStore(file, safe, undefined, () => T0).list().some((d) => d.canApproveCommands)).toBe(false)
    expect(s.setCanApproveCommands('f'.repeat(32), true)).toBe(false)
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

describe('DevicesStore: ajustes globales y confianza de 12 h', () => {
  it('confirmEachConnection está apagado por defecto, persiste junto a port y a los dispositivos', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, fakeSafe())
    expect(a.getPrefs()).toEqual({ confirmEachConnection: false })
    a.add('Pixel')
    a.setPort(41234)
    a.setPrefs({ confirmEachConnection: true })
    const b = new DevicesStore(file, fakeSafe())
    expect(b.getPrefs()).toEqual({ confirmEachConnection: true })
    expect(b.getPort()).toBe(41234)
    expect(b.list()).toHaveLength(1)
    // Guardar otra cosa (un dispositivo nuevo) no pierde el ajuste.
    b.add('iPhone')
    expect(new DevicesStore(file, fakeSafe()).getPrefs()).toEqual({ confirmEachConnection: true })
  })

  it('un bloque prefs raro o ausente deja el valor por defecto (nada de `"sí"` → true)', () => {
    const safe = fakeSafe()
    for (const raw of [{ devices: [] }, { devices: [], prefs: 'x' }, { devices: [], prefs: { confirmEachConnection: 'sí' } }]) {
      const file = join(dir, `r${Math.random()}.bin`)
      writeFileSync(file, safe.encryptString(JSON.stringify(raw)))
      expect(new DevicesStore(file, safe).getPrefs()).toEqual({ confirmEachConnection: false })
    }
  })

  it('clearAllTrust borra «Recordar 12 h» de todos y persiste', () => {
    const file = join(dir, 'remote.bin')
    const s = new DevicesStore(file, fakeSafe())
    const a = s.add('A')
    const b = s.add('B')
    s.setTrust(a.id, 123)
    s.setTrust(b.id, 456)
    s.clearAllTrust()
    expect(s.trustedUntil(a.id)).toBeNull()
    expect(s.trustedUntil(b.id)).toBeNull()
    expect(new DevicesStore(file, fakeSafe()).trustedUntil(a.id)).toBeNull()
  })
})

describe('DevicesStore: fuera de casa (modo de conexión, away y hostToken)', () => {
  it('por defecto: «Solo esta red» y sin «Disponible fuera de casa»; persiste junto a prefs y dispositivos', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, fakeSafe())
    expect(a.getCloudPrefs()).toEqual({ connection: 'lan', away: false, travelKeep: 'idle30' })
    a.setPrefs({ confirmEachConnection: true })
    a.setCloudPrefs({ connection: 'cloud' })
    a.setCloudPrefs({ away: true })
    const b = new DevicesStore(file, fakeSafe())
    expect(b.getCloudPrefs()).toMatchObject({ connection: 'cloud', away: true })
    expect(b.getPrefs()).toEqual({ confirmEachConnection: true }) // no se pisan entre sí
    // guardar otra cosa no pierde el modo
    b.setPrefs({ confirmEachConnection: false })
    expect(new DevicesStore(file, fakeSafe()).getCloudPrefs()).toMatchObject({ connection: 'cloud', away: true })
  })

  it('valores raros del archivo se leen como lo más cerrado', () => {
    const safe = fakeSafe()
    for (const cloud of [undefined, 'x', { connection: 'nube', away: 'sí' }, { connection: 'cloud', away: 1 }]) {
      const file = join(dir, `c${Math.random()}.bin`)
      writeFileSync(file, safe.encryptString(JSON.stringify({ devices: [], cloud })))
      const prefs = new DevicesStore(file, safe).getCloudPrefs()
      expect(prefs.away).toBe(false)
      expect(prefs.connection).toBe(
        typeof cloud === 'object' && cloud && (cloud as { connection?: string }).connection === 'cloud' ? 'cloud' : 'lan'
      )
    }
  })

  it('hostToken: se crea una vez, persiste cifrado y es válido (43 car.)', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, fakeSafe())
    const t = a.hostToken()!
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.hostToken()).toBe(t)
    expect(new DevicesStore(file, fakeSafe()).hostToken()).toBe(t)
    expect(readFileSync(file).toString('utf8')).not.toContain(t)
    expect(Buffer.from(readFileSync(file)).reverse().toString('utf8')).toContain(t) // está, pero cifrado en disco
  })

  it('sin cifrado disponible no hay hostToken ni se escribe nada', () => {
    const s = new DevicesStore(join(dir, 'remote.bin'), fakeSafe(false))
    expect(s.hostToken()).toBeNull()
  })

  it('un hostToken guardado con forma rara se descarta y se crea otro', () => {
    const safe = fakeSafe()
    const file = join(dir, 'remote.bin')
    writeFileSync(file, safe.encryptString(JSON.stringify({ devices: [], cloud: { connection: 'cloud', hostToken: 'corto' } })))
    const t = new DevicesStore(file, safe).hostToken()!
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(t).not.toBe('corto')
  })

  it('quitar a todos (revokeAll) y renovar rotan el token; quitar uno solo no', () => {
    const file = join(dir, 'remote.bin')
    const s = new DevicesStore(file, fakeSafe())
    const a = s.add('A')
    s.add('B')
    const t1 = s.hostToken()!
    s.revoke(a.id)
    expect(s.hostToken()).toBe(t1)
    s.revokeAll()
    const t2 = s.hostToken()!
    expect(t2).not.toBe(t1)
    s.rotateHostToken()
    expect(s.hostToken()).not.toBe(t2)
  })

  it('revokeAll sin celulares no rota el token', () => {
    const s = new DevicesStore(join(dir, 'remote.bin'), fakeSafe())
    const t = s.hostToken()
    s.revokeAll()
    expect(s.hostToken()).toBe(t)
  })
})

describe('DevicesStore: vínculos del modo viaje', () => {
  it('`kind: travel` y `expiresAt` se guardan, se releen y salen en la vista; el resto no cambia', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, fakeSafe())
    const n = a.add('Normal')
    const t = a.add('Viaje', 1000, undefined, null, 3, { kind: 'travel', expiresAt: 5000 })
    const b = new DevicesStore(file, fakeSafe())
    expect(b.get(n.id)?.kind).toBeUndefined()
    expect(b.get(t.id)).toMatchObject({ kind: 'travel', expiresAt: 5000 })
    expect(toDeviceInfo(b.get(t.id)!, false, null, 2000).kind).toBe('travel')
    expect('kind' in toDeviceInfo(b.get(n.id)!, false, null, 2000)).toBe(false)
  })

  it('caduca con el túnel (`expiresAt`) aunque su plazo en días sea mayor', () => {
    const s = new DevicesStore(join(dir, 'remote.bin'), fakeSafe())
    const t = s.add('Viaje', 1000, 90, null, 3, { kind: 'travel', expiresAt: 5000 })
    expect(s.expiresAt(t.id)).toBe(5000)
    expect(s.expiryState(t.id, 4999)).toBe('ok')
    expect(s.expiryState(t.id, 5000)).toBe('expired')
    // Sin `expiresAt`, solo cuenta el plazo en días de siempre.
    const n = s.add('Normal', 1000, 30)
    expect(s.expiresAt(n.id)).toBe(1000 + 30 * DAY_MS)
  })

  it('como mucho UN vínculo de viaje a la vez y no agota el tope de dispositivos normales', () => {
    const s = new DevicesStore(join(dir, 'remote.bin'), fakeSafe())
    s.add('Viaje', Date.now(), undefined, null, 3, { kind: 'travel' })
    expect(() => s.add('Viaje 2', Date.now(), undefined, null, 3, { kind: 'travel' })).toThrow(DevicesLimitError)
    s.add('Normal 1')
    s.add('Normal 2')
    expect(s.list()).toHaveLength(3)
  })

  it('revokeTravel borra solo los de viaje, devuelve sus ids y persiste', () => {
    const file = join(dir, 'remote.bin')
    const s = new DevicesStore(file, fakeSafe())
    const n = s.add('Normal')
    const t = s.add('Viaje', 1000, undefined, null, 3, { kind: 'travel' })
    expect(s.revokeTravel()).toEqual([t.id])
    expect(s.list().map((d) => d.id)).toEqual([n.id])
    expect(new DevicesStore(file, fakeSafe()).list().map((d) => d.id)).toEqual([n.id])
    expect(s.revokeTravel()).toEqual([])
  })

  it('revokeTravel no lanza sin cifrado disponible', () => {
    expect(new DevicesStore(join(dir, 'remote.bin'), fakeSafe(false)).revokeTravel()).toEqual([])
  })

  it('el modo `travel` y «Mantener abierto» se guardan; un valor raro cae a lo más cerrado', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, fakeSafe())
    expect(a.getCloudPrefs()).toEqual({ connection: 'lan', away: false, travelKeep: 'idle30' })
    a.setCloudPrefs({ connection: 'travel', travelKeep: 'h12' })
    expect(new DevicesStore(file, fakeSafe()).getCloudPrefs()).toEqual({ connection: 'travel', away: false, travelKeep: 'h12' })
    a.setCloudPrefs({ travelKeep: 'forever' as never })
    expect(a.getCloudPrefs().travelKeep).toBe('h12')
    a.setCloudPrefs({ connection: 'nube-rara' as never })
    expect(a.getCloudPrefs().connection).toBe('lan')
  })

  it('un archivo con valores raros se lee como lo más cerrado', () => {
    const file = join(dir, 'remote.bin')
    const s = new DevicesStore(file, fakeSafe())
    s.add('X')
    const raw = Buffer.from(readFileSync(file)).reverse().toString('utf8')
    const j = JSON.parse(raw) as { cloud?: Record<string, unknown>; devices: Array<Record<string, unknown>> }
    j.cloud = { connection: 'otra', away: 'si', travelKeep: 'h99' }
    j.devices[0].kind = 'otra-cosa'
    j.devices[0].expiresAt = 'mañana'
    writeFileSync(file, Buffer.from(Buffer.from(JSON.stringify(j), 'utf8').reverse()))
    const r = new DevicesStore(file, fakeSafe())
    expect(r.getCloudPrefs()).toEqual({ connection: 'lan', away: false, travelKeep: 'idle30' })
    expect(r.list()[0].kind).toBeUndefined()
    expect(r.list()[0].expiresAt).toBeUndefined()
  })
})
