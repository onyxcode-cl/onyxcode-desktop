/**
 * Tres funciones de Code del motor propio (experimentales, apagadas por defecto: `engineExperiments.codeExtras`):
 *
 *  1. Objetivo: `GET|POST|DELETE /experimental/session/{id}/objetivo` (`LAZUNOX.md` del motor, «Modo objetivo (3A)»).
 *  2. Presupuesto: campo `metadata.presupuesto` de la sesión, escrito con `PATCH /session/{id}` (3B). No está confirmado si el motor
 *     REEMPLAZA o FUSIONA `metadata`: por eso se lee la sesión y se reenvían TODAS las claves existentes (`mergeBudgetMetadata`).
 *  3. Revisar cambios: comando `/review` (agente `revisor`, solo lectura); su salida JSON `findings[]` es NO CONFIABLE y se valida aquí
 *     de forma defensiva (`parseReviewOutput`); se pinta siempre como texto plano.
 *
 * Funciones puras, sin Electron, compartidas por main (red) y renderer (vista). La red la hace `src/main/ipc/engine-code-extras.ts`.
 */

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Quita caracteres de control (menos salto de línea y tabulación) y los de dirección de texto; recorta a `max`. Todo lo que pinta la UI pasa por aquí. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').slice(0, max)
}

// ───────────────────────────── 1. Objetivo ─────────────────────────────

export const GOAL_STATES = ['activo', 'pausado', 'cumplido', 'imposible', 'bloqueado', 'presupuesto_agotado', 'tope'] as const
export type GoalState = (typeof GOAL_STATES)[number]

/** Estados en los que el objetivo ya no sigue solo (el motor deja de continuar). */
export const GOAL_STOPPED_STATES: ReadonlySet<GoalState> = new Set(['pausado', 'bloqueado', 'presupuesto_agotado', 'tope'])
/** El motor no deja reanudar un objetivo cumplido o imposible. */
export const GOAL_NOT_RESUMABLE: ReadonlySet<GoalState> = new Set(['cumplido', 'imposible'])

export const GOAL_LIMITS = { condition: 2000, verify: 1000, capMax: 25, capDefault: 10, reason: 500, output: 1500 } as const

export interface EngineGoal {
  condition: string
  verify?: string
  cap: number
  state: GoalState
  reason?: string
  /** Continuaciones automáticas dadas desde la última vez que habló la persona. */
  iterations: number
  updatedAt: number
  lastVerification?: { code: number | null; output: string }
  lastVerdict?: 'cumplido' | 'imposible' | 'sigue'
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Normaliza el objeto `objetivo` del motor; `null` si no es un objetivo legible. */
export function parseEngineGoal(raw: unknown): EngineGoal | null {
  if (!isRec(raw)) return null
  const state = (GOAL_STATES as readonly unknown[]).includes(raw.estado) ? (raw.estado as GoalState) : null
  const condition = cleanText(raw.condicion, GOAL_LIMITS.condition)
  if (!state || !condition) return null
  const goal: EngineGoal = {
    condition,
    cap: finite(raw.tope) ? Math.max(0, Math.min(GOAL_LIMITS.capMax, Math.trunc(raw.tope))) : GOAL_LIMITS.capDefault,
    state,
    iterations: finite(raw.iteraciones) ? Math.max(0, Math.trunc(raw.iteraciones)) : 0,
    updatedAt: finite(raw.actualizado) ? raw.actualizado : 0
  }
  const verify = cleanText(raw.verificar, GOAL_LIMITS.verify)
  if (verify) goal.verify = verify
  const reason = cleanText(raw.motivo, GOAL_LIMITS.reason)
  if (reason) goal.reason = reason
  if (raw.ultimoVeredicto === 'cumplido' || raw.ultimoVeredicto === 'imposible' || raw.ultimoVeredicto === 'sigue')
    goal.lastVerdict = raw.ultimoVeredicto
  if (isRec(raw.ultimaVerificacion))
    goal.lastVerification = {
      code: finite(raw.ultimaVerificacion.codigo) ? raw.ultimaVerificacion.codigo : null,
      output: cleanText(raw.ultimaVerificacion.salida, GOAL_LIMITS.output)
    }
  return goal
}

/** Cuerpo de `GET …/objetivo` → `{ objetivo: Info | null }`. Cuerpo ilegible = sin objetivo. */
export function parseGoalBody(body: unknown): EngineGoal | null {
  return isRec(body) ? parseEngineGoal(body.objetivo) : null
}

/** `available: false` = el motor no tiene la ruta (oficial/externo/anterior). */
export type GoalResult = { available: true; goal: EngineGoal | null } | { available: false }

export type GoalSetError = 'invalid' | 'final' | 'not_found'
export type GoalSetResult =
  { available: true; ok: true; goal: EngineGoal | null } | { available: true; ok: false; error: GoalSetError } | { available: false }

export interface GoalSetRequest {
  sessionID: string
  directory?: string
  condition: string
  verify?: string
  /** 1 a `GOAL_LIMITS.capMax`; el motor lo acota igual. */
  cap?: number
  /** Reactiva un objetivo pausado/bloqueado/en tope/sin presupuesto (no uno cumplido o imposible). */
  resume?: boolean
}

// ───────────────────────────── 2. Presupuesto ─────────────────────────────

export const BUDGET_LIMITS = {
  tokens: { min: 1000, max: 50_000_000 },
  steps: { min: 1, max: 10_000 },
  minutes: { min: 1, max: 1440 }
} as const

export interface BudgetConfig {
  tokens?: number
  steps?: number
  minutes?: number
  /** «Continuar si se corta»: si la respuesta se corta por largo, el motor la sigue solo (hasta 2 veces por paso). */
  continueOnCut: boolean
}

export const BUDGET_EMPTY: BudgetConfig = { continueOnCut: false }

const positive = (v: unknown, r: { min: number; max: number }): number | undefined =>
  finite(v) && v >= r.min && v <= r.max ? Math.trunc(v) : undefined

/** Lee `metadata.presupuesto` (`{tokens, pasos, minutos, continuar}`). Valores raros se ignoran. */
export function parseBudgetMetadata(metadata: unknown): BudgetConfig {
  const raw = isRec(metadata) ? metadata.presupuesto : undefined
  if (!isRec(raw)) return { ...BUDGET_EMPTY }
  const out: BudgetConfig = { continueOnCut: raw.continuar === true }
  const tokens = positive(raw.tokens, BUDGET_LIMITS.tokens)
  const steps = positive(raw.pasos, BUDGET_LIMITS.steps)
  const minutes = positive(raw.minutos, BUDGET_LIMITS.minutes)
  if (tokens !== undefined) out.tokens = tokens
  if (steps !== undefined) out.steps = steps
  if (minutes !== undefined) out.minutes = minutes
  return out
}

export const budgetIsEmpty = (c: BudgetConfig): boolean =>
  c.tokens === undefined && c.steps === undefined && c.minutes === undefined && !c.continueOnCut

/**
 * `metadata` completo a enviar con `PATCH /session/{id}`: TODAS las claves que la sesión ya tenía (copiadas tal cual) más
 * `presupuesto`. Así da igual si el motor reemplaza o fusiona. Una configuración vacía escribe `presupuesto: {}` (el motor
 * la ignora) en vez de quitar la clave, porque si fusiona, quitarla no la borraría. Se conserva `epoca` si ya había una.
 */
export function mergeBudgetMetadata(existing: unknown, config: BudgetConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (isRec(existing)) for (const k of Object.keys(existing)) if (k !== '__proto__') out[k] = existing[k]
  const presupuesto: Record<string, unknown> = {}
  const prev = isRec(existing) && isRec(existing.presupuesto) ? existing.presupuesto : undefined
  if (!budgetIsEmpty(config)) {
    if (config.tokens !== undefined) presupuesto.tokens = config.tokens
    if (config.steps !== undefined) presupuesto.pasos = config.steps
    if (config.minutes !== undefined) presupuesto.minutos = config.minutes
    if (config.continueOnCut) presupuesto.continuar = true
    if (prev && prev.epoca !== undefined) presupuesto.epoca = prev.epoca
  }
  out.presupuesto = presupuesto
  return out
}

/** Valida lo que escribe la persona (el esquema IPC ya acota; esto es la misma regla para la vista). `null` = valor no válido. */
export function budgetFromInputs(inp: { tokens: string; steps: string; minutes: string; continueOnCut: boolean }): BudgetConfig | null {
  const one = (s: string, r: { min: number; max: number }): number | undefined | null => {
    const v = s.trim()
    if (!v) return undefined
    if (!/^\d{1,9}$/.test(v)) return null
    const n = Number(v)
    return n >= r.min && n <= r.max ? n : null
  }
  const tokens = one(inp.tokens, BUDGET_LIMITS.tokens)
  const steps = one(inp.steps, BUDGET_LIMITS.steps)
  const minutes = one(inp.minutes, BUDGET_LIMITS.minutes)
  if (tokens === null || steps === null || minutes === null) return null
  const out: BudgetConfig = { continueOnCut: inp.continueOnCut }
  if (tokens !== undefined) out.tokens = tokens
  if (steps !== undefined) out.steps = steps
  if (minutes !== undefined) out.minutes = minutes
  return out
}

/** El presupuesto no tiene ruta propia (es un campo de la sesión): no se puede saber si el motor lo aplica; solo el de Lazunox lo hace. */
export interface BudgetResult {
  config: BudgetConfig
}

// ───────────────────────────── 3. Revisar cambios ─────────────────────────────

export const REVIEW_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number]

/** Cotas del esquema del revisor (`agent/revisor.ts` del motor). */
export const REVIEW_LIMITS = { findings: 50, title: 120, body: 2000, file: 500, explanation: 1000, rawText: 400_000 } as const

export interface ReviewFinding {
  title: string
  body: string
  priority: ReviewPriority
  /** 0 a 1. */
  confidence: number
  file: string
  line: number
  lineEnd?: number
}

export interface ReviewReport {
  findings: ReviewFinding[]
  /** `true` = el revisor cree que el cambio es correcto. */
  correct: boolean
  explanation: string
}

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000_000 ? v : null)

/** Valida UN hallazgo; `null` si no cumple (nada de lo que trae el modelo se confía). */
export function parseFinding(raw: unknown): ReviewFinding | null {
  if (!isRec(raw)) return null
  const title = cleanText(raw.title, REVIEW_LIMITS.title).trim()
  const body = cleanText(raw.body, REVIEW_LIMITS.body).trim()
  const file = cleanText(raw.file, REVIEW_LIMITS.file)
    .replace(/[\r\n\t]/g, ' ')
    .trim()
  const line = posInt(raw.line)
  const priority = (REVIEW_PRIORITIES as readonly unknown[]).includes(raw.priority) ? (raw.priority as ReviewPriority) : null
  if (!title || !body || !file || line === null || !priority) return null
  const confidence = finite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0
  const f: ReviewFinding = { title, body, priority, confidence, file, line }
  if (raw.line_end !== undefined) {
    const end = posInt(raw.line_end)
    if (end === null || end < line) return null
    f.lineEnd = end
  }
  return f
}

/** Valida la revisión entera. `skipped` = hallazgos descartados por no cumplir el esquema. `null` si ni el envoltorio vale. */
export function parseReviewObject(raw: unknown): { report: ReviewReport; skipped: number } | null {
  if (!isRec(raw) || !Array.isArray(raw.findings)) return null
  const rows = raw.findings.slice(0, REVIEW_LIMITS.findings)
  const findings: ReviewFinding[] = []
  let skipped = Math.max(0, raw.findings.length - rows.length)
  for (const r of rows) {
    const f = parseFinding(r)
    if (f) findings.push(f)
    else skipped++
  }
  const order = (p: ReviewPriority): number => REVIEW_PRIORITIES.indexOf(p)
  findings.sort((a, b) => order(a.priority) - order(b.priority))
  return {
    report: {
      findings,
      correct: raw.overall_correctness === 'correct',
      explanation: cleanText(raw.overall_explanation, REVIEW_LIMITS.explanation).trim()
    },
    skipped
  }
}

/** Candidatos a JSON dentro de un texto: el texto entero, bloques ```json y objetos `{…}` de llaves equilibradas que mencionan `findings`. */
function jsonCandidates(text: string): unknown[] {
  const out: unknown[] = []
  const tryParse = (s: string): void => {
    try {
      out.push(JSON.parse(s))
    } catch {
      /* no era JSON */
    }
  }
  const t = text.trim()
  tryParse(t)
  for (const m of t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) tryParse(m[1]!.trim())
  // Barrido de llaves equilibradas (respeta cadenas); acotado para no gastar CPU con basura.
  let scanned = 0
  let tries = 0
  for (let i = t.indexOf('{'); i !== -1 && scanned < 20 && tries++ < 200 && out.length < 40; i = t.indexOf('{', i + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let j = i; j < t.length; j++) {
      const c = t[j]!
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        end = j
        break
      }
    }
    if (end === -1) break
    const piece = t.slice(i, end + 1)
    if (piece.includes('"findings"')) {
      scanned++
      tryParse(piece)
      i = end // el siguiente `{` se busca después de este objeto
    }
  }
  return out
}

export type ReviewParse = { status: 'ok'; report: ReviewReport; skipped: number } | { status: 'unreadable' }

/**
 * Busca la revisión en los textos que devolvió el motor (el último primero). Acepta JSON suelto, en bloque ```json o dentro del
 * envoltorio de la subtarea. Si nada cumple el esquema → `unreadable` (la UI lo dice en llano y no inventa nada).
 */
export function parseReviewOutput(texts: readonly string[]): ReviewParse {
  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i]
    if (typeof text !== 'string' || !text.includes('findings')) continue
    for (const cand of jsonCandidates(text.slice(0, REVIEW_LIMITS.rawText))) {
      const parsed = parseReviewObject(cand)
      if (parsed) return { status: 'ok', ...parsed }
    }
  }
  return { status: 'unreadable' }
}

/** Lo que devuelve main al renderer. `unavailable` = el motor no tiene el comando `/review` (oficial o anterior). */
export type ReviewResult = { status: 'unavailable' } | ReviewParse

/** Agrupa por archivo conservando el orden de prioridad del primer hallazgo de cada archivo. */
export function groupFindingsByFile(findings: readonly ReviewFinding[]): { file: string; findings: ReviewFinding[] }[] {
  const map = new Map<string, ReviewFinding[]>()
  for (const f of findings) {
    const list = map.get(f.file)
    if (list) list.push(f)
    else map.set(f.file, [f])
  }
  return [...map].map(([file, list]) => ({ file, findings: list.sort((a, b) => a.line - b.line) }))
}
