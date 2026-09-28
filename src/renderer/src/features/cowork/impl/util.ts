/** Utilidades de presentación del modo Cowork (tiempos, tamaños, estado y etiquetas de pasos). */
import type { Message, Part, PermissionRequest, Session, Todo, ToolPart } from '@opencode-ai/sdk/v2/client'
import type { MessageEntry, SessionRunState } from '../../../stores/sessions'
import { shortenPath } from '../../../lib/paths'
import { computerToolDetail, computerToolInfo, computerToolKind } from './computer-tools'

export function baseName(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

export function extOf(p: string): string {
  const name = baseName(p)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function relTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ayer'
  if (d < 7) return `hace ${d} días`
  return new Date(ts).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** "0:42", "12:05", "1:02:10". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// ───────────────────────────── Estado de la tarea ─────────────────────────────

export type TaskStatus = 'running' | 'waiting' | 'done' | 'error' | 'idle'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  running: 'Trabajando',
  waiting: 'Esperando tu aprobación',
  done: 'Terminado',
  error: 'Error',
  idle: 'Nueva'
}

function lastAssistant(entries: MessageEntry[] | undefined): Message | undefined {
  if (!entries) return undefined
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'assistant') return entries[i].info
  return undefined
}

/** Estado visible de una tarea a partir del run state, permisos pendientes y mensajes. */
export function taskStatus(args: {
  run: SessionRunState | undefined
  waiting: boolean
  error: string | null | undefined
  entries: MessageEntry[] | undefined
}): TaskStatus {
  if (args.waiting) return 'waiting'
  if (args.run && args.run !== 'idle') return 'running'
  if (args.error) return 'error'
  const last = lastAssistant(args.entries)
  if (last && last.role === 'assistant' && last.error && last.error.name !== 'MessageAbortedError') return 'error'
  if (last) return 'done'
  return 'idle'
}

/** ¿El permiso pertenece a la tarea (o a una subtarea suya)? */
export function permissionBelongsTo(p: PermissionRequest, taskId: string, sessions: Record<string, Session>): boolean {
  if (p.sessionID === taskId) return true
  let s = sessions[p.sessionID]
  for (let i = 0; s && i < 5; i++) {
    if (s.parentID === taskId) return true
    s = s.parentID ? sessions[s.parentID] : undefined
  }
  return false
}

/** Inicio y fin del último turno (desde el último mensaje del usuario). */
export function turnTiming(entries: MessageEntry[]): { start: number | null; end: number | null } {
  let start: number | null = null
  let end: number | null = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const info = entries[i].info
    if (info.role === 'assistant' && end === null && info.time.completed) end = info.time.completed
    if (info.role === 'user') {
      start = info.time.created
      break
    }
  }
  return { start, end }
}

// ───────────────────────────── Etiquetas de pasos ─────────────────────────────

function str(input: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

function clip(s: string, n = 60): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

function fileLabel(p: string): string {
  return p ? baseName(p) : ''
}

/** Descripción amigable de una llamada a herramienta: "Leyendo informe.md". */
export function friendlyTool(part: ToolPart): { verb: string; detail: string } {
  const input = part.state.input ?? {}
  const kind = computerToolKind(part.tool)
  if (kind) return { verb: computerToolInfo(kind).label, detail: computerToolDetail(kind, input) }
  const running = part.state.status === 'running' || part.state.status === 'pending'
  const v = (doing: string, done: string): string => (running ? doing : done)
  switch (part.tool) {
    case 'read':
      return { verb: v('Leyendo', 'Leyó'), detail: fileLabel(str(input, 'filePath', 'path')) }
    case 'write':
      return { verb: v('Creando', 'Creó'), detail: fileLabel(str(input, 'filePath', 'path')) }
    case 'edit':
    case 'multiedit':
      return { verb: v('Editando', 'Editó'), detail: fileLabel(str(input, 'filePath', 'path')) }
    case 'patch':
    case 'apply_patch':
      return { verb: v('Aplicando cambios', 'Aplicó cambios'), detail: '' }
    case 'list':
      return { verb: v('Explorando', 'Exploró'), detail: shortenPath(str(input, 'path')) || 'la carpeta' }
    case 'glob':
      return { verb: v('Buscando archivos', 'Buscó archivos'), detail: str(input, 'pattern') }
    case 'grep':
      return { verb: v('Buscando texto', 'Buscó texto'), detail: clip(str(input, 'pattern'), 40) }
    case 'bash': {
      const desc = str(input, 'description')
      return { verb: v('Ejecutando', 'Ejecutó'), detail: desc ? clip(desc) : clip(str(input, 'command')) }
    }
    case 'webfetch':
      return { verb: v('Consultando', 'Consultó'), detail: clip(str(input, 'url'), 50) }
    case 'websearch':
      return { verb: v('Buscando en la web', 'Buscó en la web'), detail: clip(str(input, 'query'), 50) }
    case 'todowrite':
      return { verb: 'Actualizó el plan', detail: '' }
    case 'task':
      return { verb: v('Delegando subtarea', 'Subtarea'), detail: clip(str(input, 'description', 'prompt')) }
    case 'question':
      return { verb: 'Pregunta', detail: '' }
    default: {
      const title = 'title' in part.state && part.state.title ? part.state.title : ''
      return { verb: part.tool.replace(/_/g, ' '), detail: clip(shortenPath(title || str(input, 'description', 'path', 'url'))) }
    }
  }
}

// ───────────────────────────── Pasos por etapa del plan ─────────────────────────────

export interface StepGroup {
  /** Paso del plan activo en ese momento (null = antes de planificar). */
  title: string | null
  tools: ToolPart[]
}

function todosFrom(part: ToolPart): Todo[] | null {
  const raw = part.state.input?.todos
  if (!Array.isArray(raw)) return null
  return raw.filter((t): t is Todo => !!t && typeof t === 'object' && typeof (t as Todo).content === 'string')
}

/** Agrupa las herramientas de la tarea según el paso del plan que estaba "in_progress". */
export function groupActivityBySteps(entries: MessageEntry[]): StepGroup[] {
  const groups: StepGroup[] = []
  let current: StepGroup | null = null
  const push = (title: string | null): StepGroup => {
    const g: StepGroup = { title, tools: [] }
    groups.push(g)
    return g
  }
  for (const e of entries) {
    for (const p of e.parts) {
      if (p.type !== 'tool') continue
      if (p.tool === 'todowrite') {
        const todos = todosFrom(p)
        const active = todos?.find((t) => t.status === 'in_progress')?.content ?? null
        if (active && active !== current?.title) current = push(active)
        continue
      }
      if (!current) current = push(null)
      current.tools.push(p)
    }
  }
  return groups.filter((g) => g.tools.length > 0)
}

/** ¿La parte es "texto visible" del asistente? */
export function isVisibleText(p: Part): p is Extract<Part, { type: 'text' }> {
  return p.type === 'text' && !p.synthetic && !p.ignored && !!p.text.trim()
}
