import { describe, expect, it } from 'vitest'
import { pairId, pairKey } from '@shared/remote/handshake'
import { PairingManager } from './pairing'
import { RateLimiter } from './rate-limit'
import { isPrivateIPv4, pickLanIp } from './lan-ip'
import { LIMITS } from '@shared/remote/protocol'

describe('PairingManager (QR de un solo uso, v3)', () => {
  it('create devuelve q; el qid correcto se reconoce SIN consumir y solo consume() lo gasta', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(p.active).toBe(true)
    expect(p.match(pairId(secret))).toBe(true)
    expect(p.match(pairId(secret))).toBe(true) // no se consumió
    expect(p.active).toBe(true)
    expect(p.reserve(pairId(secret))).not.toBeNull()
    expect(p.consume()).toBe(true)
    expect(p.active).toBe(false)
    expect(p.match(pairId(secret))).toBe(false)
  })

  it('QR falso: un qid incorrecto no consume (el qid bueno sigue valiendo) y el QR sigue activo', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(p.match('x'.repeat(43))).toBe(false)
    expect(p.active).toBe(true)
    expect(p.match(pairId(secret))).toBe(true)
  })

  it('5 qid incorrectos anulan el QR y avisan', () => {
    let exhausted = 0
    const p = new PairingManager(Date.now, () => void exhausted++)
    const { secret } = p.create()
    for (let i = 0; i < LIMITS.pairMaxFails - 1; i++) expect(p.match('x'.repeat(43))).toBe(false)
    expect(p.active).toBe(true)
    expect(exhausted).toBe(0)
    expect(p.match('x'.repeat(43))).toBe(false)
    expect(p.active).toBe(false)
    expect(exhausted).toBe(1)
    expect(p.match(pairId(secret))).toBe(false)
  })

  it('qid correcto con hs3 malo: release(true) suma un fallo y el QR sigue vigente hasta el 5.º', () => {
    let exhausted = 0
    const p = new PairingManager(Date.now, () => void exhausted++)
    const { secret } = p.create()
    for (let i = 0; i < LIMITS.pairMaxFails - 1; i++) {
      expect(p.reserve(pairId(secret))).not.toBeNull()
      expect(p.reserved).toBe(true)
      p.release(true)
      expect(p.reserved).toBe(false)
      expect(p.active).toBe(true)
    }
    expect(p.reserve(pairId(secret))).not.toBeNull()
    p.release(true)
    expect(p.active).toBe(false)
    expect(exhausted).toBe(1)
  })

  it('release(false) (el canal nunca abrió) no cuenta fallo', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    for (let i = 0; i < LIMITS.pairMaxFails * 2; i++) {
      p.reserve(pairId(secret))
      p.release(false)
    }
    expect(p.active).toBe(true)
  })

  it('un único intento en curso: una segunda reserva falla hasta liberar', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(p.reserve(pairId(secret))).not.toBeNull()
    expect(p.reserve(pairId(secret))).toBeNull()
    p.release(false)
    expect(p.reserve(pairId(secret))).not.toBeNull()
  })

  it('éxito: consumido (un segundo match o reserva da null); consume sin reserva no vale', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(p.consume()).toBe(false) // sin intento reservado
    const q = p.create().secret
    expect(p.reserve(pairId(q))).not.toBeNull()
    expect(p.consume()).toBe(true)
    expect(p.match(pairId(q))).toBe(false)
    expect(p.reserve(pairId(q))).toBeNull()
    expect(secret).not.toBe(q)
  })

  it('caduca a los 120 s (match, reserve y consume dan null/false; sin contar fallos)', () => {
    let now = 1000
    let exhausted = 0
    const p = new PairingManager(
      () => now,
      () => void exhausted++
    )
    const { secret, expiresAt } = p.create()
    expect(expiresAt).toBe(1000 + LIMITS.pairingTtlMs)
    expect(p.reserve(pairId(secret))).not.toBeNull()
    now += LIMITS.pairingTtlMs + 1
    expect(p.active).toBe(false)
    expect(p.match(pairId(secret))).toBe(false)
    expect(p.match('x'.repeat(43))).toBe(false)
    expect(p.reserve(pairId(secret))).toBeNull()
    expect(p.consume()).toBe(false)
    expect(exhausted).toBe(0)
  })

  it('uno nuevo invalida el anterior; revoke lo anula', () => {
    const p = new PairingManager()
    const a = p.create().secret
    const b = p.create().secret
    expect(p.match(pairId(a))).toBe(false)
    expect(p.match(pairId(b))).toBe(true)
    p.revoke()
    expect(p.match(pairId(b))).toBe(false)
    expect(a).not.toBe(b)
  })

  it('el estado no guarda q en claro y la clave del canal es la de q', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(JSON.stringify(Object.values(p))).not.toContain(secret)
    expect(p.reserve(pairId(secret))).toEqual(pairKey(secret))
  })
})

describe('RateLimiter', () => {
  it('ráfaga de 20 y luego 10/s', () => {
    let now = 0
    const r = new RateLimiter(() => now)
    for (let i = 0; i < LIMITS.requestBurst; i++) expect(r.allowRequest()).toBe(true)
    expect(r.allowRequest()).toBe(false)
    now += 1000
    let ok = 0
    for (let i = 0; i < 30; i++) if (r.allowRequest()) ok++
    expect(ok).toBe(LIMITS.requestsPerSecond)
  })

  it('6 prompts por minuto', () => {
    let now = 0
    const r = new RateLimiter(() => now)
    for (let i = 0; i < LIMITS.promptsPerMinute; i++) expect(r.allowPrompt()).toBe(true)
    expect(r.allowPrompt()).toBe(false)
    now += 60_001
    expect(r.allowPrompt()).toBe(true)
  })

  it('3 violaciones cortan', () => {
    const r = new RateLimiter()
    expect(r.violation()).toBe(false)
    expect(r.violation()).toBe(false)
    expect(r.violation()).toBe(true)
  })
})

describe('lan-ip', () => {
  it('solo IPv4 privadas', () => {
    expect(isPrivateIPv4('192.168.1.20')).toBe(true)
    expect(isPrivateIPv4('10.0.0.5')).toBe(true)
    expect(isPrivateIPv4('172.20.1.1')).toBe(true)
    expect(isPrivateIPv4('172.32.0.1')).toBe(false)
    expect(isPrivateIPv4('100.64.0.1')).toBe(false)
    expect(isPrivateIPv4('169.254.1.1')).toBe(false)
    expect(isPrivateIPv4('127.0.0.1')).toBe(false)
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
  })

  it('prefiere en0 y descarta túneles y VPN', () => {
    const ifaces = {
      utun3: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
      en5: [{ address: '192.168.50.4', family: 'IPv4', internal: false }],
      en0: [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '192.168.1.20', family: 'IPv4', internal: false }
      ],
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
    }
    expect(pickLanIp(ifaces)).toBe('192.168.1.20')
    expect(pickLanIp({ utun1: ifaces.utun3, lo0: ifaces.lo0 })).toBeNull()
    expect(pickLanIp({ en0: [{ address: '8.8.4.4', family: 'IPv4', internal: false }] })).toBeNull()
  })
})
