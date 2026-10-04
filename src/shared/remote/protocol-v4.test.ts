import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  parseClientFrame,
  parseHostFrame,
  parseIceServers,
  parseSignalClientFrame,
  parseSignalHostFrame,
  protocolVersionOk
} from './protocol'

const B43 = 'A'.repeat(43)
const DEV = 'a'.repeat(32)
const ICE = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

describe('protocolo v4', () => {
  it('versión actual 4 y mínima 3', () => {
    expect(PROTOCOL_VERSION).toBe(4)
    expect(MIN_PROTOCOL_VERSION).toBe(3)
    expect(protocolVersionOk(3)).toBe(true)
    expect(protocolVersionOk(4)).toBe(true)
    for (const v of [2, 5, 3.5, '4', null, undefined, NaN]) expect(protocolVersionOk(v)).toBe(false)
  })

  it('hs1 acepta b opcional (solo informativo) y rechaza uno malformado', () => {
    const base = { t: 'hs1', v: 4, mode: 'resume', id: DEV, nc: B43 }
    expect(parseClientFrame(JSON.stringify({ ...base, b: 'abc123' }))).toEqual({ ok: true, value: { ...base, b: 'abc123' } })
    expect(parseClientFrame(JSON.stringify(base)).ok).toBe(true)
    for (const b of ['', 'MAYUS', 'x'.repeat(33), 5, 'con espacio']) expect(parseClientFrame(JSON.stringify({ ...base, b })).ok).toBe(false)
  })

  it('authed y pair-pending llevan caps válidas; una desconocida o repetida invalida la trama', () => {
    expect(parseHostFrame(JSON.stringify({ t: 'authed', proof: B43, caps: ['entry', 'push'] }))).toMatchObject({
      ok: true,
      value: { t: 'authed', caps: ['entry', 'push'] }
    })
    expect(parseHostFrame(JSON.stringify({ t: 'authed', proof: B43 }))).toEqual({ ok: true, value: { t: 'authed', proof: B43 } })
    expect(parseHostFrame(JSON.stringify({ t: 'pair-pending', proof: B43, caps: ['entry'] }))).toMatchObject({ ok: true })
    for (const caps of [['raro'], ['entry', 'entry'], 'entry', [1], ['entry', 'push', 'passkey', 'x']])
      expect(parseHostFrame(JSON.stringify({ t: 'authed', proof: B43, caps })).ok).toBe(false)
  })

  it('paired lleva room opcional y la valida', () => {
    const base = { t: 'paired', deviceId: DEV, deviceSecret: B43 }
    expect(parseHostFrame(JSON.stringify({ ...base, room: B43 }))).toMatchObject({ ok: true, value: { room: B43 } })
    expect(parseHostFrame(JSON.stringify(base))).toEqual({ ok: true, value: base })
    expect(parseHostFrame(JSON.stringify({ ...base, room: 'corta' })).ok).toBe(false)
  })

  it('señalización: turn, host-offline y rate se validan en la PWA', () => {
    expect(parseSignalHostFrame(JSON.stringify({ t: 'turn', servers: ICE }))).toEqual({ ok: true, value: { t: 'turn', servers: ICE } })
    expect(parseSignalHostFrame(JSON.stringify({ t: 'turn', servers: [{ urls: ['stun:evil.example:3478'] }] })).ok).toBe(false)
    expect(parseSignalHostFrame(JSON.stringify({ t: 'turn', servers: ICE, x: 1 })).ok).toBe(false)
    for (const code of ['host-offline', 'rate', 'invalid', 'version', 'busy', 'frame'])
      expect(parseSignalHostFrame(JSON.stringify({ t: 'error', code })).ok).toBe(true)
    expect(parseSignalHostFrame(JSON.stringify({ t: 'error', code: 'otro' })).ok).toBe(false)
  })

  it('el hello de señalización sigue llevando un v entero cualquiera (la comprobación de rango es del servidor)', () => {
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 4, mode: 'resume', deviceId: DEV })).ok).toBe(true)
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 99, mode: 'resume', deviceId: DEV })).ok).toBe(true)
  })

  it('parseIceServers: límites', () => {
    expect(parseIceServers(ICE)).toEqual(ICE)
    expect(parseIceServers(Array(4).fill(ICE[0]))).toHaveLength(4)
    expect(parseIceServers(Array(5).fill(ICE[0]))).toBeNull()
    expect(parseIceServers([{ urls: Array(5).fill('stun:stun.cloudflare.com') }])).toBeNull()
    expect(parseIceServers([{ urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }])).not.toBeNull()
    expect(parseIceServers([{ urls: ['turn:turn.cloudflare.com:99999'] }])).toBeNull()
    expect(parseIceServers([{ urls: ['stun:CLOUDFLARE.COM'] }])).not.toBeNull()
    expect(parseIceServers('x')).toBeNull()
    expect(LIMITS.maxSignalFrameBytes).toBeGreaterThan(1000)
  })
})
