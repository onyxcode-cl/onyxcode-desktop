/** Panel derecho: plan (todos), actividad de herramientas y entregables. */
import { useMemo, useState } from 'react'
import { shortenPath } from '../../../lib/paths'
import type { Todo, ToolPart } from '@opencode-ai/sdk/v2/client'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleX,
  ExternalLink,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Package,
  RefreshCw,
  Wrench
} from 'lucide-react'
import type { CoworkDeliverable } from '@shared/ipc-cowork'
import { useSessions, type MessageEntry } from '../../../stores/sessions'
import { openPath, reveal } from './actions'
import { ScreenshotThumbs } from './ComputerAccess'
import { computerToolDetail, computerToolInfo, computerToolKind, toolImages } from './computer-tools'
import { refreshDeliverables, useCowork } from './store'

const EMPTY_TODOS: Todo[] = []
const EMPTY_FILES: CoworkDeliverable[] = []
const EMPTY_ENTRIES: MessageEntry[] = []

function TodoIcon({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={15} className="text-accent" />
    case 'in_progress':
      return <Loader2 size={15} className="animate-spin text-accent" />
    case 'cancelled':
      return <CircleX size={15} className="text-subtle" />
    default:
      return <Circle size={15} className="text-subtle" />
  }
}

function Section({
  icon: Icon,
  title,
  right,
  children
}: {
  icon: typeof ListChecks
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="border-b border-border px-4 py-3 last:border-b-0">
      <header className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        <Icon size={14} />
        <span>{title}</span>
        <span className="ml-auto normal-case">{right}</span>
      </header>
      {children}
    </section>
  )
}

function toolLabel(part: ToolPart): string {
  const s = part.state
  if ('title' in s && s.title) return shortenPath(s.title)
  const input = s.input
  for (const key of ['description', 'filePath', 'path', 'command', 'pattern', 'url']) {
    const v = input[key]
    if (typeof v === 'string' && v) return shortenPath(v)
  }
  return ''
}

const TOOL_NAMES: Record<string, string> = {
  read: 'Leer',
  write: 'Escribir',
  edit: 'Editar',
  bash: 'Terminal',
  glob: 'Buscar archivos',
  grep: 'Buscar texto',
  list: 'Listar',
  webfetch: 'Web',
  websearch: 'Buscar en web',
  todowrite: 'Plan',
  task: 'Subtarea'
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function ProgressPanel({ sessionID }: { sessionID: string | null }): React.JSX.Element {
  const todos = useCowork((s) => (sessionID ? (s.todos[sessionID] ?? EMPTY_TODOS) : EMPTY_TODOS))
  const files = useCowork((s) => (sessionID ? (s.deliverables[sessionID] ?? EMPTY_FILES) : EMPTY_FILES))
  const entries = useSessions((s) => (sessionID ? (s.messages[sessionID] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES))
  const [showAll, setShowAll] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const tools = useMemo(() => {
    const out: ToolPart[] = []
    for (const e of entries) for (const p of e.parts) if (p.type === 'tool' && p.tool !== 'todowrite') out.push(p)
    return out.reverse()
  }, [entries])

  const done = todos.filter((t) => t.status === 'completed').length
  const visibleTools = showAll ? tools : tools.slice(0, 12)

  const run = (fn: () => Promise<void>): void => {
    setActionError(null)
    fn().catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
  }

  if (!sessionID) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-subtle">
        <ListChecks size={22} />
        Aquí verás el plan, la actividad y los archivos entregados de la tarea.
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto text-sm">
      <Section icon={ListChecks} title="Plan" right={todos.length > 0 ? `${done}/${todos.length}` : undefined}>
        {todos.length === 0 ? (
          <p className="text-xs text-subtle">El agente aún no ha publicado un plan.</p>
        ) : (
          <>
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-hover">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(done / todos.length) * 100}%` }}
              />
            </div>
            <ul className="space-y-1.5">
              {todos.map((t, i) => (
                <li key={`${i}-${t.content}`} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    <TodoIcon status={t.status} />
                  </span>
                  <span
                    className={
                      t.status === 'completed'
                        ? 'text-subtle line-through'
                        : t.status === 'in_progress'
                          ? 'font-medium text-fg'
                          : 'text-muted'
                    }
                  >
                    {t.content}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section
        icon={Package}
        title="Entregables"
        right={
          <button
            type="button"
            title="Actualizar"
            className="rounded p-0.5 text-subtle hover:text-fg"
            onClick={() => void refreshDeliverables(sessionID)}
          >
            <RefreshCw size={12} />
          </button>
        }
      >
        {actionError && (
          <p className="mb-2 flex items-center gap-1 text-xs text-danger">
            <AlertCircle size={12} /> {actionError}
          </p>
        )}
        {files.length === 0 ? (
          <p className="text-xs text-subtle">Todavía no hay archivos nuevos o modificados.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.path} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-hover">
                <FileText size={14} className="shrink-0 text-muted" />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  title={`Abrir ${f.relPath}`}
                  onClick={() => run(() => openPath(f.path))}
                >
                  {f.relPath}
                </button>
                <span className="shrink-0 text-[11px] text-subtle group-hover:hidden">{formatSize(f.size)}</span>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    title="Abrir"
                    className="rounded p-0.5 text-muted hover:text-fg"
                    onClick={() => run(() => openPath(f.path))}
                  >
                    <ExternalLink size={13} />
                  </button>
                  <button
                    type="button"
                    title="Abrir en Finder"
                    className="rounded p-0.5 text-muted hover:text-fg"
                    onClick={() => run(() => reveal(f.path))}
                  >
                    <FolderOpen size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Wrench} title="Actividad" right={tools.length > 0 ? String(tools.length) : undefined}>
        {tools.length === 0 ? (
          <p className="text-xs text-subtle">Sin actividad todavía.</p>
        ) : (
          <ul className="space-y-1">
            {visibleTools.map((p) => {
              const kind = computerToolKind(p.tool)
              const info = kind ? computerToolInfo(kind) : null
              const detail = kind ? computerToolDetail(kind, p.state.input) : toolLabel(p)
              const images = toolImages(p)
              const KindIcon = info?.icon
              return (
                <li key={p.id} className="text-xs">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      {p.state.status === 'completed' ? (
                        <CheckCircle2 size={13} className="text-accent" />
                      ) : p.state.status === 'error' ? (
                        <AlertCircle size={13} className="text-danger" />
                      ) : p.state.status === 'running' ? (
                        <Loader2 size={13} className="animate-spin text-accent" />
                      ) : (
                        <CircleDashed size={13} className="text-subtle" />
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-medium text-fg">
                      {KindIcon && <KindIcon size={12} className="text-amber-500" />}
                      {info?.label ?? TOOL_NAMES[p.tool] ?? p.tool}
                    </span>
                    <span className="min-w-0 truncate font-mono text-subtle" title={detail}>
                      {detail}
                    </span>
                  </div>
                  {p.state.status === 'error' && kind && (
                    <p className="mt-0.5 ml-5 line-clamp-2 text-danger" title={p.state.error}>
                      {p.state.error}
                    </p>
                  )}
                  {images.length > 0 && (
                    <div className="ml-5">
                      <ScreenshotThumbs images={images} />
                    </div>
                  )}
                </li>
              )
            })}
            {tools.length > 12 && (
              <li>
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Ver menos' : `Ver todo (${tools.length})`}
                </button>
              </li>
            )}
          </ul>
        )}
      </Section>
    </div>
  )
}
