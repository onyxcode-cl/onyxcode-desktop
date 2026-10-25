/**
 * Formularios de conectores (MCP `elicitation/create`, modo formulario). Contrato con el motor propio (plan de herramientas
 * diferidas y formularios MCP, T4/T5): eventos `mcp.elicitation.asked|replied|rejected` y dos rutas
 * (`GET /mcp/elicitation`, `POST /mcp/elicitation/{requestID}/reply`) que el SDK fijado NO trae, así que se llaman con `fetch`.
 *
 * Funciones puras, sin Electron ni DOM, compartidas por el adaptador del motor y por los stores de Code y Chat.
 *
 * TODO lo que llega del motor se trata como NO confiable (lo escribe un servidor de terceros): los parseadores descartan lo que no
 * encaja con el contrato y limpian el texto (sin caracteres de control ni de dirección que permitan disfrazarlo). El texto se
 * muestra SIEMPRE como texto plano: sin Markdown, sin HTML, sin enlaces activos (`docs/SEGURIDAD.md`, «Formularios de conectores»).
 */

export type ElicitationFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'enum'
export type ElicitationFormat = 'email' | 'uri' | 'date' | 'date-time'
export type ElicitationAction = 'accept' | 'decline' | 'cancel'
export type ElicitationRejectReason = 'timeout' | 'abort' | 'server-cancel' | 'secret' | 'schema' | 'ambiguous'
export type ElicitationValue = string | number | boolean

export interface ElicitationOption {
  value: string
  label: string
}

export interface ElicitationField {
  name: string
  type: ElicitationFieldType
  title?: string
  description?: string
  required: boolean
  format?: ElicitationFormat
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  options?: ElicitationOption[]
  default?: ElicitationValue
}

export interface ElicitationRequest {
  id: string
  sessionID: string
  server: string
  callID?: string
  message: string
  fields: ElicitationField[]
  /** Milisegundos desde epoch en que el formulario caduca. */
  expiresAt: number
}

export interface ElicitationReplied {
  id: string
  sessionID: string
  action: ElicitationAction
}

export interface ElicitationRejected {
  id: string
  sessionID: string
  reason: ElicitationRejectReason
}

/** Topes que el motor ya aplica; aquí se repiten como defensa (un motor distinto o un evento manipulado). */
export const ELICITATION_LIMITS = {
  fields: 20,
  options: 50,
  title: 120,
  description: 500,
  message: 2000,
  name: 200,
  server: 200,
  /** Tope de un campo de texto cuando el motor no manda `maxLength` (debería mandarlo siempre). */
  stringFallback: 4000
} as const

const FIELD_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean', 'enum'])
const FORMATS: ReadonlySet<string> = new Set(['email', 'uri', 'date', 'date-time'])
const REASONS: ReadonlySet<string> = new Set(['timeout', 'abort', 'server-cancel', 'secret', 'schema', 'ambiguous'])
const ACTIONS: ReadonlySet<string> = new Set(['accept', 'decline', 'cancel'])

// ───────────────────────────── texto plano ─────────────────────────────

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
/** Marcas de dirección (U+202A–202E, U+2066–2069, U+200E/F, U+061C): permiten que un texto se lea al revés o se disfrace. */
const BIDI = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g

/** Limpia un texto del motor para mostrarlo como texto plano y lo acota. Los saltos de línea se conservan (el mensaje puede tener varias líneas). */
export function plainText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const clean = v.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(BIDI, '')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

const oneLine = (v: unknown, max: number): string =>
  plainText(v, max)
    .replace(/\s*\n\s*/g, ' ')
    .trim()

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// ───────────────────────────── parseadores ─────────────────────────────

function parseField(raw: unknown): ElicitationField | null {
  const r = rec(raw)
  const name = typeof r.name === 'string' ? r.name.slice(0, ELICITATION_LIMITS.name) : ''
  if (!name || typeof r.type !== 'string' || !FIELD_TYPES.has(r.type)) return null
  const type = r.type as ElicitationFieldType
  const field: ElicitationField = { name, type, required: r.required === true }
  const title = oneLine(r.title, ELICITATION_LIMITS.title)
  if (title) field.title = title
  const description = plainText(r.description, ELICITATION_LIMITS.description).trim()
  if (description) field.description = description
  if (typeof r.format === 'string' && FORMATS.has(r.format) && type === 'string') field.format = r.format as ElicitationFormat
  const minLength = finite(r.minLength)
  const maxLength = finite(r.maxLength)
  const minimum = finite(r.minimum)
  const maximum = finite(r.maximum)
  if (type === 'string') {
    if (minLength !== undefined && minLength >= 0) field.minLength = Math.floor(minLength)
    field.maxLength = Math.min(
      maxLength !== undefined && maxLength >= 0 ? Math.floor(maxLength) : ELICITATION_LIMITS.stringFallback,
      ELICITATION_LIMITS.stringFallback
    )
  }
  if (type === 'number' || type === 'integer') {
    if (minimum !== undefined) field.minimum = minimum
    if (maximum !== undefined) field.maximum = maximum
  }
  if (type === 'enum') {
    const options: ElicitationOption[] = []
    if (Array.isArray(r.options)) {
      for (const o of r.options.slice(0, ELICITATION_LIMITS.options)) {
        const ro = rec(o)
        if (typeof ro.value !== 'string') continue
        const value = ro.value.slice(0, ELICITATION_LIMITS.title)
        options.push({ value, label: oneLine(ro.label, ELICITATION_LIMITS.title) || value })
      }
    }
    // Una lista sin opciones no se puede contestar: el formulario entero se descarta (devuelve null abajo).
    if (options.length === 0) return null
    field.options = options
  }
  const d = r.default
  if (type === 'boolean') {
    if (typeof d === 'boolean') field.default = d
  } else if (type === 'number' || type === 'integer') {
    if (finite(d) !== undefined) field.default = d as number
  } else if (typeof d === 'string') {
    // Enum: solo vale un valor que esté entre las opciones.
    if (type !== 'enum' || field.options?.some((o) => o.value === d))
      field.default = d.slice(0, field.maxLength ?? ELICITATION_LIMITS.title)
  }
  return field
}

/** `mcp.elicitation.asked` → solicitud saneada, o `null` si no cumple el contrato (no se muestra nada). */
export function parseElicitationRequest(raw: unknown): ElicitationRequest | null {
  const r = rec(raw)
  if (typeof r.id !== 'string' || !r.id || typeof r.sessionID !== 'string' || !r.sessionID) return null
  const server = oneLine(r.server, ELICITATION_LIMITS.server)
  const expiresAt = finite(r.expiresAt)
  if (!server || expiresAt === undefined) return null
  if (!Array.isArray(r.fields) || r.fields.length > ELICITATION_LIMITS.fields) return null
  const fields: ElicitationField[] = []
  const seen = new Set<string>()
  for (const f of r.fields) {
    const parsed = parseField(f)
    // Un campo ilegible o repetido invalida el formulario: enseñar la mitad sería pedir datos a medias.
    if (!parsed || seen.has(parsed.name)) return null
    seen.add(parsed.name)
    fields.push(parsed)
  }
  const out: ElicitationRequest = {
    id: r.id,
    sessionID: r.sessionID,
    server,
    message: plainText(r.message, ELICITATION_LIMITS.message).trim(),
    fields,
    expiresAt
  }
  if (typeof r.callID === 'string' && r.callID) out.callID = r.callID
  return out
}

export function parseElicitationReplied(raw: unknown): ElicitationReplied | null {
  const r = rec(raw)
  if (typeof r.id !== 'string' || !r.id || typeof r.sessionID !== 'string' || typeof r.action !== 'string' || !ACTIONS.has(r.action))
    return null
  return { id: r.id, sessionID: r.sessionID, action: r.action as ElicitationAction }
}

export function parseElicitationRejected(raw: unknown): ElicitationRejected | null {
  const r = rec(raw)
  if (typeof r.id !== 'string' || !r.id || typeof r.sessionID !== 'string' || typeof r.reason !== 'string' || !REASONS.has(r.reason))
    return null
  return { id: r.id, sessionID: r.sessionID, reason: r.reason as ElicitationRejectReason }
}

/**
 * ¿Merece un aviso breve a la persona? Los rechazos por secreto, esquema o ambigüedad ocurren SIN formulario previo (la persona nunca
 * vio nada) y de otro modo pasarían inadvertidos. Tiempo agotado solo avisa si había una tarjeta abierta (lo decide el store).
 * Abortar o que el servidor cancele no avisan: la persona lo causó o la tarjeta simplemente desaparece.
 */
export function rejectionNeedsNotice(reason: ElicitationRejectReason, hadCard: boolean): boolean {
  if (reason === 'secret' || reason === 'schema' || reason === 'ambiguous') return true
  return reason === 'timeout' && hadCard
}

/** Aviso informativo que un store conserva hasta que la persona lo cierre. */
export interface ElicitationNotice {
  id: string
  sessionID: string
  reason: ElicitationRejectReason
}

// ───────────────────────────── validación local ─────────────────────────────

/** Estado del campo en la tarjeta: texto para todo menos el interruptor, que es booleano. */
export type ElicitationDraft = Record<string, string | boolean>

export type ElicitationFieldError =
  | { code: 'required' }
  | { code: 'tooShort'; min: number }
  | { code: 'tooLong'; max: number }
  | { code: 'email' | 'uri' | 'date' | 'dateTime' | 'number' | 'integer' | 'option' }
  | { code: 'tooSmall'; min: number }
  | { code: 'tooLarge'; max: number }

/** Valores iniciales: SOLO el `default` del esquema; todo lo demás queda vacío (nada se rellena por la persona). */
export function initialDraft(fields: readonly ElicitationField[]): ElicitationDraft {
  const draft: ElicitationDraft = {}
  for (const f of fields) {
    if (f.type === 'boolean') draft[f.name] = typeof f.default === 'boolean' ? f.default : false
    else draft[f.name] = f.default === undefined ? '' : String(f.default)
  }
  return draft
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

function validDateTime(s: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(s)
  return !!m && validDate(m[1]) && !Number.isNaN(Date.parse(s))
}

function validUri(s: string): boolean {
  if (/\s/.test(s)) return false
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

function checkField(f: ElicitationField, raw: string | boolean | undefined): { value?: ElicitationValue; error?: ElicitationFieldError } {
  if (f.type === 'boolean') return { value: raw === true }
  const text = typeof raw === 'string' ? raw : ''
  // Un campo de texto se envía tal como se escribió (sin recortar): los espacios pueden importar. «Vacío» = solo espacios.
  const empty = text.trim() === ''
  if (empty) return f.required ? { error: { code: 'required' } } : {}
  if (f.type === 'string') {
    if (f.minLength !== undefined && text.length < f.minLength) return { error: { code: 'tooShort', min: f.minLength } }
    const max = f.maxLength ?? ELICITATION_LIMITS.stringFallback
    if (text.length > max) return { error: { code: 'tooLong', max } }
    const t = text.trim()
    if (f.format === 'email' && !EMAIL.test(t)) return { error: { code: 'email' } }
    if (f.format === 'uri' && !validUri(t)) return { error: { code: 'uri' } }
    if (f.format === 'date' && !validDate(t)) return { error: { code: 'date' } }
    if (f.format === 'date-time' && !validDateTime(t)) return { error: { code: 'dateTime' } }
    return { value: f.format ? t : text }
  }
  if (f.type === 'enum') return f.options?.some((o) => o.value === text) ? { value: text } : { error: { code: 'option' } }
  // number | integer: formato decimal sencillo (sin hexadecimal, sin «1e3», sin separadores de miles).
  const t = text.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { error: { code: f.type === 'integer' ? 'integer' : 'number' } }
  const n = Number(t)
  if (!Number.isFinite(n)) return { error: { code: 'number' } }
  if (f.type === 'integer' && !Number.isInteger(n)) return { error: { code: 'integer' } }
  if (f.minimum !== undefined && n < f.minimum) return { error: { code: 'tooSmall', min: f.minimum } }
  if (f.maximum !== undefined && n > f.maximum) return { error: { code: 'tooLarge', max: f.maximum } }
  return { value: n }
}

export interface ElicitationCheck {
  /** Valores a enviar (campos opcionales vacíos, fuera). */
  content: Record<string, ElicitationValue>
  /** Error por nombre de campo. Vacío = se puede enviar. */
  errors: Record<string, ElicitationFieldError>
}

/** Valida todos los campos con las mismas reglas que el motor (el motor vuelve a validar y manda). */
export function checkElicitation(fields: readonly ElicitationField[], draft: ElicitationDraft): ElicitationCheck {
  const content: Record<string, ElicitationValue> = {}
  const errors: Record<string, ElicitationFieldError> = {}
  for (const f of fields) {
    const r = checkField(f, draft[f.name])
    if (r.error) errors[f.name] = r.error
    else if (r.value !== undefined) content[f.name] = r.value
  }
  return { content, errors }
}

// ───────────────────────────── rutas del motor (fetch crudo) ─────────────────────────────

export interface ElicitationConn {
  baseUrl: string
  /** Valor completo de la cabecera `Authorization`. */
  authorization?: string
}

type FetchLike = typeof fetch

const TIMEOUT_MS = 15_000

function url(conn: ElicitationConn, tail: string, directory: string | undefined): string {
  const q = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  return `${conn.baseUrl.replace(/\/+$/, '')}/mcp/elicitation${tail}${q}`
}

function headers(conn: ElicitationConn, json: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (conn.authorization) h.Authorization = conn.authorization
  if (json) h['Content-Type'] = 'application/json'
  return h
}

/**
 * Formularios pendientes (`GET /mcp/elicitation`). `available: false` si el motor no tiene la ruta (oficial, externo o anterior:
 * 404/405): la app sigue como antes. Un fallo de red o un 5xx lanza (quien llama decide si lo ignora).
 */
export async function listElicitations(
  conn: ElicitationConn,
  directory?: string,
  fetchImpl: FetchLike = fetch
): Promise<{ available: false } | { available: true; list: ElicitationRequest[] }> {
  const res = await fetchImpl(url(conn, '', directory), { headers: headers(conn, false), signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const body: unknown = await res.json().catch(() => null)
  const items = Array.isArray(body) ? body : []
  const list: ElicitationRequest[] = []
  for (const it of items) {
    const parsed = parseElicitationRequest(it)
    if (parsed) list.push(parsed)
  }
  return { available: true, list }
}

export interface ElicitationFieldIssue {
  campo: string
  motivo: string
}

export type ElicitationReplyResult =
  | { ok: true }
  /** 404: el formulario ya no existe (caducó, se canceló o se contestó en otro lado). La tarjeta debe irse. */
  | { ok: false; gone: true }
  /** 400: el motor no aceptó el contenido; el formulario queda abierto. */
  | { ok: false; invalid: ElicitationFieldIssue[] }
  | { ok: false; error: string }

function issuesOf(body: unknown): ElicitationFieldIssue[] {
  const b = rec(body)
  const candidates = [b.errors, rec(b.data).errors, rec(b.error).errors, rec(rec(b.error).data).errors]
  for (const c of candidates) {
    if (!Array.isArray(c)) continue
    const out: ElicitationFieldIssue[] = []
    for (const e of c.slice(0, ELICITATION_LIMITS.fields)) {
      const r = rec(e)
      if (typeof r.campo === 'string')
        out.push({ campo: r.campo.slice(0, ELICITATION_LIMITS.name), motivo: oneLine(r.motivo, ELICITATION_LIMITS.description) })
    }
    if (out.length) return out
  }
  return []
}

/**
 * Contesta un formulario (`POST /mcp/elicitation/{requestID}/reply`, cuerpo `{ action, content? }`). `content` solo se manda con `accept`.
 * Los valores viajan SOLO a esta ruta del motor local: nunca a logs, eventos ni a la conversación.
 */
export async function replyElicitation(
  conn: ElicitationConn,
  requestID: string,
  action: ElicitationAction,
  content?: Record<string, ElicitationValue>,
  directory?: string,
  fetchImpl: FetchLike = fetch
): Promise<ElicitationReplyResult> {
  let res: Response
  try {
    res = await fetchImpl(url(conn, `/${encodeURIComponent(requestID)}/reply`, directory), {
      method: 'POST',
      headers: headers(conn, true),
      body: JSON.stringify(action === 'accept' ? { action, content: content ?? {} } : { action }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (res.ok) return { ok: true }
  if (res.status === 404) return { ok: false, gone: true }
  if (res.status === 400) {
    const invalid = issuesOf(await res.json().catch(() => null))
    // Un 400 sin detalle por campo igual deja el formulario abierto.
    return { ok: false, invalid }
  }
  return { ok: false, error: `El motor respondió ${res.status}` }
}
