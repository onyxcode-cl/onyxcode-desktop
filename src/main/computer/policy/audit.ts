/**
 * Registro auditable de Control del PC (`userData/computer-audit.jsonl`, rotación 5 MB × 3). Plan C §3.
 * NUNCA guarda el texto tecleado, capturas ni valores de UIA: el constructor de entradas es una lista blanca y
 * del texto solo conserva su longitud. El sistema de archivos se inyecta (sin Electron).
 */

export const AUDIT_FILE = 'computer-audit.jsonl'
export const AUDIT_MAX_BYTES = 5 * 1024 * 1024
export const AUDIT_FILES = 3

export type AuditOutcome = 'ok' | 'denied' | 'error' | 'stopped' | 'rate-limited'
const OUTCOMES: ReadonlySet<string> = new Set<AuditOutcome>(['ok', 'denied', 'error', 'stopped', 'rate-limited'])
const TIERS: ReadonlySet<string> = new Set(['view', 'click', 'full'])

export interface AuditEntry {
  at: string
  session: string
  tool: string
  appKey: string | null
  appName: string | null
  tier: 'view' | 'click' | 'full' | null
  x: number | null
  y: number | null
  textLen: number | null
  keyCombo: string | null
  outcome: AuditOutcome
  reason: string | null
}

/** Entrada cruda del llamador. `text` se usa SOLO para medir su longitud y se descarta. Cualquier otro campo se ignora. */
export interface AuditInput {
  at?: number | string | Date
  session?: string
  tool?: string
  appKey?: string | null
  appName?: string | null
  tier?: string | null
  x?: number | null
  y?: number | null
  text?: string | null
  textLen?: number | null
  keyCombo?: string | null
  outcome?: string
  reason?: string | null
}

const CTRL = /[\u0000-\u001f\u007f]/g
const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v ? v.replace(CTRL, ' ').slice(0, n) : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

export function buildAuditEntry(input: AuditInput, now: () => number = Date.now): AuditEntry {
  const t =
    input.at instanceof Date
      ? input.at.getTime()
      : typeof input.at === 'number'
        ? input.at
        : typeof input.at === 'string'
          ? Date.parse(input.at)
          : now()
  const textLen = typeof input.text === 'string' ? [...input.text].length : int(input.textLen)
  const combo =
    typeof input.keyCombo === 'string' && /^[a-z0-9+\- ,./;'`\\[\]=]{1,128}$/i.test(input.keyCombo) ? input.keyCombo.toLowerCase() : null
  return {
    at: new Date(Number.isFinite(t) ? t : now()).toISOString(),
    session: clip(input.session, 64) ?? '',
    tool: clip(input.tool, 64) ?? '',
    appKey: clip(input.appKey, 400),
    appName: clip(input.appName, 120),
    tier: input.tier && TIERS.has(input.tier) ? (input.tier as AuditEntry['tier']) : null,
    x: int(input.x),
    y: int(input.y),
    textLen: textLen !== null && textLen >= 0 ? textLen : null,
    keyCombo: combo,
    outcome: input.outcome && OUTCOMES.has(input.outcome) ? (input.outcome as AuditOutcome) : 'error',
    reason: clip(input.reason, 200)
  }
}

export function serializeAuditEntry(e: AuditEntry): string {
  return JSON.stringify(e) + '\n'
}

export interface AuditFs {
  /** Tamaño en bytes; 0 si no existe. */
  size(path: string): number
  append(path: string, data: string): void
  rename(from: string, to: string): void
  remove(path: string): void
  mkdirp(dir: string): void
}

const join = (dir: string, name: string): string =>
  dir.endsWith('/') || dir.endsWith('\\') ? dir + name : `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`

export interface AuditLog {
  /** Escribe una entrada. Devuelve false si falló (nunca lanza: un fallo de disco no debe tumbar el control). */
  write(input: AuditInput): boolean
  paths(): string[]
}

export function createAuditLog(dir: string, fs: AuditFs, opts: { now?: () => number; maxBytes?: number; files?: number } = {}): AuditLog {
  const maxBytes = opts.maxBytes ?? AUDIT_MAX_BYTES
  const files = Math.max(1, opts.files ?? AUDIT_FILES)
  const path = (i: number): string => join(dir, i === 0 ? AUDIT_FILE : `${AUDIT_FILE}.${i}`)
  const rotate = (): void => {
    fs.remove(path(files - 1))
    for (let i = files - 2; i >= 0; i--) {
      if (fs.size(path(i)) > 0) fs.rename(path(i), path(i + 1))
    }
  }
  return {
    write(input) {
      try {
        const line = serializeAuditEntry(buildAuditEntry(input, opts.now))
        fs.mkdirp(dir)
        const cur = fs.size(path(0))
        if (cur > 0 && cur + new TextEncoder().encode(line).length > maxBytes) rotate()
        fs.append(path(0), line)
        return true
      } catch {
        return false
      }
    },
    paths: () => Array.from({ length: files }, (_, i) => path(i))
  }
}

/** Lee líneas de un `.jsonl` tolerando basura: las que no son entradas válidas se descartan. */
export function parseAuditLines(text: string): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as Partial<AuditEntry>
      if (o && typeof o === 'object' && typeof o.at === 'string' && typeof o.tool === 'string' && typeof o.outcome === 'string')
        out.push(buildAuditEntry({ ...o, at: o.at }))
    } catch {
      /* línea corrupta */
    }
  }
  return out
}
