/** Avance de una tarea en curso, calculado SOLO del turno actual (desde el último mensaje del usuario): qué hace el agente, el plan y los contadores reales. */
import type { Todo, ToolPart } from '@opencode-ai/sdk/v2/client'
import type { MessageEntry } from '../../../lib/session-reducer'
import { parseTodos } from '../../../lib/conversation/parts'
import { plainBash } from './plain-bash'
import { stepKind } from './tool-look'

/** Qué está haciendo el agente ahora, en palabras de la tarjeta (null = ninguna herramienta en curso). */
export type WorkActivity = 'read' | 'write' | 'verify' | 'web' | 'other'
/** Fases sin plan: se derivan de lo que ya se ejecutó, nunca de un porcentaje. */
export type WorkPhase = 'gather' | 'create' | 'review'

export interface WorkStep {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface WorkProgress {
  /** Herramienta que corre ahora mismo (null = el agente está pensando). */
  tool: ToolPart | null
  /** Pasos del plan completados y total (total 0 = no hay plan en pasos). */
  done: number
  total: number
  /** Cuándo empezó este turno (ms; null si no se sabe). */
  startedAt: number | null
  /** Pasos del plan del turno (sin los cancelados) e índice del que está en curso (-1 = ninguno). */
  steps: WorkStep[]
  currentIdx: number
  /** Avance parcial del paso en curso (0 a MAX_PARTIAL): solo herramientas completadas desde el último plan. */
  partial: number
  /** Acciones (herramientas, sin contar el plan) del turno. */
  toolCount: number
  activity: WorkActivity | null
  /** Archivo o nombre asociado a la actividad (vacío si no se sabe). */
  target: string
  phase: WorkPhase
}

/** Tope del avance parcial de un paso: solo el modelo lo completa de verdad al marcarlo «completed». */
export const MAX_PARTIAL = 0.8

/** Entradas del turno actual: desde el último mensaje del usuario (si no hay ninguno, todas). */
export function turnEntries(entries: MessageEntry[]): MessageEntry[] {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.info.role === 'user') return entries.slice(i)
  return entries
}

/** Plan vigente del turno (último `todowrite` desde el último mensaje del usuario); null si el turno aún no publicó plan. */
export function turnTodos(entries: MessageEntry[]): Todo[] | null {
  const te = turnEntries(entries)
  for (let i = te.length - 1; i >= 0; i--) {
    const parts = te[i]!.parts
    for (let j = parts.length - 1; j >= 0; j--) {
      const p = parts[j]!
      if (p.type !== 'tool' || p.tool !== 'todowrite') continue
      const todos = parseTodos(p.state.input?.todos)
      if (todos && todos.length > 0) return todos
    }
  }
  return null
}

/** Curva decreciente: cada herramienta aporta menos que la anterior y nunca pasa del tope. */
export function partialProgress(completedTools: number): number {
  return MAX_PARTIAL * (1 - Math.exp(-Math.max(0, completedTools) / 4))
}

const str = (input: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}
const base = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? ''
const DOC_RE = /([\w.-]+\.(?:xlsx|docx|pptx|pdf|csv|md|txt|html))/gi

/** Actividad de una herramienta: leer / escribir / verificar / web / otra. */
export function toolActivity(p: ToolPart): { activity: WorkActivity; target: string } {
  const input = p.state.input ?? {}
  const kind = stepKind(p.tool)
  if (kind === 'web') return { activity: 'web', target: '' }
  if (kind === 'read') return { activity: 'read', target: base(str(input, 'filePath', 'path')) }
  if (kind === 'create') return { activity: 'write', target: base(str(input, 'filePath', 'path')) }
  if (kind === 'terminal') {
    const cmd = str(input, 'command')
    const id = plainBash(cmd)
    if (id === 'check' || id === 'render') return { activity: 'verify', target: '' }
    if (id === 'excel' || id === 'word' || id === 'ppt' || id === 'pdf') {
      const found = cmd.match(DOC_RE)
      return { activity: 'write', target: found ? (found[found.length - 1] ?? '') : '' }
    }
    if (id === 'look') return { activity: 'read', target: '' }
  }
  return { activity: 'other', target: '' }
}

export function workProgress(allEntries: MessageEntry[]): WorkProgress {
  const entries = turnEntries(allEntries)
  let tool: ToolPart | null = null
  let steps: WorkStep[] = []
  let startedAt: number | null = null
  let toolCount = 0
  let sinceTodo = 0
  let wrote = false
  let verified = false
  for (const e of entries) {
    if (startedAt === null && e.info.role === 'user') startedAt = e.info.time.created
    for (const p of e.parts) {
      if (p.type !== 'tool') continue
      if (p.tool === 'todowrite') {
        const todos = parseTodos(p.state.input?.todos)
        if (todos && todos.length > 0) {
          steps = todos
            .filter((t) => t.status !== 'cancelled')
            .map((t) => ({ content: t.content, status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending' }))
          sinceTodo = 0
        }
        continue
      }
      toolCount++
      const running = p.state.status === 'running' || p.state.status === 'pending'
      if (running) tool = p
      else if (p.state.status === 'completed') sinceTodo++
      const a = toolActivity(p).activity
      if (a === 'write') wrote = true
      else if (wrote && (a === 'verify' || a === 'read')) verified = true
    }
  }
  const done = steps.filter((s) => s.status === 'completed').length
  const currentIdx = steps.findIndex((s) => s.status === 'in_progress')
  const act = tool ? toolActivity(tool) : null
  return {
    tool,
    done,
    total: steps.length,
    startedAt,
    steps,
    currentIdx,
    partial: currentIdx >= 0 ? partialProgress(sinceTodo) : 0,
    toolCount,
    activity: act ? (act.activity === 'read' && wrote ? 'verify' : act.activity) : null,
    target: act && !(act.activity === 'read' && wrote) ? act.target : '',
    phase: verified ? 'review' : wrote ? 'create' : 'gather'
  }
}

/** «1:05» / «0:08» para el reloj del turno. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
