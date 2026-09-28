import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AssistantMessage, Part, ReasoningPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, Brain, ChevronRight, FileText, Loader2, RotateCw } from 'lucide-react'
import type { MessageEntry } from '../stores/sessions'
import { errorMessage } from '../lib/opencode'
import { Markdown } from './Markdown'
import { ToolCall } from './ToolCall'

function Reasoning({ part, live }: { part: ReasoningPart; live: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!part.text.trim()) return null
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  return (
    <div className="my-1 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-muted hover:text-fg"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <Brain size={13} />
        {live && !part.time.end ? 'Razonando…' : seconds ? `Razonó durante ${seconds} s` : 'Razonamiento'}
      </button>
      {open && (
        <div className="mt-1 ml-5 border-l-2 border-border pl-3 whitespace-pre-wrap text-muted">{part.text}</div>
      )}
    </div>
  )
}

function PartView({ part, live }: { part: Part; live: boolean }): React.JSX.Element | null {
  switch (part.type) {
    case 'text':
      if (part.synthetic || part.ignored || !part.text) return null
      return <Markdown text={part.text} />
    case 'reasoning':
      return <Reasoning part={part} live={live} />
    case 'tool':
      return <ToolCall part={part} />
    case 'file':
      return (
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted">
          <FileText size={13} /> {part.filename ?? part.url}
        </div>
      )
    case 'retry':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <RotateCw size={12} /> Reintento {part.attempt}: {part.error.data.message}
        </div>
      )
    default:
      return null
  }
}

function AssistantError({ info }: { info: AssistantMessage }): React.JSX.Element | null {
  if (!info.error || info.error.name === 'MessageAbortedError') {
    return info.error ? <div className="mt-1 text-xs text-subtle">Respuesta detenida.</div> : null
  }
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{errorMessage(info.error)}</span>
    </div>
  )
}

interface Props {
  entries: MessageEntry[]
  busy: boolean
  error?: string | null
}

export function MessageList({ entries, busy, error }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  // Al cambiar de conversación, volver a pegarse al final.
  const firstId = entries[0]?.info.id
  useEffect(() => {
    stickRef.current = true
  }, [firstId])

  const last = entries[entries.length - 1]
  const lastHasOutput =
    last?.info.role === 'assistant' && last.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool')
  const showThinking = busy && !lastHasOutput

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1
          if (entry.info.role === 'user') {
            const text = entry.parts
              .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic)
              .map((p) => p.text)
              .join('\n')
            const files = entry.parts.filter((p) => p.type === 'file')
            return (
              <div key={entry.info.id} className="flex flex-col items-end gap-1">
                {files.map((p) => (
                  <PartView key={p.id} part={p} live={false} />
                ))}
                {text && (
                  <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] whitespace-pre-wrap">
                    {text}
                  </div>
                )}
              </div>
            )
          }
          return (
            <div key={entry.info.id} className="flex flex-col gap-1">
              {entry.parts.map((p) => (
                <PartView key={p.id} part={p} live={busy && isLast} />
              ))}
              <AssistantError info={entry.info} />
            </div>
          )
        })}
        {showThinking && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Pensando…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
