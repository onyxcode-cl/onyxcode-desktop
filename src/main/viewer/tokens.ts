/**
 * Tokens efímeros del visor de documentos: un token de un solo uso apunta a {path, kind}. Solo
 * puede haber UNO activo a la vez — emitir uno nuevo revoca el anterior (D3 del plan del visor).
 * Módulo PURO: sin Electron, sin node:fs, solo node:crypto para generar el token al azar.
 */
import { randomBytes } from 'node:crypto'
import type { DocKind } from '@shared/doc-kind'

export interface ViewerTokenPayload {
  path: string
  kind: DocKind
}

let active: { token: string; payload: ViewerTokenPayload } | null = null

/** Emite un token nuevo (256 bits, hex). Revoca el anterior si había uno. */
export function issueToken(payload: ViewerTokenPayload): string {
  const token = randomBytes(32).toString('hex')
  active = { token, payload }
  return token
}

/** `null` si el token no existe o ya fue revocado. */
export function resolveToken(token: string): ViewerTokenPayload | null {
  if (!active || active.token !== token) return null
  return active.payload
}

/** Revoca el token activo, si lo hay. Idempotente (no falla si ya no había ninguno). */
export function revokeToken(token: string): void {
  if (active?.token === token) active = null
}

/** Revoca cualquier token activo, sin necesitar saber cuál es (p. ej. al cerrar el visor). */
export function revokeActive(): void {
  active = null
}
