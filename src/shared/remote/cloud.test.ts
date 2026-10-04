import { describe, expect, it } from 'vitest'
import { toBase64Url } from './code'
import {
  CLOUD_LIMITS,
  codeFromHash,
  decodePairCode,
  encodeCloudFrame,
  encodePairCode,
  formatPairCode,
  isRelayText,
  newHostToken,
  normalizePairCode,
  pairHostToken,
  pairRoom,
  pairSecretFromCode,
  parseCloudToHost,
  parseHostToCloud,
  roomOfToken,
  roomOfTokenAsync
} from './cloud'
import { pairId } from './handshake'

const rand = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)

describe('salas', () => {
  it('la sala es sha256(token) en base64url y WebCrypto da lo mismo que noble', async () => {
    const token = newHostToken(rand)
    expect(token).toHaveLength(43)
    const room = roomOfToken(token)
    expect(room).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await roomOfTokenAsync(token)).toBe(room)
    expect(roomOfToken(token + 'x')).not.toBe(room)
  })

  it('vector fijo: sha256("abc") en base64url', () => {
    expect(roomOfToken('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
  })

  it('la sala de vinculación se deriva de q y no revela q ni qid', () => {
    const q = toBase64Url(rand(32))
    const tok = pairHostToken(q)
    expect(tok).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tok).not.toBe(q)
    expect(pairRoom(q)).toBe(roomOfToken(tok))
    expect(pairRoom(q)).not.toBe(pairId(q))
    expect(tok).not.toBe(pairId(q))
    expect(() => pairHostToken('corto')).toThrow()
  })
})

describe('código de vinculación', () => {
  const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])

  it('ida y vuelta de 10 bytes a 16 caracteres', () => {
    const code = encodePairCode(bytes)
    expect(code).toHaveLength(16)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
    expect(Array.from(decodePairCode(code)!)).toEqual(Array.from(bytes))
    expect(formatPairCode(code)).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
  })

  it('ida y vuelta con muchos valores', () => {
    for (let s = 0; s < 200; s++) {
      const b = Uint8Array.from({ length: 10 }, (_, i) => (s * 31 + i * 17 + (s >> 3) * 5) & 255)
      expect(Array.from(decodePairCode(encodePairCode(b))!)).toEqual(Array.from(b))
    }
  })

  it('tolera minúsculas, guiones, espacios y confusiones O/0 e I/L/1', () => {
    const code = encodePairCode(bytes)
    const good = normalizePairCode(code)
    expect(good).toBe(code)
    expect(normalizePairCode(formatPairCode(code).toLowerCase())).toBe(code)
    expect(normalizePairCode(`  ${formatPairCode(code).replace(/-/g, ' ')}  `)).toBe(code)
    expect(normalizePairCode('0123-4567-89AB-CDEF')).toBe(normalizePairCode('O123-4567-89AB-CDEF'))
    expect(normalizePairCode('1111-1111-1111-1111')).toBe(normalizePairCode('IlI1-1111-llll-1111'))
  })

  it('rechaza largo distinto, la U y caracteres raros', () => {
    expect(normalizePairCode('')).toBeNull()
    expect(normalizePairCode('ABCD-EFGH-JKMN-PQR')).toBeNull()
    expect(normalizePairCode('ABCD-EFGH-JKMN-PQRST')).toBeNull()
    expect(normalizePairCode('UUUU-UUUU-UUUU-UUUU')).toBeNull()
    expect(normalizePairCode('ABCD-EFGH-JKMN-PQR$')).toBeNull()
    expect(decodePairCode('nope')).toBeNull()
    expect(() => encodePairCode(new Uint8Array(9))).toThrow()
  })

  it('el mismo código da siempre el mismo q y códigos distintos dan q distintos', () => {
    const a = pairSecretFromCode(encodePairCode(bytes))!
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pairSecretFromCode(formatPairCode(encodePairCode(bytes)).toLowerCase())).toBe(a)
    const other = Uint8Array.from(bytes)
    other[9] ^= 1
    expect(pairSecretFromCode(encodePairCode(other))).not.toBe(a)
    expect(pairSecretFromCode('x')).toBeNull()
  })

  it('el fragmento #c= se lee y cualquier otro se ignora', () => {
    const code = encodePairCode(bytes)
    expect(codeFromHash(`#c=${formatPairCode(code)}`)).toBe(code)
    expect(codeFromHash(`#c=${code.toLowerCase()}`)).toBe(code)
    expect(codeFromHash(`#x=${code}`)).toBeNull()
    expect(codeFromHash('#c=corto')).toBeNull()
    expect(codeFromHash('')).toBeNull()
  })
})

const ID = 'abc12345'
const TURN = { urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }

describe('tramas Mac <-> servicio', () => {
  it('DO -> host: peer, from, gone y turn válidos', () => {
    expect(parseCloudToHost(JSON.stringify({ t: 'peer', id: ID }))).toEqual({ ok: true, value: { t: 'peer', id: ID } })
    expect(parseCloudToHost(JSON.stringify({ t: 'gone', id: ID })).ok).toBe(true)
    const from = parseCloudToHost(JSON.stringify({ t: 'from', id: ID, d: '{"t":"hello"}' }))
    expect(from).toEqual({ ok: true, value: { t: 'from', id: ID, d: '{"t":"hello"}' } })
    const turn = parseCloudToHost(JSON.stringify({ t: 'turn', id: ID, servers: [TURN] }))
    expect(turn.ok && turn.value).toEqual({ t: 'turn', id: ID, servers: [TURN] })
  })

  it('DO -> host: rechaza lo raro', () => {
    for (const raw of [
      'no json',
      '[]',
      JSON.stringify({ t: 'peer' }),
      JSON.stringify({ t: 'peer', id: 'MAYUS' }),
      JSON.stringify({ t: 'peer', id: ID, extra: 1 }),
      JSON.stringify({ t: 'from', id: ID, d: '' }),
      JSON.stringify({ t: 'from', id: ID, d: 'x'.repeat(CLOUD_LIMITS.maxRelayBytes + 1) }),
      JSON.stringify({ t: 'raro', id: ID }),
      JSON.stringify({ t: 'turn', id: ID, servers: [] }),
      JSON.stringify({ t: 'turn', id: ID, servers: [{ urls: ['turn:evil.example.com:3478'], username: 'u', credential: 'c' }] }),
      JSON.stringify({ t: 'turn', id: ID, servers: [{ urls: ['https://turn.cloudflare.com'] }] }),
      JSON.stringify({ t: 'turn', id: ID, servers: [{ urls: ['turn:turn.cloudflare.com.evil.com:3478'] }] }),
      JSON.stringify({ t: 'turn', id: ID, servers: [{ urls: ['turn:notcloudflare.com:3478'] }] }),
      JSON.stringify({ t: 'turn', id: ID, servers: [{ ...TURN, credential: 'c'.repeat(257) }] }),
      JSON.stringify({ t: 'turn', id: ID, servers: Array(5).fill(TURN) }),
      JSON.stringify({ t: 'turn', id: ID, servers: [{ ...TURN, port: 1 }] }),
      5
    ])
      expect(parseCloudToHost(raw).ok, String(raw).slice(0, 60)).toBe(false)
  })

  it('host -> DO: to, grant y kick', () => {
    expect(parseHostToCloud(JSON.stringify({ t: 'to', id: ID, d: 'x' }))).toEqual({ ok: true, value: { t: 'to', id: ID, d: 'x' } })
    expect(parseHostToCloud(JSON.stringify({ t: 'grant', id: ID }))).toEqual({ ok: true, value: { t: 'grant', id: ID } })
    expect(parseHostToCloud(JSON.stringify({ t: 'kick', id: ID })).ok).toBe(true)
    for (const raw of [
      JSON.stringify({ t: 'grant', id: ID, d: 'x' }),
      JSON.stringify({ t: 'to', id: ID }),
      JSON.stringify({ t: 'peer', id: ID }),
      JSON.stringify({ t: 'to', id: '../x', d: 'x' }),
      'ping'
    ])
      expect(parseHostToCloud(raw).ok, raw).toBe(false)
  })

  it('un texto de exactamente el máximo cabe y uno mayor no; el sobre se mide en bytes UTF-8', () => {
    expect(isRelayText('a'.repeat(CLOUD_LIMITS.maxRelayBytes))).toBe(true)
    expect(isRelayText('a'.repeat(CLOUD_LIMITS.maxRelayBytes + 1))).toBe(false)
    expect(isRelayText('é'.repeat(CLOUD_LIMITS.maxRelayBytes / 2 + 1))).toBe(false)
    expect(isRelayText(5)).toBe(false)
  })

  it('encodeCloudFrame es JSON y se valida de vuelta', () => {
    const f = encodeCloudFrame({ t: 'to', id: ID, d: 'hola' })
    expect(parseHostToCloud(f).ok).toBe(true)
  })
})
