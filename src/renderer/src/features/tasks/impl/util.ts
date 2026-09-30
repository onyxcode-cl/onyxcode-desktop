/** Utilidades de presentación del modo Tareas (tiempos, tamaños, estado y etiquetas de pasos). */
import type { Message, Part, PermissionRequest, Session, ToolPart } from '@opencode-ai/sdk/v2/client'
import { MAIN_SOURCE, type MessageEntry, type SessionRunState } from '../../../stores/sessions'
import type { ConvError } from '../../../lib/session-reducer'
import { parseTodos } from '../../../lib/conversation/parts'
import { shortenPath } from '../../../lib/paths'
import { computerToolDetail, computerToolInfo, computerToolKind } from './computer-tools'

/** ¿El origen de una sesión es un servidor de Tareas (cualquiera)? Chat/Code usan el origen principal (ausente). */
export function isTasksSource(src: string | undefined): boolean {
  return !!src && src !== MAIN_SOURCE
}

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

export type TaskStatus = 'running' | 'using_computer' | 'plan_ready' | 'waiting' | 'question' | 'done' | 'error' | 'idle' | 'archived'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  running: 'Trabajando',
  using_computer: 'Usando el Mac',
  plan_ready: 'Plan listo para revisar',
  waiting: 'Esperando tu aprobación',
  question: 'Esperando tu respuesta',
  done: 'Terminado',
  error: 'Error',
  idle: 'Nueva',
  archived: 'Archivada'
}

function lastAssistant(entries: MessageEntry[] | undefined): Message | undefined {
  if (!entries) return undefined
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'assistant') return entries[i].info
  return undefined
}

/**
 * ¿La sesión está archivada? Igual que `time.archived`, salvo que el respaldo de "Restaurar"
 * (`metadata.unarchivedAt`, cuando el servidor no acepta `archived: 0`) sea posterior al archivado.
 */
export function isArchivedSession(s: Pick<Session, 'time' | 'metadata'>): boolean {
  const archived = s.time.archived
  if (!archived) return false
  const back = s.metadata?.unarchivedAt
  return !(typeof back === 'number' && back > archived)
}

/**
 * Estado visible de una tarea a partir del run state, permisos/preguntas pendientes y mensajes.
 * Prioridad: archived > plan_ready > question > waiting > using_computer > running > error > done/idle.
 */
export function taskStatus(args: {
  run: SessionRunState | undefined
  waiting: boolean
  hasQuestion?: boolean
  error: ConvError | null | undefined
  entries: MessageEntry[] | undefined
  /** Control total: el agente está actuando sobre el Mac ahora mismo. */
  usingComputer?: boolean
  /** Control total: hay un plan esperando tu aprobación. */
  planPending?: boolean
  archived?: boolean
  /** Estado terminal que la tarea tenía al desalojarse su historial (`evictedStatusOf`); solo se usa sin `entries`. */
  evicted?: TaskStatus
}): TaskStatus {
  if (args.archived) return 'archived'
  if (args.planPending) return 'plan_ready'
  if (args.hasQuestion) return 'question'
  if (args.waiting) return 'waiting'
  const running = !!args.run && args.run !== 'idle'
  if (running && args.usingComputer) return 'using_computer'
  if (running) return 'running'
  if (args.error) return 'error'
  // Historial desalojado (LRU): no degradar a «done» una tarea que terminó con error.
  if (!args.entries && args.evicted) return args.evicted
  const last = lastAssistant(args.entries)
  if (last && last.role === 'assistant' && last.error && last.error.name !== 'MessageAbortedError') return 'error'
  if (last) return 'done'
  // Sin mensajes cargados (tarea antigua en la lista) ⇒ se asume terminada.
  return args.entries && args.entries.length === 0 ? 'idle' : 'done'
}

// F7-B35: estado terminal de las tareas cuyo historial se desalojó (sin historial no se puede recalcular).
const evictedStatus = new Map<string, TaskStatus>()

/** Guarda (o borra) el estado terminal de una tarea al desalojarse su historial; solo se conserva `error`. */
export function rememberEvictedStatus(id: string, entries: MessageEntry[]): void {
  const st = taskStatus({ run: 'idle', waiting: false, error: null, entries })
  if (st === 'error') evictedStatus.set(id, st)
  else evictedStatus.delete(id)
}

export function evictedStatusOf(id: string): TaskStatus | undefined {
  return evictedStatus.get(id)
}

/** ¿Una sesión (permiso, pregunta…) pertenece a la tarea (o a una subtarea suya)? */
export function sessionBelongsTo(sessionID: string, taskId: string, sessions: Record<string, Session>): boolean {
  if (sessionID === taskId) return true
  let s: Session | undefined = sessions[sessionID]
  for (let i = 0; s && i < 5; i++) {
    if (s.parentID === taskId) return true
    s = s.parentID ? sessions[s.parentID] : undefined
  }
  return false
}

/** ¿El permiso pertenece a la tarea (o a una subtarea suya)? */
export function permissionBelongsTo(p: PermissionRequest, taskId: string, sessions: Record<string, Session>): boolean {
  return sessionBelongsTo(p.sessionID, taskId, sessions)
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

// ───────────────────────────── Borrado bloqueado por el sandbox ─────────────────────────────

const OPERATION_NOT_PERMITTED_RE = /operation not permitted/i

/** ¿Esta parte de herramienta parece un `rm`/`unlink` bloqueado por el sandbox (Seatbelt, EPERM)? */
export function looksLikeBlockedDelete(part: ToolPart): boolean {
  if (part.tool !== 'bash') return false
  const text = part.state.status === 'completed' ? part.state.output : part.state.status === 'error' ? part.state.error : ''
  return !!text && OPERATION_NOT_PERMITTED_RE.test(text)
}

// ───────────────────────────── Pasos por etapa del plan ─────────────────────────────

export interface StepGroup {
  /** Paso del plan activo en ese momento (null = antes de planificar). */
  title: string | null
  tools: ToolPart[]
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
        const todos = parseTodos(p.state.input?.todos)
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

// ───────────────────────────── Panel de contexto (item 2) ─────────────────────────────

/** Una entrada del panel "Contexto": clic ⇒ hace scroll hasta donde ocurrió en la conversación. */
export interface ContextItem {
  label: string
  sub?: string
  partId: string
}

export interface ContextGroups {
  filesRead: ContextItem[]
  filesWritten: ContextItem[]
  commands: ContextItem[]
  web: ContextItem[]
  /** Herramientas de MCP/conectores (no reconocidas como herramientas de archivo del sistema). */
  connectors: ContextItem[]
}

const FILE_READ_TOOLS = new Set(['read', 'list', 'glob', 'grep'])
const FILE_WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'patch', 'apply_patch'])
const KNOWN_TOOLS = new Set([...FILE_READ_TOOLS, ...FILE_WRITE_TOOLS, 'bash', 'webfetch', 'websearch', 'todowrite', 'question', 'task'])

/** Agrupa la actividad de la tarea por tipo (archivos leídos/escritos, comandos, web, conectores). */
export function buildContext(entries: MessageEntry[]): ContextGroups {
  const filesRead = new Map<string, string>()
  const filesWritten = new Map<string, string>()
  const commands: ContextItem[] = []
  const web: ContextItem[] = []
  const connectors: ContextItem[] = []
  for (const e of entries) {
    for (const p of e.parts) {
      if (p.type !== 'tool') continue
      if (computerToolKind(p.tool)) continue // ya se ve en "Control del Mac"
      const input = p.state.input ?? {}
      if (FILE_READ_TOOLS.has(p.tool)) {
        const path = str(input, 'filePath', 'path')
        if (path) filesRead.set(path, p.id)
        continue
      }
      if (FILE_WRITE_TOOLS.has(p.tool)) {
        const path = str(input, 'filePath', 'path')
        if (path) filesWritten.set(path, p.id)
        continue
      }
      if (p.tool === 'bash') {
        const label = str(input, 'description') || str(input, 'command')
        if (label) commands.push({ label: clip(label, 70), partId: p.id })
        continue
      }
      if (p.tool === 'webfetch' || p.tool === 'websearch') {
        const label = str(input, 'url') || str(input, 'query')
        web.push({ label: clip(label, 60) || (p.tool === 'webfetch' ? 'Página web' : 'Búsqueda web'), partId: p.id })
        continue
      }
      if (!KNOWN_TOOLS.has(p.tool)) {
        const { verb, detail } = friendlyTool(p)
        connectors.push({ label: verb, sub: detail || undefined, partId: p.id })
      }
    }
  }
  return {
    filesRead: [...filesRead].map(([path, partId]) => ({ label: baseName(path), sub: path, partId })),
    filesWritten: [...filesWritten].map(([path, partId]) => ({ label: baseName(path), sub: path, partId })),
    commands,
    web,
    connectors
  }
}

// ───────────────────────────── Carpetas pedidas por el agente ─────────────────────────────

/** Quita el `/*` (o `/`) final de un patrón de `external_directory` para quedarse con la carpeta. */
function stripGlob(p: string): string {
  let out = p.trim().replace(/\/\*+$/, '')
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** Carpeta personal inferida de una ruta absoluta (`/Users/<x>` o `/home/<x>`); null si no cuelga de una. */
function inferHome(p: string): string | null {
  const m = /^(\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/.exec(p)
  return m ? m[1] : null
}

/**
 * Carpeta que pide el agente en una petición `external_directory` y las carpetas que se pueden
 * ofrecer (la pedida y hasta 4 ancestros; nunca la carpeta personal ni por encima de ella, ni la raíz).
 * `requested` = `metadata.parentDir` (herramientas de archivos) o `metadata.directories[0]` (bash);
 * si faltan, se deduce del primer patrón (`<dir>/*`) o de `metadata.filepath`.
 * `candidates[0]` es siempre `requested`.
 */
export function folderRequestPaths(p: PermissionRequest, home?: string): { requested: string; candidates: string[] } {
  const md = (p.metadata ?? {}) as Record<string, unknown>
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')
  const dirs = Array.isArray(md.directories) ? md.directories.map(asStr).filter(Boolean) : []
  let requested = asStr(md.parentDir) || dirs[0] || ''
  if (!requested && p.patterns[0]) requested = p.patterns[0]
  if (!requested && asStr(md.filepath)) requested = asStr(md.filepath).replace(/\/[^/]*$/, '')
  requested = stripGlob(requested)
  if (!requested) return { requested: '', candidates: [] }
  const homeDir = stripGlob(home ?? inferHome(requested) ?? '')
  const candidates = [requested]
  let cur = requested
  for (let i = 0; i < 4; i++) {
    const idx = cur.lastIndexOf('/')
    if (idx <= 0) break
    const parent = cur.slice(0, idx)
    // Nunca la raíz ni carpetas de primer nivel, ni la carpeta personal ni por encima de ella.
    if (parent.split('/').filter(Boolean).length < 2) break
    if (homeDir && (parent === homeDir || homeDir.startsWith(`${parent}/`))) break
    candidates.push(parent)
    cur = parent
  }
  return { requested, candidates }
}

// ───────────────────────────── Permisos recordables ─────────────────────────────

/** Comandos de borrado (misma expresión que `PermissionPrompt.tsx` y `rules.ts` de main). */
const DELETE_RE = /(^|[;&|]\s*)(rm|rmdir|unlink|trash|srm)\b|\s-delete\b/

/**
 * ¿Se puede guardar este par permiso/patrón como regla "siempre permitir"? Espejo de
 * `ruleRejectionReason` de main: nunca `external_directory`, `doom_loop`, `computer_*`, borrados
 * ni patrones de bash que empiecen por comodín.
 */
export function isRememberablePermission(permission: string, pattern: string): boolean {
  if (!/^[A-Za-z0-9_*.:-]{1,200}$/.test(permission)) return false
  if (permission === 'external_directory' || permission === 'doom_loop' || permission.startsWith('computer_')) return false
  if (!pattern || pattern.length > 2000) return false
  if (DELETE_RE.test(pattern)) return false
  if (permission === 'bash' && (/^[\s*?]*$/.test(pattern) || /^[*?]/.test(pattern.trim()))) return false
  return true
}

/** Patrones de una petición que se guardarían como regla (`always`, o los `patterns` si no hay). */
export function rememberablePatterns(p: PermissionRequest): string[] {
  const list = p.always.length > 0 ? p.always : p.patterns
  return list.filter((pat) => isRememberablePermission(p.permission, pat))
}
