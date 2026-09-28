/**
 * Conversación de una tarea de Cowork: los mensajes del asistente se aplanan y las llamadas a
 * herramientas consecutivas se agrupan en bloques compactos de "Pasos" (expandibles) en lugar
 * de una lista larga de tarjetas de herramientas.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, Part, PermissionRequest, ReasoningPart, ToolPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, Brain, ChevronRight, FileText, Loader2, RotateCw, Sparkles } from 'lucide-react'
import { Markdown } from '../../../components/Markdown'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { ActivityRow } from './ProgressPanel'
import { PermissionCard } from './PermissionPrompt'
import { toolImages } from './computer-tools'
import { ScreenshotThumbs } from './ComputerAccess'
import { onScrollToPart } from './scroll'
import { friendlyTool, isVisibleText } from './util'

export const ATTACH_MARKER = '\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n'

type Block =
  | { kind: 'user'; id: string; text: string; files: string[] }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'steps'; id: string; parts: Array<ToolPart | ReasoningPart> }
  | { kind: 'error'; id: string; info: AssistantMessage }
  | { kind: 'retry'; id: string; text: string }
  | { kind: 'file'; id: string; name: string }

function buildBlocks(entries: MessageEntry[]): Block[] {
  const blocks: Block[] = []
  let steps: Extract<Block, { kind: 'steps' }> | null = null
  for (const entry of entries) {
    if (entry.info.role === 'user') {
      steps = null
      const raw = entry.parts
        .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic)
        .map((p) => p.text)
        .join('\n')
      const idx = raw.indexOf(ATTACH_MARKER)
      const text = idx >= 0 ? raw.slice(0, idx) : raw
      const files =
        idx >= 0
          ? raw
              .slice(idx + ATTACH_MARKER.length)
              .split('\n')
              .map((l) => l.replace(/^-\s*/, '').trim())
              .filter(Boolean)
          : []
      for (const p of entry.parts) if (p.type === 'file') files.push(p.filename ?? p.url)
      blocks.push({ kind: 'user', id: entry.info.id, text, files })
      continue
    }
    for (const p of entry.parts) {
      if (p.type === 'tool' || (p.type === 'reasoning' && p.text.trim())) {
        if (!steps) {
          steps = { kind: 'steps', id: p.id, parts: [] }
          blocks.push(steps)
        }
        steps.parts.push(p as ToolPart | ReasoningPart)
      } else if (isVisibleText(p)) {
        steps = null
        blocks.push({ kind: 'text', id: p.id, text: p.text })
      } else if (p.type === 'retry') {
        blocks.push({ kind: 'retry', id: p.id, text: `Reintento ${p.attempt}: ${p.error.data.message}` })
      } else if (p.type === 'file') {
        steps = null
        blocks.push({ kind: 'file', id: p.id, name: p.filename ?? p.url })
      }
    }
    if (entry.info.role === 'assistant' && entry.info.error) {
      steps = null
      blocks.push({ kind: 'error', id: `${entry.info.id}-err`, info: entry.info })
    }
  }
  return blocks
}

function ReasoningRow({ part }: { part: ReasoningPart }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  return (
    <li className="text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-muted hover:text-fg">
        <Brain size={12} className="shrink-0" />
        {seconds ? `Pensó durante ${seconds} s` : 'Pensando…'}
      </button>
      {open && <div className="mt-1 ml-5 border-l-2 border-border pl-2 whitespace-pre-wrap text-muted">{part.text}</div>}
    </li>
  )
}

function StepsBlock({
  id,
  parts,
  live,
  forceOpen,
  flash
}: {
  id: string
  parts: Array<ToolPart | ReasoningPart>
  live: boolean
  forceOpen?: boolean
  flash?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])
  const tools = parts.filter((p): p is ToolPart => p.type === 'tool')
  const running = live ? [...tools].reverse().find((t) => t.state.status === 'running' || t.state.status === 'pending') : undefined
  const failed = tools.filter((t) => t.state.status === 'error').length
  const lastTool = running ?? tools[tools.length - 1]
  const current = lastTool ? friendlyTool(lastTool) : null
  const lastShot = useMemo(() => {
    for (let i = tools.length - 1; i >= 0; i--) {
      const imgs = toolImages(tools[i])
      if (imgs.length > 0) return imgs.slice(-1)
    }
    return []
  }, [tools])
  const count = tools.length
  return (
    <div
      id={`cw-block-${id}`}
      className={`rounded-xl border bg-elevated/60 transition-colors duration-500 ${flash ? 'border-accent ring-2 ring-accent/25' : 'border-border'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-muted hover:text-fg"
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {live && running ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Sparkles size={13} className="shrink-0 text-accent" />
        )}
        <span className="shrink-0 font-medium text-fg">
          {count === 0 ? 'Pensando' : count === 1 ? '1 paso' : `${count} pasos`}
        </span>
        {current && (
          <span className="min-w-0 truncate">
            · {current.verb} {current.detail}
            {live && running ? '…' : ''}
          </span>
        )}
        {failed > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-danger">
            <AlertCircle size={12} /> {failed}
          </span>
        )}
      </button>
      {!open && lastShot.length > 0 && (
        <div className="px-3 pb-2 pl-8">
          <ScreenshotThumbs images={lastShot} />
        </div>
      )}
      {open && (
        <ul className="space-y-1.5 border-t border-border px-3 py-2.5 pl-8">
          {parts.map((p) => (p.type === 'tool' ? <ActivityRow key={p.id} part={p} /> : <ReasoningRow key={p.id} part={p} />))}
        </ul>
      )}
    </div>
  )
}

function AssistantError({ info }: { info: AssistantMessage }): React.JSX.Element | null {
  if (!info.error) return null
  if (info.error.name === 'MessageAbortedError') return <div className="text-xs text-subtle">Tarea detenida.</div>
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{errorMessage(info.error)}</span>
    </div>
  )
}

interface Props {
  entries: MessageEntry[]
  busy: boolean
  error?: string | null
  permissions: PermissionRequest[]
  /** Contenido extra al final (p.ej. seguimientos). */
  footer?: React.ReactNode
}

export function TaskConversation({ entries, busy, error, permissions, footer }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const blocks = useMemo(() => buildBlocks(entries), [entries])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  const firstId = entries[0]?.info.id
  useEffect(() => {
    stickRef.current = true
  }, [firstId])

  const last = blocks[blocks.length - 1]
  const showThinking = busy && permissions.length === 0 && (!last || last.kind === 'user' || last.kind === 'text')

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
        {blocks.map((b, i) => {
          switch (b.kind) {
            case 'user':
              return (
                <div key={b.id} className="flex flex-col items-end gap-1.5">
                  {b.files.length > 0 && (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                      {b.files.map((f) => (
                        <span
                          key={f}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted"
                        >
                          <FileText size={12} /> {f}
                        </span>
                      ))}
                    </div>
                  )}
                  {b.text && (
                    <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] whitespace-pre-wrap">{b.text}</div>
                  )}
                </div>
              )
            case 'text':
              return <Markdown key={b.id} text={b.text} />
            case 'steps':
              return <StepsBlock key={b.id} parts={b.parts} live={busy && i === blocks.length - 1} />
            case 'error':
              return <AssistantError key={b.id} info={b.info} />
            case 'retry':
              return (
                <div key={b.id} className="flex items-center gap-1.5 text-xs text-muted">
                  <RotateCw size={12} /> {b.text}
                </div>
              )
            case 'file':
              return (
                <div key={b.id} className="inline-flex items-center gap-1.5 self-start rounded-md border border-border px-2 py-1 text-xs text-muted">
                  <FileText size={13} /> {b.name}
                </div>
              )
            default:
              return null
          }
        })}
        {permissions.map((p) => (
          <PermissionCard key={p.id} request={p} />
        ))}
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
        {footer}
      </div>
    </div>
  )
}
