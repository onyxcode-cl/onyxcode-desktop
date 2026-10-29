/**
 * No repetir capturas idénticas: guarda el hash de la última captura de cada ventana (por sesión) y, si la nueva es idéntica y NO hubo
 * ninguna acción entre medias, el puente responde corto («sin cambios desde la captura anterior») en vez de reenviar la imagen.
 *
 * Nunca oculta una imagen que importa:
 * - `force: true` siempre devuelve la imagen;
 * - tras CUALQUIER acción de la sesión desde la última captura (clic, teclas, texto…) la imagen se envía aunque sea idéntica: si la acción
 *   debía cambiar algo y no lo hizo, quien mira tiene que poder verlo, no leer un resumen;
 * - tras `maxConsecutiveSkips` omisiones seguidas se vuelve a enviar (el contexto pudo compactarse);
 * - pasado `ttlMs` desde la última imagen enviada se vuelve a enviar.
 *
 * Módulo puro (solo `node:crypto`): sin Electron, sin disco, sin temporizadores; el reloj se inyecta.
 */

import { createHash } from 'node:crypto'

export interface DedupOptions {
  maxConsecutiveSkips?: number
  ttlMs?: number
  now?: () => number
  /** Tope de sesiones recordadas (se descartan las más antiguas). */
  maxSessions?: number
}

export const DEFAULT_MAX_SKIPS = 2
export const DEFAULT_TTL_MS = 5 * 60_000

interface Entry {
  hash: string
  /** Contador de acciones de la sesión cuando se envió esta imagen. */
  seq: number
  /** Cuándo se envió la imagen por última vez. */
  sentAt: number
  /** Omisiones seguidas desde entonces. */
  skips: number
}

interface SessionState {
  seq: number
  entries: Map<string, Entry>
}

export interface DedupDecision {
  /** `true`: responder corto, sin imagen. */
  duplicate: boolean
  /** Omisiones seguidas (incluida esta si `duplicate`). */
  skips: number
}

/** Hash del contenido de la imagen (bytes, o base64 que se decodifica antes de hashear). */
export const hashImage = (image: Buffer | Uint8Array | string): string =>
  createHash('sha256')
    .update(typeof image === 'string' ? Buffer.from(image, 'base64') : image)
    .digest('hex')

export const DEDUP_NOTICE =
  'sin cambios desde la captura anterior: la imagen es idéntica y no se reenvía (pide fresh: true para verla de nuevo).'

export class ScreenshotDedup {
  private readonly sessions = new Map<string, SessionState>()
  private readonly maxSkips: number
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly maxSessions: number

  constructor(opts: DedupOptions = {}) {
    this.maxSkips = opts.maxConsecutiveSkips ?? DEFAULT_MAX_SKIPS
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? Date.now
    this.maxSessions = opts.maxSessions ?? 64
  }

  private state(session: string): SessionState {
    let s = this.sessions.get(session)
    if (!s) {
      s = { seq: 0, entries: new Map() }
      this.sessions.set(session, s)
      if (this.sessions.size > this.maxSessions) {
        const oldest = this.sessions.keys().next().value
        if (oldest !== undefined) this.sessions.delete(oldest)
      }
    }
    return s
  }

  /** Anota que la sesión hizo una acción (clic, teclas, texto…): la próxima captura se envía aunque sea idéntica. */
  noteAction(session: string): void {
    this.state(session).seq++
  }

  /** Decide si la captura de `target` (p. ej. `bundleId#ventana`) es un duplicado omisible. Siempre registra la captura. */
  check(session: string, target: string, image: Buffer | Uint8Array | string, opts: { force?: boolean } = {}): DedupDecision {
    const s = this.state(session)
    const hash = hashImage(image)
    const now = this.now()
    const prev = s.entries.get(target)
    const duplicate =
      !opts.force && !!prev && prev.hash === hash && prev.seq === s.seq && prev.skips < this.maxSkips && now - prev.sentAt <= this.ttlMs
    if (duplicate && prev) {
      prev.skips++
      return { duplicate: true, skips: prev.skips }
    }
    s.entries.set(target, { hash, seq: s.seq, sentAt: now, skips: 0 })
    return { duplicate: false, skips: 0 }
  }

  /** Olvida una sesión (o todo): p. ej. al terminar la sesión o compactar el contexto. */
  reset(session?: string): void {
    if (session === undefined) this.sessions.clear()
    else this.sessions.delete(session)
  }
}
