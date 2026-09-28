import { useMemo, useState, type ReactNode } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
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
import { DiffView, diffStats, makePatch } from './DiffView'

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

interface TodoItem {
  content: string
  status: string
  priority?: string
}

function todosFrom(v: unknown): TodoItem[] {
  if (!Array.isArray(v)) return []
  return v.filter((t): t is TodoItem => !!t && typeof t === 'object' && typeof (t as TodoItem).content === 'string')
}

export function TodoList({ todos }: { todos: TodoItem[] }): React.JSX.Element {
  return (
    <ul className="space-y-1 text-[13px]">
      {todos.map((t, i) => (
        <li key={i} className="flex items-start gap-2">
          {t.status === 'completed' ? (
            <Check size={14} className="mt-0.5 shrink-0 text-accent" />
          ) : t.status === 'in_progress' ? (
            <CircleDot size={14} className="mt-0.5 shrink-0 text-accent" />
          ) : t.status === 'cancelled' ? (
            <XCircle size={14} className="mt-0.5 shrink-0 text-subtle" />
          ) : (
            <Circle size={14} className="mt-0.5 shrink-0 text-subtle" />
          )}
          <span
            className={
              t.status === 'completed' || t.status === 'cancelled'
                ? 'text-muted line-through'
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
  return (
    <pre className={`${max} overflow-auto bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-fg`}>
      {text}
    </pre>
  )
}

interface CardProps {
  icon: ReactNode
  label: string
  title?: string
  extra?: ReactNode
  status: ToolPart['state']['status']
  defaultOpen?: boolean
  children?: ReactNode
}

function Card({ icon, label, title, extra, status, defaultOpen = false, children }: CardProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const statusIcon =
    status === 'completed' ? null : status === 'error' ? (
      <AlertCircle size={13} className="text-danger" />
    ) : (
      <Loader2 size={13} className="animate-spin text-muted" />
    )
  return (
    <div
      className={`my-1 overflow-hidden rounded-lg border bg-elevated text-[13px] ${status === 'error' ? 'border-danger/40' : 'border-border'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!children}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted hover:text-fg disabled:cursor-default"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''} ${children ? '' : 'opacity-0'}`}
        />
        <span className="shrink-0">{icon}</span>
        <span className="shrink-0 font-medium text-fg">{label}</span>
        {title && <span className="min-w-0 truncate font-mono text-xs">{title}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {extra}
          {statusIcon}
        </span>
      </button>
      {open && children && <div className="border-t border-border">{children}</div>}
    </div>
  )
}

function Stats({ patch }: { patch: string }): React.JSX.Element | null {
  const { additions, deletions } = useMemo(() => diffStats(patch), [patch])
  if (!additions && !deletions) return null
  return (
    <span className="font-mono text-xs">
      <span className="text-[#16a34a]">+{additions}</span> <span className="text-danger">-{deletions}</span>
    </span>
  )
}

export function ToolCard({ part, root }: { part: ToolPart; root: string | null }): React.JSX.Element {
  const { state } = part
  const input = state.input ?? {}
  const meta = ('metadata' in state && state.metadata) || {}
  const output = state.status === 'completed' ? state.output : ''
  const error = state.status === 'error' ? state.error : ''
  const errorBlock = error ? <div className="px-3 py-2 font-mono text-xs whitespace-pre-wrap text-danger">{error}</div> : null
  const tool = part.tool

  switch (tool) {
    case 'bash': {
      const command = str(input.command)
      const live = str(meta.output) || output
      return (
        <Card
          icon={<SquareTerminal size={14} />}
          label="Terminal"
          title={str(input.description) || command}
          status={state.status}
          extra={num(meta.exit) !== undefined && num(meta.exit) !== 0 ? <span className="text-xs text-danger">código {num(meta.exit)}</span> : null}
        >
          <pre className="bg-code px-3 pt-2 font-mono text-xs whitespace-pre-wrap text-muted">$ {command}</pre>
          <Output text={live} />
          {errorBlock}
        </Card>
      )
    }
    case 'edit':
    case 'multiedit':
    case 'write':
    case 'patch':
    case 'apply_patch': {
      const file = str(input.filePath) || str(input.path)
      let patch = str(meta.diff)
      if (!patch && tool === 'edit' && (str(input.oldString) || str(input.newString))) {
        patch = makePatch(relPath(file, root), str(input.oldString), str(input.newString))
      }
      if (!patch && tool === 'write' && str(input.content)) {
        patch = makePatch(relPath(file, root), '', str(input.content))
      }
      if (!patch && (tool === 'patch' || tool === 'apply_patch')) patch = str(input.patchText) || str(input.patch)
      const label = tool === 'write' ? 'Escribir' : tool === 'patch' || tool === 'apply_patch' ? 'Parche' : 'Editar'
      return (
        <Card
          icon={tool === 'write' ? <FilePlus size={14} /> : <FilePen size={14} />}
          label={label}
          title={relPath(file, root) || ('title' in state ? (state.title ?? '') : '')}
          status={state.status}
          extra={patch ? <Stats patch={patch} /> : null}
          defaultOpen={state.status !== 'error'}
        >
          {patch ? <DiffView patch={patch} hideFileHeaders className="max-h-96" /> : <Output text={output} />}
          {errorBlock}
        </Card>
      )
    }
    case 'read': {
      const file = str(input.filePath)
      const offset = num(input.offset)
      const limit = num(input.limit)
      return (
        <Card
          icon={<FileText size={14} />}
          label="Leer"
          title={relPath(file, root) + (offset !== undefined ? ` (desde ${offset}${limit ? `, ${limit} líneas` : ''})` : '')}
          status={state.status}
        >
          {error ? errorBlock : <Output text={output} max="max-h-60" />}
        </Card>
      )
    }
    case 'grep':
    case 'glob':
    case 'list':
    case 'ls':
    case 'codesearch': {
      const pattern = str(input.pattern) || str(input.query)
      const where = relPath(str(input.path), root)
      const count = num(meta.matches) ?? num(meta.count)
      const label = tool === 'grep' ? 'Buscar' : tool === 'glob' ? 'Archivos' : tool === 'codesearch' ? 'Buscar código' : 'Listar'
      return (
        <Card
          icon={tool === 'grep' || tool === 'codesearch' ? <FileSearch size={14} /> : <FolderSearch size={14} />}
          label={label}
          title={[pattern, where && where !== '.' ? `en ${where}` : '', str(input.include)].filter(Boolean).join(' ')}
          status={state.status}
          extra={count !== undefined ? <span className="text-xs">{count} resultados</span> : null}
        >
          {error ? errorBlock : <Output text={output} max="max-h-60" />}
        </Card>
      )
    }
    case 'todowrite':
    case 'todoread': {
      const todos = todosFrom(input.todos).length ? todosFrom(input.todos) : todosFrom(meta.todos)
      const done = todos.filter((t) => t.status === 'completed').length
      return (
        <Card
          icon={<ListTodo size={14} />}
          label="Tareas"
          title={todos.length ? `${done}/${todos.length} completadas` : ''}
          status={state.status}
          defaultOpen
        >
          {todos.length > 0 ? (
            <div className="px-3 py-2">
              <TodoList todos={todos} />
            </div>
          ) : (
            errorBlock
          )}
        </Card>
      )
    }
    case 'webfetch':
    case 'websearch':
      return (
        <Card icon={<Globe size={14} />} label={tool === 'webfetch' ? 'Web' : 'Buscar en la web'} title={str(input.url) || str(input.query)} status={state.status}>
          {error ? errorBlock : <Output text={output} max="max-h-60" />}
        </Card>
      )
    case 'task':
      return (
        <Card
          icon={<Bot size={14} />}
          label={`Subagente${str(input.subagent_type) ? ` · ${str(input.subagent_type)}` : ''}`}
          title={str(input.description)}
          status={state.status}
        >
          {str(input.prompt) && <div className="px-3 py-2 text-xs whitespace-pre-wrap text-muted">{str(input.prompt)}</div>}
          {error ? errorBlock : <Output text={output} max="max-h-60" />}
        </Card>
      )
    default: {
      const title = ('title' in state && state.title) || str(input.description) || str(input.filePath) || str(input.path)
      return (
        <Card icon={<Wrench size={14} />} label={tool} title={title} status={state.status}>
          <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted">
            {JSON.stringify(input, null, 2)}
          </pre>
          <Output text={output} />
          {errorBlock}
        </Card>
      )
    }
  }
}
