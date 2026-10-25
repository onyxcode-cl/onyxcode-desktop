/**
 * Rebobinar por turno (motor propio, plan `docs/PLAN-REBOBINAR-Y-COMPACTACION.md`, 2.A y fase R3). Cinco rutas que el SDK fijado NO trae,
 * así que se llaman con `fetch` crudo (igual que los trabajos y los formularios de conectores):
 *
 *  - `GET  /experimental/session/{id}/turnos?antesDe=&limite=`            lista ligera de turnos con sus archivos
 *  - `GET  /experimental/session/{id}/turnos/{messageID}/diff?file=`     parche de un archivo de un turno
 *  - `GET  /experimental/session/{id}/rebobinar/{messageID}`             revisión previa (solo lectura)
 *  - `POST /experimental/session/{id}/rebobinar`                         `{ messageID, modo, sobrescribir? }`
 *  - `POST /experimental/session/{id}/rebobinar/deshacer`                `{ sobrescribir? }`
 *
 * Funciones puras, sin Electron ni DOM, compartidas por el adaptador del motor y por el store de Code.
 *
 * TODO lo que llega del motor se trata como NO confiable: los nombres de archivo, los asuntos de commit y los títulos de ayudantes los
 * escribe el proyecto o un tercero. Los parseadores descartan lo que no encaja con el contrato, acotan las listas y limpian el texto (sin
 * caracteres de control ni de dirección). La interfaz los muestra SIEMPRE como texto plano: sin Markdown, sin HTML y sin enlaces activos.
 * Nada de esto toca el disco: quien restaura archivos es el motor (nunca fuera del proyecto, ver `docs/SEGURIDAD.md`, «Rebobinar por turno»).
 */
import { plainText } from './mcp-elicitation'

export type TurnFileStatus = 'added' | 'deleted' | 'modified'
/** `herramienta`: lo editó una herramienta de edición; `comando`: el turno corrió comandos (puede no verse completo); `otro`: persona, ayudante de fondo u otro proceso. */
export type TurnOrigin = 'herramienta' | 'comando' | 'otro'
export type TurnNotRestorableReason = 'sin-git' | 'sin-instantaneas' | 'caducado'
export type RewindMode = 'todo' | 'conversacion' | 'codigo'
export type RewindBlocked = 'ocupada' | 'hija-ocupada' | 'trabajo-vivo' | 'pendiente'
export type RewindConflictReason =
  | 'ocupada'
  | 'hija-ocupada'
  | 'trabajo-vivo'
  | 'pendiente'
  | 'caducado'
  | 'sin-git'
  | 'sin-instantaneas'
  | 'revert-pendiente'
  | 'nada-que-deshacer'

export interface TurnFile {
  file: string
  status: TurnFileStatus
  additions: number
  deletions: number
  origen: TurnOrigin
}

export interface TurnSummary {
  messageID: string
  time: number
  files: TurnFile[]
  truncated: boolean
  restaurable: boolean
  motivo?: TurnNotRestorableReason
}

export interface TurnFileDiff {
  file: string
  status: TurnFileStatus
  additions: number
  deletions: number
  patch: string
  binary: boolean
  truncated: boolean
}

export interface RewindCommit {
  hash: string
  asunto: string
}

export interface RewindHelper {
  tipo: 'sesion' | 'ayudante' | 'shell' | 'celda'
  id: string
  titulo: string
}

export interface RewindReview {
  archivos: TurnFile[]
  conflictos: string[]
  protegidos: string[]
  comandos: boolean
  commitsDespues: RewindCommit[]
  ayudantesActivos: RewindHelper[]
  mensajes: number
  restaurable: boolean
  motivo?: TurnNotRestorableReason
  bloqueado?: RewindBlocked
}

export interface RewindSkipped {
  file: string
  motivo: string
}

export interface RewindResult {
  modo: RewindMode
  restaurados: string[]
  borrados: string[]
  omitidos: RewindSkipped[]
  mensajesOcultos: number
  puedeDeshacer: boolean
}

export interface UndoRewindResult {
  restaurados: string[]
  borrados: string[]
  omitidos: RewindSkipped[]
  conflictos: string[]
}

/** Topes defensivos (el motor ya aplica los suyos; esto cubre un motor distinto o una respuesta manipulada). */
export const REWIND_LIMITS = {
  turns: 100,
  files: 500,
  paths: 500,
  commits: 50,
  helpers: 50,
  path: 1000,
  subject: 200,
  title: 200,
  patch: 1_000_000
} as const

const STATUSES: ReadonlySet<string> = new Set(['added', 'deleted', 'modified'])
const ORIGINS: ReadonlySet<string> = new Set(['herramienta', 'comando', 'otro'])
const NOT_RESTORABLE: ReadonlySet<string> = new Set(['sin-git', 'sin-instantaneas', 'caducado'])
const BLOCKED: ReadonlySet<string> = new Set(['ocupada', 'hija-ocupada', 'trabajo-vivo', 'pendiente'])
const CONFLICT_REASONS: ReadonlySet<string> = new Set([
  'ocupada',
  'hija-ocupada',
  'trabajo-vivo',
  'pendiente',
  'caducado',
  'sin-git',
  'sin-instantaneas',
  'revert-pendiente',
  'nada-que-deshacer'
])
const HELPER_KINDS: ReadonlySet<string> = new Set(['sesion', 'ayudante', 'shell', 'celda'])
const MODES: ReadonlySet<string> = new Set(['todo', 'conversacion', 'codigo'])

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** Texto de una sola línea y plano. */
function oneLine(v: unknown, max: number): string {
  return plainText(v, max)
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

/** Ruta mostrable: texto plano de una línea. Una ruta vacía se descarta. */
function pathOf(v: unknown): string {
  return oneLine(v, REWIND_LIMITS.path)
}

function pathList(v: unknown, max: number = REWIND_LIMITS.paths): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const it of v.slice(0, max)) {
    const p = pathOf(it)
    if (p) out.push(p)
  }
  return out
}

function parseFile(raw: unknown): TurnFile | null {
  const r = rec(raw)
  const file = pathOf(r.file)
  if (!file) return null
  const status = typeof r.status === 'string' && STATUSES.has(r.status) ? (r.status as TurnFileStatus) : 'modified'
  const origen = typeof r.origen === 'string' && ORIGINS.has(r.origen) ? (r.origen as TurnOrigin) : 'otro'
  return { file, status, additions: count(r.additions), deletions: count(r.deletions), origen }
}

function parseFiles(v: unknown): TurnFile[] {
  if (!Array.isArray(v)) return []
  const out: TurnFile[] = []
  for (const it of v.slice(0, REWIND_LIMITS.files)) {
    const f = parseFile(it)
    if (f) out.push(f)
  }
  return out
}

export function parseTurn(raw: unknown): TurnSummary | null {
  const r = rec(raw)
  if (typeof r.messageID !== 'string' || !r.messageID) return null
  const turn: TurnSummary = {
    messageID: r.messageID,
    time: typeof r.time === 'number' && Number.isFinite(r.time) ? r.time : 0,
    files: parseFiles(r.files),
    truncated: r.truncated === true,
    // Sin la marca explícita no se promete deshacer archivos.
    restaurable: r.restaurable === true
  }
  if (typeof r.motivo === 'string' && NOT_RESTORABLE.has(r.motivo)) turn.motivo = r.motivo as TurnNotRestorableReason
  return turn
}

export function parseTurns(raw: unknown): TurnSummary[] {
  if (!Array.isArray(raw)) return []
  const out: TurnSummary[] = []
  for (const it of raw.slice(-REWIND_LIMITS.turns)) {
    const t = parseTurn(it)
    if (t) out.push(t)
  }
  return out
}

export function parseTurnDiff(raw: unknown): TurnFileDiff | null {
  const r = rec(raw)
  const file = pathOf(r.file)
  if (!file) return null
  const patch = typeof r.patch === 'string' ? r.patch.slice(0, REWIND_LIMITS.patch) : ''
  return {
    file,
    status: typeof r.status === 'string' && STATUSES.has(r.status) ? (r.status as TurnFileStatus) : 'modified',
    additions: count(r.additions),
    deletions: count(r.deletions),
    patch,
    binary: r.binary === true,
    truncated: r.truncated === true || (typeof r.patch === 'string' && r.patch.length > REWIND_LIMITS.patch)
  }
}

export function parseReview(raw: unknown): RewindReview | null {
  const r = rec(raw)
  if (typeof r.restaurable !== 'boolean') return null
  const commits: RewindCommit[] = []
  if (Array.isArray(r.commitsDespues)) {
    for (const c of r.commitsDespues.slice(0, REWIND_LIMITS.commits)) {
      const rc = rec(c)
      const hash = oneLine(rc.hash, 40)
      if (hash) commits.push({ hash, asunto: oneLine(rc.asunto, REWIND_LIMITS.subject) })
    }
  }
  const helpers: RewindHelper[] = []
  if (Array.isArray(r.ayudantesActivos)) {
    for (const h of r.ayudantesActivos.slice(0, REWIND_LIMITS.helpers)) {
      const rh = rec(h)
      if (typeof rh.tipo !== 'string' || !HELPER_KINDS.has(rh.tipo)) continue
      helpers.push({
        tipo: rh.tipo as RewindHelper['tipo'],
        id: oneLine(rh.id, 200),
        titulo: oneLine(rh.titulo, REWIND_LIMITS.title)
      })
    }
  }
  const review: RewindReview = {
    archivos: parseFiles(r.archivos),
    conflictos: pathList(r.conflictos),
    protegidos: pathList(r.protegidos),
    comandos: r.comandos === true,
    commitsDespues: commits,
    ayudantesActivos: helpers,
    mensajes: count(r.mensajes),
    restaurable: r.restaurable
  }
  if (typeof r.motivo === 'string' && NOT_RESTORABLE.has(r.motivo)) review.motivo = r.motivo as TurnNotRestorableReason
  if (typeof r.bloqueado === 'string' && BLOCKED.has(r.bloqueado)) review.bloqueado = r.bloqueado as RewindBlocked
  return review
}

function skipped(v: unknown): RewindSkipped[] {
  if (!Array.isArray(v)) return []
  const out: RewindSkipped[] = []
  for (const it of v.slice(0, REWIND_LIMITS.paths)) {
    const r = rec(it)
    const file = pathOf(r.file)
    if (file) out.push({ file, motivo: oneLine(r.motivo, 60) })
  }
  return out
}

export function parseRewindResult(raw: unknown): RewindResult | null {
  const r = rec(raw)
  if (typeof r.modo !== 'string' || !MODES.has(r.modo)) return null
  return {
    modo: r.modo as RewindMode,
    restaurados: pathList(r.restaurados),
    borrados: pathList(r.borrados),
    omitidos: skipped(r.omitidos),
    mensajesOcultos: count(r.mensajesOcultos),
    puedeDeshacer: r.puedeDeshacer === true
  }
}

export function parseUndoResult(raw: unknown): UndoRewindResult {
  const r = rec(raw)
  return {
    restaurados: pathList(r.restaurados),
    borrados: pathList(r.borrados),
    omitidos: skipped(r.omitidos),
    conflictos: pathList(r.conflictos)
  }
}

// ───────────────────────────── cálculos puros ─────────────────────────────

export function turnTotals(files: readonly TurnFile[]): { files: number; additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { files: files.length, additions, deletions }
}

/** ¿Algún archivo del turno salió de un comando? (la tarjeta avisa que la lista puede estar incompleta). */
export function turnHasCommandOrigin(files: readonly TurnFile[]): boolean {
  return files.some((f) => f.origen === 'comando')
}

/**
 * Qué modos se ofrecen. Sin soporte de archivos (carpeta sin git, sin instantáneas, punto caducado) o con la revisión bloqueada para el
 * código, solo «conversación»: el diálogo lo dice sin prometer deshacer archivos.
 */
export function availableModes(review: Pick<RewindReview, 'restaurable'>): RewindMode[] {
  return review.restaurable ? ['todo', 'conversacion', 'codigo'] : ['conversacion']
}

/**
 * Rutas que se mandan en `sobrescribir`: SOLO las que la persona marcó y que de verdad son conflicto o protegida en la revisión
 * (una ruta inventada o ya resuelta nunca viaja). Orden estable, sin repetidos.
 */
export function overwriteSelection(review: Pick<RewindReview, 'conflictos' | 'protegidos'>, marked: ReadonlySet<string>): string[] {
  const allowed = new Set([...review.conflictos, ...review.protegidos])
  return [...allowed].filter((p) => marked.has(p))
}

/** Archivos que se restaurarán de verdad: los de la revisión menos los que se saltan (conflictos y protegidos sin marcar). */
export function filesToRestore(
  review: Pick<RewindReview, 'archivos' | 'conflictos' | 'protegidos'>,
  overwrite: readonly string[]
): TurnFile[] {
  const risky = new Set([...review.conflictos, ...review.protegidos])
  const forced = new Set(overwrite)
  return review.archivos.filter((f) => !risky.has(f.file) || forced.has(f.file))
}

// ───────────────────────────── rutas del motor (fetch crudo) ─────────────────────────────

export interface RewindConn {
  baseUrl: string
  /** Valor completo de la cabecera `Authorization`. */
  authorization?: string
}

type FetchLike = typeof fetch

const TIMEOUT_MS = 20_000

function url(conn: RewindConn, sessionID: string, tail: string, query: Record<string, string | number | undefined>): string {
  const q = Object.entries(query)
    .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  return `${conn.baseUrl.replace(/\/+$/, '')}/experimental/session/${encodeURIComponent(sessionID)}${tail}${q ? `?${q}` : ''}`
}

function headers(conn: RewindConn, json: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (conn.authorization) h.Authorization = conn.authorization
  if (json) h['Content-Type'] = 'application/json'
  return h
}

/** Un 409 trae `{ motivo, message }`; el motivo se valida contra la lista del contrato. */
async function conflictOf(res: Response): Promise<{ motivo: RewindConflictReason | null; message: string }> {
  const body = rec(await res.json().catch(() => null))
  const inner = rec(body.error)
  const motivoRaw = body.motivo ?? inner.motivo
  const messageRaw = body.message ?? inner.message
  const motivo = typeof motivoRaw === 'string' && CONFLICT_REASONS.has(motivoRaw) ? (motivoRaw as RewindConflictReason) : null
  return { motivo, message: oneLine(messageRaw, 300) }
}

export type RewindFailure =
  /** 404/405: el motor no tiene estas rutas (oficial, externo, anterior o `LAZUNOX_REBOBINAR=0`): se sigue con «Revertir» de siempre. */
  | { ok: false; kind: 'unavailable' }
  /** 409: el motor se negó (sesión ocupada, caducado, sin git…). */
  | { ok: false; kind: 'conflict'; motivo: RewindConflictReason | null; message: string }
  /** 400: petición no válida (p. ej. el mensaje no es de la persona). */
  | { ok: false; kind: 'invalid'; message: string }
  | { ok: false; kind: 'error'; error: string }

async function failureOf(res: Response): Promise<RewindFailure> {
  if (res.status === 404 || res.status === 405) return { ok: false, kind: 'unavailable' }
  if (res.status === 409) return { ok: false, kind: 'conflict', ...(await conflictOf(res)) }
  if (res.status === 400) {
    const body = rec(await res.json().catch(() => null))
    return { ok: false, kind: 'invalid', message: oneLine(body.message ?? rec(body.error).message, 300) }
  }
  return { ok: false, kind: 'error', error: `El motor respondió ${res.status}` }
}

function errorOf(err: unknown): RewindFailure {
  return { ok: false, kind: 'error', error: err instanceof Error ? err.message : String(err) }
}

/** Turnos de la sesión. `available: false` si el motor no tiene la ruta. Un fallo de red o un 5xx lanza (quien llama decide). */
export async function listTurns(
  conn: RewindConn,
  req: { sessionID: string; directory?: string; antesDe?: string; limite?: number },
  fetchImpl: FetchLike = fetch
): Promise<{ available: false } | { available: true; turns: TurnSummary[] }> {
  const res = await fetchImpl(url(conn, req.sessionID, '/turnos', { directory: req.directory, antesDe: req.antesDe, limite: req.limite }), {
    headers: headers(conn, false),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  return { available: true, turns: parseTurns(await res.json().catch(() => null)) }
}

export type TurnDiffResult = { ok: true; diff: TurnFileDiff } | RewindFailure

/** Parche de un archivo de un turno (bajo demanda, contexto 3, tope 1 MB en el motor). */
export async function fetchTurnDiff(
  conn: RewindConn,
  req: { sessionID: string; messageID: string; file: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<TurnDiffResult> {
  try {
    const res = await fetchImpl(
      url(conn, req.sessionID, `/turnos/${encodeURIComponent(req.messageID)}/diff`, { directory: req.directory, file: req.file }),
      { headers: headers(conn, false), signal: AbortSignal.timeout(TIMEOUT_MS) }
    )
    if (!res.ok) return await failureOf(res)
    const diff = parseTurnDiff(await res.json().catch(() => null))
    return diff ? { ok: true, diff } : { ok: false, kind: 'error', error: 'Respuesta no válida del motor' }
  } catch (err) {
    return errorOf(err)
  }
}

export type RewindReviewResult = { ok: true; review: RewindReview } | RewindFailure

/** Revisión previa (solo lectura): qué se restauraría, qué choca y qué lo bloquea. */
export async function fetchRewindReview(
  conn: RewindConn,
  req: { sessionID: string; messageID: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<RewindReviewResult> {
  try {
    const res = await fetchImpl(url(conn, req.sessionID, `/rebobinar/${encodeURIComponent(req.messageID)}`, { directory: req.directory }), {
      headers: headers(conn, false),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return await failureOf(res)
    const review = parseReview(await res.json().catch(() => null))
    return review ? { ok: true, review } : { ok: false, kind: 'error', error: 'Respuesta no válida del motor' }
  } catch (err) {
    return errorOf(err)
  }
}

export type RewindOutcome = { ok: true; result: RewindResult } | RewindFailure

/**
 * Rebobina. `sobrescribir` lleva SOLO lo que la persona marcó; vacío = el motor se salta conflictos y rutas protegidas.
 * Sin tiempo de espera corto: restaurar muchos archivos puede tardar.
 */
export async function postRewind(
  conn: RewindConn,
  req: { sessionID: string; messageID: string; modo: RewindMode; sobrescribir?: readonly string[]; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<RewindOutcome> {
  try {
    const body: Record<string, unknown> = { messageID: req.messageID, modo: req.modo }
    // Con «solo la conversación» no se toca ningún archivo: nunca se manda `sobrescribir`.
    if (req.modo !== 'conversacion' && req.sobrescribir && req.sobrescribir.length > 0) body.sobrescribir = [...req.sobrescribir]
    const res = await fetchImpl(url(conn, req.sessionID, '/rebobinar', { directory: req.directory }), {
      method: 'POST',
      headers: headers(conn, true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) return await failureOf(res)
    const result = parseRewindResult(await res.json().catch(() => null))
    return result ? { ok: true, result } : { ok: false, kind: 'error', error: 'Respuesta no válida del motor' }
  } catch (err) {
    return errorOf(err)
  }
}

export type UndoOutcome = { ok: true; result: UndoRewindResult } | RewindFailure

/** Deshace el último rebobinado, solo en los archivos que tocó. */
export async function postUndoRewind(
  conn: RewindConn,
  req: { sessionID: string; sobrescribir?: readonly string[]; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<UndoOutcome> {
  try {
    const body: Record<string, unknown> = {}
    if (req.sobrescribir && req.sobrescribir.length > 0) body.sobrescribir = [...req.sobrescribir]
    const res = await fetchImpl(url(conn, req.sessionID, '/rebobinar/deshacer', { directory: req.directory }), {
      method: 'POST',
      headers: headers(conn, true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) return await failureOf(res)
    return { ok: true, result: parseUndoResult(await res.json().catch(() => null)) }
  } catch (err) {
    return errorOf(err)
  }
}
