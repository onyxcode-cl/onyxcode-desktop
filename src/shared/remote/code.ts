/**
 * Código de confirmación de 6 dígitos y utilidades de codificación que comparten el escritorio y la PWA.
 *
 * Una IP local por HTTP NO es contexto seguro: aquí no se usa `crypto.subtle` (solo `@noble/hashes`).
 * El código se deriva de las huellas DTLS de los dos SDP (offer del celular y answer del escritorio):
 * si un intermediario reemplaza alguna, cada lado verá un código distinto y el dueño lo notará al compararlos.
 */
import { sha256 } from '@noble/hashes/sha2.js'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  if (i + 1 === bytes.length) {
    const n = bytes[i] << 16
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
  } else if (i + 2 === bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63]
  }
  return out
}

/** `null` si la cadena no es base64url válido. */
export function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const ch of s) {
    acc = (acc << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 255)
    }
  }
  return Uint8Array.from(out)
}

export function toHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

export function sha256Hex(data: Uint8Array | string): string {
  return toHex(sha256(typeof data === 'string' ? new TextEncoder().encode(data) : data))
}

/** Comparación en tiempo constante de dos cadenas (la longitud sí se filtra, aquí es pública y fija). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Primera huella `a=fingerprint:sha-256 AA:BB:…` del SDP, en minúsculas y sin dos puntos; `null` si falta. */
export function sdpFingerprint(sdp: string): string | null {
  const m = /^a=fingerprint:sha-256[ \t]+([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})[ \t]*\r?$/m.exec(sdp)
  return m ? m[1].replace(/:/g, '').toLowerCase() : null
}

/**
 * Código de 6 dígitos: sha256 de `onyxcode-pair-v1\n` + las dos huellas ordenadas (así no depende de
 * quién es offerer y quién answerer). `null` si algún SDP no trae huella sha-256.
 */
export function pairingCode(offerSdp: string, answerSdp: string): string | null {
  const a = sdpFingerprint(offerSdp)
  const b = sdpFingerprint(answerSdp)
  if (!a || !b) return null
  const [x, y] = a <= b ? [a, b] : [b, a]
  const h = sha256(new TextEncoder().encode(`onyxcode-pair-v1\n${x}\n${y}`))
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0
  return String(n % 1_000_000).padStart(6, '0')
}
