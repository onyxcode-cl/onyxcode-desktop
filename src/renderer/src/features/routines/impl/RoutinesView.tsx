/** Modo Rutinas: tareas programadas que lanzan prompts en Chat, Cowork o Code. */
import { useEffect, useMemo } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FolderOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Terminal,
  Trash2,
  Users,
  XCircle
} from 'lucide-react'
import { WEEKDAYS_ES, type RoutineInput, type RoutineRunRecord, type RoutineSchedule, type ScheduledRoutine } from '@shared/ipc-cowork'
import { Button } from '../../../components/Button'
import { Markdown } from '../../../components/Markdown'
import { useSettings } from '../../../stores/settings'
import { hasCoworkBridge } from '../../cowork/impl/bridge'
import { RoutineEditor } from './RoutineEditor'
import {
  deleteRoutine,
  loadRoutines,
  runRoutineNow,
  subscribeRoutines,
  toggleRoutine,
  useRoutines
} from './store'

const MODE_META = {
  chat: { label: 'Chat', icon: MessageSquare },
  cowork: { label: 'Cowork', icon: Users },
  code: { label: 'Code', icon: Terminal }
} as const

const TRIGGER_LABEL: Record<RoutineRunRecord['trigger'], string> = {
  schedule: 'programada',
  manual: 'manual',
  catchup: 'recuperada'
}

function scheduleText(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
      return `Diario · ${s.time}`
    case 'weekly':
      return `${WEEKDAYS_ES[s.day] ?? '?'} · ${s.time}`
    case 'interval':
      return s.hours === 1 ? 'Cada hora' : `Cada ${s.hours} h`
    case 'cron':
      return `cron ${s.expr}`
  }
}

function fmt(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function duration(r: RoutineRunRecord): string {
  if (!r.finishedAt) return ''
  const s = Math.round((r.finishedAt - r.startedAt) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

function StatusIcon({ status }: { status: RoutineRunRecord['status'] }): React.JSX.Element {
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-accent" />
  if (status === 'success') return <CheckCircle2 size={14} className="text-accent" />
  return <XCircle size={14} className="text-danger" />
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-4.5' : 'left-0.5'}`} />
    </button>
  )
}

function toInput(r: ScheduledRoutine): RoutineInput {
  return { id: r.id, name: r.name, prompt: r.prompt, mode: r.mode, folder: r.folder ?? null, model: r.model, schedule: r.schedule, enabled: r.enabled }
}

function RoutineRow({ r, selected }: { r: ScheduledRoutine; selected: boolean }): React.JSX.Element {
  const Icon = MODE_META[r.mode].icon
  const last = r.lastResult
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => useRoutines.setState({ selectedId: r.id })}
      onKeyDown={(e) => e.key === 'Enter' && useRoutines.setState({ selectedId: r.id })}
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${selected ? 'border-accent/60 bg-accent-soft/40' : 'border-border hover:bg-hover'} ${r.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted">
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{r.name}</span>
          {r.running && <Loader2 size={13} className="shrink-0 animate-spin text-accent" />}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Clock size={11} /> {scheduleText(r.schedule)}
          </span>
          {r.enabled && r.nextRun && <span>Próxima: {fmt(r.nextRun)}</span>}
          {last && (
            <span className="flex items-center gap-1">
              <StatusIcon status={last.status} /> {fmt(last.startedAt)}
            </span>
          )}
        </div>
      </div>
      <Toggle checked={r.enabled} onChange={(v) => void toggleRoutine(r.id, v)} label={r.enabled ? 'Desactivar' : 'Activar'} />
    </div>
  )
}

function RoutineDetail({ r }: { r: ScheduledRoutine }): React.JSX.Element {
  const allHistory = useRoutines((s) => s.history)
  const history = useMemo(() => allHistory.filter((h) => h.routineId === r.id), [allHistory, r.id])
  const Icon = MODE_META[r.mode].icon
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{r.name}</h2>
          <Button variant="primary" disabled={r.running} onClick={() => void runRoutineNow(r.id)}>
            {r.running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Ejecutar ahora
          </Button>
          <Button variant="ghost" title="Editar" onClick={() => useRoutines.setState({ editing: toInput(r) })}>
            <Pencil size={14} />
          </Button>
          <Button
            variant="ghost"
            title="Eliminar"
            onClick={() => {
              if (window.confirm(`¿Eliminar la rutina «${r.name}»?`)) void deleteRoutine(r.id)
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Icon size={12} /> {MODE_META[r.mode].label}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} /> {scheduleText(r.schedule)}
          </span>
          <span>
            {r.model.providerID}/{r.model.modelID}
          </span>
          {r.folder && (
            <span className="flex min-w-0 items-center gap-1 font-mono" title={r.folder}>
              <FolderOpen size={12} /> <span className="truncate">{r.folder}</span>
            </span>
          )}
        </div>
        <p className="mt-3 line-clamp-4 rounded-lg bg-bg px-3 py-2 text-sm whitespace-pre-wrap text-muted">{r.prompt}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Historial</h3>
        {history.length === 0 ? (
          <p className="text-sm text-subtle">Aún no se ha ejecutado.</p>
        ) : (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <StatusIcon status={h.status} />
                  <span className="font-medium text-fg">{fmt(h.startedAt)}</span>
                  <span className="rounded-full border border-border px-1.5">{TRIGGER_LABEL[h.trigger]}</span>
                  <span className="ml-auto">{duration(h)}</span>
                </div>
                {h.status === 'error' && h.error && (
                  <p className="mt-2 flex items-start gap-1 text-sm text-danger">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" /> {h.error}
                  </p>
                )}
                {h.summary && (
                  <div className="mt-2 max-h-72 overflow-y-auto text-sm">
                    <Markdown text={h.summary} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

export function RoutinesView(): React.JSX.Element {
  const bridge = hasCoworkBridge()
  const routines = useRoutines((s) => s.routines)
  const loading = useRoutines((s) => s.loading)
  const error = useRoutines((s) => s.error)
  const editing = useRoutines((s) => s.editing)
  const selectedId = useRoutines((s) => s.selectedId)
  const defaultModel = useSettings((s) => s.settings.defaultModel)

  useEffect(() => {
    if (!bridge) return
    void loadRoutines()
    return subscribeRoutines()
  }, [bridge])

  const selected = routines.find((r) => r.id === selectedId) ?? null

  const create = (): void =>
    useRoutines.setState({
      editing: { name: '', prompt: '', mode: 'chat', folder: null, model: defaultModel, schedule: { kind: 'daily', time: '09:00' }, enabled: true }
    })

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-danger">
        <AlertCircle size={16} className="mr-2" /> Falta `window.api.cowork` en el preload.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
          <CalendarClock size={18} className="text-accent" />
          <h1 className="text-base font-semibold">Rutinas</h1>
          {loading && <Loader2 size={14} className="animate-spin text-muted" />}
          <Button variant="primary" className="ml-auto" onClick={create}>
            <Plus size={15} /> Nueva rutina
          </Button>
        </header>
        {error && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle size={15} /> {error}
            <button type="button" className="ml-auto text-xs underline" onClick={() => useRoutines.setState({ error: null })}>
              Cerrar
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {routines.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <CalendarClock size={28} />
              </div>
              <h2 className="text-xl font-semibold">Automatiza tareas recurrentes</h2>
              <p className="max-w-md text-sm text-muted">
                Programa un prompt para que se ejecute solo (a diario, cada semana, cada N horas o con cron) y recibe una
                notificación con el resultado. Si la app estaba cerrada, se ejecuta una vez al volver a abrirla.
              </p>
              <Button variant="primary" onClick={create}>
                <Plus size={15} /> Crear rutina
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-2">
              {routines.map((r) => (
                <RoutineRow key={r.id} r={r} selected={r.id === selectedId} />
              ))}
            </div>
          )}
        </div>
      </section>

      {selected && (
        <aside className="w-[420px] shrink-0 border-l border-border">
          <RoutineDetail r={selected} />
        </aside>
      )}

      {editing && <RoutineEditor key={editing.id ?? 'new'} initial={editing} />}
    </div>
  )
}

export default RoutinesView
