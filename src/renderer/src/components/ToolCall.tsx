import { useState } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { shortenPath } from '../lib/paths'
import { AlertCircle, Check, ChevronRight, Loader2, Wrench } from 'lucide-react'

function summarizeInput(input: Record<string, unknown>): string {
  for (const key of ['description', 'filePath', 'path', 'command', 'pattern', 'url', 'query']) {
    const v = input[key]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/** Llamada a herramienta en formato compacto (expandible). */
export function ToolCall({ part }: { part: ToolPart }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { state } = part
  const title = shortenPath(('title' in state && state.title) || summarizeInput(state.input))
  const icon =
    state.status === 'completed' ? (
      <Check size={13} className="text-accent" />
    ) : state.status === 'error' ? (
      <AlertCircle size={13} className="text-danger" />
    ) : (
      <Loader2 size={13} className="animate-spin" />
    )
  const detail = state.status === 'completed' ? state.output : state.status === 'error' ? state.error : ''

  return (
    <div className="my-1 rounded-lg border border-border bg-elevated/60 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted hover:text-fg"
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Wrench size={13} className="shrink-0" />
        <span className="font-mono text-fg">{part.tool}</span>
        {title && <span className="truncate">{title}</span>}
        <span className="ml-auto shrink-0">{icon}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted">
            {JSON.stringify(state.input, null, 2)}
          </pre>
          {detail && (
            <pre className="max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap">{detail}</pre>
          )}
        </div>
      )}
    </div>
  )
}
