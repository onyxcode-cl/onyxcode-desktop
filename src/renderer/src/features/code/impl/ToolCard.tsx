/**
 * Llamadas a herramientas del agente, en formato compacto:
 *  - pasos consecutivos se agrupan (`StepGroup`) con un resumen ("Leyó 3 archivos · Editó 1…"),
 *  - las ediciones se muestran como chip de archivo con +/- que se expande al diff,
 *  - bash muestra el comando y su salida plegable.
 */
import { memo, useMemo, useState, type ReactNode } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { t, type MsgKey } from '@shared/i18n'
import { useLocale, useT } from '../../../lib/i18n'
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  FolderSearch,
  Globe,
  ListTodo,
  Loader2,
  SquareTerminal,
  Wrench,
  XCircle
} from 'lucide-react'
import { parseTodos } from '../../../lib/conversation/parts'
import { DiffView, diffStats, makePatch } from './DiffView'
import { ADD_TEXT, DEL_TEXT } from './ui'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

/** Ruta relativa al proyecto si cae dentro. */
export function relPath(p: string, root: string | null): string {
  if (!p) return ''
  if (root && p.startsWith(root)) {
    const r = p.slice(root.length).replace(/^[/\\]/, '')
    return r || '.'
  }
  return p
}

function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

interface TodoItem {
  content: string
  status: string
  priority?: string
}

export function TodoList({ todos }: { todos: TodoItem[] }): React.JSX.Element {
  return (
    <ul className="space-y-1 text-[13px]">
      {todos.map((t, i) => (
        <li key={i} className="flex items-start gap-2">
          {t.status === 'completed' ? (
            <Check size={14} className="mt-0.5 shrink-0 text-accent" />
          ) : t.status === 'in_progress' ? (
            <CircleDot size={14} className="mt-0.5 shrink-0 animate-pulse text-accent" />
          ) : t.status === 'cancelled' ? (
            <XCircle size={14} className="mt-0.5 shrink-0 text-subtle" />
          ) : (
            <Circle size={14} className="mt-0.5 shrink-0 text-subtle" />
          )}
          <span
            className={
              t.status === 'completed' || t.status === 'cancelled'
                ? 'text-muted line-through decoration-subtle'
                : t.status === 'in_progress'
                  ? 'font-medium text-fg'
                  : 'text-fg'
            }
          >
            {t.content}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Output({ text, max = 'max-h-72' }: { text: string; max?: string }): React.JSX.Element | null {
  if (!text) return null
  return <pre className={`${max} overflow-auto bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-fg`}>{text}</pre>
}

// ---------------------------------------------------------------------------
// Clasificación
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
export function summarizeSteps(parts: ToolPart[]): string {
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

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

type Status = ToolPart['state']['status']

function StatusMark({ status }: { status: Status }): React.JSX.Element | null {
  if (status === 'completed') return null
  if (status === 'error') return <AlertCircle size={13} className="text-danger" />
  return <Loader2 size={13} className="animate-spin text-muted" />
}

interface RowProps {
  icon: ReactNode
  verb: string
  detail?: ReactNode
  extra?: ReactNode
  status: Status
  /** Abierto por defecto (se puede sobrescribir haciendo clic). */
  autoOpen?: boolean
  children?: ReactNode
}

function Row({ icon, verb, detail, extra, status, autoOpen = false, children }: RowProps): React.JSX.Element {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? autoOpen
  const expandable = !!children
  return (
    <div className="text-[13px]">
      <button
        type="button"
        onClick={() => expandable && setUserOpen(!open)}
        aria-expanded={expandable ? open : undefined}
        className={`group/row flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted ${expandable ? 'hover:bg-hover hover:text-fg' : 'cursor-default'}`}
      >
        <span className={`shrink-0 ${status === 'error' ? 'text-danger' : 'text-subtle group-hover/row:text-muted'}`}>{icon}</span>
        <span className="shrink-0 text-fg/90">{verb}</span>
        {detail && <span className="min-w-0 truncate">{detail}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {extra}
          <StatusMark status={status} />
          {expandable && (
            <ChevronRight
              size={13}
              className={`text-subtle transition-transform ${open ? 'rotate-90' : 'opacity-0 group-hover/row:opacity-100'}`}
            />
          )}
        </span>
      </button>
      {open && children && <div className="mt-1 mb-1.5 ml-6 overflow-hidden rounded-lg border border-border bg-elevated">{children}</div>}
    </div>
  )
}

export function DiffStats({ additions, deletions }: { additions: number; deletions: number }): React.JSX.Element | null {
  if (!additions && !deletions) return null
  return (
    <span className="font-mono text-[11px] tabular-nums">
      <span className={ADD_TEXT}>+{additions}</span> <span className={DEL_TEXT}>-{deletions}</span>
    </span>
  )
}

function editInfo(part: ToolPart, root: string | null): { file: string; patch: string } {
  const { state } = part
  const input = state.input ?? {}
  const meta = ('metadata' in state && state.metadata) || {}
  const tool = part.tool
  const file = relPath(str(input.filePath) || str(input.path), root) || ('title' in state ? (state.title ?? '') : '')
  let patch = str(meta.diff)
  if (!patch && tool === 'edit' && (str(input.oldString) || str(input.newString))) {
    patch = makePatch(file, str(input.oldString), str(input.newString))
  }
  if (!patch && tool === 'write' && str(input.content)) patch = makePatch(file, '', str(input.content))
  if (!patch && (tool === 'patch' || tool === 'apply_patch')) patch = str(input.patchText) || str(input.patch)
  return { file, patch }
}

/** Chip de archivo editado con +/- que se expande al diff. */
function EditChip({ part, root }: { part: ToolPart; root: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()
  const { file, patch } = useMemo(() => editInfo(part, root), [part, root])
  const label = part.tool === 'write' ? t('code.tool.created') : t('code.tool.edited')
  const stats = useMemo(() => (patch ? diffStats(patch) : { additions: 0, deletions: 0 }), [patch])
  const { dir, name } = splitPath(file)
  const status = part.state.status
  const error = status === 'error' ? part.state.error : ''
  const Icon = part.tool === 'write' ? FilePlus : FilePen
  return (
    <div className="text-[13px]">
      <div className="flex items-center gap-2 px-1.5 py-1">
        <Icon size={14} className={status === 'error' ? 'shrink-0 text-danger' : 'shrink-0 text-subtle'} />
        <span className="shrink-0 text-fg/90">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!patch && !error}
          aria-expanded={open}
          title={file}
          className={`flex min-w-0 items-center gap-2 rounded-md border px-2 py-0.5 transition ${open ? 'border-border-strong bg-hover' : 'border-border bg-elevated hover:border-border-strong hover:bg-hover'} disabled:cursor-default`}
        >
          <span className="min-w-0 truncate font-mono text-xs">
            <span className="text-fg">{name || file}</span>
            {dir && <span className="ml-1.5 text-subtle">{dir}</span>}
          </span>
          <DiffStats {...stats} />
          {(patch || error) && (
            <ChevronRight size={12} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
          )}
        </button>
        <span className="ml-auto shrink-0">
          <StatusMark status={status} />
        </span>
      </div>
      {open && (
        <div className="mt-1 mb-1.5 ml-6 overflow-hidden rounded-lg border border-border bg-elevated">
          {patch && <DiffView patch={patch} path={file} hideFileHeaders className="max-h-96" />}
          {error && <div className="px-3 py-2 font-mono text-xs whitespace-pre-wrap text-danger">{error}</div>}
        </div>
      )}
    </div>
  )
}

// Memoizada (F7-B44): `part` conserva su referencia en el store mientras no cambia.
export const ToolRow = memo(function ToolRow({ part, root }: { part: ToolPart; root: string | null }): React.JSX.Element {
  const t = useT()
  const { state } = part
  const input = state.input ?? {}
  const meta = ('metadata' in state && state.metadata) || {}
  const output = state.status === 'completed' ? state.output : ''
  const error = state.status === 'error' ? state.error : ''
  const errorBlock = error ? <div className="px-3 py-2 font-mono text-xs whitespace-pre-wrap text-danger">{error}</div> : null
  const running = state.status === 'running' || state.status === 'pending'
  const tool = part.tool
  const kind = toolKind(tool)

  switch (kind) {
    case 'edit':
      return <EditChip part={part} root={root} />
    case 'bash': {
      const command = str(input.command)
      const live = str(meta.output) || output
      const exit = num(meta.exit)
      const desc = str(input.description)
      return (
        <Row
          icon={<SquareTerminal size={14} />}
          verb={running ? t('code.tool.running') : t('code.tool.ran')}
          detail={
            <span className="rounded bg-code px-1.5 py-0.5 font-mono text-xs text-fg" title={desc || command}>
              {command.split('\n')[0]}
            </span>
          }
          status={state.status}
          autoOpen={running && !!live}
          extra={
            exit !== undefined && exit !== 0 ? (
              <span className="rounded bg-danger/10 px-1.5 text-[11px] font-medium text-danger">exit {exit}</span>
            ) : desc ? (
              <span className="hidden max-w-56 truncate text-xs text-subtle md:inline">{desc}</span>
            ) : null
          }
        >
          <pre className="bg-code px-3 pt-2 font-mono text-xs whitespace-pre-wrap text-muted">
            <span className="text-accent select-none">$ </span>
            {command}
          </pre>
          <Output text={live} />
          {errorBlock}
        </Row>
      )
    }
    case 'read': {
      const file = relPath(str(input.filePath), root)
      const offset = num(input.offset)
      const limit = num(input.limit)
      return (
        <Row
          icon={<FileText size={14} />}
          verb={running ? t('code.tool.reading') : t('code.tool.read')}
          detail={
            <span className="font-mono text-xs">
              {file}
              {offset !== undefined && (
                <span className="text-subtle">
                  {' '}
                  {t('code.tool.fromLine', { offset })}
                  {limit ? t('code.tool.lines', { limit }) : ''}
                </span>
              )}
            </span>
          }
          status={state.status}
        >
          {error ? errorBlock : output ? <Output text={output} max="max-h-60" /> : null}
        </Row>
      )
    }
    case 'search': {
      const pattern = str(input.pattern) || str(input.query)
      const where = relPath(str(input.path), root)
      const count = num(meta.matches) ?? num(meta.count)
      const verb =
        tool === 'grep' || tool === 'codesearch'
          ? t('code.tool.searched')
          : tool === 'glob'
            ? t('code.tool.searchedFiles')
            : t('code.tool.listed')
      return (
        <Row
          icon={tool === 'grep' || tool === 'codesearch' ? <FileSearch size={14} /> : <FolderSearch size={14} />}
          verb={verb}
          detail={
            <span className="font-mono text-xs">
              {pattern || where}
              {pattern && where && where !== '.' && <span className="text-subtle"> {t('code.tool.inPath', { where })}</span>}
              {str(input.include) && <span className="text-subtle"> ({str(input.include)})</span>}
            </span>
          }
          extra={count !== undefined ? <span className="text-xs text-subtle">{plural(count, 'code.n.result')}</span> : null}
          status={state.status}
        >
          {error ? errorBlock : output ? <Output text={output} max="max-h-60" /> : null}
        </Row>
      )
    }
    case 'todo': {
      const fromInput = parseTodos(input.todos) ?? []
      const todos = fromInput.length ? fromInput : (parseTodos(meta.todos) ?? [])
      const done = todos.filter((todo) => todo.status === 'completed').length
      return (
        <Row
          icon={<ListTodo size={14} />}
          verb={t('code.tool.todoUpdated')}
          detail={
            todos.length ? (
              <span className="text-xs text-subtle">{t('code.tool.todosDone', { done, total: todos.length })}</span>
            ) : undefined
          }
          status={state.status}
        >
          {todos.length > 0 ? (
            <div className="px-3 py-2">
              <TodoList todos={todos} />
            </div>
          ) : (
            errorBlock
          )}
        </Row>
      )
    }
    case 'web':
      return (
        <Row
          icon={<Globe size={14} />}
          verb={tool === 'webfetch' ? t('code.tool.opened') : t('code.tool.searchedWeb')}
          detail={<span className="font-mono text-xs">{str(input.url) || str(input.query)}</span>}
          status={state.status}
        >
          {error ? errorBlock : output ? <Output text={output} max="max-h-60" /> : null}
        </Row>
      )
    case 'task':
      return (
        <Row
          icon={<Bot size={14} />}
          verb={`${t('code.tool.subagent')}${str(input.subagent_type) ? ` ${str(input.subagent_type)}` : ''}`}
          detail={<span className="text-xs">{str(input.description)}</span>}
          status={state.status}
        >
          {str(input.prompt) && <div className="px-3 py-2 text-xs whitespace-pre-wrap text-muted">{str(input.prompt)}</div>}
          {error ? errorBlock : <Output text={output} max="max-h-60" />}
        </Row>
      )
    default: {
      const title = ('title' in state && state.title) || str(input.description) || str(input.filePath) || str(input.path)
      return (
        <Row
          icon={<Wrench size={14} />}
          verb={tool}
          detail={title ? <span className="text-xs">{title}</span> : undefined}
          status={state.status}
        >
          <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted">
            {JSON.stringify(input, null, 2)}
          </pre>
          <Output text={output} />
          {errorBlock}
        </Row>
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Grupo de pasos
// ---------------------------------------------------------------------------

interface StepGroupProps {
  parts: ToolPart[]
  root: string | null
  /** El grupo es lo último que está haciendo el agente ahora mismo. */
  live: boolean
  /** Hay algún permiso pendiente ligado a estas llamadas (fuerza abierto). */
  hasPending: boolean
  /** Contenido a mostrar después de una llamada concreta (p. ej. su tarjeta de permiso). */
  after?: (part: ToolPart) => ReactNode
}

export function StepGroup({ parts, root, live, hasPending, after }: StepGroupProps): React.JSX.Element {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const locale = useLocale()
  const summary = useMemo(() => summarizeSteps(parts), [parts, locale])
  const anyRunning = parts.some((p) => p.state.status === 'running' || p.state.status === 'pending')
  const errors = parts.filter((p) => p.state.status === 'error').length
  const edits = parts.filter((p) => toolKind(p.tool) === 'edit')
  const collapsible = parts.length >= 3
  const open = !collapsible || hasPending || (userOpen ?? live)

  const rows = (list: ToolPart[]): React.JSX.Element[] =>
    list.map((p) => (
      <div key={p.id}>
        <ToolRow part={p} root={root} />
        {after?.(p)}
      </div>
    ))

  if (!collapsible) return <div className="-mx-1.5 flex flex-col">{rows(parts)}</div>

  return (
    <div className="-mx-1.5">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group/steps flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-muted hover:bg-hover hover:text-fg"
      >
        {anyRunning ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        ) : (
          <ChevronRight size={14} className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
        )}
        <span className="shrink-0 font-medium text-fg/90">{plural(parts.length, 'code.n.step')}</span>
        <span className="min-w-0 truncate">{summary}</span>
        {errors > 0 && (
          <span className="ml-auto shrink-0 rounded bg-danger/10 px-1.5 text-[11px] font-medium text-danger">
            {plural(errors, 'code.n.error')}
          </span>
        )}
      </button>
      {open ? (
        <div className="ml-[13px] border-l border-border pl-2">{rows(parts)}</div>
      ) : (
        edits.length > 0 && (
          <div className="ml-[13px] border-l border-border pl-2">
            {edits.map((p) => (
              <EditChip key={p.id} part={p} root={root} />
            ))}
          </div>
        )
      )}
    </div>
  )
}
