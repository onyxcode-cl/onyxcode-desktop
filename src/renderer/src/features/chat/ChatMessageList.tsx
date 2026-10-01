import { memo, useEffect, useRef, useState } from 'react'
import type { AssistantMessage, Part } from '@opencode-ai/sdk/v2/client'
import { FileText, Pencil, RotateCcw, RotateCw } from 'lucide-react'
import { friendlyError } from '@shared/ai-errors'
import { useT } from '../../lib/i18n'
import type { ConvError } from '../../lib/session-reducer'
import type { MessageEntry } from '../../stores/sessions'
import { LogoMark } from '../../components/Logo'
import { CopyButton, Markdown } from '../../components/Markdown'
import { AssistantError } from '../../components/conversation/AssistantError'
import { Button } from '../../components/Button'
import { ErrorNotice, type ErrorActions } from '../../components/conversation/ErrorNotice'
import { Reasoning } from '../../components/conversation/Reasoning'
import { ScrollToEnd } from '../../components/conversation/ScrollToEnd'
import { useStickToBottom } from '../../lib/conversation/use-stick-to-bottom'
import { isOldRow, withCv } from '../../lib/conversation/cv'
import { lastAssistantFailed } from '../../lib/conversation/errors'
import { ChatToolCall } from './ChatToolCall'

// Filas memoizadas (F7-B44): las partes y mensajes sin cambios conservan su referencia en el store, así que durante
// el streaming solo se re-renderiza lo que cambió. Todas las props son primitivas o referencias estables.
const PartView = memo(function PartView({
  part,
  live,
  streaming
}: {
  part: Part
  live: boolean
  streaming?: boolean
}): React.JSX.Element | null {
  const t = useT()
  switch (part.type) {
    case 'text':
      if (part.synthetic || part.ignored || !part.text) return null
      return <Markdown text={part.text} streaming={streaming} />
    case 'reasoning':
      return <Reasoning part={part} live={live} variant="chat" />
    case 'tool':
      return <ChatToolCall part={part} />
    case 'file':
      return (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-muted shadow-xs">
          <FileText size={13} className="text-accent" /> {part.filename ?? part.url}
        </div>
      )
    case 'retry':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <RotateCw size={12} /> {`${t('chat.msg.retryAttempt', { attempt: part.attempt })} ${friendlyError(part.error).message}`}
        </div>
      )
    default:
      return null
  }
})

/** Indicador de "pensando" con la chispa de la marca. */
export function ThinkingIndicator({ label }: { label?: string }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex animate-fade-in items-center gap-2.5 text-sm text-muted" role="status" aria-live="polite">
      <LogoMark size={18} animated />
      <span className="text-shimmer">{label ?? t('chat.msg.thinking')}</span>
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

const ChatUserRow = memo(function ChatUserRow({
  entry,
  old,
  onEdit
}: {
  entry: MessageEntry
  old: boolean
  /** «Editar y reintentar»: recibe el id del mensaje y el texto editado. Sin él no se ofrece. */
  onEdit?: (messageID: string, text: string) => Promise<unknown>
}): React.JSX.Element {
  const t = useT()
  const text = textOfParts(entry.parts)
  const files = entry.parts.filter((p) => p.type === 'file')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [pending, setPending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!editing) return
    const el = taRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])
  const cancel = (): void => {
    setEditing(false)
    setDraft(text)
  }
  const submit = async (): Promise<void> => {
    const next = draft.trim()
    if (!onEdit || pending || (!next && files.length === 0)) return
    setPending(true)
    try {
      // `false` = no se envió (el error queda en la sesión): el editor sigue abierto con el texto.
      if ((await onEdit(entry.info.id, next)) !== false) setEditing(false)
    } catch {
      /* el fallo queda en el estado de la sesión; el editor sigue abierto */
    } finally {
      setPending(false)
    }
  }
  if (editing) {
    return (
      <div className="flex w-full flex-col items-end gap-1.5">
        <textarea
          ref={taRef}
          value={draft}
          disabled={pending}
          rows={Math.min(8, Math.max(2, draft.split('\n').length))}
          aria-label={t('chat.msg.editAria')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel()
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
          className="w-full max-w-[85%] resize-y rounded-xl border border-border-strong bg-elevated px-3 py-2 text-[15px] focus:shadow-[0_0_0_3px_var(--accent-ring)] focus:outline-none"
        />
        <p className="max-w-[85%] text-right text-[11px] text-subtle">{t('chat.msg.editNote')}</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>
            {t('chat.msg.editCancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={pending || (!draft.trim() && files.length === 0)} onClick={() => void submit()}>
            {t('chat.msg.editSend')}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className={withCv('group flex animate-rise-in flex-col items-end gap-1', old, true)}>
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
          <CopyButton text={text} label={t('chat.msg.copyMessage')} />
          {onEdit && (
            <button
              type="button"
              onClick={() => {
                setDraft(text)
                setEditing(true)
              }}
              title={t('chat.msg.edit')}
              aria-label={t('chat.msg.edit')}
              className="no-drag inline-flex items-center rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
})

const ChatAssistantRow = memo(function ChatAssistantRow({
  entry,
  live,
  isLast,
  onRetry,
  onCompact,
  old
}: {
  entry: { info: AssistantMessage; parts: Part[] }
  live: boolean
  isLast: boolean
  /** Solo se entregan a la última fila (las demás reciben `undefined`, para no romper la memoización). */
  onRetry?: ErrorActions['onRetry']
  onCompact?: ErrorActions['onCompact']
  /** Fila antigua: `content-visibility: auto`. */
  old: boolean
}): React.JSX.Element {
  const t = useT()
  const lastTextIdx = live ? entry.parts.map((p) => p.type).lastIndexOf('text') : -1
  const text = textOfParts(entry.parts)
  const showActions = !live && !!text
  return (
    <div className={withCv('group flex flex-col gap-1.5', old, true)}>
      {entry.parts.map((p, idx) => (
        <PartView key={p.id} part={p} live={live} streaming={live && idx === lastTextIdx} />
      ))}
      <AssistantError
        info={entry.info}
        abortedLabel={t('chat.msg.stopped')}
        variant="chat"
        onRetry={live ? undefined : onRetry}
        onCompact={live ? undefined : onCompact}
      />
      {showActions && (
        <div
          className={`-ml-1.5 flex items-center gap-0.5 transition-opacity ${isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
        >
          <CopyButton text={text} label={t('chat.msg.copyReply')} />
          {isLast && onRetry && (
            <button
              type="button"
              onClick={() => void Promise.resolve(onRetry()).catch(() => undefined)}
              title={t('chat.msg.retry')}
              aria-label={t('chat.msg.retry')}
              className="no-drag inline-flex items-center rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  )
})

interface Props extends ErrorActions {
  entries: MessageEntry[]
  busy: boolean
  error?: ConvError | null
  /** Si se entrega, cada mensaje del usuario con texto ofrece «Editar y reintentar». */
  onEdit?: (messageID: string, text: string) => Promise<unknown>
}

export function ChatMessageList({ entries, busy, error, onRetry, onCompact, onEdit }: Props): React.JSX.Element {
  const { scrollRef, atBottom, onScroll, scrollToBottom } = useStickToBottom(entries[0]?.info.id)

  const last = entries[entries.length - 1]
  const lastHasOutput = last?.info.role === 'assistant' && last.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool')
  const showThinking = busy && !lastHasOutput

  // Sin ningún mensaje de usuario no hay nada que reenviar: no se ofrece «Reintentar».
  const canRetry = entries.some((e) => e.info.role === 'user')

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 pt-8 pb-10">
          {entries.map((entry, i) => {
            const isLast = i === entries.length - 1
            const old = isOldRow(i, entries.length)
            if (entry.info.role === 'user') return <ChatUserRow key={entry.info.id} entry={entry} old={old} onEdit={onEdit} />
            return (
              <ChatAssistantRow
                key={entry.info.id}
                entry={entry as { info: AssistantMessage; parts: Part[] }}
                live={busy && isLast}
                isLast={isLast}
                onRetry={isLast && canRetry ? onRetry : undefined}
                onCompact={isLast ? onCompact : undefined}
                old={old}
              />
            )
          })}
          {showThinking && <ThinkingIndicator />}
          {error && !lastAssistantFailed(entries) && (
            <ErrorNotice error={error} variant="chat" onRetry={canRetry ? onRetry : undefined} onCompact={onCompact} />
          )}
        </div>
      </div>
      <ScrollToEnd visible={!atBottom} onClick={scrollToBottom} />
    </div>
  )
}
