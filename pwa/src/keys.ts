/**
 * Claves del celular con WebCrypto (solo en contexto seguro, es decir, por HTTPS).
 *
 * La clave de autenticación es un `CryptoKey` NO exportable: un script malicioso que corra en la página puede USARLA (firmar
 * mientras la página está abierta), pero no llevársela. El protocolo no cambia: son las mismas derivaciones HKDF/HMAC de
 * `src/shared/remote/handshake.ts` (etiqueta `onyxcode-auth-v3`), y el vector de prueba comprueba que dan los mismos bytes.
 *
 * Una clave importada para `HKDF` y derivada a `HMAC` con `extractable: false` no se puede leer nunca: el secreto en claro solo
 * existe en memoria durante la importación y después se descarta (quien llama no debe conservarlo).
 */
import { fromBase64Url, toBase64Url } from '../../src/shared/remote/code'
import type { AuthMac } from '../../src/shared/remote/handshake'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const SALT = enc('onyxcode/remote/v3')
const B64_32 = /^[A-Za-z0-9_-]{43}$/

/** ¿Hay `crypto.subtle`? (HTTPS). Por HTTP en una IP local no existe y se usa `nobleAuthMac`. */
export function subtleAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.importKey === 'function'
}

/** Copia a un `ArrayBuffer` propio (los tipos de WebCrypto no admiten `Uint8Array<ArrayBufferLike>`). */
function buf(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer as ArrayBuffer
}

async function deriveHmacKey(ikm: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(SALT), info: buf(enc(info)) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false, // no exportable
    ['sign', 'verify']
  )
}

/** Clave de reconexión: `HKDF(sha256(secreto), sal, "device-auth")` (igual que `deviceKey(sha256Hex(secreto))`). */
export async function importDeviceKey(secretB64u: string): Promise<CryptoKey> {
  if (!B64_32.test(secretB64u)) throw new Error('bad-secret')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf(enc(secretB64u))))
  return deriveHmacKey(digest, 'device-auth')
}

/** Clave del canal de vinculación desde el secreto `q`: `HKDF(q, sal, "pair-auth")` (igual que `pairKey(q)`). */
export async function importPairKey(q: string): Promise<CryptoKey> {
  const bytes = B64_32.test(q) ? fromBase64Url(q) : null
  if (!bytes || bytes.length !== 32) throw new Error('bad-pair-secret')
  return deriveHmacKey(bytes, 'pair-auth')
}

/** `AuthMac` sobre un `CryptoKey` HMAC: mismos bytes que `nobleAuthMac`. */
export function subtleAuthMac(key: CryptoKey): AuthMac {
  return {
    async c2h(t) {
      return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, buf(enc(`c2h\n${t}`)))))
    },
    async verifyH2c(t, proof) {
      const p = B64_32.test(proof) ? fromBase64Url(proof) : null
      if (!p || p.length !== 32) return false
      return crypto.subtle.verify('HMAC', key, buf(p), buf(enc(`h2c\n${t}`)))
    }
  }
}
