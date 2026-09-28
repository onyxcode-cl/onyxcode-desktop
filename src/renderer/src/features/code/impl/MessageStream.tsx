import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, FilePart, Part, ReasoningPart, TextPart, ToolPart } from '@opencode-ai/sdk/v2/client'
import { AlertCircle, AtSign, Brain, ChevronRight, Copy, Check, Loader2, RotateCw, Undo2 } from 'lucide-react'
import { Markdown } from '../../../components/Markdown'
import { errorMessage } from './client'
import { PermissionCard, QuestionCard } from './PermissionCard'
import { StepGroup, relPath } from './ToolCard'
import type { CodeMessage, PendingPermission, PendingQuestion } from './types'
import { ConfirmButton } from './ui'
import { useCode } from './store'

function Reasoning({ part, live }: { part: ReasoningPart; live: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!part.text.trim()) return null
  const seconds = part.time.end ? Math.max(1, Math.round((part.time.end - part.time.start) / 1000)) : null
  return (
    <div className="text-[13px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-muted hover:bg-hover hover:text-fg">
        <Brain size={14} className={live && !part.time.end ? 'animate-pulse text-accent' : 'text-subtle'} />
        {live && !part.time.end ? 'Razonando…' : seconds ? `Razonó durante ${seconds} s` : 'Razonamiento'}
        <ChevronRight size={13} className={`text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="mt-1 ml-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{part.text}</div>}
    </div>
  )
}

function AssistantError({ info }: { info: AssistantMessage }): React.JSX.Element | null {
  if (!info.error) return null
  if (info.error.name === 'MessageAbortedError') return <div className="text-xs text-subtle">Detenido por el usuario.</div>
  return (
    <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{errorMessage(info.error)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agrupación en bloques
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'text'; key: string; part: TextPart }
  | { kind: 'reasoning'; key: string; part: ReasoningPart }
  | { kind: 'steps'; key: string; parts: ToolPart[] }
  | { kind: 'retry'; key: string; text: string; attempt: number }
  | { kind: 'subtask'; key: string; text: string }
  | { kind: 'error'; key: string; info: AssistantMessage }

/** Partes que no rompen un grupo de pasos (no se muestran). */
const TRANSPARENT = new Set<Part['type']>(['step-start', 'step-finish', 'snapshot', 'patch', 'compaction', 'agent'])

function buildBlocks(messages: CodeMessage[]): Block[] {
  const blocks: Block[] = []
  let steps: ToolPart[] | null = null
  const flush = (): void => {
    if (steps && steps.length) blocks.push({ kind: 'steps', key: steps[0].id, parts: steps })
    steps = null
  }
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool') {
        ;(steps ??= []).push(p)
        continue
      }
      if (TRANSPARENT.has(p.type)) continue
      if (p.type === 'reasoning' && !p.text.trim()) continue
      if (p.type === 'text' && (p.synthetic || p.ignored || !p.text)) continue
      flush()
      if (p.type === 'text') blocks.push({ kind: 'text', key: p.id, part: p })
      else if (p.type === 'reasoning') blocks.push({ kind: 'reasoning', key: p.id, part: p })
      else if (p.type === 'retry') blocks.push({ kind: 'retry', key: p.id, text: p.error.data.message, attempt: p.attempt })
      else if (p.type === 'subtask') blocks.push({ kind: 'subtask', key: p.id, text: `Subtarea (${p.agent}): ${p.description}` })
    }
    if (m.info.role === 'assistant' && m.info.error) {
      flush()
      blocks.push({ kind: 'error', key: `${m.info.id}-err`, info: m.info })
    }
  }
  flush()
  return blocks
}

/** Turno: un mensaje de usuario y las respuestas del asistente que le siguen. */
interface Turn {
  user: CodeMessage | null
  assistant: CodeMessage[]
}

function buildTurns(entries: CodeMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const e of entries) {
    if (e.info.role === 'user') turns.push({ user: e, assistant: [] })
    else if (turns.length) turns[turns.length - 1].assistant.push(e)
    else turns.push({ user: null, assistant: [e] })
  }
  return turns
}

// ---------------------------------------------------------------------------
// Mensaje de usuario
// ---------------------------------------------------------------------------

function UserMessage({ entry, busy, root }: { entry: CodeMessage; busy: boolean; root: string | null }): React.JSX.Element | null {
  const revertTo = useCode((s) => s.revertTo)
  const [copied, setCopied] = useState(false)
  const text = entry.parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map((p) => p.text)
    .join('\n')
  const files = entry.parts.filter((p): p is FilePart => p.type === 'file')
  if (!text && files.length === 0) return null
  const agent = entry.info.role === 'user' ? entry.info.agent : undefined
  return (
    <div className="group/user flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl bg-user px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
        {text}
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((f) => {
              const path = f.source && 'path' in f.source ? f.source.path : f.filename ?? f.url
              return (
                <span key={f.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-bg/60 px-1.5 py-0.5 font-mono text-[11px] text-muted" title={path}>
                  <AtSign size={11} /> {relPath(path.replace(/^file:\/\//, ''), root)}
                </span>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-subtle">
        <span className="rounded px-1 font-medium">{agent === 'plan' ? 'Plan' : 'Build'}</span>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            title="Copiar"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              })
            }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <ConfirmButton
            title="¿Revertir a este punto?"
            body="Se ocultará este mensaje y todo lo que vino después, y se desharán los cambios en archivos que hizo el agente desde aquí. Puedes restaurarlo mientras no envíes un mensaje nuevo."
            confirmLabel="Revertir"
            danger
            disabled={busy}
            onConfirm={() => revertTo(entry.info.id)}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <Undo2 size={12} /> Revertir
          </ConfirmButton>
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

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

  const visible = useMemo(
    () => (revertMessageID ? entries.filter((e) => e.info.id < revertMessageID) : entries),
    [entries, revertMessageID]
  )
  const hidden = entries.length - visible.length
  const turns = useMemo(() => buildTurns(visible), [visible])
  const turnBlocks = useMemo(() => turns.map((t) => buildBlocks(t.assistant)), [turns])

  // Permisos ligados a una llamada de herramienta visible se muestran junto a ella.
  const callIds = new Set<string>()
  for (const e of visible) for (const p of e.parts) if (p.type === 'tool') callIds.add(p.callID)
  const inlinePerms = new Map<string, PendingPermission[]>()
  const loosePerms: PendingPermission[] = []
  for (const p of permissions) {
    if (p.tool && callIds.has(p.tool.callID)) inlinePerms.set(p.tool.callID, [...(inlinePerms.get(p.tool.callID) ?? []), p])
    else loosePerms.push(p)
  }
  const hotkeyID = permissions[0]?.id

  const lastTurn = turns[turns.length - 1]
  const lastAssistant = lastTurn?.assistant[lastTurn.assistant.length - 1]
  const lastHasOutput = !!lastAssistant?.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool' || p.type === 'reasoning')
  const showThinking = busy && !lastHasOutput && permissions.length === 0

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
        {loading && entries.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Cargando…
          </div>
        )}
        {turns.map((turn, ti) => {
          const isLastTurn = ti === turns.length - 1
          const blocks = turnBlocks[ti]
          return (
            <div key={turn.user?.info.id ?? `t${ti}`} className="flex flex-col gap-3">
              {turn.user && <UserMessage entry={turn.user} busy={busy} root={root} />}
              {blocks.length > 0 && (
                <div className="flex flex-col gap-2">
                  {blocks.map((b, bi) => {
                    const live = busy && isLastTurn && bi === blocks.length - 1
                    switch (b.kind) {
                      case 'text':
                        return <Markdown key={b.key} text={b.part.text} />
                      case 'reasoning':
                        return <Reasoning key={b.key} part={b.part} live={busy && isLastTurn} />
                      case 'steps': {
                        const hasPending = b.parts.some((p) => inlinePerms.has(p.callID))
                        return (
                          <StepGroup
                            key={b.key}
                            parts={b.parts}
                            root={root}
                            live={live}
                            hasPending={hasPending}
                            after={(p) =>
                              inlinePerms
                                .get(p.callID)
                                ?.map((perm) => <PermissionCard key={perm.id} request={perm} root={root} hotkeys={perm.id === hotkeyID} />)
                            }
                          />
                        )
                      }
                      case 'retry':
                        return (
                          <div key={b.key} className="flex items-center gap-1.5 text-xs text-muted">
                            <RotateCw size={12} /> Reintento {b.attempt}: {b.text}
                          </div>
                        )
                      case 'subtask':
                        return (
                          <div key={b.key} className="text-xs text-muted">
                            {b.text}
                          </div>
                        )
                      case 'error':
                        return <AssistantError key={b.key} info={b.info} />
                    }
                  })}
                </div>
              )}
            </div>
          )
        })}
        {hidden > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
            <span className="flex items-center gap-2">
              <Undo2 size={14} /> {hidden === 1 ? '1 mensaje revertido' : `${hidden} mensajes revertidos`}
            </span>
            <button type="button" onClick={onUnrevert} className="rounded-md px-2 py-0.5 font-medium text-accent hover:bg-accent-soft">
              Restaurar
            </button>
          </div>
        )}
        {loosePerms.map((perm) => (
          <PermissionCard key={perm.id} request={perm} root={root} hotkeys={perm.id === hotkeyID} />
        ))}
        {questions.map((q) => (
          <QuestionCard key={q.id} request={q} />
        ))}
        {showThinking && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
            </span>
            Trabajando…
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
