/** Lista de tareas de la carpeta: estado (icono), tiempo relativo, búsqueda y archivar. */
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Archive, CheckCircle2, Circle, Hand, Loader2, Search, X } from 'lucide-react'
import { selectSessionsForDirectory, useSessions } from '../../../stores/sessions'
import { archiveTask, openTask } from './actions'
import { useCowork } from './store'
import { permissionBelongsTo, relTime, taskStatus, type TaskStatus } from './util'

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <Loader2 size={size} className="animate-spin text-accent" />
    case 'waiting':
      return <Hand size={size} className="text-amber-500" />
    case 'error':
      return <AlertCircle size={size} className="text-danger" />
    case 'done':
      return <CheckCircle2 size={size} className="text-accent" />
    default:
      return <Circle size={size} className="text-subtle" />
  }
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
  const groups: Array<{ label: string; items: typeof tasks }> = []
  for (const t of tasks) {
    const label = dayBucket(t.time.updated)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(t)
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
                  error: errors[t.id],
                  entries: messages[t.id]
                })
                const busy = st === 'running' || st === 'waiting'
                const isUnseen = !!unseen[t.id] && t.id !== activeId
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
                      <div className={`truncate ${isUnseen ? 'font-semibold' : ''}`}>{t.title || 'Tarea sin título'}</div>
                      <div className="text-[11px] text-subtle">
                        {st === 'waiting' ? (
                          <span className="text-amber-600 [[data-theme=dark]_&]:text-amber-400">Esperando aprobación</span>
                        ) : st === 'running' ? (
                          <span className="text-accent">Trabajando…</span>
                        ) : (
                          relTime(t.time.updated)
                        )}
                      </div>
                    </button>
                    {isUnseen && <span className="h-2 w-2 shrink-0 rounded-full bg-accent group-hover:hidden" />}
                    {!busy && (
                      <button
                        type="button"
                        title="Archivar"
                        className="hidden shrink-0 rounded p-0.5 text-subtle group-hover:block hover:text-fg"
                        onClick={() => void archiveTask(t.id).catch(() => undefined)}
                      >
                        <Archive size={13} />
                      </button>
                    )}
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
