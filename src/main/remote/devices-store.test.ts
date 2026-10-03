import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITS } from '@shared/remote/protocol'
import { DevicesLimitError, DevicesStore, type SafeStorageLike } from './devices-store'

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
