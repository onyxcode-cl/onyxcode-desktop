/** Modo Rutinas: tareas programadas que lanzan prompts en Chat, Tareas o Code. */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  FolderOpen,
  Hourglass,
  Loader2,
  Newspaper,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { needsRoutinesNotice } from '@shared/routines-terms'
import type { RoutineInput, RoutineMode, RoutineRunRecord, ScheduledRoutine } from '@shared/ipc-tasks'
import { Button } from '../../../components/Button'
import { PageHeader } from '../../../components/PageHeader'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { Markdown } from '../../../components/Markdown'
import { resolveModelForMode } from '../../settings/impl/extras'
import { useSettings } from '../../../stores/settings'
import { useUi } from '../../../stores/ui'
import { hasTasksBridge } from '../../tasks/impl/bridge'
import { platformCaps } from '../../../lib/platform'
import { PlatformNote } from '../../../components/PlatformNote'
import { MODE_LABELS } from '@shared/labels'
import { useCode } from '../../code/impl/store'
import { openProjectTrusted } from '../../code/impl/trust'
import { MODE_META } from './meta'
import { RoutineEditor } from './RoutineEditor'
import { agoText, durationText, fullDate, scheduleText, untilText } from './schedule'
import { deleteRoutine, loadRoutines, openEditor, runRoutineNow, subscribeRoutines, toggleRoutine, useRoutines } from './store'
import { ROUTINE_TEMPLATES } from './templates'
import { ensureRoutinesTermsAck, showRoutinesTermsDialog } from './terms'
import { baseName } from '../../../lib/paths'
import { useT } from '../../../lib/i18n'
import { Toggle } from '../../../components/Toggle'

/** Reloj que se actualiza cada `ms` (para cuentas atrás). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function StatusBadge({ status, compact = false }: { status: RoutineRunRecord['status']; compact?: boolean }): React.JSX.Element {
  const t = useT()
  const meta = {
    running: {
      cls: 'bg-accent-soft text-accent',
      icon: <Loader2 size={11} className="animate-spin" />,
      label: t('routines.status.running')
    },
    success: { cls: 'bg-success/10 text-success', icon: <CheckCircle2 size={11} />, label: t('routines.status.success') },
    error: { cls: 'bg-danger/10 text-danger', icon: <XCircle size={11} />, label: t('routines.status.error') }
  }[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      {meta.icon}
      {!compact && meta.label}
    </span>
  )
}

function toInput(r: ScheduledRoutine): RoutineInput {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    mode: r.mode,
    folder: r.folder ?? null,
    model: r.model,
    schedule: r.schedule,
    enabled: r.enabled,
    originSessionId: r.originSessionId ?? null,
    sessionMode: r.sessionMode,
    onAsk: r.onAsk,
    allow: r.allow,
    allowHosts: r.allowHosts,
    fullAccess: r.fullAccess,
    fullAccessConsentAt: r.fullAccessConsentAt ?? null
  }
}

type PermEntry = { permission: string; patterns: string[] }

/** Lista de permisos rechazados/aprobados de una ejecución (historial). */
function PermList({ title, tone, items }: { title: string; tone: 'danger' | 'success'; items: PermEntry[] }): React.JSX.Element {
  const Icon = tone === 'danger' ? ShieldAlert : ShieldCheck
  return (
    <div className="mb-2">
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-medium ${tone === 'danger' ? 'text-danger' : 'text-success'}`}>
        <Icon size={13} /> {title} ({items.length})
      </div>
      <ul className="space-y-0.5">
        {items.map((e, i) => (
          <li key={i} className="flex items-baseline gap-1.5 text-xs text-muted">
            <span className="shrink-0 rounded bg-hover px-1 font-mono text-[11px] text-fg">{e.permission}</span>
            <span className="min-w-0 truncate font-mono text-[11px]" title={e.patterns.join('\n')}>
              {e.patterns.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------

function RoutineCard({ r, selected, now }: { r: ScheduledRoutine; selected: boolean; now: number }): React.JSX.Element {
  const t = useT()
  const Icon = MODE_META[r.mode].icon
  const last = r.lastResult
  const waiting = useRoutines((s) => s.history.some((h) => h.routineId === r.id && h.status === 'running' && h.waiting === true))
  const select = (): void => useRoutines.setState({ selectedId: selected ? null : r.id })
  return (
    // La tarjeta se puede pulsar entera con el ratón; para teclado y lectores el control es el botón del nombre
    // (un interruptor dentro de `role="button"` sería un control anidado).
    <div
      onClick={select}
      className={`group flex cursor-pointer flex-col gap-3 rounded-xl border bg-elevated p-4 text-left transition ${selected ? 'border-accent/60 shadow-md ring-2 ring-accent/15' : 'border-border hover:border-border-strong hover:shadow-sm'}`}
    >
      <div className="flex items-start gap-3">
        <button type="button" aria-pressed={selected} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${r.enabled ? 'bg-accent-soft text-accent' : 'bg-hover text-subtle'}`}
          >
            <Icon size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={`truncate font-medium ${r.enabled ? '' : 'text-muted'}`}>{r.name}</div>
            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
              <Clock size={11} className="shrink-0" /> <span className="truncate">{scheduleText(r.schedule)}</span>
            </div>
            {r.mode === 'tasks' && !platformCaps().tasks && (
              <div className="mt-1 text-[11px] font-medium text-warning">{t('platform.win.unavailable.routineBadge')}</div>
            )}
          </div>
        </button>
        <Toggle
          stopPropagation
          checked={r.enabled}
          onChange={(v) =>
            void ensureRoutinesTermsAck(v).then((ok) => {
              if (ok) void toggleRoutine(r.id, v)
            })
          }
          label={r.enabled ? t('routines.card.deactivate') : t('routines.card.activate')}
        />
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-3 text-xs">
        {r.running ? (
          waiting ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
              <Hourglass size={11} /> {t('routines.card.waitingApproval')}
            </span>
          ) : (
            <StatusBadge status="running" />
          )
        ) : r.enabled && r.nextRun ? (
          <span className="text-muted" title={fullDate(r.nextRun)}>
            {t('routines.card.next')} <span className="font-medium text-fg">{untilText(r.nextRun, now)}</span>
          </span>
        ) : (
          <span className="text-subtle">{r.enabled ? t('routines.card.noNext') : t('routines.card.paused')}</span>
        )}
        {last && !r.running && (
          <span
            className="ml-auto flex items-center gap-1.5 text-subtle"
            title={t('routines.card.last', { date: fullDate(last.startedAt) })}
          >
            {agoText(last.startedAt, now)}
            <StatusBadge status={last.status} compact />
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

function openRunInCode(run: RoutineRunRecord): void {
  if (!run.sessionId || !run.directory) return
  const sid = run.sessionId
  const dir = run.directory
  useUi.getState().setMode('code')
  void openProjectTrusted(dir).then(async (ok) => {
    if (ok) await useCode.getState().selectSession(sid)
  })
}

function RunItem({ run, mode, last, now }: { run: RoutineRunRecord; mode: RoutineMode; last: boolean; now: number }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const dot =
    run.status === 'running'
      ? 'bg-accent ring-accent/25 animate-pulse'
      : run.status === 'success'
        ? 'bg-success ring-success/20'
        : 'bg-danger ring-danger/20'
  const elapsed = (run.finishedAt ?? now) - run.startedAt
  const rejected = run.rejected ?? []
  const approved = run.approved ?? []
  const blocked = run.blockedHosts ?? []
  const hasLog = rejected.length + approved.length + blocked.length > 0
  const hasBody = !!run.summary || !!run.error || hasLog
  return (
    <li className="relative pl-6">
      {!last && <span className="absolute top-4 bottom-0 left-[5px] w-px bg-border" />}
      <span className={`absolute top-1.5 left-0 h-[11px] w-[11px] rounded-full ring-4 ${dot}`} />
      <button
        type="button"
        onClick={() => hasBody && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 text-left text-xs ${hasBody ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="font-medium text-fg">{fullDate(run.startedAt)}</span>
        <span className="rounded-full border border-border px-1.5 text-[10px] text-muted">
          {t(`routines.trigger.${run.trigger}` as 'routines.trigger.manual')}
        </span>
        {run.waiting && run.status === 'running' && (
          <span className="flex items-center gap-1 rounded-full bg-warning/10 px-1.5 text-[10px] font-medium text-warning">
            <Hourglass size={10} /> {t('routines.card.waitingApproval')}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-subtle tabular-nums">
          {run.status === 'running' ? (
            <span className="text-accent">{durationText(elapsed)}…</span>
          ) : run.finishedAt ? (
            durationText(elapsed)
          ) : null}
          {hasBody && <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
        </span>
      </button>
      {run.waiting && run.status === 'running' && !open && <p className="mt-1 text-xs text-warning">{t('routines.run.waitingYou')}</p>}
      {!open && (rejected.length > 0 || blocked.length > 0) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-danger">
          <ShieldAlert size={12} className="shrink-0" />
          {[
            rejected.length > 0 && t('routines.run.rejectedCount', { count: rejected.length }),
            blocked.length > 0 && t('routines.run.blockedCount', { count: blocked.length })
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {run.status === 'error' && run.error && !open && <p className="mt-1 line-clamp-2 text-xs text-danger">{run.error}</p>}
      {run.summary && !open && run.status !== 'error' && (
        <p className="mt-1 line-clamp-2 text-xs text-muted">{run.summary.replace(/[#*_`>]/g, '').slice(0, 240)}</p>
      )}
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-elevated p-3">
          {run.error && (
            <p className="mb-2 flex items-start gap-1.5 text-sm text-danger">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {run.error}
            </p>
          )}
          {run.waiting && run.status === 'running' && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-warning">
              <Hourglass size={13} className="mt-0.5 shrink-0" /> {t('routines.run.waitingYou')}
            </p>
          )}
          {rejected.length > 0 && <PermList title={t('routines.run.rejected')} tone="danger" items={rejected} />}
          {approved.length > 0 && <PermList title={t('routines.run.approved')} tone="success" items={approved} />}
          {blocked.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-danger">
                <ShieldAlert size={13} /> {t('routines.run.blockedSites')} ({blocked.length})
              </div>
              <p className="font-mono text-[11px] break-all text-muted">{blocked.join(', ')}</p>
              <p className="mt-0.5 text-[11px] text-subtle">{t('routines.run.blockedHint')}</p>
            </div>
          )}
          {run.summary && (
            <div className={`max-h-96 overflow-y-auto text-sm ${hasLog ? 'border-t border-border pt-2' : ''}`}>
              <Markdown text={run.summary} />
            </div>
          )}
          {mode === 'code' && run.sessionId && run.directory && (
            <button
              type="button"
              onClick={() => openRunInCode(run)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <ExternalLink size={12} /> {t('routines.run.openInCode')}
            </button>
          )}
        </div>
      )}
      <div className="pb-4" />
    </li>
  )
}

function RoutineDetail({ r, now }: { r: ScheduledRoutine; now: number }): React.JSX.Element {
  const t = useT()
  const allHistory = useRoutines((s) => s.history)
  const history = useMemo(
    () => allHistory.filter((h) => h.routineId === r.id).sort((a, b) => b.startedAt - a.startedAt),
    [allHistory, r.id]
  )
  const [starting, setStarting] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const Icon = MODE_META[r.mode].icon
  const unavailable = r.mode === 'tasks' && !platformCaps().tasks
  const running = r.running || history.some((h) => h.status === 'running')
  const stats = useMemo(() => {
    const done = history.filter((h) => h.status !== 'running')
    return { total: done.length, ok: done.filter((h) => h.status === 'success').length }
  }, [history])

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{r.name}</h2>
            <div className="text-xs text-muted">{scheduleText(r.schedule)}</div>
          </div>
          <button
            type="button"
            onClick={() => useRoutines.setState({ selectedId: null })}
            aria-label={t('routines.detail.close')}
            className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        {unavailable && (
          <div className="mt-3">
            <PlatformNote>{t('platform.win.unavailable.routine', { tasks: MODE_LABELS.tasks })}</PlatformNote>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            disabled={running || starting || unavailable}
            onClick={() => {
              setStarting(true)
              void runRoutineNow(r.id).finally(() => setStarting(false))
            }}
          >
            {running || starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? t('routines.detail.running') : t('routines.detail.runNow')}
          </Button>
          <Button variant="secondary" onClick={() => openEditor(toInput(r))}>
            <Pencil size={14} /> {t('routines.detail.edit')}
          </Button>
          <Button
            variant="ghost"
            className="ml-auto hover:text-danger"
            title={t('routines.detail.delete')}
            aria-label={t('routines.detail.delete')}
            onClick={() => {
              void confirmDialog({
                title: t('routines.detail.deleteTitle'),
                message: t('routines.detail.deleteMessage', { name: r.name }),
                confirmLabel: t('routines.detail.deleteConfirm'),
                danger: true
              }).then((ok) => {
                if (ok) void deleteRoutine(r.id)
              })
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-subtle">{t('routines.detail.mode')}</dt>
          <dd className="flex items-center gap-1 text-fg">
            <Icon size={12} /> {MODE_META[r.mode].label}
          </dd>
          <dt className="text-subtle">{t('routines.detail.model')}</dt>
          <dd className="truncate font-mono text-fg" title={`${r.model.providerID}/${r.model.modelID}`}>
            {r.model.modelID}
          </dd>
          {r.folder && (
            <>
              <dt className="text-subtle">{t('routines.detail.folder')}</dt>
              <dd className="flex min-w-0 items-center gap-1 text-fg" title={r.folder}>
                <FolderOpen size={12} className="shrink-0" /> <span className="truncate">{baseName(r.folder)}</span>
              </dd>
            </>
          )}
          {r.mode === 'tasks' && (
            <>
              <dt className="text-subtle">{t('routines.detail.eachRun')}</dt>
              <dd className="text-fg">{r.sessionMode === 'continue' ? t('routines.detail.continue') : t('routines.detail.fresh')}</dd>
              <dt className="text-subtle">{t('routines.detail.onAsk')}</dt>
              <dd className="text-fg">{r.onAsk === 'wait' ? t('routines.detail.onAskWait') : t('routines.detail.onAskReject')}</dd>
              {(r.allow?.length ?? 0) > 0 && (
                <>
                  <dt className="text-subtle">{t('routines.detail.allowed')}</dt>
                  <dd className="text-fg">{t('routines.detail.rules', { count: r.allow!.length })}</dd>
                </>
              )}
              {(r.allowHosts?.length ?? 0) > 0 && (
                <>
                  <dt className="text-subtle">{t('routines.detail.sites')}</dt>
                  <dd className="truncate text-fg" title={r.allowHosts!.join(', ')}>
                    {r.allowHosts!.join(', ')}
                  </dd>
                </>
              )}
              {r.fullAccess && (
                <>
                  <dt className="text-subtle">{TASKS_TERMS.fullControlShort}</dt>
                  <dd className="text-warning">{t('routines.detail.fullActive')}</dd>
                </>
              )}
            </>
          )}
          <dt className="text-subtle">{t('routines.detail.nextLabel')}</dt>
          <dd className="text-fg">
            {r.enabled && r.nextRun ? `${untilText(r.nextRun, now)} · ${fullDate(r.nextRun)}` : r.enabled ? '—' : t('routines.card.paused')}
          </dd>
          {stats.total > 0 && (
            <>
              <dt className="text-subtle">{t('routines.detail.success')}</dt>
              <dd className="text-fg">{t('routines.detail.successRuns', { ok: stats.ok, total: stats.total })}</dd>
            </>
          )}
        </dl>

        <button
          type="button"
          onClick={() => setShowPrompt((s) => !s)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
        >
          <ChevronDown size={13} className={`transition-transform ${showPrompt ? 'rotate-180' : ''}`} /> {t('routines.detail.prompt')}
        </button>
        {showPrompt ? (
          <p className="mt-1.5 max-h-48 overflow-y-auto rounded-lg bg-bg px-3 py-2 text-sm whitespace-pre-wrap text-muted">{r.prompt}</p>
        ) : (
          <p className="mt-1 line-clamp-2 text-xs text-subtle">{r.prompt}</p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h3 className="mb-3 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t('routines.detail.history')}</h3>
        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-subtle">
            {t('routines.detail.historyEmpty1')}
            <b className="font-medium text-muted">{t('routines.detail.runNow')}</b>
            {t('routines.detail.historyEmpty2')}
          </div>
        ) : (
          <ol>
            {history.map((h, i) => (
              <RunItem key={h.id} run={h} mode={r.mode} last={i === history.length - 1} now={now} />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estado vacío
// ---------------------------------------------------------------------------

const TEMPLATE_ICON: Record<string, LucideIcon> = { news: Newspaper, downloads: FolderOpen, inbox: FileText, repo: Terminal }

function EmptyState({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <CalendarClock size={28} />
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">{t('routines.empty.title')}</h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{t('routines.empty.desc')}</p>
      <div className="mt-8 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
        {ROUTINE_TEMPLATES.filter((tpl) => tpl.input.mode !== 'tasks' || platformCaps().tasks).map((tpl) => {
          const Icon = TEMPLATE_ICON[tpl.id] ?? CalendarClock
          const ModeIcon = MODE_META[tpl.input.mode].icon
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => openEditor({ ...tpl.input, model: resolveModelForMode(tpl.input.mode), enabled: true }, tpl.needs ?? null)}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-elevated p-4 transition hover:-translate-y-px hover:border-border-strong hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-muted transition group-hover:bg-accent-soft group-hover:text-accent">
                  <Icon size={16} />
                </span>
                <span className="flex items-center gap-1 text-[11px] text-subtle">
                  <ModeIcon size={11} /> {MODE_META[tpl.input.mode].label}
                </span>
              </div>
              <div className="text-sm font-medium">{tpl.title}</div>
              <div className="text-xs leading-relaxed text-muted">{tpl.description}</div>
              <div className="mt-auto flex items-center gap-1 pt-1 text-[11px] text-subtle">
                <Clock size={11} /> {scheduleText(tpl.input.schedule)}
              </div>
            </button>
          )
        })}
      </div>
      <Button variant="secondary" className="mt-6" onClick={onCreate}>
        <Plus size={15} /> {t('routines.empty.fromScratch')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export function RoutinesView(): React.JSX.Element {
  const t = useT()
  const bridge = hasTasksBridge()
  const routines = useRoutines((s) => s.routines)
  const loading = useRoutines((s) => s.loading)
  const error = useRoutines((s) => s.error)
  const editing = useRoutines((s) => s.editing)
  const selectedId = useRoutines((s) => s.selectedId)
  const acknowledged = useSettings((s) => s.settings.routinesTermsAcknowledged)
  const now = useNow(20_000)
  const hasRunning = routines.some((r) => r.running)
  const fastNow = useNow(hasRunning ? 1000 : 60_000)

  useEffect(() => {
    if (!bridge) return
    void loadRoutines()
    return subscribeRoutines()
  }, [bridge])

  const selected = routines.find((r) => r.id === selectedId) ?? null
  const sorted = useMemo(
    () =>
      [...routines].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity)
      }),
    [routines]
  )
  const activeCount = routines.filter((r) => r.enabled).length

  const create = (): void =>
    openEditor({
      name: '',
      prompt: '',
      mode: 'chat',
      folder: null,
      model: resolveModelForMode('chat'),
      schedule: { kind: 'daily', time: '09:00' },
      enabled: true
    })

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-danger">
        <AlertCircle size={16} className="mr-2" /> {t('routines.view.noBridge')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          title={t('routines.view.title')}
          meta={
            <>
              {routines.length > 0 && (
                <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-muted">
                  {t('routines.view.active', { count: activeCount })}
                </span>
              )}
              {loading && <Loader2 size={14} className="animate-spin text-muted" />}
            </>
          }
          actions={
            routines.length > 0 ? (
              <Button variant="primary" onClick={create}>
                <Plus size={15} /> {t('routines.view.new')}
              </Button>
            ) : undefined
          }
        />
        {needsRoutinesNotice(acknowledged, routines) && (
          <div
            role="status"
            data-testid="routines-terms-notice"
            className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            <ShieldAlert size={15} className="shrink-0" /> <span className="min-w-0 flex-1">{t('routines.terms.notice')}</span>
            <Button variant="secondary" onClick={() => void showRoutinesTermsDialog()}>
              {t('routines.terms.noticeButton')}
            </Button>
          </div>
        )}
        {error && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle size={15} className="shrink-0" /> <span className="min-w-0 flex-1">{error}</span>
            <button type="button" className="shrink-0 text-xs underline" onClick={() => useRoutines.setState({ error: null })}>
              {t('routines.view.close')}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {routines.length === 0 && !loading ? (
            <EmptyState onCreate={create} />
          ) : (
            <div className={`mx-auto grid max-w-5xl grid-cols-1 gap-3 ${selected ? 'xl:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
              {sorted.map((r) => (
                <RoutineCard key={r.id} r={r} selected={r.id === selectedId} now={r.running ? fastNow : now} />
              ))}
            </div>
          )}
        </div>
      </section>

      {selected && (
        <aside className="w-[420px] shrink-0 border-l border-border bg-bg">
          <RoutineDetail key={selected.id} r={selected} now={fastNow} />
        </aside>
      )}

      {editing && <RoutineEditor key={editing.id ?? 'new'} initial={editing} />}
    </div>
  )
}

export default RoutinesView
