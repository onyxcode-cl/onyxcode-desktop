/**
 * Secciones transversales de la barra lateral de Cowork (Fijadas, Activas, Programadas: de TODAS las carpetas)
 * y utilidades puras de la lista de tareas (agrupar por fecha / por grupo, "Mostrar más", orden de las activas).
 * Las funciones puras no dependen de React ni de los stores para poder probarlas con node.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Hand,
  HelpCircle,
  Loader2,
  MousePointer2,
  Pin
} from 'lucide-react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { CoworkTaskActivity, CoworkTaskMeta, ScheduledRoutine } from '@shared/ipc-tasks'
import { COWORK_TERMS } from '@shared/tasks-glossary'
import { useSessions } from '../../../stores/sessions'
import { untilText } from '../../routines/impl/schedule'
import { cw, onCowork } from './bridge'
import { openTaskAnywhere } from './actions'
import { syncActivity, useCowork } from './store'
import { baseName, isArchivedSession, relTime, TASK_STATUS_LABEL, type TaskStatus } from './util'

// ───────────────────────────── Puras ─────────────────────────────

/** Minúsculas y sin tildes, para comparar títulos. */
export function foldTitle(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Tareas cuyo título contiene `query` (sin distinguir mayúsculas ni tildes). Consulta vacía = todas. */
export function filterByTitle<T extends { title?: string }>(items: T[], query: string): T[] {
  const q = foldTitle(query.trim())
  if (!q) return items
  return items.filter((t) => foldTitle(t.title || '').includes(q))
}

/** Etiqueta del día de una fecha: Hoy / Ayer / Esta semana / "mes año". */
export function dayBucket(ts: number, now = Date.now()): string {
  const today = new Date(now)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= start) return 'Hoy'
  if (ts >= start - 86_400_000) return 'Ayer'
  if (ts >= start - 6 * 86_400_000) return 'Esta semana'
  const label = new Date(ts).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export interface TaskGroup<T> {
  key: string
  label: string
  items: T[]
}

/** Agrupa por fecha conservando el orden de entrada (los grupos salen en el orden en que aparecen). */
export function groupByDate<T>(items: T[], tsOf: (t: T) => number, now = Date.now()): TaskGroup<T>[] {
  const out: TaskGroup<T>[] = []
  const byLabel = new Map<string, TaskGroup<T>>()
  for (const t of items) {
    const label = dayBucket(tsOf(t), now)
    let g = byLabel.get(label)
    if (!g) {
      g = { key: `date:${label}`, label, items: [] }
      byLabel.set(label, g)
      out.push(g)
    }
    g.items.push(t)
  }
  return out
}

/** Etiqueta del grupo de las tareas que no tienen grupo. */
export const NO_GROUP_LABEL = 'Sin grupo'

/**
 * Agrupa por el grupo definido por el usuario: grupos con nombre por orden alfabético (es) y al final
 * "Sin grupo". Dentro de cada grupo se conserva el orden de entrada (más recientes primero).
 */
export function groupByGroup<T>(items: T[], groupOf: (t: T) => string | null | undefined): TaskGroup<T>[] {
  const named = new Map<string, T[]>()
  const loose: T[] = []
  for (const t of items) {
    const g = groupOf(t)?.trim()
    if (!g) loose.push(t)
    else {
      const list = named.get(g)
      if (list) list.push(t)
      else named.set(g, [t])
    }
  }
  const out: TaskGroup<T>[] = [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
    .map(([label, list]) => ({ key: `group:${label}`, label, items: list }))
  if (loose.length > 0) out.push({ key: 'group:', label: NO_GROUP_LABEL, items: loose })
  return out
}

/** "Mostrar más": los primeros `limit` elementos (todos si `expanded`) y cuántos quedan ocultos. */
export function takeVisible<T>(items: T[], limit: number, expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || items.length <= limit) return { shown: items, hidden: 0 }
  return { shown: items.slice(0, limit), hidden: items.length - limit }
}

const ACTIVE_RANK: Record<CoworkTaskActivity['state'], number> = { question: 0, waiting: 1, running: 2 }

/** Tareas activas: primero las que esperan al usuario (pregunta, aprobación), luego las que trabajan; más recientes primero. */
export function orderActiveTasks(tasks: CoworkTaskActivity[]): CoworkTaskActivity[] {
  return [...tasks].sort(
    (a, b) => ACTIVE_RANK[a.state] - ACTIVE_RANK[b.state] || b.since - a.since || a.sessionId.localeCompare(b.sessionId)
  )
}

export interface PinnedEntry {
  sessionId: string
  folder: string
  fullAccess: boolean
  title: string
  updated: number
}

/**
 * Fijadas de todas las carpetas (metadatos de main). Si la sesión ya se conoce (carpeta conectada) se usa su
 * título y su fecha reales y se omiten las archivadas. Más recientes primero.
 */
export function pinnedEntries(taskMeta: Record<string, CoworkTaskMeta>, sessions: Record<string, Session>): PinnedEntry[] {
  const out: PinnedEntry[] = []
  for (const m of Object.values(taskMeta)) {
    if (!m.pinned) continue
    const s = sessions[m.sessionId]
    if (s && isArchivedSession(s)) continue
    out.push({
      sessionId: m.sessionId,
      folder: s?.directory ?? m.folder,
      fullAccess: m.fullAccess,
      title: s?.title || m.title,
      updated: s?.time.updated ?? m.updatedAt
    })
  }
  return out.sort((a, b) => b.updated - a.updated || a.sessionId.localeCompare(b.sessionId))
}

/** Rutinas programadas de Cowork y activas, por próxima ejecución (las que no la tienen, al final). */
export function upcomingRoutines(routines: ScheduledRoutine[]): ScheduledRoutine[] {
  return routines
    .filter((r) => r.mode === 'tasks' && r.enabled)
    .sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity) || a.name.localeCompare(b.name, 'es'))
}

/**
 * Tareas raíz archivadas de un directorio, más recientemente archivadas primero. Solo las del origen
 * (servidor) visible de ese directorio; las restauradas con el respaldo `metadata.unarchivedAt` no cuentan.
 * NOTA: `selectSessionsForDirectory` las oculta, pero `loadSessions` (GET /session) sí las trae.
 */
export function archivedSessionsForDirectory(
  sessions: Record<string, Session>,
  directory: string,
  viewSource: string,
  sourceOf: (sessionId: string) => string
): Session[] {
  return Object.values(sessions)
    .filter((s) => s.directory === directory && !s.parentID && isArchivedSession(s) && sourceOf(s.id) === viewSource)
    .sort((a, b) => (b.time.archived ?? 0) - (a.time.archived ?? 0))
}

/** Clase de color del texto de estado de una tarea (tokens de DESIGN.md). */
export function statusTextClass(status: TaskStatus): string {
  switch (status) {
    case 'waiting':
    case 'plan_ready':
      return 'text-warning'
    case 'question':
    case 'running':
    case 'using_computer':
      return 'text-accent'
    case 'error':
      return 'text-danger'
    default:
      return 'text-subtle'
  }
}

// ───────────────────────────── Componentes ─────────────────────────────

/** Icono del estado de una tarea (incluye `using_computer`, `plan_ready` y `archived`). */
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }): React.JSX.Element {
  let icon: React.JSX.Element
  switch (status) {
    case 'running':
      icon = <Loader2 size={size} className="animate-spin text-accent" />
      break
    case 'using_computer':
      icon = <MousePointer2 size={size} className="animate-pulse text-accent" />
      break
    case 'plan_ready':
      icon = <ClipboardCheck size={size} className="text-warning" />
      break
    case 'waiting':
      icon = <Hand size={size} className="text-warning" />
      break
    case 'question':
      icon = <HelpCircle size={size} className="text-accent" />
      break
    case 'error':
      icon = <AlertCircle size={size} className="text-danger" />
      break
    case 'done':
      icon = <CheckCircle2 size={size} className="text-accent" />
      break
    case 'archived':
      icon = <Archive size={size} className="text-subtle" />
      break
    default:
      icon = <Circle size={size} className="text-subtle" />
  }
  return (
    <span role="img" aria-label={TASK_STATUS_LABEL[status]} className="inline-flex">
      {icon}
    </span>
  )
}

/** Fila de las secciones transversales (un botón con icono, título y subtítulo). */
function SectionRow({
  icon,
  title,
  subtitle,
  subtitleClass = 'text-subtle',
  active,
  fullAccess,
  hint,
  onClick
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  subtitleClass?: string
  active?: boolean
  fullAccess?: boolean
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${active ? 'bg-active' : 'hover:bg-hover'}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title || 'Tarea sin título'}</span>
        <span className={`block truncate text-[11px] ${subtitleClass}`}>{subtitle}</span>
      </span>
      {fullAccess && (
        <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted">
          {COWORK_TERMS.fullControlShort}
        </span>
      )}
    </button>
  )
}

/** Bloque con título, filas y "Mostrar más / Mostrar menos". No se pinta si no hay elementos. */
function Section<T>({
  label,
  items,
  limit,
  keyOf,
  render
}: {
  label: string
  items: T[]
  limit: number
  keyOf: (t: T) => string
  render: (t: T) => React.JSX.Element
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const { shown, hidden } = takeVisible(items, limit, expanded)
  if (items.length === 0) return null
  return (
    <section aria-label={label} className="mb-1">
      <div className="px-1 pt-2.5 pb-1 text-[11.5px] font-medium text-subtle">{label}</div>
      <ul className="space-y-0.5">
        {shown.map((t) => (
          <li key={keyOf(t)}>{render(t)}</li>
        ))}
      </ul>
      {(hidden > 0 || (expanded && items.length > limit)) && (
        <button
          type="button"
          aria-expanded={expanded}
          className="mt-0.5 w-full rounded-lg px-2 py-1 text-left text-[11.5px] text-muted hover:bg-hover hover:text-fg"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Mostrar menos' : `Mostrar ${hidden} más`}
        </button>
      )}
    </section>
  )
}

/** Abre una rutina: su tarea de origen si existe; si no, el modo Rutinas con la rutina seleccionada. */
async function openRoutine(r: ScheduledRoutine, editor = false): Promise<void> {
  if (!editor && r.originSessionId && r.folder) {
    await openTaskAnywhere({ sessionId: r.originSessionId, folder: r.folder, fullAccess: !!r.fullAccess })
    return
  }
  const [{ useUi }, { useRoutines }] = await Promise.all([import('../../../stores/ui'), import('../../routines/impl/store')])
  useRoutines.setState({ selectedId: r.id })
  useUi.getState().setMode('routines')
}

/** Fijadas, Activas y Programadas de todas las carpetas (arriba de la lista de la carpeta actual). */
export function SidebarSections(): React.JSX.Element {
  const activity = useCowork((s) => s.activity)
  const taskMeta = useCowork((s) => s.taskMeta)
  const activeTaskId = useCowork((s) => s.activeTaskId)
  const sessions = useSessions((s) => s.sessions)
  const [routines, setRoutines] = useState<ScheduledRoutine[]>([])
  const [, tick] = useState(0)

  // Suscripción única a la actividad (idempotente) y refresco de los "en X min".
  useEffect(() => {
    syncActivity()
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // Rutinas: carga inicial + cambios push.
  useEffect(() => {
    let alive = true
    cw('routines:list')
      .then((list) => {
        if (alive) setRoutines(list)
      })
      .catch(() => undefined)
    const off = onCowork('routines:changed', (list) => setRoutines(list))
    return () => {
      alive = false
      off()
    }
  }, [])

  const pinned = useMemo(() => pinnedEntries(taskMeta, sessions), [taskMeta, sessions])
  const active = useMemo(() => orderActiveTasks(activity?.tasks ?? []), [activity])
  const activeById = useMemo(() => new Map(active.map((t) => [t.sessionId, t])), [active])
  const scheduled = useMemo(() => upcomingRoutines(routines), [routines])

  const open = (t: { sessionId: string; folder: string; fullAccess: boolean }): void => {
    void openTaskAnywhere(t).catch(() => undefined)
  }

  return (
    <div>
      <Section
        label="Fijadas"
        items={pinned}
        limit={5}
        keyOf={(p) => p.sessionId}
        render={(p) => {
          const live = activeById.get(p.sessionId)
          return (
            <SectionRow
              icon={live ? <StatusIcon status={live.state} size={13} /> : <Pin size={13} className="text-subtle" />}
              title={p.title}
              subtitle={live ? `${baseName(p.folder)} · ${TASK_STATUS_LABEL[live.state]}` : `${baseName(p.folder)} · ${relTime(p.updated)}`}
              subtitleClass={live ? statusTextClass(live.state) : undefined}
              active={p.sessionId === activeTaskId}
              fullAccess={p.fullAccess}
              hint={p.folder}
              onClick={() => open(p)}
            />
          )
        }}
      />
      <Section
        label="Activas"
        items={active}
        limit={4}
        keyOf={(t) => t.sessionId}
        render={(t) => (
          <SectionRow
            icon={<StatusIcon status={t.state} size={13} />}
            title={t.title}
            subtitle={`${baseName(t.folder)} · ${TASK_STATUS_LABEL[t.state]}`}
            subtitleClass={statusTextClass(t.state)}
            active={t.sessionId === activeTaskId}
            fullAccess={t.fullAccess}
            hint={t.folder}
            onClick={() => open(t)}
          />
        )}
      />
      <Section
        label="Programadas"
        items={scheduled}
        limit={3}
        keyOf={(r) => r.id}
        render={(r) => (
          <SectionRow
            icon={<CalendarClock size={13} className="text-subtle" />}
            title={r.name}
            subtitle={`${r.folder ? `${baseName(r.folder)} · ` : ''}${r.running ? 'En ejecución' : r.nextRun ? untilText(r.nextRun) : 'Sin próxima ejecución'}`}
            fullAccess={r.fullAccess}
            hint={r.originSessionId && r.folder ? 'Abrir la tarea de origen' : 'Abrir en Rutinas'}
            onClick={() => void openRoutine(r).catch(() => undefined)}
          />
        )}
      />
    </div>
  )
}
