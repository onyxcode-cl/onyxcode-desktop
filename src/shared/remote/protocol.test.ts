import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './code'
import { LIMITS, parseClientFrame, parseHostFrame, parseSignalClientFrame, parseSignalHostFrame, sanitizeDeviceName } from './protocol'

const RLO = String.fromCharCode(0x202e)
const SECRET = 'A'.repeat(43)
const DEV = 'a'.repeat(32)
const req = (m: string, p: unknown, id = 1): string => JSON.stringify({ t: 'req', id, m, p })

describe('protocolo remoto: tramas del celular', () => {
  it('acepta la lista blanca exacta', () => {
    expect(parseClientFrame(req('sessions.list', {})).ok).toBe(true)
    expect(parseClientFrame(req('session.messages', { sessionId: 'ses_1', limit: 50 })).ok).toBe(true)
    expect(parseClientFrame(req('session.prompt', { sessionId: 'ses_1', text: 'hola' })).ok).toBe(true)
    expect(parseClientFrame(req('session.abort', { sessionId: 'ses_1' })).ok).toBe(true)
    expect(parseClientFrame(req('permission.reply', { requestId: 'per_1', reply: 'once' })).ok).toBe(true)
    expect(parseClientFrame(req('permission.reply', { requestId: 'per_1', reply: 'reject' })).ok).toBe(true)
  })

  it('rechaza «always», métodos fuera de lista y claves extra', () => {
    expect(parseClientFrame(req('permission.reply', { requestId: 'per_1', reply: 'always' })).ok).toBe(false)
    expect(parseClientFrame(req('session.delete', { sessionId: 'ses_1' })).ok).toBe(false)
    expect(parseClientFrame(req('session.abort', { sessionId: 'ses_1', extra: 1 })).ok).toBe(false)
    expect(parseClientFrame(JSON.stringify({ t: 'req', id: 1, m: 'sessions.list', p: {}, x: 1 })).ok).toBe(false)
  })

  it('aplica los límites de limit, texto e ids', () => {
    expect(parseClientFrame(req('session.messages', { sessionId: 'ses_1', limit: 51 })).ok).toBe(false)
    expect(parseClientFrame(req('session.messages', { sessionId: 'ses_1', limit: 0 })).ok).toBe(false)
    expect(parseClientFrame(req('session.messages', { sessionId: '../x', limit: 5 })).ok).toBe(false)
    expect(parseClientFrame(req('session.prompt', { sessionId: 'ses_1', text: 'x'.repeat(LIMITS.maxPromptChars) })).ok).toBe(true)
    expect(parseClientFrame(req('session.prompt', { sessionId: 'ses_1', text: 'x'.repeat(LIMITS.maxPromptChars + 1) })).ok).toBe(false)
    expect(parseClientFrame(req('session.prompt', { sessionId: 'ses_1', text: '   ' })).ok).toBe(false)
    expect(parseClientFrame(req('sessions.list', {}, 0)).ok).toBe(false)
  })

  it('rechaza tramas gigantes, no JSON y no objeto', () => {
    expect(parseClientFrame('x'.repeat(LIMITS.maxFrameBytes + 1)).ok).toBe(false)
    expect(parseClientFrame('{no').ok).toBe(false)
    expect(parseClientFrame('[1]').ok).toBe(false)
    expect(parseClientFrame(new Uint8Array(3)).ok).toBe(false)
  })

  it('auth (v1/v2) ya no existe: trama desconocida', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'auth', deviceId: DEV, secret: SECRET }))).toEqual({ ok: false, reason: 'unknown-type' })
  })

  describe('handshake v3', () => {
    const hs1 = { t: 'hs1', v: 3, mode: 'resume', id: DEV, nc: SECRET }
    const hs1p = { t: 'hs1', v: 3, mode: 'pair', id: SECRET, nc: SECRET, cm: SECRET }
    const ok = (o: unknown): boolean => parseClientFrame(JSON.stringify(o)).ok
    it('hs1 válida en los dos modos', () => {
      expect(ok(hs1)).toBe(true)
      expect(ok(hs1p)).toBe(true)
    })
    it('hs1: claves de más, cm en resume, falta cm en pair, longitudes erróneas', () => {
      expect(ok({ ...hs1, extra: 1 })).toBe(false)
      expect(ok({ ...hs1, cm: SECRET })).toBe(false)
      expect(ok({ ...hs1p, cm: undefined })).toBe(false)
      expect(ok({ ...hs1p, cm: 'corto' })).toBe(false)
      expect(ok({ ...hs1, id: 'zz' })).toBe(false)
      expect(ok({ ...hs1, id: SECRET })).toBe(false) // resume exige un deviceId, no un qid
      expect(ok({ ...hs1p, id: DEV })).toBe(false) // pair exige un qid
      expect(ok({ ...hs1, nc: 'A'.repeat(42) })).toBe(false)
      expect(ok({ ...hs1, v: 'tres' })).toBe(false)
      expect(ok({ ...hs1, mode: 'otro' })).toBe(false)
    })
    it('hs3 válida; rp opcional de 22 caracteres; lo demás se rechaza', () => {
      expect(ok({ t: 'hs3', mac: SECRET })).toBe(true)
      expect(ok({ t: 'hs3', mac: SECRET, rp: 'A'.repeat(22) })).toBe(true)
      expect(ok({ t: 'hs3', mac: SECRET, rp: SECRET })).toBe(false)
      expect(ok({ t: 'hs3', mac: 'x' })).toBe(false)
      expect(ok({ t: 'hs3', mac: SECRET, extra: 1 })).toBe(false)
    })
  })
})

describe('protocolo remoto: señalización', () => {
  it('hello pair y resume', () => {
    const pair = parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 3, mode: 'pair', qid: SECRET, deviceName: ' iPhone\n de Ana ' }))
    expect(pair.ok && pair.value.t === 'hello' && pair.value.mode === 'pair' && pair.value.deviceName).toBe('iPhone de Ana')
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 3, mode: 'resume', deviceId: DEV })).ok).toBe(true)
    // ningún secreto viaja por la señalización: ni en una reconexión ni en la vinculación (solo el `qid`)
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 3, mode: 'resume', deviceId: DEV, secret: SECRET })).ok).toBe(false)
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 3, mode: 'pair', secret: SECRET, deviceName: 'a' })).ok).toBe(false)
    expect(
      parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 3, mode: 'pair', qid: SECRET, secret: SECRET, deviceName: 'a' })).ok
    ).toBe(false)
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 3, mode: 'pair', qid: 'x', deviceName: 'a' })).ok).toBe(false)
  })

  it('offer/ice acotados; respuestas del host', () => {
    expect(parseSignalClientFrame(JSON.stringify({ t: 'offer', sdp: 'v=0\r\n' + 'a'.repeat(100) })).ok).toBe(true)
    expect(parseSignalClientFrame(JSON.stringify({ t: 'offer', sdp: 'v'.repeat(LIMITS.maxSdpChars + 1) })).ok).toBe(false)
    expect(parseSignalHostFrame(JSON.stringify({ t: 'error', code: 'invalid' })).ok).toBe(true)
    expect(parseSignalHostFrame(JSON.stringify({ t: 'error', code: 'otro' })).ok).toBe(false)
  })

  it('sanitiza el nombre del dispositivo', () => {
    expect(sanitizeDeviceName(`a${RLO}b\u0000c`.repeat(30)).length).toBeLessThanOrEqual(LIMITS.maxDeviceNameChars)
    expect(sanitizeDeviceName(RLO)).toBe('')
  })
})

describe('protocolo remoto: tramas del escritorio', () => {
  it('valida respuesta de sesiones y eventos', () => {
    const session = { id: 'ses_1', title: 'Hola', kind: 'chat', updatedAt: 1, status: 'idle' }
    const res = { t: 'res', id: 1, ok: true, m: 'sessions.list', result: { sessions: [session], permissions: [] } }
    expect(parseHostFrame(JSON.stringify(res)).ok).toBe(true)
    const evt = {
      t: 'evt',
      ev: {
        e: 'message.updated',
        message: { id: 'msg_1', sessionId: 'ses_1', role: 'assistant', createdAt: 1, parts: [{ type: 'text', text: 'x' }] }
      }
    }
    expect(parseHostFrame(JSON.stringify(evt)).ok).toBe(true)
    expect(parseHostFrame(JSON.stringify({ ...evt, ev: { e: 'otro' } })).ok).toBe(false)
    expect(parseHostFrame(JSON.stringify({ t: 'res', id: 1, ok: false, error: { code: 'forbidden' } })).ok).toBe(true)
    expect(parseHostFrame(JSON.stringify({ t: 'paired', deviceId: DEV, deviceSecret: SECRET })).ok).toBe(true)
  })

  describe('handshake v3', () => {
    const ok = (o: unknown): boolean => parseHostFrame(JSON.stringify(o)).ok
    it('hs2 con o sin rm', () => {
      expect(ok({ t: 'hs2', ns: SECRET })).toBe(true)
      expect(ok({ t: 'hs2', ns: SECRET, rm: 'A'.repeat(22) })).toBe(true)
      expect(ok({ t: 'hs2', ns: SECRET, rm: SECRET })).toBe(false)
      expect(ok({ t: 'hs2', ns: 'x' })).toBe(false)
      expect(ok({ t: 'hs2', ns: SECRET, extra: 1 })).toBe(false)
    })
    it('authed y pair-pending sin proof se rechazan; con proof valen', () => {
      expect(ok({ t: 'authed' })).toBe(false)
      expect(ok({ t: 'authed', expiresAt: 5 })).toBe(false)
      expect(ok({ t: 'authed', proof: SECRET })).toBe(true)
      expect(ok({ t: 'authed', proof: SECRET, expiresAt: 5, expiring: true })).toBe(true)
      expect(ok({ t: 'authed', proof: 'corta' })).toBe(false)
      expect(ok({ t: 'pair-pending' })).toBe(false)
      expect(ok({ t: 'pair-pending', proof: SECRET })).toBe(true)
    })
    it('auth-failed: sin prueba a secas; expired exige prueba', () => {
      expect(ok({ t: 'auth-failed' })).toBe(true)
      expect(ok({ t: 'auth-failed', proof: SECRET })).toBe(false)
      expect(ok({ t: 'auth-failed', why: 'expired' })).toBe(false)
      expect(ok({ t: 'auth-failed', why: 'expired', proof: SECRET })).toBe(true)
      expect(ok({ t: 'auth-failed', why: 'otra', proof: SECRET })).toBe(false)
    })
  })
})

describe('codificación', () => {
  it('base64url ida y vuelta', () => {
    for (const n of [0, 1, 2, 3, 31, 32]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    }
    expect(toBase64Url(new Uint8Array(32)).length).toBe(43)
  })
})

describe('parseHostFrame: caducidad del vínculo', () => {
  const ok = (o: unknown): unknown => {
    const r = parseHostFrame(JSON.stringify(o))
    return r.ok ? r.value : r.reason
  }
  it('authed admite expiresAt y expiring; auth-failed admite why=expired', () => {
    expect(ok({ t: 'authed', proof: SECRET })).toEqual({ t: 'authed', proof: SECRET })
    expect(ok({ t: 'authed', proof: SECRET, expiresAt: 123, expiring: true })).toEqual({
      t: 'authed',
      proof: SECRET,
      expiresAt: 123,
      expiring: true
    })
    expect(ok({ t: 'auth-failed' })).toEqual({ t: 'auth-failed' })
    expect(ok({ t: 'auth-failed', why: 'expired', proof: SECRET })).toEqual({ t: 'auth-failed', why: 'expired', proof: SECRET })
  })
  it('rechaza tipos y claves de más', () => {
    expect(ok({ t: 'authed', proof: SECRET, expiresAt: 'x' })).toBe('bad-expires')
    expect(ok({ t: 'authed', proof: SECRET, expiresAt: -1 })).toBe('bad-expires')
    expect(ok({ t: 'authed', proof: SECRET, expiring: 1 })).toBe('bad-expiring')
    expect(ok({ t: 'authed', proof: SECRET, otra: 1 })).toBe('extra-keys')
    expect(ok({ t: 'auth-failed', why: 'x', proof: SECRET })).toBe('bad-why')
    expect(ok({ t: 'auth-failed', secret: 'x' })).toBe('extra-keys')
  })
})
