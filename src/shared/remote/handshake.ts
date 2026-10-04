/**
 * Autenticación mutua del control remoto (protocolo v3), ligada a las huellas DTLS de los dos extremos.
 *
 * TypeScript puro, sin Node ni DOM: solo `@noble/hashes` (la PWA corre por HTTP, sin `crypto.subtle`). El azar se INYECTA
 * (`Rand`): en el Mac viene de `node:crypto`; en la PWA, de `crypto.getRandomValues`.
 *
 * IDEA. Ninguna credencial viaja. Cada lado calcula un HMAC con una clave compartida sobre un transcript que contiene dos
 * nonces frescos y las huellas DTLS QUE VIO SU PROPIA PILA (la de su `localDescription`/`remoteDescription`; las pilas
 * WebRTC exigen que el certificado del par case con la huella de su SDP remoto). Con un intermediario que termine dos DTLS,
 * las huellas de cada lado son distintas, los HMAC no cuadran y el intermediario (que no tiene la clave) no puede
 * fabricarlos. El Mac prueba al celular que tiene la clave (`proof`) ANTES de que el celular mande el PIN o cualquier cosa.
 *
 * CLAVES (HKDF-SHA256, sal fija de versión):
 *  - reconexión: `K = deviceKey(sha256(secreto))`. El celular parte del secreto que ya guarda; el Mac, del `secretHash` que ya
 *    guarda. Los celulares vinculados antes siguen sirviendo sin volver a vincular.
 *  - vinculación: `K = pairKey(q)` con `q` el secreto del QR, que NUNCA sale del celular: el `hello` lleva `pairId(q)`.
 *
 * CÓDIGO DE 6 DÍGITOS (`sasCode`, solo vinculación). NO usa la clave: protege también cuando `q` se filtró (QR fotografiado).
 * Lleva compromiso previo (commit-reveal): el celular se compromete a `rp` (`cm = sha256(rp)`) antes de ver `rm`; el Mac
 * revela `rm` antes de ver `rp`. Un intermediario que conoce `q` hace de Mac ante el celular y de celular ante el Mac. Ante
 * el Mac tiene que comprometerse a su `rp'` antes de recibir `rm`, así que el código del lado Mac queda fijado sin que él
 * pueda moler certificados. Ante el celular tiene que mandar su `rm'` sin conocer `rp`, que el celular revela después: el
 * código del celular le sale al azar y acierta con probabilidad 1e-6 por intento (los intentos por QR están limitados).
 * Sin compromiso, bastaría moler ~2^10 certificados (cumpleaños) para igualar los dos códigos.
 */
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { constantTimeEqual, fromBase64Url, hexToBytes, sha256Hex, toBase64Url } from './code'
import type { Hs1Frame, Hs2Frame, Hs3Frame } from './protocol'

export const HS_VERSION = 3

/** Huellas DTLS (hex minúscula, 32 B) del offer (celular) y del answer (Mac), ya validadas con `sdpFingerprintStrict`. */
export interface Fps {
  offer: string
  answer: string
}
export type Rand = (n: number) => Uint8Array

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const SALT = enc('onyxcode/remote/v3')
const HEX64 = /^[0-9a-f]{64}$/
const B64_32 = /^[A-Za-z0-9_-]{43}$/
const B64_16 = /^[A-Za-z0-9_-]{22}$/
const DEVICE_ID = /^[0-9a-f]{32}$/

// ── claves ──

/** Clave de reconexión desde el sha256 (hex, 64 car.) del secreto de dispositivo. Lanza si el valor no es válido. */
export function deviceKey(secretHashHex: string): Uint8Array {
  const ikm = HEX64.test(secretHashHex) ? hexToBytes(secretHashHex) : null
  if (!ikm) throw new Error('bad-secret-hash')
  return hkdf(sha256, ikm, SALT, enc('device-auth'), 32)
}

function qBytes(q: string): Uint8Array {
  const b = B64_32.test(q) ? fromBase64Url(q) : null
  if (!b || b.length !== 32) throw new Error('bad-pair-secret')
  return b
}

/** Clave del canal de vinculación desde el secreto `q` del QR (32 B base64url). Lanza si no es válido. */
export function pairKey(q: string): Uint8Array {
  return hkdf(sha256, qBytes(q), SALT, enc('pair-auth'), 32)
}

/** Identificador público del QR (43 car. base64url): sirve para reconocerlo sin revelar `q`. */
export function pairId(q: string): string {
  return toBase64Url(hkdf(sha256, qBytes(q), SALT, enc('pair-id'), 32))
}

// ── transcript, pruebas y código ──

interface TranscriptInput {
  mode: 'resume' | 'pair'
  id: string
  fps: Fps
  nc: string
  ns: string
  cm?: string
  rm?: string
  rp?: string
}

/**
 * Todos los campos tienen alfabeto cerrado (hex, base64url o enumerado) y se unen con `\n`: la codificación no es
 * ambigua. `null` si algún campo no cumple (no se calcula nada sobre datos raros).
 */
function transcript(t: TranscriptInput): string | null {
  const idOk = t.mode === 'resume' ? DEVICE_ID.test(t.id) : B64_32.test(t.id)
  const pairOk = t.mode === 'pair'
  const okOpt = (v: string | undefined, re: RegExp): boolean => (pairOk ? v !== undefined && re.test(v) : v === undefined)
  if (
    !idOk ||
    !HEX64.test(t.fps.offer) ||
    !HEX64.test(t.fps.answer) ||
    !B64_32.test(t.nc) ||
    !B64_32.test(t.ns) ||
    !okOpt(t.cm, B64_32) ||
    !okOpt(t.rm, B64_16) ||
    !okOpt(t.rp, B64_16)
  )
    return null
  return ['onyxcode-auth-v3', t.mode, t.id, t.fps.offer, t.fps.answer, t.nc, t.ns, t.cm ?? '-', t.rm ?? '-', t.rp ?? '-'].join('\n')
}

/** Prueba del celular al Mac (`c2h`). */
export function c2h(key: Uint8Array, transcriptText: string): string {
  return toBase64Url(hmac(sha256, key, enc(`c2h\n${transcriptText}`)))
}
/** Prueba del Mac al celular (`h2c`): otra etiqueta, así que no se puede reflejar una prueba como la otra. */
export function h2c(key: Uint8Array, transcriptText: string): string {
  return toBase64Url(hmac(sha256, key, enc(`h2c\n${transcriptText}`)))
}

/** Código de 6 dígitos del transcript (uint32 BE de los 4 primeros bytes, mod 1e6). No usa la clave. */
export function sasCode(transcriptText: string): string {
  const h = sha256(enc(`onyxcode-sas-v3\n${transcriptText}`))
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0
  return String(n % 1_000_000).padStart(6, '0')
}

/** Compromiso del celular sobre `rp` (la cadena exacta, sin decodificar: no hay codificaciones equivalentes). */
export function commit(rp: string): string {
  return toBase64Url(sha256(enc(rp)))
}

const validFps = (f: Fps): boolean => HEX64.test(f.offer) && HEX64.test(f.answer)

// ── lado celular ──

export type ClientHandshakeOptions =
  { mode: 'resume'; deviceId: string; secret: string; fps: Fps; rand: Rand } | { mode: 'pair'; q: string; fps: Fps; rand: Rand }

export class ClientHandshake {
  private stage: 'new' | 'hello' | 'challenged' | 'done' = 'new'
  private readonly key: Uint8Array | null
  private readonly id: string
  private nc = ''
  private ns = ''
  private rp = ''
  private cm = ''
  private rm = ''
  private t: string | null = null
  private code: string | null = null

  constructor(private readonly o: ClientHandshakeOptions) {
    let key: Uint8Array | null = null
    let id = ''
    try {
      if (o.mode === 'resume') {
        key = deviceKey(sha256Hex(o.secret))
        id = o.deviceId
      } else {
        key = pairKey(o.q)
        id = pairId(o.q)
      }
    } catch {
      key = null
    }
    this.key = key
    this.id = id
  }

  /** Primera trama (`hs1`). Se llama una sola vez. */
  hello(): Hs1Frame {
    if (this.stage !== 'new') throw new Error('hello-twice')
    this.stage = 'hello'
    this.nc = toBase64Url(this.o.rand(32))
    const f: Hs1Frame = { t: 'hs1', v: HS_VERSION, mode: this.o.mode, id: this.id, nc: this.nc }
    if (this.o.mode === 'pair') {
      this.rp = toBase64Url(this.o.rand(16))
      this.cm = commit(this.rp)
      f.cm = this.cm
    }
    return f
  }

  /** Responde al desafío del Mac con `hs3`. `null` = trama inválida (en pair falta `rm`; en resume sobra) o ya usada. */
  onChallenge(f: Hs2Frame): Hs3Frame | null {
    if (this.stage !== 'hello' || !this.key) return this.abort()
    const pair = this.o.mode === 'pair'
    if (pair !== (f.rm !== undefined)) return this.abort()
    this.ns = f.ns
    this.rm = f.rm ?? ''
    const t = transcript({
      mode: this.o.mode,
      id: this.id,
      fps: this.o.fps,
      nc: this.nc,
      ns: this.ns,
      ...(pair ? { cm: this.cm, rm: this.rm, rp: this.rp } : {})
    })
    if (!t || !validFps(this.o.fps)) return this.abort()
    this.t = t
    this.stage = 'challenged'
    const out: Hs3Frame = { t: 'hs3', mac: c2h(this.key, t) }
    if (pair) out.rp = this.rp
    return out
  }

  /** ¿La prueba del Mac (`h2c`) es válida para ESTE transcript? Un solo intento por instancia. */
  verifyProof(proof: string): boolean {
    if (this.stage !== 'challenged' || !this.key || !this.t) return false
    this.stage = 'done'
    const ok = constantTimeEqual(proof, h2c(this.key, this.t))
    if (ok && this.o.mode === 'pair') this.code = sasCode(this.t)
    return ok
  }

  /** Código de 6 dígitos: solo en vinculación y solo tras `verifyProof === true`. */
  sas(): string | null {
    return this.code
  }

  private abort(): null {
    this.stage = 'done'
    return null
  }
}

// ── lado Mac ──

export type HostHandshakeOptions =
  | { mode: 'resume'; expectId: string; key: Uint8Array | null; fps: Fps; rand: Rand }
  | { mode: 'pair'; qid: string; key: Uint8Array; fps: Fps; rand: Rand }

export type HostProofResult = { ok: true; proof: string; sas?: string } | { ok: false }

export class HostHandshake {
  private stage: 'new' | 'challenged' | 'done' = 'new'
  /** Clave real o de relleno (aleatoria): el trabajo es el mismo y el resultado, siempre `ok: false`. */
  private readonly key: Uint8Array
  private readonly realKey: boolean
  private id = ''
  private nc = ''
  private ns = ''
  private cm = ''
  private rm = ''

  constructor(private readonly o: HostHandshakeOptions) {
    this.realKey = o.key !== null && o.key.length === 32
    this.key = this.realKey ? (o.key as Uint8Array) : o.rand(32)
  }

  /** Comprueba `hs1` y devuelve `hs2`. `null` = violación (versión, modo, id, forma o segunda llamada). */
  onHello(f: Hs1Frame): Hs2Frame | null {
    if (this.stage !== 'new') return this.abort()
    const pair = this.o.mode === 'pair'
    const expect = this.o.mode === 'pair' ? this.o.qid : this.o.expectId
    if (f.v !== HS_VERSION || f.mode !== this.o.mode || !constantTimeEqual(f.id, expect)) return this.abort()
    if (pair !== (f.cm !== undefined)) return this.abort()
    if (!B64_32.test(f.nc) || (pair && !B64_32.test(f.cm as string)) || !validFps(this.o.fps)) return this.abort()
    this.id = f.id
    this.nc = f.nc
    this.cm = f.cm ?? ''
    this.ns = toBase64Url(this.o.rand(32))
    this.stage = 'challenged'
    if (!pair) return { t: 'hs2', ns: this.ns }
    this.rm = toBase64Url(this.o.rand(16))
    return { t: 'hs2', ns: this.ns, rm: this.rm }
  }

  /** Verifica `hs3`. Un solo intento: tras él, la instancia no vuelve a aceptar nada. */
  onProof(f: Hs3Frame): HostProofResult {
    if (this.stage !== 'challenged') return { ok: false }
    this.stage = 'done'
    const pair = this.o.mode === 'pair'
    if (pair !== (f.rp !== undefined)) return { ok: false }
    if (!B64_32.test(f.mac) || (pair && !B64_16.test(f.rp as string))) return { ok: false }
    // Se calcula todo siempre (también con clave de relleno o compromiso roto) para no distinguir los casos por tiempo.
    const commitOk = !pair || constantTimeEqual(commit(f.rp as string), this.cm)
    const t = transcript({
      mode: this.o.mode,
      id: this.id,
      fps: this.o.fps,
      nc: this.nc,
      ns: this.ns,
      ...(pair ? { cm: this.cm, rm: this.rm, rp: f.rp } : {})
    })
    if (!t) return { ok: false }
    const macOk = constantTimeEqual(f.mac, c2h(this.key, t))
    if (!(macOk && commitOk && this.realKey)) return { ok: false }
    const proof = h2c(this.key, t)
    return pair ? { ok: true, proof, sas: sasCode(t) } : { ok: true, proof }
  }

  private abort(): null {
    this.stage = 'done'
    return null
  }
}
