import { memo } from 'react'
import type { AssistantMessage, Part } from '@opencode-ai/sdk/v2/client'
import { FileText, RotateCcw, RotateCw } from 'lucide-react'
import { friendlyError } from '@shared/ai-errors'
import { useT } from '../../lib/i18n'
import type { ConvError } from '../../lib/session-reducer'
import type { MessageEntry } from '../../stores/sessions'
import { LogoMark } from '../../components/Logo'
import { CopyButton, Markdown } from '../../components/Markdown'
import { AssistantError } from '../../components/conversation/AssistantError'
import { ErrorNotice } from '../../components/conversation/ErrorNotice'
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

const ChatUserRow = memo(function ChatUserRow({ entry, old }: { entry: MessageEntry; old: boolean }): React.JSX.Element {
  const t = useT()
  const text = textOfParts(entry.parts)
  const files = entry.parts.filter((p) => p.type === 'file')
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
  lastUserText,
  old
}: {
  entry: { info: AssistantMessage; parts: Part[] }
  live: boolean
  isLast: boolean
  /** Solo se entrega a la última fila (las demás reciben `undefined`, para no romper la memoización). */
  onRetry?: (userText: string) => void
  lastUserText: string
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
      <AssistantError info={entry.info} abortedLabel={t('chat.msg.stopped')} variant="chat" />
      {showActions && (
        <div
          className={`-ml-1.5 flex items-center gap-0.5 transition-opacity ${isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
        >
          <CopyButton text={text} label={t('chat.msg.copyReply')} />
          {isLast && onRetry && lastUserText && (
            <button
              type="button"
              onClick={() => onRetry(lastUserText)}
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

interface Props {
  entries: MessageEntry[]
  busy: boolean
  error?: ConvError | null
  /** Si se entrega, la última respuesta muestra "Reintentar" (recibe el texto del último mensaje del usuario). */
  onRetry?: (userText: string) => void
}

export function ChatMessageList({ entries, busy, error, onRetry }: Props): React.JSX.Element {
  const { scrollRef, atBottom, onScroll, scrollToBottom } = useStickToBottom(entries[0]?.info.id)

  const last = entries[entries.length - 1]
  const lastHasOutput = last?.info.role === 'assistant' && last.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool')
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
            const old = isOldRow(i, entries.length)
            if (entry.info.role === 'user') return <ChatUserRow key={entry.info.id} entry={entry} old={old} />
            return (
              <ChatAssistantRow
                key={entry.info.id}
                entry={entry as { info: AssistantMessage; parts: Part[] }}
                live={busy && isLast}
                isLast={isLast}
                onRetry={isLast ? onRetry : undefined}
                lastUserText={isLast ? lastUserText : ''}
                old={old}
              />
            )
          })}
          {showThinking && <ThinkingIndicator />}
          {error && !lastAssistantFailed(entries) && <ErrorNotice error={error} variant="chat" />}
        </div>
      </div>
      <ScrollToEnd visible={!atBottom} onClick={scrollToBottom} />
    </div>
  )
}
