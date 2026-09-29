import { memo, useState } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { shortenPath } from '../../lib/paths'
import {
  AlertCircle,
  Check,
  ChevronRight,
  FilePen,
  FileSearch,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon
} from 'lucide-react'

function summarizeInput(input: Record<string, unknown>): string {
  for (const key of ['description', 'filePath', 'path', 'command', 'pattern', 'url', 'query']) {
    const v = input[key]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: SquareTerminal,
  read: FileText,
  write: FilePen,
  edit: FilePen,
  patch: FilePen,
  multiedit: FilePen,
  grep: Search,
  glob: FileSearch,
  list: FileSearch,
  webfetch: Globe,
  websearch: Globe,
  todowrite: ListTodo,
  todoread: ListTodo
}

/** Llamada a herramienta en formato compacto (expandible). */
export const ChatToolCall = memo(function ChatToolCall({ part }: { part: ToolPart }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { state } = part
  const title = shortenPath(('title' in state && state.title) || summarizeInput(state.input))
  const ToolIcon = TOOL_ICONS[part.tool] ?? Wrench
  const running = state.status === 'running' || state.status === 'pending'
  const icon =
    state.status === 'completed' ? (
      <Check size={13} className="text-success" />
    ) : state.status === 'error' ? (
      <AlertCircle size={13} className="text-danger" />
    ) : (
      <Loader2 size={13} className="animate-spin text-accent" />
    )
  const detail = state.status === 'completed' ? state.output : state.status === 'error' ? state.error : ''

  return (
    <div
      className={`my-1 overflow-hidden rounded-lg border bg-elevated/70 text-[13px] shadow-xs transition-colors ${state.status === 'error' ? 'border-danger/30' : running ? 'border-accent/30' : 'border-border'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted transition-colors hover:bg-hover/60 hover:text-fg"
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${running ? 'bg-accent-soft text-accent' : 'bg-hover text-muted'}`}
        >
          <ToolIcon size={12} />
        </span>
        <span className="font-mono text-[12px] font-medium text-fg">{part.tool}</span>
        {title && <span className={`truncate ${running ? 'text-shimmer' : ''}`}>{title}</span>}
        <span className="ml-auto shrink-0">{icon}</span>
      </button>
      {open && (
        <div className="animate-fade-in space-y-2 border-t border-border bg-inset/50 px-3 py-2">
          <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">
            {JSON.stringify(state.input, null, 2)}
          </pre>
          {detail && (
            <pre className="max-h-64 overflow-auto border-t border-border pt-2 font-mono text-xs whitespace-pre-wrap">{detail}</pre>
          )}
        </div>
      )}
    </div>
  )
})
