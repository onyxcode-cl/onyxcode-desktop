import { describe, expect, it } from 'vitest'
import { PairingManager } from './pairing'
import { RateLimiter } from './rate-limit'
import { isPrivateIPv4, pickLanIp } from './lan-ip'
import { LIMITS } from '@shared/remote/protocol'

describe('PairingManager (secreto de un solo uso)', () => {
  it('acepta el secreto una vez y lo consume', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(p.active).toBe(true)
    expect(p.consume(secret)).toBe(true)
    expect(p.consume(secret)).toBe(false)
    expect(p.active).toBe(false)
  })

  it('un intento fallido también lo consume (no se puede adivinar)', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(p.consume('x'.repeat(43))).toBe(false)
    expect(p.consume(secret)).toBe(false)
  })

  it('caduca a los 120 s', () => {
    let now = 1000
    const p = new PairingManager(() => now)
    const { secret, expiresAt } = p.create()
    expect(expiresAt).toBe(1000 + LIMITS.pairingTtlMs)
    now += LIMITS.pairingTtlMs + 1
    expect(p.active).toBe(false)
    expect(p.consume(secret)).toBe(false)
  })

  it('uno nuevo invalida el anterior; revoke lo anula', () => {
    const p = new PairingManager()
    const a = p.create().secret
    const b = p.create().secret
    expect(p.consume(a)).toBe(false)
    const c = p.create().secret
    p.revoke()
    expect(p.consume(c)).toBe(false)
    expect(b).not.toBe(c)
  })

  it('el estado no guarda el secreto en claro', () => {
    const p = new PairingManager()
    const { secret } = p.create()
    expect(JSON.stringify(Object.values(p))).not.toContain(secret)
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
