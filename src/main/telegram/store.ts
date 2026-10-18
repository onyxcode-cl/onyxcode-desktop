/**
 * Persistencia del puente con Telegram, SIEMPRE dentro de `userData` (nunca en `opencode.json` ni en `settings.json`):
 *  - `telegram-token.bin`: el token del bot, cifrado con el almacén seguro de la app (`safeStorage`; en macOS empaquetado, el auxiliar
 *    del Llavero que no cambia entre versiones). Sin cifrado disponible NO se guarda (no hay respaldo en texto plano).
 *  - `telegram-state.json`: interruptor, chat dueño, nombre del bot y `offset` de `getUpdates` (para no repetir mensajes al reiniciar).
 *    No lleva secretos.
 *  - `telegram-audit.jsonl`: auditoría local sin secretos (vinculaciones, desvinculaciones, permisos respondidos).
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SafeStorageLike } from '../remote/devices-store'

export const TELEGRAM_STATE_FILE = 'telegram-state.json'
export const TELEGRAM_TOKEN_FILE = 'telegram-token.bin'
export const TELEGRAM_AUDIT_FILE = 'telegram-audit.jsonl'
const AUDIT_MAX_BYTES = 256 * 1024

export interface PersistedTelegramState {
  v: 1
  enabled: boolean
  ownerChatId: number | null
  ownerLabel: string | null
  /** Parte numérica del token (identifica al bot; no es secreta por sí sola pero no se enseña). */
  botId: string | null
  botUsername: string | null
  /** Siguiente `offset` de `getUpdates`. */
  offset: number
  /** «Permitir escribir a la sesión desde Telegram»: APAGADO por defecto (solo seguimiento). */
  allowWrite: boolean
  /** «Solo resúmenes». */
  summariesOnly: boolean
  /** La sesión que sigue el chat (se retoma al reiniciar). Sin contenido de la conversación. */
  active: PersistedActiveSession | null
  /** Id (de Telegram) del último mensaje enviado a la sesión: una repetición tras un reinicio no se envía dos veces. */
  lastWriteId: number
}

export interface PersistedActiveSession {
  id: string
  /** Carpeta de la instancia del motor donde vive (hace falta para todas las llamadas). */
  directory: string
  kind: 'chat' | 'code'
  title: string
  /** Id del último mensaje del asistente que ya se dio por contado (no se repite al reiniciar). */
  seenUpTo: string
}

export const EMPTY_PERSISTED: PersistedTelegramState = {
  v: 1,
  enabled: false,
  ownerChatId: null,
  ownerLabel: null,
  botId: null,
  botUsername: null,
  offset: 0,
  allowWrite: false,
  summariesOnly: false,
  active: null,
  lastWriteId: 0
}

function cleanActive(v: unknown): PersistedActiveSession | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const str = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length > 0 && x.length <= max ? x : null)
  const id = str(o.id, 100)
  const directory = str(o.directory, 1000)
  if (!id || !directory || (o.kind !== 'chat' && o.kind !== 'code')) return null
  return {
    id,
    directory,
    kind: o.kind,
    title: typeof o.title === 'string' ? o.title.slice(0, 200) : '',
    seenUpTo: typeof o.seenUpTo === 'string' ? o.seenUpTo.slice(0, 100) : ''
  }
}

function writeAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, file)
}

export class TelegramStore {
  private cache: PersistedTelegramState | null = null
  private tokenCache: string | null | undefined

  constructor(
    private readonly dir: string,
    private readonly safe: SafeStorageLike
  ) {}

  get stateFile(): string {
    return join(this.dir, TELEGRAM_STATE_FILE)
  }
  get tokenFile(): string {
    return join(this.dir, TELEGRAM_TOKEN_FILE)
  }
  get auditFile(): string {
    return join(this.dir, TELEGRAM_AUDIT_FILE)
  }

  secureAvailable(): boolean {
    try {
      return this.safe.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  load(): PersistedTelegramState {
    if (this.cache) return this.cache
    let s: PersistedTelegramState = { ...EMPTY_PERSISTED }
    try {
      if (existsSync(this.stateFile)) {
        const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<PersistedTelegramState>
        s = {
          v: 1,
          enabled: raw.enabled === true,
          ownerChatId: typeof raw.ownerChatId === 'number' && Number.isSafeInteger(raw.ownerChatId) ? raw.ownerChatId : null,
          ownerLabel: typeof raw.ownerLabel === 'string' ? raw.ownerLabel.slice(0, 80) : null,
          botId: typeof raw.botId === 'string' && /^\d{1,12}$/.test(raw.botId) ? raw.botId : null,
          botUsername: typeof raw.botUsername === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(raw.botUsername) ? raw.botUsername : null,
          offset: typeof raw.offset === 'number' && Number.isSafeInteger(raw.offset) && raw.offset >= 0 ? raw.offset : 0,
          allowWrite: raw.allowWrite === true,
          summariesOnly: raw.summariesOnly === true,
          active: cleanActive(raw.active),
          lastWriteId:
            typeof raw.lastWriteId === 'number' && Number.isSafeInteger(raw.lastWriteId) && raw.lastWriteId >= 0 ? raw.lastWriteId : 0
        }
      }
    } catch {
      s = { ...EMPTY_PERSISTED }
    }
    this.cache = s
    return s
  }

  save(patch: Partial<PersistedTelegramState>): PersistedTelegramState {
    const next = { ...this.load(), ...patch, v: 1 as const }
    this.cache = next
    try {
      writeAtomic(this.stateFile, JSON.stringify(next, null, 2))
    } catch {
      /* sin disco: sigue en memoria */
    }
    return next
  }

  /** El token, o `null` si no hay o no se puede descifrar (Llavero distinto, archivo dañado). */
  readToken(): string | null {
    if (this.tokenCache !== undefined) return this.tokenCache
    let token: string | null = null
    try {
      if (existsSync(this.tokenFile) && this.secureAvailable()) token = this.safe.decryptString(readFileSync(this.tokenFile)) || null
    } catch {
      token = null
    }
    this.tokenCache = token
    return token
  }

  /** Guarda el token cifrado. `false` si el almacén seguro no está disponible (no se guarda nada). */
  writeToken(token: string): boolean {
    if (!this.secureAvailable()) return false
    try {
      writeAtomic(this.tokenFile, this.safe.encryptString(token))
    } catch {
      return false
    }
    this.tokenCache = token
    return true
  }

  deleteToken(): void {
    this.tokenCache = null
    try {
      rmSync(this.tokenFile, { force: true })
    } catch {
      /* ya no está */
    }
  }

  // ---- auditoría ----

  audit(input: AuditInput): void {
    try {
      const e = sanitizeAudit(input, Date.now())
      if (!e) return
      const line = `${JSON.stringify(e)}\n`
      mkdirSync(this.dir, { recursive: true })
      let size = 0
      try {
        size = statSync(this.auditFile).size
      } catch {
        /* aún no existe */
      }
      if (size > 0 && size + line.length > AUDIT_MAX_BYTES) renameSync(this.auditFile, `${this.auditFile}.1`)
      appendFileSync(this.auditFile, line, { mode: 0o600 })
    } catch {
      /* la auditoría nunca rompe el puente */
    }
  }
}

export const TELEGRAM_AUDIT_KINDS = [
  'enabled',
  'disabled',
  'token-saved',
  'token-removed',
  'link-started',
  'linked',
  'link-failed',
  'link-locked',
  'unlinked',
  'panic',
  'permission-sent',
  'permission-answered',
  'permission-expired',
  'permission-screen',
  'test-sent',
  'foreign-ignored',
  // ---- entrega 2 ----
  'session-chosen',
  'session-released',
  'session-lost',
  'message-sent',
  'message-blocked',
  'file-sent',
  'file-received',
  'file-refused',
  'write-toggled',
  'summaries-toggled'
] as const
export type TelegramAuditKind = (typeof TELEGRAM_AUDIT_KINDS)[number]

export interface AuditInput {
  kind: TelegramAuditKind
  /** Motivo corto fijo (`command`, `app`, `screen`…), nunca texto libre. */
  why?: string
  /** Respuesta dada a un permiso. */
  reply?: 'once' | 'reject'
  /** Por dónde se respondió. */
  via?: 'telegram' | 'screen'
  /** Tipo de permiso (`bash`, `edit`…), nunca el comando. */
  perm?: string
  /** Chat (o usuario) afectado, como huella corta: nunca el número. */
  chat?: number
  /** Sesión afectada, como huella corta (nunca el título ni el contenido). */
  sess?: string
  /** `chat` o `code`. */
  mode?: 'chat' | 'code'
  /** Tamaño en bytes de un archivo enviado o recibido (nunca su nombre ni su ruta). */
  bytes?: number
  /** Extensión (sin punto) de un archivo enviado o recibido. */
  ext?: string
  /** Interruptor: activado o no. */
  on?: boolean
}

export interface AuditEntry extends Omit<AuditInput, 'chat' | 'sess'> {
  ts: number
  chat?: string
  sess?: string
}

const WHY_RE = /^[A-Za-z0-9:._-]{1,40}$/

export function chatFingerprint(chatId: number): string {
  return createHash('sha256').update(`lzx-tg:${chatId}`).digest('hex').slice(0, 8)
}

export function sessionFingerprint(sessionId: string): string {
  return createHash('sha256').update(`lzx-tg-s:${sessionId}`).digest('hex').slice(0, 8)
}

export function sanitizeAudit(i: AuditInput, ts: number): AuditEntry | null {
  if (!(TELEGRAM_AUDIT_KINDS as readonly string[]).includes(i.kind)) return null
  const e: AuditEntry = { ts: Math.trunc(ts), kind: i.kind }
  if (typeof i.why === 'string' && WHY_RE.test(i.why)) e.why = i.why
  if (i.reply === 'once' || i.reply === 'reject') e.reply = i.reply
  if (i.via === 'telegram' || i.via === 'screen') e.via = i.via
  if (typeof i.perm === 'string' && WHY_RE.test(i.perm)) e.perm = i.perm
  if (typeof i.chat === 'number' && Number.isSafeInteger(i.chat)) e.chat = chatFingerprint(i.chat)
  if (typeof i.sess === 'string' && i.sess.length > 0 && i.sess.length <= 100) e.sess = sessionFingerprint(i.sess)
  if (i.mode === 'chat' || i.mode === 'code') e.mode = i.mode
  if (typeof i.bytes === 'number' && Number.isSafeInteger(i.bytes) && i.bytes >= 0) e.bytes = i.bytes
  if (typeof i.ext === 'string' && /^[A-Za-z0-9]{1,8}$/.test(i.ext)) e.ext = i.ext.toLowerCase()
  if (typeof i.on === 'boolean') e.on = i.on
  return e
}

/** Últimos sucesos (más recientes primero), para las pruebas y para un futuro visor. */
export function readAudit(file: string, limit = 200): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const f of [file, `${file}.1`]) {
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
      try {
        rows.push(JSON.parse(line) as AuditEntry)
      } catch {
        /* línea dañada */
      }
    }
    out.push(...rows.reverse())
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}
