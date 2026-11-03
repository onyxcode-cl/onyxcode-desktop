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

/** `null` si el token no existe o ya fue revocado (el del panel o el de la ranura de captura). */
export function resolveToken(token: string): ViewerTokenPayload | null {
  if (active && active.token === token) return active.payload
  return resolveCaptureToken(token)
}

/** Revoca el token activo, si lo hay. Idempotente (no falla si ya no había ninguno). */
export function revokeToken(token: string): void {
  if (active?.token === token) active = null
}

/** Revoca cualquier token activo, sin necesitar saber cuál es (p. ej. al cerrar el visor). */
export function revokeActive(): void {
  active = null
}

/**
 * Segunda ranura, EXCLUSIVA del render oculto que usa la IA para ver un documento (`viewer/capture.ts`): un token propio, de vida corta y
 * para un solo archivo, que no toca el token activo del panel de la persona (emitir uno no revoca el otro y revocarlo tampoco). El token
 * solo existe en la dirección de la ventana oculta: el panel nunca lo conoce. Se revoca apenas termina el render (y vence solo si no).
 */
const CAPTURE_TTL_MS = 30_000
const captures = new Map<string, { payload: ViewerTokenPayload; expires: number }>()

export function issueCaptureToken(payload: ViewerTokenPayload, now: () => number = Date.now): string {
  for (const [k, v] of captures) if (v.expires <= now()) captures.delete(k)
  const token = randomBytes(32).toString('hex')
  captures.set(token, { payload, expires: now() + CAPTURE_TTL_MS })
  return token
}

/** `null` si no existe, ya se revocó o venció. */
export function resolveCaptureToken(token: string, now: () => number = Date.now): ViewerTokenPayload | null {
  const hit = captures.get(token)
  if (!hit) return null
  if (hit.expires <= now()) {
    captures.delete(token)
    return null
  }
  return hit.payload
}

export function revokeCaptureToken(token: string): void {
  captures.delete(token)
}
