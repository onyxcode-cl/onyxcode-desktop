import { describe, expect, it } from 'vitest'
import { sdpFingerprintStrict, sha256Hex, toBase64Url } from './code'
import {
  ClientHandshake,
  HS_VERSION,
  HostHandshake,
  c2h,
  commit,
  deviceKey,
  h2c,
  pairId,
  pairKey,
  sasCode,
  type Fps,
  type Rand
} from './handshake'

/** Azar determinista (xorshift) para pruebas: la semilla fija el resultado. */
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

const fp = (c: string): string => c.repeat(32)
const FP_P = fp('ab') // celular
const FP_MAC = fp('cd') // Mac
const FP_M1 = fp('11') // intermediario hacia el celular
const FP_M2 = fp('22') // intermediario hacia el Mac
const REAL: Fps = { offer: FP_P, answer: FP_MAC }

const SECRET = toBase64Url(seeded(7)(32))
const DEVICE = 'a'.repeat(32)
const Q = toBase64Url(seeded(9)(32))

function hostKey(secret = SECRET): Uint8Array {
  return deviceKey(sha256Hex(secret))
}

interface RunOpts {
  secret?: string
  hostSecret?: string
  fpsClient?: Fps
  fpsHost?: Fps
  seed?: number
}

/** Un handshake de reconexión completo; devuelve lo que pasó. */
function runResume(o: RunOpts = {}) {
  const seed = o.seed ?? 1
  const client = new ClientHandshake({
    mode: 'resume',
    deviceId: DEVICE,
    secret: o.secret ?? SECRET,
    fps: o.fpsClient ?? REAL,
    rand: seeded(seed)
  })
  const host = new HostHandshake({
    mode: 'resume',
    expectId: DEVICE,
    key: hostKey(o.hostSecret),
    fps: o.fpsHost ?? REAL,
    rand: seeded(seed + 1000)
  })
  const hello = client.hello()
  const hs2 = host.onHello(hello)
  const hs3 = hs2 ? client.onChallenge(hs2) : null
  const res = hs3 ? host.onProof(hs3) : ({ ok: false } as const)
  const verified = res.ok ? client.verifyProof(res.proof) : false
  return { client, host, hello, hs2, hs3, res, verified }
}

function runPair(o: { fpsClient?: Fps; fpsHost?: Fps; seed?: number; qHost?: string } = {}) {
  const seed = o.seed ?? 1
  const client = new ClientHandshake({ mode: 'pair', q: Q, fps: o.fpsClient ?? REAL, rand: seeded(seed) })
  const host = new HostHandshake({
    mode: 'pair',
    qid: pairId(Q),
    key: pairKey(o.qHost ?? Q),
    fps: o.fpsHost ?? REAL,
    rand: seeded(seed + 1000)
  })
  const hello = client.hello()
  const hs2 = host.onHello(hello)
  const hs3 = hs2 ? client.onChallenge(hs2) : null
  const res = hs3 ? host.onProof(hs3) : ({ ok: false } as const)
  const verified = res.ok ? client.verifyProof(res.proof) : false
  return { client, host, hello, hs2, hs3, res, verified }
}

describe('ida y vuelta', () => {
  it('reconexión: el Mac acepta, el celular verifica la prueba y no hay código', () => {
    const r = runResume()
    expect(r.res.ok).toBe(true)
    expect(r.verified).toBe(true)
    expect(r.client.sas()).toBeNull()
    expect(r.hs2).not.toHaveProperty('rm')
    expect(r.hs3).not.toHaveProperty('rp')
  })

  it('vinculación: los dos códigos coinciden y son de 6 dígitos', () => {
    const r = runPair()
    expect(r.res.ok).toBe(true)
    expect(r.verified).toBe(true)
    const sas = r.client.sas()
    expect(sas).toMatch(/^\d{6}$/)
    expect(r.res.ok && r.res.sas).toBe(sas)
  })

  it('secreto o clave distintos: el Mac rechaza', () => {
    expect(runResume({ hostSecret: toBase64Url(seeded(99)(32)) }).res.ok).toBe(false)
    expect(runPair({ qHost: toBase64Url(seeded(98)(32)) }).res.ok).toBe(false)
  })

  it('ningún campo de las tramas contiene el secreto ni su hash', () => {
    const r = runResume()
    const wire = JSON.stringify([r.hello, r.hs2, r.hs3])
    expect(wire).not.toContain(SECRET)
    expect(wire).not.toContain(sha256Hex(SECRET))
    const p = runPair()
    expect(JSON.stringify([p.hello, p.hs2, p.hs3])).not.toContain(Q)
  })
})

describe('intermediario simulado (reconexión)', () => {
  // El celular ve {offer: P, answer: M1}; el Mac ve {offer: M2, answer: MAC}.
  const fpsClient: Fps = { offer: FP_P, answer: FP_M1 }
  const fpsHost: Fps = { offer: FP_M2, answer: FP_MAC }

  it('reenviar hs1/hs2/hs3 sin cambiarlos no sirve', () => {
    const r = runResume({ fpsClient, fpsHost })
    expect(r.hs3).not.toBeNull()
    expect(r.res.ok).toBe(false)
  })

  it('un hs3 propio con una clave aleatoria tampoco', () => {
    const host = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: fpsHost, rand: seeded(5) })
    const fake = new ClientHandshake({
      mode: 'resume',
      deviceId: DEVICE,
      secret: toBase64Url(seeded(77)(32)),
      fps: fpsHost,
      rand: seeded(6)
    })
    const hs2 = host.onHello(fake.hello())!
    expect(host.onProof(fake.onChallenge(hs2)!).ok).toBe(false)
  })

  it('la prueba del Mac reenviada por el intermediario no la verifica el celular', () => {
    // El Mac legítimo ve las huellas del intermediario y responde bien a SU transcript; el celular usa las suyas.
    const client = new ClientHandshake({ mode: 'resume', deviceId: DEVICE, secret: SECRET, fps: fpsClient, rand: seeded(1) })
    const hello = client.hello()
    // El intermediario hace de celular ante el Mac con la clave que NO tiene: usa un transcript copiado del celular.
    const macSide = new ClientHandshake({ mode: 'resume', deviceId: DEVICE, secret: SECRET, fps: fpsHost, rand: seeded(1) })
    macSide.hello()
    const host = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: fpsHost, rand: seeded(1001) })
    const hs2 = host.onHello(hello)!
    const hs3 = macSide.onChallenge(hs2)!
    const res = host.onProof(hs3)
    expect(res.ok).toBe(true) // (solo para disponer de una prueba legítima del Mac sobre las huellas del intermediario)
    client.onChallenge(hs2)
    expect(client.verifyProof((res as { proof: string }).proof)).toBe(false)
  })
})

describe('intermediario que conoce q (vinculación)', () => {
  // Las dos sesiones terminan bien (tiene la clave), pero los códigos casi nunca coinciden.
  it('con 200 semillas, los códigos de las dos mitades casi nunca coinciden', () => {
    let same = 0
    let both = 0
    for (let seed = 1; seed <= 200; seed++) {
      // Mitad celular<->intermediario: el celular ve (P, M1); mitad intermediario<->Mac: el Mac ve (M2, MAC).
      const a = runPair({ fpsClient: { offer: FP_P, answer: FP_M1 }, fpsHost: { offer: FP_P, answer: FP_M1 }, seed })
      const b = runPair({ fpsClient: { offer: FP_M2, answer: FP_MAC }, fpsHost: { offer: FP_M2, answer: FP_MAC }, seed: seed + 5000 })
      if (!a.verified || !b.verified) continue
      both++
      if (a.client.sas() === b.client.sas()) same++
    }
    expect(both).toBe(200)
    expect(same).toBeLessThanOrEqual(2)
  })

  it('onChallenge exige rm antes de revelar rp, y sas() es null hasta verificar la prueba', () => {
    const client = new ClientHandshake({ mode: 'pair', q: Q, fps: REAL, rand: seeded(3) })
    client.hello()
    expect(client.onChallenge({ t: 'hs2', ns: toBase64Url(seeded(4)(32)) })).toBeNull() // falta rm: no se revela rp
    const c2 = new ClientHandshake({ mode: 'pair', q: Q, fps: REAL, rand: seeded(3) })
    c2.hello()
    const hs3 = c2.onChallenge({ t: 'hs2', ns: toBase64Url(seeded(4)(32)), rm: toBase64Url(seeded(5)(16)) })
    expect(hs3?.rp).toBeDefined()
    expect(c2.sas()).toBeNull()
    expect(c2.verifyProof('x'.repeat(43))).toBe(false)
    expect(c2.sas()).toBeNull()
  })

  it('rm sobra en una reconexión: se descarta', () => {
    const client = new ClientHandshake({ mode: 'resume', deviceId: DEVICE, secret: SECRET, fps: REAL, rand: seeded(3) })
    client.hello()
    expect(client.onChallenge({ t: 'hs2', ns: toBase64Url(seeded(4)(32)), rm: toBase64Url(seeded(5)(16)) })).toBeNull()
  })
})

describe('repetición', () => {
  it('un hs3 capturado entregado a un Mac nuevo (otro ns) no vale', () => {
    const first = runResume({ seed: 1 })
    const host2 = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: REAL, rand: seeded(2222) })
    // Mismo hs1 (el atacante repite también el nonce del celular), pero el Mac elige otro `ns`.
    const hs2b = host2.onHello(first.hello)!
    expect(hs2b.ns).not.toBe(first.hs2!.ns)
    expect(host2.onProof(first.hs3!).ok).toBe(false)
  })

  it('una prueba capturada entregada a un celular nuevo (otro nc) no vale', () => {
    const first = runResume({ seed: 1 })
    const proof = (first.res as { proof: string }).proof
    const client2 = new ClientHandshake({ mode: 'resume', deviceId: DEVICE, secret: SECRET, fps: REAL, rand: seeded(500) })
    client2.hello()
    client2.onChallenge({ t: 'hs2', ns: first.hs2!.ns })
    expect(client2.verifyProof(proof)).toBe(false)
  })

  it('un segundo onProof o un segundo verifyProof en la misma instancia no valen', () => {
    const r = runResume()
    expect(r.res.ok).toBe(true)
    expect(r.host.onProof(r.hs3!).ok).toBe(false)
    expect(r.client.verifyProof((r.res as { proof: string }).proof)).toBe(false)
  })

  it('onHello solo una vez', () => {
    const r = runResume()
    expect(r.host.onHello(r.hello)).toBeNull()
  })
})

describe('reflejo', () => {
  it('la prueba h2c devuelta como mac de hs3 no vale', () => {
    const client = new ClientHandshake({ mode: 'resume', deviceId: DEVICE, secret: SECRET, fps: REAL, rand: seeded(1) })
    const host = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: REAL, rand: seeded(1001) })
    const hello = client.hello()
    const hs2 = host.onHello(hello)!
    const hs3 = client.onChallenge(hs2)!
    // Misma entrada que hizo el celular, pero con la etiqueta del otro sentido.
    const t = ['onyxcode-auth-v3', 'resume', DEVICE, REAL.offer, REAL.answer, hello.nc, hs2.ns, '-', '-', '-'].join('\n')
    const key = hostKey()
    expect(hs3.mac).toBe(c2h(key, t))
    expect(h2c(key, t)).not.toBe(c2h(key, t))
    expect(host.onProof({ t: 'hs3', mac: h2c(key, t) }).ok).toBe(false)
  })
})

describe('compromiso (vinculación)', () => {
  it('un rp que no casa con cm falla', () => {
    const client = new ClientHandshake({ mode: 'pair', q: Q, fps: REAL, rand: seeded(1) })
    const host = new HostHandshake({ mode: 'pair', qid: pairId(Q), key: pairKey(Q), fps: REAL, rand: seeded(1001) })
    const hs2 = host.onHello(client.hello())!
    const hs3 = client.onChallenge(hs2)!
    expect(host.onProof({ ...hs3, rp: toBase64Url(seeded(42)(16)) }).ok).toBe(false)
  })

  it('cm obligatorio en pair y prohibido en resume', () => {
    const host = new HostHandshake({ mode: 'pair', qid: pairId(Q), key: pairKey(Q), fps: REAL, rand: seeded(1) })
    const c = new ClientHandshake({ mode: 'pair', q: Q, fps: REAL, rand: seeded(2) })
    const h = c.hello()
    delete h.cm
    expect(host.onHello(h)).toBeNull()
    const hostR = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: REAL, rand: seeded(1) })
    expect(
      hostR.onHello({ t: 'hs1', v: HS_VERSION, mode: 'resume', id: DEVICE, nc: toBase64Url(seeded(3)(32)), cm: commit('x'.repeat(22)) })
    ).toBeNull()
  })
})

describe('clave de relleno', () => {
  it('key null con un hs3 cualquiera: ok false y sin lanzar', () => {
    const host = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: null, fps: REAL, rand: seeded(1) })
    host.onHello({ t: 'hs1', v: HS_VERSION, mode: 'resume', id: DEVICE, nc: toBase64Url(seeded(3)(32)) })
    expect(() => host.onProof({ t: 'hs3', mac: toBase64Url(seeded(4)(32)) })).not.toThrow()
    const host2 = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: null, fps: REAL, rand: seeded(1) })
    // Aun con un hs3 «correcto» para cualquier clave que el atacante invente, no hay clave real.
    const c = new ClientHandshake({ mode: 'resume', deviceId: DEVICE, secret: SECRET, fps: REAL, rand: seeded(2) })
    const hs2 = host2.onHello(c.hello())!
    expect(host2.onProof(c.onChallenge(hs2)!).ok).toBe(false)
  })
})

describe('hs1 inválido', () => {
  const host = (): HostHandshake => new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: REAL, rand: seeded(1) })
  const nc = toBase64Url(seeded(3)(32))
  it('versión, modo e id distintos son violación', () => {
    expect(host().onHello({ t: 'hs1', v: 2, mode: 'resume', id: DEVICE, nc })).toBeNull()
    expect(host().onHello({ t: 'hs1', v: HS_VERSION, mode: 'pair', id: DEVICE, nc })).toBeNull()
    expect(host().onHello({ t: 'hs1', v: HS_VERSION, mode: 'resume', id: 'b'.repeat(32), nc })).toBeNull()
  })
  it('huellas inválidas: no se acepta nada', () => {
    const h = new HostHandshake({ mode: 'resume', expectId: DEVICE, key: hostKey(), fps: { offer: 'zz', answer: FP_MAC }, rand: seeded(1) })
    expect(h.onHello({ t: 'hs1', v: HS_VERSION, mode: 'resume', id: DEVICE, nc })).toBeNull()
  })
})

describe('huellas estrictas', () => {
  const line = (hex: string, alg = 'sha-256'): string => `a=fingerprint:${alg} ${hex.match(/../g)!.join(':').toUpperCase()}`
  const sdp = (...lines: string[]): string =>
    ['v=0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', ...lines, 'a=setup:actpass', ''].join('\r\n')
  const A = 'ab'.repeat(32)
  const B = '12'.repeat(32)

  it('una huella, o varias iguales: vale', () => {
    expect(sdpFingerprintStrict(sdp(line(A)))).toBe(A)
    expect(sdpFingerprintStrict(sdp(line(A), line(A)))).toBe(A)
  })
  it('dos huellas distintas: null', () => {
    expect(sdpFingerprintStrict(sdp(line(A), line(B)))).toBeNull()
    expect(sdpFingerprintStrict(sdp(line(B), line(A)))).toBeNull()
  })
  it('sha-1 o sha-512, sola o mezclada: null', () => {
    expect(sdpFingerprintStrict(sdp(line(A, 'sha-1')))).toBeNull()
    expect(sdpFingerprintStrict(sdp(line(A, 'sha-512')))).toBeNull()
    expect(sdpFingerprintStrict(sdp(line(A), line(A, 'sha-1')))).toBeNull()
    expect(sdpFingerprintStrict(sdp(line(A, 'sha-512'), line(A)))).toBeNull()
  })
  it('ninguna: null', () => {
    expect(sdpFingerprintStrict(sdp())).toBeNull()
    expect(sdpFingerprintStrict('')).toBeNull()
  })
  it('longitud errónea o caracteres raros: null', () => {
    expect(sdpFingerprintStrict(sdp('a=fingerprint:sha-256 AB:CD'))).toBeNull()
    expect(sdpFingerprintStrict(sdp(line(A) + ':00'))).toBeNull()
    expect(sdpFingerprintStrict(sdp(`${line(A).slice(0, -2)}ZZ`))).toBeNull()
  })
  it('normaliza mayúsculas, espacios finales y fin de línea', () => {
    expect(sdpFingerprintStrict(`v=0\n${line(A)}  \nm=x\n`)).toBe(A)
    expect(sdpFingerprintStrict(sdp(line(A).replace('sha-256', 'SHA-256')))).toBe(A)
  })
})

describe('vectores fijos', () => {
  // Detectan cambios accidentales del formato: valen igual para el Mac y para la PWA (ambos importan este módulo).
  const hash = sha256Hex('secreto-de-prueba')
  const q = toBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i))
  it('deviceKey, pairId y c2h', () => {
    expect(Array.from(deviceKey(hash), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(VECTORS.deviceKey)
    expect(pairId(q)).toBe(VECTORS.pairId)
    const t = [
      'onyxcode-auth-v3',
      'resume',
      'a'.repeat(32),
      'ab'.repeat(32),
      'cd'.repeat(32),
      'N'.repeat(43),
      'S'.repeat(43),
      '-',
      '-',
      '-'
    ].join('\n')
    expect(c2h(deviceKey(hash), t)).toBe(VECTORS.c2h)
    expect(h2c(deviceKey(hash), t)).toBe(VECTORS.h2c)
    expect(sasCode(t)).toBe(VECTORS.sas)
  })
})

// Calculados aparte con HKDF/HMAC de la librería estándar de Python (no con este módulo).
const VECTORS = {
  deviceKey: '9284b1a4de6f6df40c0949cbb5c9547612c6b29ade73fa663d231c52583d3548',
  pairId: 'MUSbW_gs95Dz_5XT7psoC-PoPEH8eXSdSyeop-T56dc',
  c2h: '7UyMsTcUebO3PZ9qaWgmA3lfHoclRgr-geyp-OmqKt0',
  h2c: 'Gi7pKRE_5ccUTZdCsUXmlzECJo38vthh0_UyMf8maFQ',
  sas: '441731'
}
