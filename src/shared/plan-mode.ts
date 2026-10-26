/**
 * Modo plan del motor propio (2C, `LAZUNOX.md` «Modo plan para la app»): el agente `plan` termina con `plan_exit`, el motor publica
 * `session.plan.listo` y deja una pregunta pendiente con DOS opciones fijas. Aquí vive la parte pura del cliente: leer el evento, reconocer
 * la pregunta que le corresponde y qué respuesta exacta manda cada botón.
 *
 * Bandera `Settings.modoPlan` (experimental, apagada): la app NO enciende `LAZUNOX_PLAN` al lanzar el motor, así que hoy el evento no llega.
 * El plan es texto de un modelo y de archivos del proyecto: se pinta como TEXTO PLANO (nunca Markdown ni enlaces).
 */
import { plainText } from './mcp-elicitation'

/** Respuestas EXACTAS que espera el motor (`PLAN_OPCIONES`): cualquier otra cosa cuenta como «seguir planificando». */
export const PLAN_APPROVE = 'Aprobar y editar con preguntas'
export const PLAN_KEEP = 'Seguir planificando'

export const PLAN_LIMITS = {
  /** Tope del contenido que manda el motor (48 KB); aquí se repite como defensa. */
  contentChars: 48 * 1024,
  path: 1000,
  id: 200
} as const

export interface PlanReady {
  sessionID: string
  messageID?: string
  /** Id de la llamada a `plan_exit`: enlaza el plan con su pregunta (`tool.callID`). */
  callID?: string
  ruta: string
  rutaAbsoluta: string
  contenido: string
  truncado: boolean
  bytes: number
}

export interface PlanDecided {
  sessionID: string
  callID?: string
  decision: 'aprobado' | 'seguir'
  ruta: string
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const id = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= PLAN_LIMITS.id ? v : undefined)

/** `session.plan.listo` → plan saneado, o `null` si no cumple el contrato (no se muestra nada dudoso). */
export function parsePlanReady(props: unknown): PlanReady | null {
  const p = rec(props)
  const sessionID = id(p.sessionID)
  if (!sessionID) return null
  if (typeof p.contenido !== 'string') return null
  const bytes = typeof p.bytes === 'number' && Number.isFinite(p.bytes) && p.bytes >= 0 ? Math.floor(p.bytes) : 0
  const out: PlanReady = {
    sessionID,
    ruta: plainText(p.ruta, PLAN_LIMITS.path)
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
    rutaAbsoluta: plainText(p.rutaAbsoluta, PLAN_LIMITS.path)
      .replace(/\s*\n\s*/g, ' ')
      .trim(),
    contenido: plainText(p.contenido, PLAN_LIMITS.contentChars),
    truncado: p.truncado === true,
    bytes
  }
  const messageID = id(p.messageID)
  const callID = id(p.callID)
  if (messageID) out.messageID = messageID
  if (callID) out.callID = callID
  return out
}

/** `session.plan.decidido` → decisión, o `null` si está mal formado. */
export function parsePlanDecided(props: unknown): PlanDecided | null {
  const p = rec(props)
  const sessionID = id(p.sessionID)
  if (!sessionID) return null
  if (p.decision !== 'aprobado' && p.decision !== 'seguir') return null
  const out: PlanDecided = { sessionID, decision: p.decision, ruta: plainText(p.ruta, PLAN_LIMITS.path).trim() }
  const callID = id(p.callID)
  if (callID) out.callID = callID
  return out
}

/** Lo mínimo de una pregunta pendiente que hace falta para reconocerla. */
export interface QuestionLike {
  id: string
  sessionID: string
  tool?: { messageID?: string; callID?: string }
  questions: ReadonlyArray<{ options?: ReadonlyArray<{ label?: string }> }>
}

/**
 * ¿Es esta la pregunta del plan? Se reconoce porque su `tool.callID` coincide con el `callID` del evento (misma sesión) Y porque trae las
 * dos opciones fijas: si algo no cuadra, NO se trata como la del plan y sigue como una pregunta genérica (nada se responde a ciegas).
 */
export function isPlanQuestion(q: QuestionLike, plan: Pick<PlanReady, 'sessionID' | 'callID'>): boolean {
  if (!plan.callID || q.sessionID !== plan.sessionID) return false
  if (q.tool?.callID !== plan.callID) return false
  if (q.questions.length !== 1) return false
  const labels = (q.questions[0]?.options ?? []).map((o) => o.label)
  return labels.includes(PLAN_APPROVE) && labels.includes(PLAN_KEEP)
}

/** La pregunta pendiente que corresponde a un plan, o `undefined` (aún no llegó o no cuadra). */
export function findPlanQuestion<Q extends QuestionLike>(plan: PlanReady, questions: readonly Q[]): Q | undefined {
  return questions.find((q) => isPlanQuestion(q, plan))
}

/** Respuesta que manda cada botón (una sola opción, texto exacto). */
export function planAnswers(decision: 'aprobado' | 'seguir'): string[][] {
  return [[decision === 'aprobado' ? PLAN_APPROVE : PLAN_KEEP]]
}

/** Ids de las preguntas que son la del plan de alguna de las tarjetas: la lista genérica de preguntas las oculta. */
export function planQuestionIds(plans: readonly PlanReady[], questions: readonly QuestionLike[]): Set<string> {
  const ids = new Set<string>()
  for (const plan of plans) {
    const q = findPlanQuestion(plan, questions)
    if (q) ids.add(q.id)
  }
  return ids
}
