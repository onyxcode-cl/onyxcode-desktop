/**
 * Valoraciones de respuestas, guardadas solo en el equipo: `userData/logs/valoraciones.jsonl`, una línea JSON por respuesta valorada.
 * Sin texto de la conversación y sin rutas; sin red. Nunca lanza hacia fuera salvo entrada inválida (el manejador IPC la valida antes).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RATING_COMMENT_MAX,
  RATING_FILE,
  RATING_ID_RE,
  RATING_LABEL_RE,
  RATING_MAX_RECORDS,
  RATING_VALUES,
  type RatingEntry,
  type RatingInput,
  type RatingRecord,
  type RatingTokens
} from '@shared/ratings'

const INPUT_KEYS = new Set(['sessionId', 'messageId', 'value', 'comment', 'model', 'service', 'mode', 'durationMs', 'tokens'])
const TOKEN_KEYS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'] as const
const PATH_RE = /(?:[A-Za-z]:[\\/]|\/)(?:[^\s/\\]+[\\/])*[^\s/\\]*/g

const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12 ? Math.round(v) : undefined

/** Recorta el comentario y quita rutas de archivos (por si la persona pegó una). */
export function cleanComment(raw: string): string | undefined {
  const s = raw.replace(PATH_RE, (m) => (m.length > 1 && /[\\/]/.test(m.slice(1)) ? '[ruta]' : m)).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, RATING_COMMENT_MAX) : undefined
}

/**
 * Arma la línea a guardar. Devuelve `null` si la entrada es inválida (clave de más, valor que no es «good»/«bad», ids o etiquetas con
 * formato raro). `value: null` no es un registro: es «quitar» y lo resuelve el almacén.
 */
export function buildRatingRecord(input: unknown, ctx: { now: number; appVersion: string; engineVersion: string }): RatingRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  if (Object.keys(o).some((k) => !INPUT_KEYS.has(k))) return null
  const { sessionId, messageId, value, model, service, mode } = o
  if (typeof sessionId !== 'string' || !RATING_ID_RE.test(sessionId)) return null
  if (typeof messageId !== 'string' || !RATING_ID_RE.test(messageId)) return null
  if (typeof value !== 'string' || !(RATING_VALUES as readonly string[]).includes(value)) return null
  for (const l of [model, service, mode]) if (typeof l !== 'string' || !RATING_LABEL_RE.test(l)) return null
  const rec: RatingRecord = {
    t: new Date(ctx.now).toISOString(),
    sessionId,
    messageId,
    model: model as string,
    service: service as string,
    mode: mode as string,
    appVersion: ctx.appVersion.slice(0, 40),
    engineVersion: ctx.engineVersion.slice(0, 40),
    value: value as RatingRecord['value']
  }
  if (o.comment !== undefined) {
    if (typeof o.comment !== 'string') return null
    // El comentario solo cuenta con «mala»; con «buena» se descarta.
    const c = value === 'bad' ? cleanComment(o.comment) : undefined
    if (c) rec.comment = c
  }
  if (o.durationMs !== undefined) {
    const d = count(o.durationMs)
    if (d === undefined) return null
    rec.durationMs = d
  }
  if (o.tokens !== undefined) {
    const t = o.tokens as Record<string, unknown> | null
    if (!t || typeof t !== 'object') return null
    const tokens = {} as RatingTokens
    for (const k of TOKEN_KEYS) {
      const n = count(t[k])
      if (n === undefined) return null
      tokens[k] = n
    }
    if (Object.keys(t).length !== TOKEN_KEYS.length) return null
    rec.tokens = tokens
  }
  return rec
}

export interface RatingStoreOptions {
  dir: string
  now?: () => number
  appVersion: () => string
  engineVersion: () => string
}

export class RatingStore {
  private readonly file: string
  constructor(private readonly o: RatingStoreOptions) {
    this.file = join(o.dir, RATING_FILE)
  }

  private read(): RatingRecord[] {
    try {
      if (!existsSync(this.file)) return []
      const out: RatingRecord[] = []
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line) as RatingRecord
          if (r && typeof r.sessionId === 'string' && typeof r.messageId === 'string') out.push(r)
        } catch {
          /* línea dañada: se salta */
        }
      }
      return out
    } catch {
      return []
    }
  }

  private write(records: RatingRecord[]): void {
    mkdirSync(this.o.dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.file)
  }

  /** Guarda (o cambia) la valoración de una respuesta, o la quita si `value` es null. Devuelve false si la entrada es inválida. */
  set(input: RatingInput): boolean {
    const raw = input as unknown as Record<string, unknown>
    if (raw && raw.value === null) {
      const sid = raw.sessionId
      const mid = raw.messageId
      if (typeof sid !== 'string' || typeof mid !== 'string' || !RATING_ID_RE.test(sid) || !RATING_ID_RE.test(mid)) return false
      this.write(this.read().filter((r) => !(r.sessionId === sid && r.messageId === mid)))
      return true
    }
    const rec = buildRatingRecord(input, {
      now: (this.o.now ?? Date.now)(),
      appVersion: this.o.appVersion(),
      engineVersion: this.o.engineVersion()
    })
    if (!rec) return false
    const kept = this.read().filter((r) => !(r.sessionId === rec.sessionId && r.messageId === rec.messageId))
    kept.push(rec)
    this.write(kept.slice(-RATING_MAX_RECORDS))
    return true
  }

  list(sessionId: string): RatingEntry[] {
    return this.read()
      .filter((r) => r.sessionId === sessionId)
      .map((r) => ({ messageId: r.messageId, value: r.value, ...(r.comment ? { comment: r.comment } : {}) }))
  }

  /** Líneas tal como están en el archivo (para el informe de diagnóstico). */
  readLines(max = 200): string[] {
    return this.read()
      .slice(-max)
      .map((r) => JSON.stringify(r))
  }
}
