/**
 * PKCE (RFC 7636, método S256) y `state` aleatorio para el inicio de sesión con Google por
 * loopback (RFC 8252). Solo `node:crypto`: nada de red.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** base64url sin relleno (RFC 7636 §3 / RFC 4648 §5). */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** `code_verifier`: 32 bytes aleatorios → 43 caracteres del alfabeto permitido. */
export function createVerifier(bytes: Buffer = randomBytes(32)): string {
  return base64url(bytes)
}

/** `code_challenge` = BASE64URL(SHA256(verifier)). */
export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest())
}

/** `state` de un solo uso: 32 bytes aleatorios (256 bits). */
export function createState(): string {
  return base64url(randomBytes(32))
}

export interface Pkce {
  verifier: string
  challenge: string
  method: 'S256'
}

export function createPkce(): Pkce {
  const verifier = createVerifier()
  return { verifier, challenge: challengeFor(verifier), method: 'S256' }
}

/** Comparación en tiempo constante de dos cadenas (p. ej. `state`). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
