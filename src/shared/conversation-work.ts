/**
 * Lógica pura del trabajo plegado de una respuesta («Trabajó durante 6 s · 4 pasos ›»), compartida por Chat, Code y el puente con
 * Telegram (`src/main/telegram`, que la usa para escribir el avance en lenguaje llano). Todo se calcula con datos que ya existen
 * (partes de herramienta, razonamiento y texto con sus tiempos): no toca el motor ni la interfaz.
 */
import { t, type MsgKey } from './i18n'

/** Papel de una parte o bloque dentro de una respuesta. */
export type WorkRole =
  /** Llamada a herramienta (uno o varios pasos). */
  | 'tool'
  /** Razonamiento visible. */
  | 'reasoning'
  /** Texto del agente (narración intermedia o respuesta final). */
  | 'text'
  /** Corta el trabajo: reintentos, subtareas, errores, archivos. Nunca va dentro del plegado. */
  | 'break'
  /** No se pinta (inicio/fin de paso, instantáneas…): no cuenta ni corta. */
  | 'skip'

export type Segment<T> = { kind: 'plain'; items: T[] } | { kind: 'work'; items: T[] }

/**
 * Parte una respuesta en tramos: el trabajo (desde la primera herramienta o razonamiento hasta el último, con el texto
 * intermedio que haya entre medias) y el resto. El texto de antes de empezar y el de después de terminar —la respuesta
 * final— quedan fuera. Un tramo solo es «trabajo» si tiene al menos una herramienta: un razonamiento suelto se queda como
 * siempre. Los cortes (`break`) separan tramos y nunca quedan dentro.
 */
export function segmentWork<T>(items: readonly T[], role: (item: T) => WorkRole): Segment<T>[] {
  const out: Segment<T>[] = []
  const push = (kind: Segment<T>['kind'], list: T[]): void => {
    if (!list.length) return
    const last = out[out.length - 1]
    if (kind === 'plain' && last?.kind === 'plain') last.items.push(...list)
    else out.push({ kind, items: [...list] })
  }
  const flushRun = (run: T[]): void => {
    const roles = run.map(role)
    const isWork = (r: WorkRole): boolean => r === 'tool' || r === 'reasoning'
    const first = roles.findIndex(isWork)
    let last = -1
    roles.forEach((r, i) => {
      if (isWork(r)) last = i
    })
    if (first < 0 || !roles.some((r) => r === 'tool')) {
      push('plain', run)
      return
    }
    push('plain', run.slice(0, first))
    push('work', run.slice(first, last + 1))
    push('plain', run.slice(last + 1))
  }
  let run: T[] = []
  for (const it of items) {
    if (role(it) === 'break') {
      flushRun(run)
      run = []
      push('plain', [it])
    } else run.push(it)
  }
  flushRun(run)
  return out
}

/**
 * ¿Este tramo es lo último que hace el agente? Lo es si después no queda nada que se pinte: ni la respuesta final ni un
 * corte (error, reintento). En cuanto empieza el texto final, el trabajo se da por terminado y se pliega.
 */
export function isOngoing<T>(segments: readonly Segment<T>[], index: number, role: (item: T) => WorkRole): boolean {
  return segments.slice(index + 1).every((s) => s.items.every((it) => role(it) === 'skip'))
}

// ---------------------------------------------------------------------------
// Tiempo y número de pasos
// ---------------------------------------------------------------------------

/** Lo mínimo que se necesita de una parte para medir el tiempo. */
export interface TimedFacts {
  type: string
  time?: { start?: number; end?: number }
  state?: { status?: string; time?: { start?: number; end?: number } }
}

const MAX_WORK_MS = 24 * 60 * 60 * 1000

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Tiempo real del trabajo, en milisegundos: del primer inicio al último fin de las partes. En vivo el fin es `now`.
 * Devuelve `null` si los datos no son fiables (sin inicios, fin antes del inicio, más de un día): entonces solo se
 * muestra el número de pasos.
 */
export function workDurationMs(parts: readonly TimedFacts[], live: boolean, now: number): number | null {
  let start = Infinity
  let end = -Infinity
  for (const p of parts) {
    const time = p.type === 'tool' ? p.state?.time : p.time
    if (finite(time?.start)) start = Math.min(start, time.start)
    if (finite(time?.end)) end = Math.max(end, time.end)
  }
  if (!Number.isFinite(start)) return null
  const stop = live ? now : end
  if (!Number.isFinite(stop) || stop < start) return null
  const ms = stop - start
  return ms > MAX_WORK_MS ? null : ms
}

/** Cuántos pasos tiene el trabajo: una llamada a herramienta es un paso (el razonamiento no cuenta). */
export function countSteps(parts: readonly { type: string }[]): number {
  return parts.filter((p) => p.type === 'tool').length
}

/** «6 s», «2 min 5 s», «1 h 3 min». Mínimo 1 s. */
export function formatWorkDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  if (total < 60) return t('work.dur.sec', { s: total })
  const m = Math.floor(total / 60)
  const s = total % 60
  if (total < 3600) return s ? t('work.dur.minSec', { m, s }) : t('work.dur.min', { m })
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? t('work.dur.hourMin', { h, m: rest }) : t('work.dur.hour', { h })
}

/** Título de la línea plegada. Sin tiempo fiable solo dice cuántos pasos fueron. */
export function workTitle(steps: number, ms: number | null, live: boolean): string {
  const count = t('code.n.step', { count: steps })
  if (live)
    return ms === null ? t('work.title.liveNoTime', { steps: count }) : t('work.title.live', { time: formatWorkDuration(ms), steps: count })
  return ms === null ? t('work.title.doneNoTime', { steps: count }) : t('work.title.done', { time: formatWorkDuration(ms), steps: count })
}

/** Aviso para lectores de pantalla cuando el trabajo termina. */
export function workDoneAnnouncement(steps: number): string {
  return t('work.announce.done', { steps: t('code.n.step', { count: steps }) })
}

// ---------------------------------------------------------------------------
// Lo que nunca se esconde
// ---------------------------------------------------------------------------

/**
 * Pasos que necesitan atención y por eso se ven aunque el trabajo esté plegado: los que esperan un permiso o una
 * respuesta tuya y los que terminaron con error.
 */
export function attentionSteps<P extends { type: string; callID?: string; state?: { status?: string } }>(
  parts: readonly P[],
  pendingCallIDs: ReadonlySet<string>
): P[] {
  return parts.filter((p) => p.type === 'tool' && (p.state?.status === 'error' || (!!p.callID && pendingCallIDs.has(p.callID))))
}

// ---------------------------------------------------------------------------
// Clasificación de herramientas y resumen en lenguaje llano (antes vivían en ToolCard.tsx)
// ---------------------------------------------------------------------------

export type ToolKind = 'edit' | 'bash' | 'read' | 'search' | 'web' | 'todo' | 'task' | 'other'

export function toolKind(tool: string): ToolKind {
  switch (tool) {
    case 'edit':
    case 'multiedit':
    case 'write':
    case 'patch':
    case 'apply_patch':
      return 'edit'
    case 'bash':
      return 'bash'
    case 'read':
      return 'read'
    case 'grep':
    case 'glob':
    case 'list':
    case 'ls':
    case 'codesearch':
      return 'search'
    case 'webfetch':
    case 'websearch':
      return 'web'
    case 'todowrite':
    case 'todoread':
      return 'todo'
    case 'task':
      return 'task'
    default:
      return 'other'
  }
}

function plural(n: number, key: MsgKey): string {
  return t(key, { count: n })
}

/** "Leyó 3 archivos · Editó 2 archivos · Ejecutó 1 comando". */
export function summarizeSteps(parts: readonly { tool: string }[]): string {
  const c: Record<ToolKind, number> = { edit: 0, bash: 0, read: 0, search: 0, web: 0, todo: 0, task: 0, other: 0 }
  for (const p of parts) c[toolKind(p.tool)]++
  const out: string[] = []
  if (c.read) out.push(t('code.sum.read', { items: plural(c.read, 'code.n.file') }))
  if (c.search) out.push(t('code.sum.search', { count: c.search }))
  if (c.edit) out.push(t('code.sum.edit', { items: plural(c.edit, 'code.n.file') }))
  if (c.bash) out.push(t('code.sum.bash', { items: plural(c.bash, 'code.n.command') }))
  if (c.web) out.push(c.web > 1 ? t('code.sum.webMany', { count: c.web }) : t('code.sum.web'))
  if (c.task) out.push(plural(c.task, 'code.n.subagent'))
  if (c.todo) out.push(t('code.tool.todoUpdated'))
  if (c.other) out.push(plural(c.other, 'code.n.tool'))
  return out.join(' · ')
}

/** Lo mínimo de una llamada a herramienta para describirla en una línea. */
export interface StepFacts {
  tool: string
  state: { status?: string; input?: Record<string, unknown>; title?: string }
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Última parte de una ruta (el nombre del archivo): en una línea de avance no hace falta la carpeta entera. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Una línea en lenguaje llano para un paso: «Leyó App.tsx», «Ejecutando: npm test», «Creó informe.docx». Sin salidas ni contenido:
 * solo el verbo y el objeto (nombre del archivo, comando de una línea, o la descripción que dio el agente).
 */
export function stepLine(p: StepFacts): string {
  const running = p.state.status === 'running' || p.state.status === 'pending'
  const input = p.state.input ?? {}
  const kind = toolKind(p.tool)
  const file = baseName(s(input.filePath) || s(input.path))
  switch (kind) {
    case 'read':
      return `${t(running ? 'code.tool.reading' : 'code.tool.read')} ${file}`.trim()
    case 'edit':
      return `${t(p.tool === 'write' ? 'code.tool.created' : 'code.tool.edited')} ${file || s(p.state.title)}`.trim()
    case 'bash': {
      const cmd = s(input.command).split('\n')[0] ?? ''
      return `${t(running ? 'code.tool.running' : 'code.tool.ran')}: ${s(input.description) || cmd}`.trim()
    }
    case 'search':
      return `${t('code.tool.searched')} ${s(input.pattern) || s(input.query) || file}`.trim()
    case 'web':
      return p.tool === 'websearch'
        ? `${t('code.tool.searchedWeb')} ${s(input.query)}`.trim()
        : `${t('code.tool.opened')} ${s(input.url)}`.trim()
    case 'todo':
      return t('code.tool.todoUpdated')
    case 'task':
      return `${t('code.tool.subagent')}: ${s(input.description) || s(p.state.title)}`.trim()
    default:
      return s(p.state.title) || p.tool
  }
}
