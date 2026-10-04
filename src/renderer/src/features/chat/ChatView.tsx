import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Languages, Lightbulb, ListChecks, PenLine, type LucideIcon } from 'lucide-react'
import { ChatComposer } from './ChatComposer'
import { ErrorNotice } from '../../components/conversation/ErrorNotice'
import { LogoMark } from '../../components/Logo'
import { ChatMessageList } from './ChatMessageList'
import { ModelPicker } from '../../components/ModelPicker'
import { NoAiBanner } from '../../components/NoAiBanner'
import { TranscriptLoader } from '../../components/TranscriptLoader'
import { UsageMeter } from '../../components/UsageMeter'
import { t as tr, type MsgKey } from '@shared/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useAiGate } from '../../lib/ai-gate'
import { useT } from '../../lib/i18n'
import { onStreamReconnect, useServer } from '../../stores/server'
import { useSessions, type MessageEntry } from '../../stores/sessions'
import { setModeModel, useModeModel } from '../settings/impl/extras'
import type { ChatAttachment } from '../../lib/attachments'
import { abortChat, compactChat, resendFromMessage, retryChat, sendChatMessage } from './actions'
import { useChat } from './store'

const EMPTY: MessageEntry[] = []

function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return tr('chat.greeting.morning')
  if (h >= 12 && h < 20) return tr('chat.greeting.afternoon')
  return tr('chat.greeting.evening')
}

const SUGGESTIONS: { icon: LucideIcon; label: MsgKey; prompt: MsgKey }[] = [
  { icon: PenLine, label: 'chat.suggest.write', prompt: 'chat.suggest.write.prompt' },
  { icon: Lightbulb, label: 'chat.suggest.brainstorm', prompt: 'chat.suggest.brainstorm.prompt' },
  { icon: BookOpen, label: 'chat.suggest.explain', prompt: 'chat.suggest.explain.prompt' },
  { icon: ListChecks, label: 'chat.suggest.plan', prompt: 'chat.suggest.plan.prompt' },
  { icon: Languages, label: 'chat.suggest.translate', prompt: 'chat.suggest.translate.prompt' }
]

export function ChatView(): React.JSX.Element {
  const t = useT()
  const ready = useServer((s) => s.status.state === 'ready' && !!s.client)
  const activeId = useChat((s) => s.activeSessionId)
  const session = useSessions((s) => (activeId ? s.sessions[activeId] : undefined))
  const entries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const busy = useSessions((s) => (activeId ? (s.status[activeId] ?? 'idle') !== 'idle' : false))
  const error = useSessions((s) => (activeId ? s.errors[activeId] : null))
  // Cada modo recuerda su propio modelo (`modelsByMode.chat`); sin elección propia vale el predeterminado global.
  const model = useModeModel('chat')
  const { effective, gate, free, unavailable } = useAiGate(model, { strict: true })
  const [sendError, setSendError] = useState<unknown>(null)
  const [insert, setInsert] = useState<{ text: string; key: number; attachments?: ChatAttachment[] } | null>(null)

  // Si la conversación abierta se eliminó (aquí o desde otro cliente), volver a "nueva".
  const listLoading = useChat((s) => s.listLoading)
  useEffect(() => {
    if (activeId && !session && !listLoading) useChat.getState().setActive(null)
  }, [activeId, session, listLoading])

  // Tras reconectar el stream, recargar los mensajes de la conversación abierta.
  useEffect(
    () =>
      onStreamReconnect(() => {
        const id = useChat.getState().activeSessionId
        const { client, connection } = useServer.getState()
        if (id && client && connection) void useSessions.getState().loadMessages(client, id, connection.chatDirectory)
      }),
    []
  )

  /** `false` = no se envió: el compositor restaura el borrador. */
  const send = async (text: string, files: ChatAttachment[] = []): Promise<boolean> => {
    setSendError(null)
    try {
      const ok = await sendChatMessage(
        text,
        files.map((f) => ({ mime: f.mime, filename: f.name, url: f.url }))
      )
      if (!ok) setInsert({ text, key: Date.now(), attachments: files })
      return ok
    } catch (err) {
      const id = useChat.getState().activeSessionId
      if (id) useSessions.getState().setError(id, typeof err === 'object' && err ? err : String(err))
      else setSendError(err)
      // Al crear la conversación la vista cambia de pantalla y el compositor se remonta: el texto vuelve por `insert`.
      setInsert({ text, key: Date.now(), attachments: files })
      return false
    }
  }

  // Reintentar / editar deshacen la conversación desde el mensaje (sin duplicarlo) y lo reenvían con sus adjuntos.
  // Si el motor no pudo ni recibirlo, el fallo se muestra como error de la conversación.
  const guarded = useCallback(
    async <T,>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      if (!activeId) return undefined
      try {
        return await fn(activeId)
      } catch (err) {
        useSessions.getState().setError(activeId, typeof err === 'object' && err ? err : String(err))
        throw err
      }
    },
    [activeId]
  )
  const retry = useCallback(() => guarded((id) => retryChat(id)), [guarded])
  const compact = useCallback(() => guarded((id) => compactChat(id)), [guarded])
  const edit = useCallback((messageID: string, text: string) => guarded((id) => resendFromMessage(id, messageID, text)), [guarded])

  const picker = (
    <div className="flex w-full items-center">
      <ModelPicker value={effective ?? model} unavailable={unavailable} onChange={(m) => setModeModel('chat', m)} />
      <span className="ml-auto" />
      <UsageMeter messages={entries} model={effective ?? model} />
    </div>
  )
  const composer = (
    <ChatComposer
      onSend={send}
      onAbort={() => activeId && void abortChat(activeId)}
      busy={busy}
      disabled={!ready || gate.blocked}
      placeholder={
        !ready
          ? t('chat.placeholder.connecting')
          : unavailable
            ? t('chat.placeholder.modelUnavailable')
            : gate.blocked
              ? t('chat.placeholder.noAi')
              : t('chat.placeholder.message')
      }
      footer={picker}
      autoFocusKey={activeId}
      showAttach
      insert={insert}
    />
  )

  const notices = (
    <div className={`mx-auto w-full max-w-3xl ${isRemoteSurface() ? 'px-4' : 'px-6'}`}>
      {sendError != null && (
        <div className="mb-2">
          <ErrorNotice error={sendError} variant="chat" />
        </div>
      )}
      {unavailable && (
        <div role="status" data-testid="model-unavailable-notice" className="mb-2 px-1 text-xs text-warning">
          {t('chat.modelUnavailable.notice', { model: model.modelID })}
        </div>
      )}
      <NoAiBanner
        gate={unavailable ? { blocked: false, reason: null, freeNote: false } : gate}
        freeModel={free}
        onUseFree={(m) => setModeModel('chat', m)}
      />
    </div>
  )

  if (!activeId && isRemoteSurface()) {
    // Celular: saludo centrado en el espacio libre, sugerencias en una fila con scroll y compositor abajo.
    return (
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 animate-rise-in flex-col items-center justify-center gap-4 px-6 text-center">
          <LogoMark size={36} />
          <div>
            <h1 className="font-display text-[26px] leading-tight font-semibold tracking-[-0.02em]">{greeting()}</h1>
            <p className="mt-1.5 text-[15px] text-muted">{t('chat.empty.prompt')}</p>
          </div>
        </div>
        {notices}
        <div className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              disabled={!ready}
              onClick={() => setInsert({ text: t(prompt), key: Date.now() })}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-elevated px-3 text-[13px] text-muted active:bg-hover disabled:opacity-50"
            >
              <Icon size={14} className="text-accent" />
              {t(label)}
            </button>
          ))}
        </div>
        {composer}
      </div>
    )
  }

  if (!activeId) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-12 shrink-0" data-mobile="hide" />
        <div className="flex flex-1 flex-col items-center justify-center pb-20">
          <div className="mb-8 flex animate-rise-in flex-col items-center gap-4 px-6 text-center">
            <div className="relative isolate">
              <div
                className="pointer-events-none absolute inset-0 -z-10 scale-[3] rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
                aria-hidden
              />
              <LogoMark size={44} />
            </div>
            <div>
              <h1 className="font-display text-[32px] leading-tight font-semibold tracking-[-0.02em]">{greeting()}</h1>
              <p className="mt-1.5 text-[15px] text-muted">{t('chat.empty.prompt')}</p>
            </div>
          </div>
          <div className="w-full animate-rise-in [animation-delay:60ms]">
            {notices}
            {composer}
          </div>
          <div className="mt-1 flex max-w-2xl animate-rise-in flex-wrap justify-center gap-2 px-6 [animation-delay:120ms]">
            {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                type="button"
                disabled={!ready}
                onClick={() => setInsert({ text: t(prompt), key: Date.now() })}
                className="no-drag inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1.5 text-[13px] text-muted shadow-xs transition-[color,border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:text-fg active:translate-y-0 disabled:opacity-50"
              >
                <Icon size={14} className="text-accent" />
                {t(label)}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header
        data-mobile="hide"
        className="drag flex h-12 shrink-0 items-center justify-center border-b border-border/70 bg-bg/80 px-24 backdrop-blur"
      >
        <span className="truncate text-[13.5px] font-medium">{session?.title || t('chat.newConversation')}</span>
      </header>
      <TranscriptLoader sessionId={activeId} />
      <ChatMessageList entries={entries} busy={busy} error={error} onRetry={retry} onCompact={compact} onEdit={edit} />
      {notices}
      {composer}
    </div>
  )
}
