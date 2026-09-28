/** Lista de tareas de la carpeta: estado (icono), tiempo relativo, búsqueda, pin/renombrar/eliminar/archivar. */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Circle,
  Hand,
  HelpCircle,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Search,
  ShieldOff,
  Trash2,
  X
} from 'lucide-react'
import { selectSessionsForDirectory, useSessions } from '../../../stores/sessions'
import { archiveTask, deleteTask, openTask, renameTask } from './actions'
import { isPinned, markUnread, togglePinned, useCowork } from './store'
import { permissionBelongsTo, relTime, sessionBelongsTo, taskStatus, type TaskStatus } from './util'

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Loader2 size={size} className="animate-spin text-accent" />
    case 'waiting':
      return <Hand size={size} className="text-amber-500" />
    case 'question':
      return <HelpCircle size={size} className="text-accent" />
    case 'error':
      return <AlertCircle size={size} className="text-danger" />
    case 'done':
      return <CheckCircle2 size={size} className="text-accent" />
    default:
      return <Circle size={size} className="text-subtle" />
  }
}

/** Menú "…" de una tarea: fijar/desfijar, renombrar, marcar como no leída, archivar, eliminar. */
function TaskMenu({ id, title, archived }: { id: string; title: string; archived?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const pinned = useCowork((s) => !!s.pinned[id])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger?: boolean): React.JSX.Element => (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover ${danger ? 'text-danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        onClick()
      }}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        title="Más acciones"
        className="hidden rounded p-0.5 text-subtle group-hover:block hover:text-fg"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-elevated p-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {item(pinned ? <PinOff size={13} /> : <Pin size={13} />, pinned ? 'Desfijar' : 'Fijar', () => togglePinned(id))}
          {item(<Pencil size={13} />, 'Renombrar…', () => {
            const next = window.prompt('Nuevo nombre de la tarea', title)
            if (next && next.trim()) void renameTask(id, next).catch(() => undefined)
          })}
          {item(<Mail size={13} />, 'Marcar como no leída', () => markUnread(id))}
          {!archived && item(<Archive size={13} />, 'Archivar', () => void archiveTask(id).catch(() => undefined))}
          {item(
            <Trash2 size={13} />,
            'Eliminar…',
            () => {
              if (window.confirm(`¿Eliminar la tarea «${title || 'sin título'}»? Esta acción no se puede deshacer.`)) {
                void deleteTask(id).catch(() => undefined)
              }
            },
            true
          )}
        </div>
      )}
    </div>
  )
}

function dayBucket(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= start) return 'Hoy'
  if (ts >= start - 86_400_000) return 'Ayer'
  if (ts >= start - 6 * 86_400_000) return 'Esta semana'
  return d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
}

export function TaskList(): React.JSX.Element {
  const folder = useCowork((s) => s.folder)
  const activeId = useCowork((s) => s.activeTaskId)
  const loading = useCowork((s) => s.listLoading)
  const permissions = useCowork((s) => s.permissions)
  const questions = useCowork((s) => s.questions)
  const unseen = useCowork((s) => s.unseen)
  const sessions = useSessions((s) => s.sessions)
  const status = useSessions((s) => s.status)
  const errors = useSessions((s) => s.errors)
  const messages = useSessions((s) => s.messages)
  const [query, setQuery] = useState('')
  const [, tick] = useState(0)

  // Refresca los "hace X min".
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const tasks = useMemo(() => {
    const all = folder ? selectSessionsForDirectory(sessions, folder) : []
    const q = query.trim().toLowerCase()
    return q ? all.filter((t) => (t.title || '').toLowerCase().includes(q)) : all
  }, [sessions, folder, query])

  const perms = Object.values(permissions)
  const qs = Object.values(questions)
  const networkBlocked = useCowork((s) => s.networkBlocked)
  const pinnedMap = useCowork((s) => s.pinned)
  const pinnedTasks = tasks.filter((t) => pinnedMap[t.id])
  const restTasks = tasks.filter((t) => !pinnedMap[t.id])
  const groups: Array<{ label: string; items: typeof tasks }> = []
  if (pinnedTasks.length > 0) groups.push({ label: 'Fijadas', items: pinnedTasks })
  for (const t of restTasks) {
    const label = dayBucket(t.time.updated)
    const g = groups[groups.length - 1]
    if (g && g.label === label && label !== 'Fijadas') g.items.push(t)
    else groups.push({ label, items: [t] })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mt-3 mb-1">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar tareas"
          className="w-full rounded-lg border border-border bg-transparent py-1.5 pr-7 pl-8 text-[13px] outline-none placeholder:text-subtle focus:border-border-strong"
        />
        {query && (
          <button
            type="button"
            title="Limpiar"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-fg"
            onClick={() => setQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && tasks.length === 0 && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-subtle">
            <Loader2 size={12} className="animate-spin" /> Cargando tareas…
          </div>
        )}
        {tasks.length === 0 && !loading && (
          <p className="px-1 py-2 text-xs text-subtle">
            {query ? 'Ninguna tarea coincide con la búsqueda.' : folder ? 'Aún no hay tareas en esta carpeta.' : 'Elige una carpeta para ver sus tareas.'}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-1">
            <div className="px-1 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((t) => {
                const st = taskStatus({
                  run: status[t.id],
                  waiting: perms.some((p) => permissionBelongsTo(p, t.id, sessions)),
                  hasQuestion: qs.some((q) => sessionBelongsTo(q.sessionID, t.id, sessions)),
                  error: errors[t.id],
                  entries: messages[t.id]
                })
                const busy = st === 'running' || st === 'waiting' || st === 'question'
                const isUnseen = !!unseen[t.id] && t.id !== activeId
                const hasBlockedHost = (networkBlocked[t.id] ?? []).some((b) => !b.resolved)
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      t.id === activeId ? 'bg-active' : 'hover:bg-hover'
                    }`}
                  >
                    <span className="shrink-0" title={st === 'waiting' ? 'Necesita tu aprobación' : undefined}>
                      <StatusIcon status={st} size={13} />
                    </span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openTask(t.id)}>
                      <div className={`truncate ${isUnseen ? 'font-semibold' : ''}`}>
                        {isPinned(t.id) && <Pin size={10} className="mr-1 inline-block -translate-y-px text-subtle" />}
                        {t.title || 'Tarea sin título'}
                      </div>
                      <div className="text-[11px] text-subtle">
                        {st === 'waiting' ? (
                          <span className="text-amber-600 [[data-theme=dark]_&]:text-amber-400">Esperando aprobación</span>
                        ) : st === 'question' ? (
                          <span className="text-accent">Esperando tu respuesta</span>
                        ) : st === 'running' ? (
                          <span className="text-accent">Trabajando…</span>
                        ) : (
                          relTime(t.time.updated)
                        )}
                      </div>
                    </button>
                    {hasBlockedHost && (
                      <span
                        className="shrink-0 text-amber-600 [[data-theme=dark]_&]:text-amber-400"
                        title="Se bloqueó el acceso a un sitio: necesita tu decisión"
                      >
                        <ShieldOff size={12} />
                      </span>
                    )}
                    {isUnseen && <span className="h-2 w-2 shrink-0 rounded-full bg-accent group-hover:hidden" />}
                    {!busy && <TaskMenu id={t.id} title={t.title || ''} />}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
