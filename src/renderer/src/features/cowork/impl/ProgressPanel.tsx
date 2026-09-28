/**
 * Panel derecho: Plan (todos en vivo), Entregables (con vista previa), Contexto (herramientas,
 * archivos y conectores usados, con scroll a la conversación), Programada (rutina vinculada, si
 * se creó con "Programar esta tarea") y Actividad agrupada por paso.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Todo, ToolPart } from '@opencode-ai/sdk/v2/client'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleX,
  FileInput,
  FileOutput,
  Globe,
  ListChecks,
  Loader2,
  Package,
  Plug,
  RefreshCw,
  Terminal,
  Activity
} from 'lucide-react'
import type { CoworkDeliverable, RoutineRunRecord, ScheduledRoutine } from '@shared/ipc-cowork'
import { cw } from './bridge'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { ScreenshotThumbs } from './ComputerAccess'
import { computerToolKind, toolImages } from './computer-tools'
import { DeliverableList } from './Deliverables'
import { requestScrollToPart } from './scroll'
import { refreshDeliverables, useCowork } from './store'
import { buildContext, friendlyTool, groupActivityBySteps, relTime, type ContextItem } from './util'

const EMPTY_TODOS: Todo[] = []
const EMPTY_FILES: CoworkDeliverable[] = []
const EMPTY_ENTRIES: MessageEntry[] = []

function TodoIcon({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={16} className="text-accent" />
    case 'in_progress':
      return <Loader2 size={16} className="animate-spin text-accent" />
    case 'cancelled':
      return <CircleX size={16} className="text-subtle" />
    default:
      return <Circle size={16} className="text-subtle" />
  }
}

function Section({
  icon: Icon,
  title,
  badge,
  right,
  defaultOpen = true,
  children
}: {
  icon: typeof ListChecks
  title: string
  badge?: React.ReactNode
  right?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold"
        >
          <ChevronRight size={13} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
          <Icon size={14} className="shrink-0 text-muted" />
          <span>{title}</span>
          {badge !== undefined && <span className="rounded-full bg-hover px-1.5 text-[11px] font-medium text-muted">{badge}</span>}
        </button>
        {right}
      </header>
      {open && <div className="px-4 pb-3.5">{children}</div>}
    </section>
  )
}

function ToolStatusIcon({ part }: { part: ToolPart }): React.JSX.Element {
  switch (part.state.status) {
    case 'completed':
      return <CheckCircle2 size={12} className="text-accent" />
    case 'error':
      return <AlertCircle size={12} className="text-danger" />
    case 'running':
      return <Loader2 size={12} className="animate-spin text-accent" />
    default:
      return <CircleDashed size={12} className="text-subtle" />
  }
}

/** Una fila de actividad legible ("Leyó informe.md"). */
export function ActivityRow({ part }: { part: ToolPart }): React.JSX.Element {
  const { verb, detail } = friendlyTool(part)
  const images = toolImages(part)
  const isComputer = !!computerToolKind(part.tool)
  return (
    <li className="text-xs">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <ToolStatusIcon part={part} />
        </span>
        <span className="min-w-0 flex-1 truncate" title={detail ? `${verb} ${detail}` : verb}>
          <span className={isComputer ? 'text-amber-600 [[data-theme=dark]_&]:text-amber-400' : 'text-fg'}>{verb}</span>
          {detail && <span className="text-muted"> {detail}</span>}
        </span>
      </div>
      {part.state.status === 'error' && (
        <p className="mt-0.5 ml-5 line-clamp-2 text-danger" title={part.state.error}>
          {part.state.error}
        </p>
      )}
      {images.length > 0 && (
        <div className="ml-5">
          <ScreenshotThumbs images={images} />
        </div>
      )}
    </li>
  )
}

function ActivityGroup({ title, tools, live }: { title: string | null; tools: ToolPart[]; live: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(live)
  const [showAll, setShowAll] = useState(false)
  const failed = tools.filter((t) => t.state.status === 'error').length
  const visible = showAll ? tools : tools.slice(-8)
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-1.5 text-left text-xs">
        <ChevronRight size={12} className={`mt-0.5 shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={`min-w-0 flex-1 ${live ? 'font-semibold text-fg' : 'font-medium text-muted'}`}>
          {title ?? 'Preparación'}
        </span>
        <span className="shrink-0 text-[11px] text-subtle">
          {failed > 0 && <span className="mr-1 text-danger">{failed} ✕</span>}
          {tools.length}
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 mb-1 ml-1.5 space-y-1.5 border-l border-border pl-3">
          {tools.length > visible.length && (
            <li>
              <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setShowAll(true)}>
                Ver {tools.length - visible.length} anteriores
              </button>
            </li>
          )}
          {visible.map((p) => (
            <ActivityRow key={p.id} part={p} />
          ))}
        </ul>
      )}
    </li>
  )
}

function ContextRow({ item }: { item: ContextItem }): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => requestScrollToPart(item.partId)}
        title={item.sub ?? item.label}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-fg hover:bg-hover"
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
    </li>
  )
}

function ContextGroup({
  icon: Icon,
  label,
  items
}: {
  icon: typeof FileInput
  label: string
  items: ContextItem[]
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-subtle">
        <Icon size={12} /> {label} <span className="text-subtle/70">· {items.length}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <ContextRow key={`${it.partId}-${i}`} item={it} />
        ))}
      </ul>
    </div>
  )
}

/** Rutina vinculada a esta tarea ("Programar esta tarea") y sus últimas ejecuciones. */
function ScheduledSection({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const [routine, setRoutine] = useState<ScheduledRoutine | null | undefined>(undefined)
  const [runs, setRuns] = useState<RoutineRunRecord[]>([])

  useEffect(() => {
    let alive = true
    setRoutine(undefined)
    setRuns([])
    void cw('routines:list').then((list) => {
      if (!alive) return
      const found = list.find((r) => r.originSessionId === sessionID) ?? null
      setRoutine(found)
      if (found) void cw('routines:history', { id: found.id, limit: 5 }).then((h) => alive && setRuns(h))
    }, () => alive && setRoutine(null))
    return () => {
      alive = false
    }
  }, [sessionID])

  if (!routine) return null
  return (
    <Section icon={CalendarClock} title="Programada" badge={routine.enabled ? 'Activa' : 'Pausada'}>
      <p className="mb-2 text-[13px] font-medium text-fg">{routine.name}</p>
      {runs.length === 0 ? (
        <p className="text-xs text-subtle">Aún no se ha ejecutado.</p>
      ) : (
        <ul className="space-y-1">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              {r.status === 'success' ? (
                <CheckCircle2 size={12} className="shrink-0 text-accent" />
              ) : r.status === 'error' ? (
                <AlertCircle size={12} className="shrink-0 text-danger" />
              ) : (
                <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
              )}
              <span className="text-muted">{relTime(r.startedAt)}</span>
              {r.summary && <span className="min-w-0 flex-1 truncate text-subtle" title={r.summary}>{r.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function ProgressPanel({ sessionID, busy }: { sessionID: string | null; busy: boolean }): React.JSX.Element {
  const todos = useCowork((s) => (sessionID ? (s.todos[sessionID] ?? EMPTY_TODOS) : EMPTY_TODOS))
  const files = useCowork((s) => (sessionID ? (s.deliverables[sessionID] ?? EMPTY_FILES) : EMPTY_FILES))
  const entries = useSessions((s) => (sessionID ? (s.messages[sessionID] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES))
  const groups = useMemo(() => groupActivityBySteps(entries), [entries])
  const toolCount = groups.reduce((n, g) => n + g.tools.length, 0)
  const context = useMemo(() => buildContext(entries), [entries])
  const contextCount =
    context.filesRead.length + context.filesWritten.length + context.commands.length + context.web.length + context.connectors.length

  if (!sessionID) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-subtle">
        <ListChecks size={22} />
        Aquí verás el plan, los archivos entregados y la actividad de la tarea.
      </div>
    )
  }

  const done = todos.filter((t) => t.status === 'completed').length
  const pct = todos.length > 0 ? Math.round((done / todos.length) * 100) : 0

  return (
    <div className="h-full overflow-y-auto text-sm">
      <Section icon={ListChecks} title="Plan" badge={todos.length > 0 ? `${done}/${todos.length}` : undefined}>
        {todos.length === 0 ? (
          <p className="text-xs text-subtle">
            {busy ? 'El agente está preparando el plan…' : 'Esta tarea no tiene un plan publicado.'}
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] text-muted tabular-nums">{pct}%</span>
            </div>
            <ol className="space-y-1">
              {todos.map((t, i) => {
                const current = t.status === 'in_progress'
                return (
                  <li
                    key={`${i}-${t.content}`}
                    className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${current ? 'bg-accent-soft' : ''}`}
                  >
                    <span className="mt-px shrink-0">
                      <TodoIcon status={t.status} />
                    </span>
                    <span
                      className={`text-[13px] leading-snug ${
                        t.status === 'completed'
                          ? 'text-subtle line-through'
                          : current
                            ? 'font-medium text-fg'
                            : t.status === 'cancelled'
                              ? 'text-subtle line-through'
                              : 'text-muted'
                      }`}
                    >
                      {t.content}
                    </span>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </Section>

      <Section
        icon={Package}
        title="Entregables"
        badge={files.length > 0 ? files.length : undefined}
        right={
          <button
            type="button"
            title="Actualizar"
            className="rounded p-1 text-subtle hover:bg-hover hover:text-fg"
            onClick={() => void refreshDeliverables(sessionID)}
          >
            <RefreshCw size={12} />
          </button>
        }
      >
        {files.length === 0 ? (
          <p className="text-xs text-subtle">Los archivos que cree o modifique el agente aparecerán aquí.</p>
        ) : (
          <DeliverableList files={files} />
        )}
      </Section>

      <ScheduledSection sessionID={sessionID} />

      <Section icon={Plug} title="Contexto" badge={contextCount > 0 ? contextCount : undefined} defaultOpen={false}>
        {contextCount === 0 ? (
          <p className="text-xs text-subtle">
            Aquí verás qué archivos, comandos y conectores usó el agente. Haz clic en una entrada para ir a ese punto de
            la conversación.
          </p>
        ) : (
          <>
            <ContextGroup icon={FileInput} label="Archivos leídos" items={context.filesRead} />
            <ContextGroup icon={FileOutput} label="Archivos creados o editados" items={context.filesWritten} />
            <ContextGroup icon={Terminal} label="Comandos" items={context.commands} />
            <ContextGroup icon={Globe} label="Web" items={context.web} />
            <ContextGroup icon={Plug} label="Conectores" items={context.connectors} />
          </>
        )}
      </Section>

      <Section icon={Activity} title="Actividad" badge={toolCount > 0 ? toolCount : undefined} defaultOpen={busy}>
        {groups.length === 0 ? (
          <p className="text-xs text-subtle">Sin actividad todavía.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g, i) => (
              <ActivityGroup
                key={`${i}-${g.title ?? ''}`}
                title={g.title}
                tools={g.tools}
                live={busy && i === groups.length - 1}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
