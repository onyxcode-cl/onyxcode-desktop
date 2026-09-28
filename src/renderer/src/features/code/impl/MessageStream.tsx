import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AssistantMessage, Part, ReasoningPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, Brain, ChevronRight, FileDiff, Loader2, RotateCw, Undo2 } from 'lucide-react'
import { Markdown } from '../../../components/Markdown'
import { errorMessage } from './client'
import { PermissionCard, QuestionCard } from './PermissionCard'
import { ToolCard, relPath } from './ToolCard'
import type { CodeMessage, PendingPermission, PendingQuestion } from './types'

function Reasoning({ part, live }: { part: ReasoningPart; live: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!part.text.trim()) return null
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  return (
    <div className="my-1 text-[13px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-muted hover:text-fg">
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <Brain size={13} />
        {live && !part.time.end ? 'Razonando…' : seconds ? `Razonó durante ${seconds} s` : 'Razonamiento'}
      </button>
      {open && <div className="mt-1 ml-5 border-l-2 border-border pl-3 whitespace-pre-wrap text-muted">{part.text}</div>}
    </div>
  )
}

function PartView({ part, live, root }: { part: Part; live: boolean; root: string | null }): React.JSX.Element | null {
  switch (part.type) {
    case 'text':
      if (part.synthetic || part.ignored || !part.text) return null
      return <Markdown text={part.text} />
    case 'reasoning':
      return <Reasoning part={part} live={live} />
    case 'tool':
      return <ToolCard part={part} root={root} />
    case 'patch':
      if (!part.files.length) return null
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <FileDiff size={13} />
          {part.files.length === 1 ? '1 archivo modificado:' : `${part.files.length} archivos modificados:`}
          {part.files.slice(0, 6).map((f) => (
            <span key={f} className="rounded bg-hover px-1.5 py-0.5 font-mono">
              {relPath(f, root)}
            </span>
          ))}
          {part.files.length > 6 && <span>…</span>}
        </div>
      )
    case 'subtask':
      return <div className="text-xs text-muted">Subtarea ({part.agent}): {part.description}</div>
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
  if (!info.error) return null
  if (info.error.name === 'MessageAbortedError') return <div className="mt-1 text-xs text-subtle">Detenido.</div>
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{errorMessage(info.error)}</span>
    </div>
  )
}

interface Props {
  entries: CodeMessage[]
  busy: boolean
  error: string | null
  root: string | null
  permissions: PendingPermission[]
  questions: PendingQuestion[]
  /** Mensaje desde el que la sesión está revertida (se ocultan este y los siguientes). */
  revertMessageID?: string
  onUnrevert: () => void
  loading: boolean
}

export function MessageStream(props: Props): React.JSX.Element {
  const { entries, busy, error, root, permissions, questions, revertMessageID, onUnrevert, loading } = props
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

  const firstId = entries[0]?.info.id
  useEffect(() => {
    stickRef.current = true
  }, [firstId])

  const visible = revertMessageID ? entries.filter((e) => e.info.id < revertMessageID) : entries
  const hidden = entries.length - visible.length

  // Permisos ligados a una llamada de herramienta visible se muestran junto a ella.
  const callIds = new Set<string>()
  for (const e of visible) for (const p of e.parts) if (p.type === 'tool') callIds.add(p.callID)
  const inlinePerms = new Map<string, PendingPermission[]>()
  const loosePerms: PendingPermission[] = []
  for (const p of permissions) {
    if (p.tool && callIds.has(p.tool.callID)) inlinePerms.set(p.tool.callID, [...(inlinePerms.get(p.tool.callID) ?? []), p])
    else loosePerms.push(p)
  }

  const last = visible[visible.length - 1]
  const lastHasOutput =
    last?.info.role === 'assistant' && last.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool')
  const showThinking = busy && !lastHasOutput && permissions.length === 0

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
        {loading && entries.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Cargando…
          </div>
        )}
        {visible.map((entry, i) => {
          const isLast = i === visible.length - 1
          if (entry.info.role === 'user') {
            const text = entry.parts
              .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic)
              .map((p) => p.text)
              .join('\n')
            if (!text) return null
            return (
              <div key={entry.info.id} className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] whitespace-pre-wrap">{text}</div>
                <div className="text-[11px] text-subtle">{entry.info.agent === 'plan' ? 'Plan' : 'Build'}</div>
              </div>
            )
          }
          return (
            <div key={entry.info.id} className="flex flex-col gap-1">
              {entry.parts.map((p) => (
                <div key={p.id}>
                  <PartView part={p} live={busy && isLast} root={root} />
                  {p.type === 'tool' &&
                    inlinePerms.get(p.callID)?.map((perm) => <PermissionCard key={perm.id} request={perm} root={root} />)}
                </div>
              ))}
              <AssistantError info={entry.info} />
            </div>
          )
        })}
        {hidden > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
            <span className="flex items-center gap-2">
              <Undo2 size={14} /> {hidden === 1 ? '1 mensaje revertido' : `${hidden} mensajes revertidos`}
            </span>
            <button type="button" onClick={onUnrevert} className="font-medium text-accent hover:underline">
              Restaurar
            </button>
          </div>
        )}
        {loosePerms.map((perm) => (
          <PermissionCard key={perm.id} request={perm} root={root} />
        ))}
        {questions.map((q) => (
          <QuestionCard key={q.id} request={q} />
        ))}
        {showThinking && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Trabajando…
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
