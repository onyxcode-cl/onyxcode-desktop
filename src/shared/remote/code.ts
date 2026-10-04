/**
 * Utilidades de codificación y de huellas DTLS que comparten el escritorio y la PWA. El código de confirmación de
 * 6 dígitos y la autenticación mutua viven en `handshake.ts`.
 *
 * Una IP local por HTTP NO es contexto seguro: aquí no se usa `crypto.subtle` (solo `@noble/hashes`).
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

/** `null` si no es hexadecimal con longitud par. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
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

/**
 * Huella DTLS ESTRICTA de un SDP: sha256 en hexadecimal minúscula sin `:`.
 *
 * Recoge TODAS las líneas `a=fingerprint:<alg> <valor>` y devuelve `null` si no hay ninguna, si alguna no es `sha-256`,
 * si algún valor no son 32 bytes `AA:BB:…` o si hay dos valores distintos.
 *
 * Por qué tan estricta: con dos huellas distintas en un mismo SDP, un intermediario podría poner la huella real como
 * primera línea (la que hashearíamos en el handshake) y la suya en otra (la que verifica la pila DTLS). Así los
 * transcripts de los dos lados coincidirían y los HMAC se podrían reenviar tal cual. Se rechaza sin excepción.
 */
export function sdpFingerprintStrict(sdp: string): string | null {
  let found: string | null = null
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=fingerprint:')) continue
    const m = /^a=fingerprint:([^ \t]+)[ \t]+([^ \t]+)[ \t]*$/.exec(line)
    if (!m || m[1].toLowerCase() !== 'sha-256' || !/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/.test(m[2])) return null
    const v = m[2].replace(/:/g, '').toLowerCase()
    if (found !== null && found !== v) return null
    found = v
  }
  return found
}
