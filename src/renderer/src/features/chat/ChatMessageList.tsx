import { memo, useEffect, useRef, useState } from 'react'
import type { AssistantMessage, Part } from '@opencode-ai/sdk/v2/client'
import { FileText, Pencil, RotateCcw, RotateCw } from 'lucide-react'
import { friendlyError } from '@shared/ai-errors'
import { useT } from '../../lib/i18n'
import type { ConvError } from '../../lib/session-reducer'
import type { MessageEntry } from '../../stores/sessions'
import { CopyButton } from '../../components/Markdown'
import { DeferredMarkdown } from '../../components/conversation/DeferredMarkdown'
import { ThinkingIndicator } from '../../components/conversation/ThinkingIndicator'
import { ActionIconButton, CopyActionButton, MessageActionsSheet } from '../../components/mobile/MessageActionsSheet'
import { TappableImage } from '../../components/mobile/ImageViewer'
import { isRemoteSurface } from '../../lib/platform'
import { useLongPress } from '../../lib/use-long-press'
import { m } from '../../app/mobile/m'
import '../../app/mobile/conversation.css'
import { AssistantError } from '../../components/conversation/AssistantError'
import { Button } from '../../components/Button'
import { ErrorNotice, type ErrorActions } from '../../components/conversation/ErrorNotice'
import { Reasoning } from '../../components/conversation/Reasoning'
import { ScrollToEnd } from '../../components/conversation/ScrollToEnd'
import { useStickToBottom } from '../../lib/conversation/use-stick-to-bottom'
import { isOldRow, withCv } from '../../lib/conversation/cv'
import { lastAssistantFailed } from '../../lib/conversation/errors'
import { ConversationAnnouncer } from '../../components/conversation/ConversationAnnouncer'
import { ChatToolCall } from './ChatToolCall'

// Filas memoizadas (F7-B44): las partes y mensajes sin cambios conservan su referencia en el store, así que durante
// el streaming solo se re-renderiza lo que cambió. Todas las props son primitivas o referencias estables.
/** Imagen de un mensaje. En el celular se toca para ampliarla; en el escritorio es la misma imagen de siempre. */
function PartImage({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const img = (
    <img src={src} alt={alt} className="max-h-56 max-w-[min(85%,20rem)] rounded-xl border border-border object-contain shadow-xs" />
  )
  if (!isRemoteSurface()) return img
  return (
    <TappableImage open={open} setOpen={setOpen} src={src} alt={alt} className="block max-w-full">
      {img}
    </TappableImage>
  )
}

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
      return <DeferredMarkdown text={part.text} streaming={streaming} />
    case 'reasoning':
      return <Reasoning part={part} live={live} variant="chat" />
    case 'tool':
      return <ChatToolCall part={part} />
    case 'file':
      if (part.mime.startsWith('image/') && part.url.startsWith('data:image/'))
        return <PartImage src={part.url} alt={part.filename ?? t('chat.attach.defaultName')} />
      return (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-muted shadow-xs">
          <FileText size={13} className="text-accent" /> {part.filename ?? part.url}
        </div>
      )
    case 'retry':
      return (
        <div {...m('meta')} className="flex items-center gap-1.5 text-xs text-muted">
          <RotateCw size={12} /> {`${t('chat.msg.retryAttempt', { attempt: part.attempt })} ${friendlyError(part.error).message}`}
        </div>
      )
    default:
      return null
  }
})

export { ThinkingIndicator }

function textOfParts(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic && !p.ignored)
    .map((p) => p.text)
    .join('\n\n')
}

const ChatUserRow = memo(function ChatUserRow({
  entry,
  old,
  animate,
  onEdit
}: {
  entry: MessageEntry
  old: boolean
  /** Animar la entrada (en el celular solo las filas nuevas, no el historial que se carga de golpe). */
  animate: boolean
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
  const [sheet, setSheet] = useState(false)
  const longPress = useLongPress(() => setSheet(true))
  const mobile = isRemoteSurface()
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
    <div className={withCv(`group flex ${animate ? 'animate-rise-in ' : ''}flex-col items-end gap-1`, old, true)}>
      {files.map((p) => (
        <PartView key={p.id} part={p} live={false} />
      ))}
      {text && (
        <div
          {...m('user-bubble')}
          {...(longPress ? { ...longPress, 'data-long-press': '' } : {})}
          className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/10 bg-user px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-xs"
        >
          {text}
        </div>
      )}
      {mobile && text && (
        <MessageActionsSheet
          open={sheet}
          onClose={() => setSheet(false)}
          text={text}
          actions={
            onEdit
              ? [
                  {
                    label: t('chat.msg.edit'),
                    icon: <Pencil size={20} />,
                    onSelect: () => {
                      setDraft(text)
                      setEditing(true)
                    }
                  }
                ]
              : []
          }
        />
      )}
      {!mobile && text && (
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
  const mobile = isRemoteSurface()
  const [sheet, setSheet] = useState(false)
  const longPress = useLongPress(() => setSheet(true))
  return (
    <div
      className={withCv('group flex flex-col gap-1.5', old, true)}
      {...(longPress && text ? { ...longPress, 'data-long-press': '' } : {})}
    >
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
      {mobile && text && (
        <MessageActionsSheet
          open={sheet}
          onClose={() => setSheet(false)}
          text={text}
          actions={
            isLast && onRetry
              ? [
                  {
                    label: t('chat.msg.retry'),
                    icon: <RotateCcw size={20} />,
                    onSelect: () => void Promise.resolve(onRetry()).catch(() => undefined)
                  }
                ]
              : []
          }
        />
      )}
      {mobile && showActions && isLast && (
        <div className="-ml-1.5 flex items-center gap-0.5">
          <CopyActionButton text={text} label={t('chat.msg.copyReply')} />
          {onRetry && (
            <ActionIconButton label={t('chat.msg.retry')} onClick={() => void Promise.resolve(onRetry()).catch(() => undefined)}>
              <RotateCcw size={18} />
            </ActionIconButton>
          )}
        </div>
      )}
      {!mobile && showActions && (
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
  const mobile = isRemoteSurface()
  // Celular: el historial que se carga de golpe no anima; solo las filas que llegan después de abrir la conversación.
  const firstRows = useRef<{ key: string | undefined; count: number }>({ key: entries[0]?.info.id, count: entries.length })
  if (firstRows.current.key !== entries[0]?.info.id) firstRows.current = { key: entries[0]?.info.id, count: entries.length }

  const last = entries[entries.length - 1]
  const lastHasOutput = last?.info.role === 'assistant' && last.parts.some((p) => (p.type === 'text' && p.text) || p.type === 'tool')
  const showThinking = busy && !lastHasOutput

  // Sin ningún mensaje de usuario no hay nada que reenviar: no se ofrece «Reintentar».
  const canRetry = entries.some((e) => e.info.role === 'user')

  return (
    <div className="relative min-h-0 flex-1">
      <ConversationAnnouncer busy={busy} error={error} entries={entries} />
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div
          className={
            mobile ? 'mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-3 pb-4' : 'mx-auto flex max-w-3xl flex-col gap-7 px-6 pt-8 pb-10'
          }
        >
          {entries.map((entry, i) => {
            const isLast = i === entries.length - 1
            const old = isOldRow(i, entries.length)
            if (entry.info.role === 'user')
              return (
                <ChatUserRow
                  key={entry.info.id}
                  entry={entry}
                  old={old}
                  animate={!mobile || i >= firstRows.current.count}
                  onEdit={onEdit}
                />
              )
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
      {mobile && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-bg to-transparent" />
      )}
      <ScrollToEnd visible={!atBottom} onClick={scrollToBottom} fresh={busy} />
    </div>
  )
}
