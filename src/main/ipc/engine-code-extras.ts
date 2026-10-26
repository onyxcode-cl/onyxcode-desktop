import http from 'node:http'
import type { IpcMain } from 'electron'
import {
  mergeBudgetMetadata,
  parseBudgetMetadata,
  parseEngineGoal,
  parseGoalBody,
  parseReviewOutput,
  REVIEW_LIMITS,
  type BudgetConfig,
  type BudgetResult,
  type GoalResult,
  type GoalSetRequest,
  type GoalSetResult,
  type ReviewResult
} from '@shared/engine-code-extras'
import { normalizeEngineExperiments } from '@shared/engine-experiments'
import type { CodeExtrasFlags, OpencodeConnection, Settings } from '@shared/types'
import type { OpencodeServer } from '../opencode/server'
import { settingsStore } from '../store'
import { handle, IpcError } from './handle'

/**
 * Objetivo, Presupuesto y Revisar cambios de Code (experimentales, apagados por defecto). El renderer pide por IPC y main habla con el
 * sidecar con `fetch` y la autorización de siempre (como `engine-jobs.ts`). Rutas del motor propio:
 *  - `GET|POST|DELETE /experimental/session/{id}/objetivo` (3A). El objetivo NO inicia turnos: la persona manda su mensaje.
 *  - `GET /session/{id}` + `PATCH /session/{id}` con `metadata.presupuesto` (3B): se reenvían TODAS las claves de `metadata`.
 *  - `POST /session/{id}/command` con `/review` (agente `revisor`, solo lectura). Su salida es NO confiable: se valida aquí.
 * 404/405 en las rutas de objetivo / comando = el motor no las tiene (oficial, externo o anterior): `available: false`.
 */

type Conn = Pick<OpencodeConnection, 'baseUrl' | 'authorization'>
type FetchLike = typeof fetch

const TIMEOUT_MS = 6000
/** `/review` corre un ayudante que lee archivos y piensa: puede tardar varios minutos. */
export const REVIEW_TIMEOUT_MS = 20 * 60_000
/** Tope de cuerpo que se acepta de una respuesta del motor (la lista de mensajes puede ser grande). */
const MAX_BODY_CHARS = 2_000_000

/** Agrega `?directory=…` (y otros parámetros ya codificados) a una URL del sidecar. */
const withQuery = (url: string, directory?: string, extra?: string): string => {
  const parts = [...(directory ? [`directory=${encodeURIComponent(directory)}`] : []), ...(extra ? [extra] : [])]
  return parts.length ? `${url}?${parts.join('&')}` : url
}
const headers = (conn: Conn, json = false): Record<string, string> => ({
  Authorization: conn.authorization,
  ...(json ? { 'Content-Type': 'application/json' } : {})
})
const goalUrl = (conn: Conn, id: string, directory?: string): string =>
  withQuery(`${conn.baseUrl}/experimental/session/${encodeURIComponent(id)}/objetivo`, directory)

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (text.length > MAX_BODY_CHARS) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

// ───────────── Objetivo ─────────────

export async function fetchGoal(
  conn: Conn,
  req: { sessionID: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<GoalResult> {
  const res = await fetchImpl(goalUrl(conn, req.sessionID, req.directory), {
    headers: headers(conn),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  return { available: true, goal: parseGoalBody(await readJson(res)) }
}

export async function setGoal(conn: Conn, req: GoalSetRequest, fetchImpl: FetchLike = fetch): Promise<GoalSetResult> {
  const body: Record<string, unknown> = { condicion: req.condition }
  if (req.verify) body.verificar = req.verify
  if (req.cap !== undefined) body.tope = req.cap
  if (req.resume) body.reanudar = true
  const res = await fetchImpl(goalUrl(conn, req.sessionID, req.directory), {
    method: 'POST',
    headers: headers(conn, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (res.status === 400 || res.status === 409 || res.status === 422)
    return { available: true, ok: false, error: req.resume ? 'final' : 'invalid' }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const json = await readJson(res)
  return { available: true, ok: true, goal: parseGoalBody(json) ?? parseEngineGoal(json) }
}

export async function clearGoal(
  conn: Conn,
  req: { sessionID: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<{ available: boolean; ok: boolean }> {
  const res = await fetchImpl(goalUrl(conn, req.sessionID, req.directory), {
    method: 'DELETE',
    headers: headers(conn),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false, ok: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const body = (await readJson(res)) as { ok?: unknown } | null
  return { available: true, ok: body?.ok === true }
}

// ───────────── Presupuesto ─────────────

/** Metadatos actuales de la sesión (objeto tal cual los guarda el motor). Si la sesión no se puede leer, NO se escribe nada. */
async function readSessionMetadata(conn: Conn, req: { sessionID: string; directory?: string }, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(withQuery(`${conn.baseUrl}/session/${encodeURIComponent(req.sessionID)}`, req.directory), {
    headers: headers(conn),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const body = await readJson(res)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('El motor devolvió una sesión ilegible')
  return (body as { metadata?: unknown }).metadata
}

export async function readBudget(
  conn: Conn,
  req: { sessionID: string; directory?: string },
  fetchImpl: FetchLike = fetch
): Promise<BudgetResult> {
  return { config: parseBudgetMetadata(await readSessionMetadata(conn, req, fetchImpl)) }
}

/**
 * Escribe `metadata.presupuesto` SIN perder las demás claves: lee la sesión, copia todas las existentes y pone la nueva. Devuelve lo que el
 * motor dejó guardado (lo leído de la respuesta del PATCH), no lo que se pidió, para que la vista muestre la verdad.
 */
export async function writeBudget(
  conn: Conn,
  req: { sessionID: string; directory?: string; config: BudgetConfig },
  fetchImpl: FetchLike = fetch
): Promise<BudgetResult> {
  const existing = await readSessionMetadata(conn, req, fetchImpl)
  const metadata = mergeBudgetMetadata(existing, req.config)
  const res = await fetchImpl(withQuery(`${conn.baseUrl}/session/${encodeURIComponent(req.sessionID)}`, req.directory), {
    method: 'PATCH',
    headers: headers(conn, true),
    body: JSON.stringify({ metadata }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const saved = await readJson(res)
  const savedMeta = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as { metadata?: unknown }).metadata : undefined
  // Si la respuesta no trae `metadata`, se relee la sesión para mostrar lo que quedó de verdad.
  const meta = savedMeta !== undefined ? savedMeta : await readSessionMetadata(conn, req, fetchImpl)
  return { config: parseBudgetMetadata(meta) }
}

// ───────────── Revisar cambios ─────────────

/**
 * `fetch` de Node (undici) corta con `HeadersTimeoutError` a los 5 minutos sin recibir cabeceras, aunque el `AbortSignal` diga 20: `/review`
 * no responde hasta que el revisor termina y una revisión lenta pasaba de 5 minutos («No se pudo consultar al motor: fetch failed», con el
 * revisor aún trabajando). Esta versión usa `node:http`, que no tiene ese tope: solo vale el `AbortSignal`. Solo lo que usa `runReview`
 * (método, cabeceras, cuerpo de texto y señal); devuelve una `Response` normal.
 */
export const longFetch: FetchLike = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const signal = init?.signal ?? undefined
    if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error('Cancelado'))
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const hdrs = Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined).entries())
    const body = typeof init?.body === 'string' ? init.body : undefined
    const req = http.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: { ...hdrs, ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          signal?.removeEventListener('abort', onAbort)
          const status = res.statusCode ?? 0
          // Una `Response` no admite cuerpo con estos códigos.
          resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status }))
        })
      }
    )
    const onAbort = (): void => void req.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Cancelado'))
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    req.end(body)
  })

/** Textos de un mensaje del motor (`{ info, parts }`): partes de texto y salida de herramientas (la subtarea del revisor llega así). */
function textsOfMessage(msg: unknown): string[] {
  if (!msg || typeof msg !== 'object') return []
  const parts = (msg as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return []
  const out: string[] = []
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue
    const part = p as { type?: unknown; text?: unknown; state?: { output?: unknown } }
    if (part.type === 'text' && typeof part.text === 'string') out.push(part.text)
    else if (part.type === 'tool' && typeof part.state?.output === 'string') out.push(part.state.output)
  }
  return out.map((t) => t.slice(0, REVIEW_LIMITS.rawText))
}

export async function runReview(
  conn: Conn,
  req: { sessionID: string; directory?: string; model?: string },
  fetchImpl: FetchLike = longFetch,
  timeoutMs: number = REVIEW_TIMEOUT_MS
): Promise<ReviewResult> {
  const res = await fetchImpl(withQuery(`${conn.baseUrl}/session/${encodeURIComponent(req.sessionID)}/command`, req.directory), {
    method: 'POST',
    headers: headers(conn, true),
    body: JSON.stringify({ command: 'review', arguments: '', ...(req.model ? { model: req.model } : {}) }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (res.status === 404 || res.status === 405) return { status: 'unavailable' }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const reply = await readJson(res)
  let parsed = parseReviewOutput(textsOfMessage(reply))
  if (parsed.status === 'ok') return parsed
  // La respuesta del comando puede ser el mensaje del padre sin el informe de la subtarea: se mira también el final de la conversación.
  try {
    const list = await fetchImpl(
      withQuery(`${conn.baseUrl}/session/${encodeURIComponent(req.sessionID)}/message`, req.directory, 'limit=8'),
      {
        headers: headers(conn),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      }
    )
    if (list.ok) {
      const rows = await readJson(list)
      if (Array.isArray(rows)) {
        const texts = rows.slice(-8).flatMap((m) => {
          const role = m && typeof m === 'object' ? (m as { info?: { role?: unknown } }).info?.role : undefined
          return role === 'assistant' ? textsOfMessage(m) : []
        })
        parsed = parseReviewOutput(texts)
      }
    }
  } catch {
    /* sin segunda fuente: queda «ilegible» */
  }
  return parsed
}

/** Lanza `FORBIDDEN` si la función experimental está apagada (valor por defecto). Pura: recibe los ajustes. */
export function assertCodeExtraOn(settings: Pick<Settings, 'engineExperiments'>, flag: keyof CodeExtrasFlags): void {
  if (!normalizeEngineExperiments(settings.engineExperiments).codeExtras[flag])
    throw new IpcError('FORBIDDEN', 'Esta función experimental está apagada en Ajustes')
}

export function registerEngineCodeExtrasHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  const conn = (): Conn => {
    const c = server.getConnection()
    if (!c) throw new IpcError('NOT_READY', 'El motor aún no está listo')
    return c
  }
  /** Cada canal exige su bandera: apagada = el canal responde `FORBIDDEN` aunque alguien lo invoque a mano. */
  const gate = (flag: keyof CodeExtrasFlags): void => assertCodeExtraOn(settingsStore.get(), flag)
  handle(ipcMain, 'goal:get', (req) => (gate('goal'), fetchGoal(conn(), req)))
  handle(ipcMain, 'goal:set', (req) => (gate('goal'), setGoal(conn(), req)))
  handle(ipcMain, 'goal:clear', (req) => (gate('goal'), clearGoal(conn(), req)))
  handle(ipcMain, 'budget:get', (req) => (gate('budget'), readBudget(conn(), req)))
  handle(ipcMain, 'budget:set', (req) => (gate('budget'), writeBudget(conn(), req)))
  handle(ipcMain, 'review:run', (req) => (gate('review'), runReview(conn(), req)))
}
