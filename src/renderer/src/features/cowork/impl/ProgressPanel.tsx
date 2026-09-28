/** Panel derecho: Plan (todos en vivo), Entregables (con vista previa) y Actividad agrupada por paso. */
import { useMemo, useState } from 'react'
import type { Todo, ToolPart } from '@opencode-ai/sdk/v2/client'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleX,
  ListChecks,
  Loader2,
  Package,
  RefreshCw,
  Activity
} from 'lucide-react'
import type { CoworkDeliverable } from '@shared/ipc-cowork'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { ScreenshotThumbs } from './ComputerAccess'
import { computerToolKind, toolImages } from './computer-tools'
import { DeliverableList } from './Deliverables'
import { refreshDeliverables, useCowork } from './store'
import { friendlyTool, groupActivityBySteps } from './util'

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

export function ProgressPanel({ sessionID, busy }: { sessionID: string | null; busy: boolean }): React.JSX.Element {
  const todos = useCowork((s) => (sessionID ? (s.todos[sessionID] ?? EMPTY_TODOS) : EMPTY_TODOS))
  const files = useCowork((s) => (sessionID ? (s.deliverables[sessionID] ?? EMPTY_FILES) : EMPTY_FILES))
  const entries = useSessions((s) => (sessionID ? (s.messages[sessionID] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES))
  const groups = useMemo(() => groupActivityBySteps(entries), [entries])
  const toolCount = groups.reduce((n, g) => n + g.tools.length, 0)

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
