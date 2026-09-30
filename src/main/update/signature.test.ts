import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodePublicKey, verifyEd25519, verifyWithKeys } from './signature'

const hex = (h: string): Buffer => Buffer.from(h, 'hex')
const b64 = (h: string): string => hex(h).toString('base64')

// Vectores de RFC 8032 §7.1 (Ed25519, clave pública cruda de 32 bytes).
const RFC = [
  {
    pk: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    msg: '',
    sig: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'
  },
  {
    pk: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    msg: '72',
    sig: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'
  }
]

function fresh(): { spki: string; raw: string; privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return { spki: der.toString('base64'), raw: der.subarray(12).toString('base64'), privateKey }
}

describe('Ed25519 del manifiesto', () => {
  it.each(RFC)('vectores RFC 8032 (clave cruda de 32 bytes)', ({ pk, msg, sig }) => {
    expect(verifyEd25519(hex(msg), b64(sig), b64(pk))).toBe(true)
  })

  it('RFC 8032: un byte cambiado o una firma alterada falla', () => {
    const v = RFC[1]
    expect(verifyEd25519(hex('73'), b64(v.sig), b64(v.pk))).toBe(false)
    const bad = hex(v.sig)
    bad[10] ^= 1
    expect(verifyEd25519(hex(v.msg), bad.toString('base64'), b64(v.pk))).toBe(false)
  })

  it('claves generadas: SPKI y cruda verifican; un byte cambiado, firma alterada y otra clave no', () => {
    const a = fresh()
    const other = fresh()
    const bytes = Buffer.from('{"schema":1,"version":"1.2.3"}')
    const sig = sign(null, bytes, a.privateKey).toString('base64')
    expect(verifyEd25519(bytes, sig, a.spki)).toBe(true)
    expect(verifyEd25519(bytes, sig, a.raw)).toBe(true)
    expect(verifyEd25519(Buffer.from('{"schema":1,"version":"1.2.4"}'), sig, a.spki)).toBe(false)
    const tampered = Buffer.from(sig, 'base64')
    tampered[0] ^= 0x80
    expect(verifyEd25519(bytes, tampered.toString('base64'), a.spki)).toBe(false)
    expect(verifyEd25519(bytes, sig, other.spki)).toBe(false)
    expect(verifyEd25519(Buffer.concat([bytes, Buffer.from('\n')]), sig, a.spki)).toBe(false)
  })

  it('entradas basura nunca lanzan', () => {
    const a = fresh()
    const bytes = Buffer.from('x')
    expect(verifyEd25519(bytes, '', a.spki)).toBe(false)
    expect(verifyEd25519(bytes, 'no-base64!!', a.spki)).toBe(false)
    expect(verifyEd25519(bytes, sign(null, bytes, a.privateKey).toString('base64'), '')).toBe(false)
    expect(decodePublicKey('AAAA')).toBeNull()
    expect(decodePublicKey(Buffer.alloc(44).toString('base64'))).toBeNull()
  })

  it('verifyWithKeys devuelve el id de la clave que firmó (rotación)', () => {
    const nueva = fresh()
    const vieja = fresh()
    const bytes = Buffer.from('m')
    const sig = sign(null, bytes, vieja.privateKey).toString('base64')
    const keys = [
      { id: 'nueva', key: nueva.spki },
      { id: 'vieja', key: vieja.spki }
    ]
    expect(verifyWithKeys(bytes, sig, keys)).toBe('vieja')
    expect(verifyWithKeys(bytes, sig, [keys[0]])).toBeNull()
    expect(verifyWithKeys(bytes, sig, [])).toBeNull()
  })
})
