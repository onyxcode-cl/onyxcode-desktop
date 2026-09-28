import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AssistantMessage, Part, ReasoningPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, ArrowDown, ChevronRight, FileText, Lightbulb, RotateCcw, RotateCw } from 'lucide-react'
import type { MessageEntry } from '../stores/sessions'
import { errorMessage } from '../lib/opencode'
import { LogoMark } from './Logo'
import { CopyButton, Markdown } from './Markdown'
import { ToolCall } from './ToolCall'

function Reasoning({ part, live }: { part: ReasoningPart; live: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!part.text.trim()) return null
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  const thinking = live && !part.time.end
  return (
    <div className="my-1 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Lightbulb size={13} className={thinking ? 'text-gold' : ''} />
        <span className={thinking ? 'text-shimmer' : ''}>
          {thinking ? 'Razonando…' : seconds ? `Razonó durante ${seconds} s` : 'Razonamiento'}
        </span>
        <ChevronRight size={13} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-1.5 ml-1.5 animate-fade-in border-l-2 border-gold/40 pl-3 leading-relaxed whitespace-pre-wrap text-muted">
          {part.text}
        </div>
      )}
    </div>
  )
}

function PartView({ part, live, streaming }: { part: Part; live: boolean; streaming?: boolean }): React.JSX.Element | null {
  switch (part.type) {
    case 'text':
      if (part.synthetic || part.ignored || !part.text) return null
      return <Markdown text={part.text} streaming={streaming} />
    case 'reasoning':
      return <Reasoning part={part} live={live} />
    case 'tool':
      return <ToolCall part={part} />
    case 'file':
      return (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-muted shadow-xs">
          <FileText size={13} className="text-accent" /> {part.filename ?? part.url}
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
    return info.error ? <div className="mt-1 text-xs text-subtle italic">Respuesta detenida.</div> : null
  }
  return (
    <div className="mt-2 flex animate-fade-in items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{errorMessage(info.error)}</span>
    </div>
  )
}

/** Indicador de "pensando" con la chispa de la marca. */
export function ThinkingIndicator({ label = 'Pensando' }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex animate-fade-in items-center gap-2.5 text-sm text-muted" role="status" aria-live="polite">
      <LogoMark size={18} animated />
      <span className="text-shimmer">{label}</span>
      <span className="typing-dots flex items-center gap-1 text-subtle">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}

function textOfParts(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic && !p.ignored)
    .map((p) => p.text)
    .join('\n\n')
}

interface Props {
  entries: MessageEntry[]
  busy: boolean
  error?: string | null
  /** Si se entrega, la última respuesta muestra "Reintentar" (recibe el texto del último mensaje del usuario). */
  onRetry?: (userText: string) => void
}

export function MessageList({ entries, busy, error, onRetry }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = near
    if (near !== atBottom) setAtBottom(near)
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  // Al cambiar de conversación, volver a pegarse al final.
  const firstId = entries[0]?.info.id
  useEffect(() => {
    stickRef.current = true
    setAtBottom(true)
  }, [firstId])

  const scrollToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const last = entries[entries.length - 1]
  const lastHasOutput =
    last?.info.role === 'assistant' && last.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool')
  const showThinking = busy && !lastHasOutput

  let lastUserText = ''
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].info.role === 'user') {
      lastUserText = textOfParts(entries[i].parts)
      break
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 pt-8 pb-10">
          {entries.map((entry, i) => {
            const isLast = i === entries.length - 1
            if (entry.info.role === 'user') {
              const text = textOfParts(entry.parts)
              const files = entry.parts.filter((p) => p.type === 'file')
              return (
                <div key={entry.info.id} className="group flex animate-rise-in flex-col items-end gap-1">
                  {files.map((p) => (
                    <PartView key={p.id} part={p} live={false} />
                  ))}
                  {text && (
                    <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/10 bg-user px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-xs">
                      {text}
                    </div>
                  )}
                  {text && (
                    <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <CopyButton text={text} label="Copiar mensaje" />
                    </div>
                  )}
                </div>
              )
            }
            const live = busy && isLast
            const lastTextIdx = live ? entry.parts.map((p) => p.type).lastIndexOf('text') : -1
            const text = textOfParts(entry.parts)
            const showActions = !live && !!text
            return (
              <div key={entry.info.id} className="group flex flex-col gap-1.5">
                {entry.parts.map((p, idx) => (
                  <PartView key={p.id} part={p} live={live} streaming={live && idx === lastTextIdx} />
                ))}
                <AssistantError info={entry.info} />
                {showActions && (
                  <div
                    className={`-ml-1.5 flex items-center gap-0.5 transition-opacity ${isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
                  >
                    <CopyButton text={text} label="Copiar respuesta" />
                    {isLast && onRetry && lastUserText && (
                      <button
                        type="button"
                        onClick={() => onRetry(lastUserText)}
                        title="Reintentar"
                        aria-label="Reintentar"
                        className="no-drag inline-flex items-center rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-hover hover:text-fg"
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {showThinking && <ThinkingIndicator />}
          {error && (
            <div className="flex animate-fade-in items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Ir al final"
          title="Ir al final"
          className="absolute bottom-3 left-1/2 flex h-8 w-8 -translate-x-1/2 animate-pop-in items-center justify-center rounded-full border border-border bg-elevated text-muted shadow-md transition-colors hover:text-fg"
        >
          <ArrowDown size={15} />
        </button>
      )}
    </div>
  )
}
