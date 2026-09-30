import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/** Prefijo SPKI DER de una clave pública Ed25519 (12 bytes) + 32 bytes de clave. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface UpdateKey {
  id: string
  /** SPKI DER en base64 (44 bytes) o los 32 bytes crudos en base64. */
  key: string
}

/** Decodifica la clave pública; null si no es una Ed25519 válida. */
export function decodePublicKey(b64: string): KeyObject | null {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
    const raw = Buffer.from(b64, 'base64')
    const der = raw.length === 32 ? Buffer.concat([SPKI_PREFIX, raw]) : raw
    if (der.length !== 44 || !der.subarray(0, 12).equals(SPKI_PREFIX)) return null
    const k = createPublicKey({ key: der, format: 'der', type: 'spki' })
    return k.asymmetricKeyType === 'ed25519' ? k : null
  } catch {
    return null
  }
}

/** Verifica una firma Ed25519 (base64) sobre los bytes exactos. Nunca lanza. */
export function verifyEd25519(bytes: Uint8Array, sigB64: string, key: string): boolean {
  try {
    const k = decodePublicKey(key)
    if (!k) return false
    const sig = Buffer.from(sigB64.trim(), 'base64')
    if (sig.length !== 64) return false
    return verify(null, bytes, k, sig)
  } catch {
    return false
  }
}

/** Devuelve el `id` de la primera clave que verifica la firma, o null (la firma manda; el JSON aún no se ha leído). */
export function verifyWithKeys(bytes: Uint8Array, sigB64: string, keys: readonly UpdateKey[]): string | null {
  for (const k of keys) if (verifyEd25519(bytes, sigB64, k.key)) return k.id
  return null
}
