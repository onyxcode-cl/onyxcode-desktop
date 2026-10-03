import { describe, expect, it } from 'vitest'
import { fromBase64Url, pairingCode, sdpFingerprint, toBase64Url } from './code'
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

  it('valida auth', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'auth', deviceId: DEV, secret: SECRET })).ok).toBe(true)
    expect(parseClientFrame(JSON.stringify({ t: 'auth', deviceId: 'zz', secret: SECRET })).ok).toBe(false)
    expect(parseClientFrame(JSON.stringify({ t: 'auth', deviceId: DEV, secret: 'corto' })).ok).toBe(false)
  })
})

describe('protocolo remoto: señalización', () => {
  it('hello pair y resume', () => {
    const pair = parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 1, mode: 'pair', secret: SECRET, deviceName: ' iPhone\n de Ana ' }))
    expect(pair.ok && pair.value.t === 'hello' && pair.value.mode === 'pair' && pair.value.deviceName).toBe('iPhone de Ana')
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 1, mode: 'resume', deviceId: DEV })).ok).toBe(true)
    // el secreto no puede viajar en una reconexión
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 1, mode: 'resume', deviceId: DEV, secret: SECRET })).ok).toBe(false)
    expect(parseSignalClientFrame(JSON.stringify({ t: 'hello', v: 1, mode: 'pair', secret: 'x', deviceName: 'a' })).ok).toBe(false)
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
})

describe('código de confirmación', () => {
  const fp = (hex: string): string => `v=0\r\na=fingerprint:sha-256 ${hex.match(/../g)!.join(':').toUpperCase()}\r\n`
  const A = fp('ab'.repeat(32))
  const B = fp('12'.repeat(32))

  it('es simétrico y de 6 dígitos', () => {
    const c = pairingCode(A, B)
    expect(c).toMatch(/^\d{6}$/)
    expect(pairingCode(B, A)).toBe(c)
  })

  it('cambia si cambia una huella (intermediario)', () => {
    expect(pairingCode(A, fp('34'.repeat(32)))).not.toBe(pairingCode(A, B))
  })

  it('sin huella devuelve null', () => {
    expect(pairingCode('v=0', B)).toBeNull()
    expect(sdpFingerprint(A)).toBe('ab'.repeat(32))
  })

  it('base64url ida y vuelta', () => {
    for (const n of [0, 1, 2, 3, 31, 32]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    }
    expect(toBase64Url(new Uint8Array(32)).length).toBe(43)
  })
})
