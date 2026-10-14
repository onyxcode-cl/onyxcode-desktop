/**
 * Registro permanente de problemas (Ajustes › Diagnóstico › «Problemas»).
 *
 * Guarda en disco, en `userData/logs/problemas.log`, los errores que va teniendo la app (proceso principal, ventana, motor,
 * actualizador, procesos hijos) para poder revisarlos después aunque se haya cerrado la app. Una línea JSON por problema.
 *
 * - Ya se escribe REDACTADO (rutas del usuario → `~` y los patrones de claves de `makeRedactor`); al mostrarlo o exportarlo,
 *   `DiagnosticsService` lo vuelve a pasar por el redactor con los secretos de ese momento.
 * - Nunca lanza: si el disco falla, el problema se pierde pero la app sigue.
 * - Acotado: rota a 1 MB y conserva `keep` archivos; los repetidos seguidos se cuentan en una sola línea y hay un tope por minuto.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { makeRedactor, type Redactor } from './redact'

export const PROBLEM_SOURCES = ['main', 'renderer', 'engine', 'update', 'process'] as const
export type ProblemSource = (typeof PROBLEM_SOURCES)[number]

export interface ProblemInput {
  source: ProblemSource
  level?: 'error' | 'warn'
  message: string
  stack?: string
  /** Datos sueltos útiles para ubicar el fallo (código de salida, motivo…). Solo texto o números. */
  detail?: Record<string, string | number>
}

interface StoredEntry {
  t: number
  source: ProblemSource
  level: 'error' | 'warn'
  message: string
  stack?: string
  detail?: Record<string, string | number>
  /** Veces que se repitió seguido (solo si > 1). */
  repeats?: number
}

export interface ProblemLogOptions {
  dir: string
  home?: string
  now?: () => number
  maxBytes?: number
  keep?: number
  maxPerMinute?: number
}

export const MAX_MESSAGE_CHARS = 2000
export const MAX_STACK_CHARS = 4000
const REPEAT_WINDOW_MS = 30_000
const SOURCE_LABEL: Record<ProblemSource, string> = {
  main: 'app',
  renderer: 'ventana',
  engine: 'motor',
  update: 'actualización',
  process: 'proceso'
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s)

export class ProblemLog {
  private readonly dir: string
  private readonly now: () => number
  private readonly maxBytes: number
  private readonly keep: number
  private readonly maxPerMinute: number
  private readonly redact: Redactor
  private minuteStart = 0
  private inMinute = 0
  private dropped = 0
  private last: { key: string; at: number; entry: StoredEntry } | null = null

  constructor(o: ProblemLogOptions) {
    this.dir = o.dir
    this.now = o.now ?? Date.now
    this.maxBytes = o.maxBytes ?? 1024 * 1024
    this.keep = Math.max(1, o.keep ?? 4)
    this.maxPerMinute = o.maxPerMinute ?? 60
    this.redact = makeRedactor({ exact: [], home: o.home })
  }

  private file(i = 0): string {
    return join(this.dir, i === 0 ? 'problemas.log' : `problemas.${i}.log`)
  }

  /** Anota un problema. No lanza nunca. */
  record(p: ProblemInput): void {
    try {
      const at = this.now()
      const entry: StoredEntry = {
        t: at,
        source: p.source,
        level: p.level ?? 'error',
        message: this.redact(clip(String(p.message ?? ''), MAX_MESSAGE_CHARS)),
        ...(p.stack ? { stack: this.redact(clip(p.stack, MAX_STACK_CHARS)) } : {}),
        ...(p.detail ? { detail: this.redactDetail(p.detail) } : {})
      }
      const key = `${entry.source}|${entry.level}|${entry.message}`
      if (this.last && this.last.key === key && at - this.last.at < REPEAT_WINDOW_MS) {
        this.last.entry.repeats = (this.last.entry.repeats ?? 1) + 1
        this.last.at = at
        return
      }
      this.flushRepeats()
      if (at - this.minuteStart >= 60_000) {
        this.minuteStart = at
        this.inMinute = 0
        if (this.dropped > 0) {
          this.write({ t: at, source: 'main', level: 'warn', message: `Se omitieron ${this.dropped} problemas por exceso en un minuto.` })
          this.dropped = 0
        }
      }
      if (this.inMinute >= this.maxPerMinute) {
        this.dropped++
        return
      }
      this.inMinute++
      this.write(entry)
      this.last = { key, at, entry }
    } catch {
      /* el registro nunca debe romper la app */
    }
  }

  private redactDetail(d: Record<string, string | number>): Record<string, string | number> {
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(d)) out[clip(k, 60)] = typeof v === 'number' ? v : this.redact(clip(String(v), 500))
    return out
  }

  /** Si el último problema se repitió, deja una línea «×N» antes de pasar a otro. */
  private flushRepeats(): void {
    const l = this.last
    this.last = null
    if (l && (l.entry.repeats ?? 1) > 1) {
      this.write({ t: l.at, source: l.entry.source, level: 'warn', message: `(el problema anterior se repitió ${l.entry.repeats} veces)` })
    }
  }

  private write(entry: StoredEntry): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const f = this.file()
    try {
      if (existsSync(f) && statSync(f).size >= this.maxBytes) this.rotate()
    } catch {
      /* se intenta escribir igual */
    }
    appendFileSync(f, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
  }

  private rotate(): void {
    rmSync(this.file(this.keep - 1), { force: true })
    for (let i = this.keep - 2; i >= 0; i--) {
      if (existsSync(this.file(i))) renameSync(this.file(i), this.file(i + 1))
    }
  }

  /** Líneas legibles (de la más antigua a la más reciente), recortadas a las últimas `maxLines`. */
  readLines(maxLines = 500): string[] {
    this.flushRepeats()
    const lines: string[] = []
    for (let i = this.keep - 1; i >= 0; i--) {
      const f = this.file(i)
      if (!existsSync(f)) continue
      let raw = ''
      try {
        raw = readFileSync(f, 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        lines.push(...formatEntry(line))
      }
    }
    return lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines
  }
}

/** Una línea JSON guardada → líneas de texto legibles (la primera con fecha, nivel y origen). */
export function formatEntry(jsonLine: string): string[] {
  let e: StoredEntry
  try {
    e = JSON.parse(jsonLine) as StoredEntry
  } catch {
    return [jsonLine]
  }
  const d = new Date(e.t)
  const p = (n: number): string => String(n).padStart(2, '0')
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  const out = [`${when} [${e.level === 'warn' ? 'aviso' : 'error'}] [${SOURCE_LABEL[e.source] ?? e.source}] ${e.message}`]
  if (e.detail) {
    const pairs = Object.entries(e.detail).map(([k, v]) => `${k}=${v}`)
    if (pairs.length) out.push(`    ${pairs.join(' ')}`)
  }
  if (e.stack) for (const s of e.stack.split(/\r?\n/)) out.push(`    ${s}`)
  return out
}

let shared: ProblemLog | null = null

/** Crea el registro compartido de la app (una vez, al arrancar). */
export function initProblemLog(o: ProblemLogOptions): ProblemLog {
  shared = new ProblemLog(o)
  return shared
}

export function getProblemLog(): ProblemLog | null {
  return shared
}

/** Anota un problema en el registro compartido; no hace nada si aún no se creó. Nunca lanza. */
export function recordProblem(p: ProblemInput): void {
  shared?.record(p)
}

/** Texto de un error cualquiera (Error, string, objeto) → mensaje y pila. */
export function describeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try {
    return { message: JSON.stringify(err) ?? String(err) }
  } catch {
    return { message: String(err) }
  }
}
