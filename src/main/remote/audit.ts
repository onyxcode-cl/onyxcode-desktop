/**
 * Auditoría del control remoto: `userData/remote-audit.jsonl`, una línea JSON por suceso, rotada a 2 archivos
 * (`.jsonl` y `.jsonl.1`) al pasar `maxBytes`. SIN SECRETOS: solo tipo de suceso, hora, huella (8 hex) y nombre del
 * dispositivo, y para llamadas rechazadas únicamente el canal (nombre, nunca payload) y su clase. Cualquier otro campo
 * que se intente guardar se descarta, y los textos libres se validan con listas de caracteres estrictas.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { sanitizeDeviceName } from '@shared/remote/protocol'

export const AUDIT_FILE = 'remote-audit.jsonl'
export const AUDIT_MAX_BYTES = 256 * 1024

export const AUDIT_KINDS = [
  'paired',
  'connected',
  'confirm-approved',
  'confirm-rejected',
  'confirm-expired',
  'revoked',
  'revoked-all',
  'expired',
  'auth-bad-proof',
  'policy-blocked',
  'pin-set',
  'pin-fail',
  'pin-reset',
  'locked',
  'policy-denied',
  'stopped'
] as const
export type AuditKind = (typeof AUDIT_KINDS)[number]

export interface AuditInput {
  kind: AuditKind
  /** Huella del dispositivo (8 hex). */
  device?: string
  name?: string
  /** Canal o ruta (solo el nombre). */
  ch?: string
  /** Clase de la política (`R`/`M`/`D`/`X`). */
  cls?: string
  /** Motivo fijo del rechazo (código corto de la política, nunca texto libre). */
  why?: string
  /** Fallos de PIN acumulados. */
  n?: number
}

export interface AuditEntry extends AuditInput {
  ts: number
}

const CH_RE = /^[A-Za-z0-9:._/ {}*-]{1,96}$/
const WHY_RE = /^[A-Za-z0-9:._/-]{1,90}$/
const FP_RE = /^[0-9a-f]{8}$/

/** Deja solo los campos conocidos y válidos. */
export function sanitizeAudit(i: AuditInput, ts: number): AuditEntry | null {
  if (!AUDIT_KINDS.includes(i.kind)) return null
  const e: AuditEntry = { ts: Math.trunc(ts), kind: i.kind }
  if (typeof i.device === 'string' && FP_RE.test(i.device)) e.device = i.device
  if (typeof i.name === 'string') e.name = sanitizeDeviceName(i.name) || '?'
  if (typeof i.ch === 'string') e.ch = CH_RE.test(i.ch) ? i.ch : '?'
  if (i.cls === 'R' || i.cls === 'M' || i.cls === 'D' || i.cls === 'X') e.cls = i.cls
  if (typeof i.why === 'string' && WHY_RE.test(i.why)) e.why = i.why
  if (typeof i.n === 'number' && Number.isInteger(i.n) && i.n >= 0 && i.n <= 1000) e.n = i.n
  return e
}

function parseLine(line: string): AuditEntry | null {
  try {
    const o = JSON.parse(line) as AuditEntry
    return o && typeof o.ts === 'number' ? sanitizeAudit(o, o.ts) : null
  } catch {
    return null
  }
}

export class AuditLog {
  private readonly now: () => number
  private readonly maxBytes: number

  constructor(
    private readonly file: string,
    opts: { now?: () => number; maxBytes?: number } = {}
  ) {
    this.now = opts.now ?? Date.now
    this.maxBytes = opts.maxBytes ?? AUDIT_MAX_BYTES
  }

  /** Añade un suceso. Nunca lanza (la auditoría no puede romper el control remoto). */
  append(input: AuditInput): void {
    try {
      const e = sanitizeAudit(input, this.now())
      if (!e) return
      const line = `${JSON.stringify(e)}\n`
      mkdirSync(dirname(this.file), { recursive: true })
      let size = 0
      try {
        size = statSync(this.file).size
      } catch {
        /* aún no existe */
      }
      if (size > 0 && size + line.length > this.maxBytes) renameSync(this.file, `${this.file}.1`)
      appendFileSync(this.file, line, { mode: 0o600 })
    } catch {
      /* sin disco no hay auditoría, pero la función sigue */
    }
  }

  /** Últimos sucesos (más recientes primero), opcionalmente de un dispositivo (huella). */
  list(opts: { device?: string; limit?: number } = {}): AuditEntry[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000))
    const out: AuditEntry[] = []
    for (const f of [this.file, `${this.file}.1`]) {
      if (!existsSync(f)) continue
      let text = ''
      try {
        text = readFileSync(f, 'utf8')
      } catch {
        continue
      }
      const rows: AuditEntry[] = []
      for (const line of text.split('\n')) {
        if (!line) continue
        const e = parseLine(line)
        if (e && (!opts.device || e.device === opts.device)) rows.push(e)
      }
      out.push(...rows.reverse())
      if (out.length >= limit) break
    }
    return out.slice(0, limit)
  }
}
