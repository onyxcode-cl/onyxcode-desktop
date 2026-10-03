import { describe, expect, it } from 'vitest'
import { PIN_PARAMS, hashPin, isValidPin, parsePinRecord, verifyPinHash } from './pin'

const FAST = { N: 16, r: 8, p: 1 }

describe('PIN (hash con sal)', () => {
  it('usa scrypt con coste fuerte por defecto', () => {
    expect(PIN_PARAMS.N).toBeGreaterThanOrEqual(32768)
  })

  it('verifica el PIN correcto y rechaza los demás; no guarda el PIN', async () => {
    const rec = await hashPin('123456', FAST)
    expect(await verifyPinHash('123456', rec)).toBe(true)
    expect(await verifyPinHash('123457', rec)).toBe(false)
    expect(JSON.stringify(rec)).not.toContain('123456')
    expect(rec.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('la sal es distinta en cada alta (mismo PIN, hash distinto)', async () => {
    const a = await hashPin('000000', FAST)
    const b = await hashPin('000000', FAST)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('con el coste por defecto funciona (maxmem suficiente)', async () => {
    const rec = await hashPin('654321')
    expect(await verifyPinHash('654321', rec)).toBe(true)
    expect(await verifyPinHash('654320', rec)).toBe(false)
  })

  it('solo admite 6 dígitos', async () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '', '１２３４５６']) {
      expect(isValidPin(bad)).toBe(false)
      await expect(hashPin(bad, FAST)).rejects.toThrow()
    }
    const rec = await hashPin('111111', FAST)
    expect(await verifyPinHash('11111', rec)).toBe(false)
  })

  it('un registro dañado se descarta', () => {
    expect(parsePinRecord({ salt: 'x', hash: 'y', N: 16, r: 8, p: 1 })).toBeNull()
    expect(parsePinRecord(null)).toBeNull()
    expect(parsePinRecord({ salt: 'a'.repeat(32), hash: 'b'.repeat(64), N: 15, r: 8, p: 1 })).toBeNull()
    expect(parsePinRecord({ salt: 'a'.repeat(32), hash: 'b'.repeat(64), N: 16, r: 8, p: 1 })).not.toBeNull()
  })
})
