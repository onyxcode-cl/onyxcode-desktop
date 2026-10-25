/**
 * Trabajos en segundo plano del motor propio (comandos `shell` y ejecuciones de Code Mode que cedieron el control, `celda`).
 *
 * Contrato con el motor (plan maestro 1.7, «Contrato motor ↔ app»):
 * - `GET  /experimental/session/{sessionID}/trabajos` → `{ trabajos: [{ id, tipo, titulo, estado, codigo, inicio, fin }] }`.
 * - `POST /experimental/session/{sessionID}/trabajos/{id}/terminar` → `{ ok: boolean }`.
 * - `POST /experimental/session/{sessionID}/trabajos/{id}/reanudar` → `{ ok: true }` o `{ ok: false, motivo }` (solo ayudantes `perdido`).
 * Los ayudantes de fondo (`tipo: "ayudante"`) también salen aquí: vivos como `en_curso`, y tras un reinicio del motor como `perdido`.
 * Este módulo solo describe y normaliza lo que llega; la red la hace main (`src/main/ipc/engine-jobs.ts`).
 */

export const ENGINE_JOB_KINDS = ['shell', 'celda', 'ayudante'] as const
export type EngineJobKind = (typeof ENGINE_JOB_KINDS)[number]

export const ENGINE_JOB_STATES = ['en_curso', 'terminado', 'terminado_por_ti', 'tope_de_vida', 'perdido'] as const
export type EngineJobState = (typeof ENGINE_JOB_STATES)[number]

export interface EngineJob {
  id: string
  kind: EngineJobKind
  title: string
  state: EngineJobState
  /** Código de salida si lo hay. */
  code: number | null
  /** Milisegundos desde 1970. */
  startedAt: number
  /** `null` mientras sigue en curso. */
  endedAt: number | null
}

/** Por qué el motor no reanudó un ayudante perdido. */
export const RESUME_REASONS = ['no_existe', 'ya_en_curso', 'tope'] as const
export type ResumeReason = (typeof RESUME_REASONS)[number]
export type EngineJobResumeResult = { ok: true } | { ok: false; motivo: ResumeReason | null }

/** Normaliza la respuesta de `…/reanudar`: solo `{ok:true}` es éxito; un motivo desconocido se vuelve `null`. */
export function parseResumeResult(body: unknown): EngineJobResumeResult {
  if (!isRec(body)) return { ok: false, motivo: null }
  if (body.ok === true) return { ok: true }
  const m = body.motivo
  return { ok: false, motivo: (RESUME_REASONS as readonly unknown[]).includes(m) ? (m as ResumeReason) : null }
}

/** `available: false` = el motor no tiene la ruta (oficial/externo/anterior): el panel sigue solo con los ayudantes. */
export type EngineJobsResult = { available: true; jobs: EngineJob[] } | { available: false }

/** Tope de trabajos que se aceptan de una respuesta (el contrato dice 50). */
export const ENGINE_JOBS_MAX = 50
const TITLE_MAX = 300

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Normaliza el cuerpo del motor; descarta filas mal formadas en vez de fallar entero. El título es texto, nunca marcado. */
export function parseEngineJobs(body: unknown): EngineJob[] {
  const rows = isRec(body) && Array.isArray(body.trabajos) ? body.trabajos : []
  const out: EngineJob[] = []
  for (const row of rows.slice(0, ENGINE_JOBS_MAX)) {
    if (!isRec(row)) continue
    const { id, tipo, titulo, estado, codigo, inicio, fin } = row
    if (typeof id !== 'string' || !id || id.length > 200) continue
    if (!(ENGINE_JOB_KINDS as readonly unknown[]).includes(tipo)) continue
    if (!(ENGINE_JOB_STATES as readonly unknown[]).includes(estado)) continue
    if (typeof inicio !== 'number' || !Number.isFinite(inicio)) continue
    out.push({
      id,
      kind: tipo as EngineJobKind,
      title: (typeof titulo === 'string' ? titulo : '').slice(0, TITLE_MAX),
      state: estado as EngineJobState,
      code: typeof codigo === 'number' && Number.isFinite(codigo) ? codigo : null,
      startedAt: inicio,
      endedAt: typeof fin === 'number' && Number.isFinite(fin) ? fin : null
    })
  }
  return out
}
