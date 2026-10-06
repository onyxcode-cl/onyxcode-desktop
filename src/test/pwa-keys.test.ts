import { describe, expect, it } from 'vitest'
import { importDeviceKey, importPairKey, subtleAuthMac } from '../../pwa/src/keys'
import { sha256Hex, toBase64Url } from '../shared/remote/code'
import {
  AsyncClientHandshake,
  HostHandshake,
  c2h,
  deviceKey,
  h2c,
  nobleAuthMac,
  pairId,
  pairKey,
  type Rand
} from '../shared/remote/handshake'
import { fakeIndexedDB } from './fake-idb'
import { StoreError, idbLinkStore, type CloudLink } from '../../pwa/src/store'

function seeded(seed: number): Rand {
  let x = (seed * 2654435761) >>> 0 || 1
  return (n) => {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      x ^= x << 13
      x >>>= 0
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      out[i] = x & 255
    }
    return out
  }
}

const SECRET = toBase64Url(seeded(7)(32))
const Q = toBase64Url(seeded(9)(32))
const DEVICE = 'a'.repeat(32)
const REAL = { offer: 'ab'.repeat(32), answer: 'cd'.repeat(32) }
const T = [
  'lazunox-auth-v3',
  'resume',
  DEVICE,
  REAL.offer,
  REAL.answer,
  toBase64Url(seeded(1)(32)),
  toBase64Url(seeded(2)(32)),
  '-',
  '-',
  '-'
].join('\n')

describe('claves WebCrypto del celular', () => {
  it('la clave de dispositivo da los mismos bytes que noble (c2h y h2c)', async () => {
    const subtle = subtleAuthMac(await importDeviceKey(SECRET))
    const key = deviceKey(sha256Hex(SECRET))
    expect(await subtle.c2h(T)).toBe(c2h(key, T))
    expect(await subtle.verifyH2c(T, h2c(key, T))).toBe(true)
    expect(await subtle.verifyH2c(T, c2h(key, T))).toBe(false) // etiqueta distinta: no se puede reflejar
    expect(await subtle.verifyH2c(T, 'x'.repeat(43))).toBe(false)
    expect(await subtle.verifyH2c(T, 'corto')).toBe(false)
  })

  it('la clave de vinculación coincide con pairKey(q)', async () => {
    const subtle = subtleAuthMac(await importPairKey(Q))
    expect(await subtle.c2h(T)).toBe(c2h(pairKey(Q), T))
  })

  it('el CryptoKey no es exportable', async () => {
    const k = await importDeviceKey(SECRET)
    expect(k.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow()
    await expect(crypto.subtle.exportKey('jwk', k)).rejects.toThrow()
  })

  it('rechaza secretos con forma rara', async () => {
    await expect(importDeviceKey('corto')).rejects.toThrow()
    await expect(importPairKey('x'.repeat(42))).rejects.toThrow()
  })

  it('handshake completo AsyncClientHandshake(subtle) <-> HostHandshake', async () => {
    const client = new AsyncClientHandshake({
      mode: 'resume',
      deviceId: DEVICE,
      mac: subtleAuthMac(await importDeviceKey(SECRET)),
      fps: REAL,
      rand: seeded(3),
      v: 4,
      b: 'abc123'
    })
    const host = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: deviceKey(sha256Hex(SECRET)), fps: REAL, rand: seeded(4) })
    const hello = client.hello()
    expect(hello.v).toBe(4)
    expect(hello.b).toBe('abc123')
    const hs2 = host.onHello(hello)
    expect(hs2).not.toBeNull()
    const hs3 = await client.onChallenge(hs2!)
    const res = host.onProof(hs3!)
    expect(res.ok).toBe(true)
    expect(await client.verifyProof((res as { proof: string }).proof)).toBe(true)
  })

  it('vinculación con subtle: mismo código de 6 dígitos en los dos lados', async () => {
    const client = new AsyncClientHandshake({
      mode: 'pair',
      pairId: pairId(Q),
      mac: subtleAuthMac(await importPairKey(Q)),
      fps: REAL,
      rand: seeded(5)
    })
    const host = new HostHandshake({ mode: 'pair', qid: pairId(Q), key: pairKey(Q), fps: REAL, rand: seeded(6) })
    const hs2 = host.onHello(client.hello())
    const hs3 = await client.onChallenge(hs2!)
    const res = host.onProof(hs3!)
    expect(res.ok).toBe(true)
    expect(await client.verifyProof((res as { proof: string }).proof)).toBe(true)
    expect(client.sas()).toBe((res as { sas: string }).sas)
  })

  it('una huella distinta (intermediario) no verifica y no hay código', async () => {
    const client = new AsyncClientHandshake({ mode: 'pair', pairId: pairId(Q), mac: nobleAuthMac(pairKey(Q)), fps: REAL, rand: seeded(5) })
    const host = new HostHandshake({
      mode: 'pair',
      qid: pairId(Q),
      key: pairKey(Q),
      fps: { offer: '11'.repeat(32), answer: REAL.answer },
      rand: seeded(6)
    })
    const hs3 = await client.onChallenge(host.onHello(client.hello())!)
    expect(host.onProof(hs3!).ok).toBe(false)
    expect(client.sas()).toBeNull()
  })

  it('sin clave, onChallenge devuelve null y una segunda llamada tampoco responde', async () => {
    const c = new AsyncClientHandshake({ mode: 'resume', deviceId: DEVICE, mac: null, fps: REAL, rand: seeded(1) })
    c.hello()
    expect(await c.onChallenge({ t: 'hs2', ns: toBase64Url(seeded(2)(32)) })).toBeNull()
    const c2 = new AsyncClientHandshake({
      mode: 'resume',
      deviceId: DEVICE,
      mac: nobleAuthMac(deviceKey(sha256Hex(SECRET))),
      fps: REAL,
      rand: seeded(1)
    })
    c2.hello()
    const ch = { t: 'hs2' as const, ns: toBase64Url(seeded(2)(32)) }
    const [a, b] = await Promise.all([c2.onChallenge(ch), c2.onChallenge(ch)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })
})

describe('almacén del vínculo (IndexedDB)', () => {
  const link = async (): Promise<CloudLink> => ({
    deviceId: DEVICE,
    key: await importDeviceKey(SECRET),
    room: 'R'.repeat(43),
    macName: 'Mac de prueba',
    pairedAt: 1
  })

  it('guarda y recupera el CryptoKey sin exponerlo', async () => {
    const store = idbLinkStore(fakeIndexedDB())
    expect(await store.load()).toBeNull()
    await store.save(await link())
    const back = await store.load()
    expect(back?.deviceId).toBe(DEVICE)
    expect(back?.room).toBe('R'.repeat(43))
    expect(back?.key.extractable).toBe(false)
    // la clave recuperada sigue firmando igual
    const mac = subtleAuthMac(back!.key)
    expect(await mac.c2h(T)).toBe(c2h(deviceKey(sha256Hex(SECRET)), T))
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('sin IndexedDB: load = null y save rechaza con StoreError', async () => {
    const store = idbLinkStore(fakeIndexedDB({ failOpen: true }))
    expect(await store.load()).toBeNull()
    await expect(store.save(await link())).rejects.toBeInstanceOf(StoreError)
    await expect(store.clear()).resolves.toBeUndefined()
  })

  it('un registro con forma rara no se guarda ni se devuelve', async () => {
    const f = fakeIndexedDB()
    const store = idbLinkStore(f)
    await expect(store.save({ ...(await link()), room: 'corta' })).rejects.toBeInstanceOf(StoreError)
    f.stores.set('link', new Map([['current', { deviceId: 'x' }]]))
    expect(await store.load()).toBeNull()
  })
})
