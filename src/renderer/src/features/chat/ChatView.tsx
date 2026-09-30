import { useEffect, useState } from 'react'
import { BookOpen, Languages, Lightbulb, ListChecks, PenLine, type LucideIcon } from 'lucide-react'
import { ChatComposer } from './ChatComposer'
import { ErrorNotice } from '../../components/conversation/ErrorNotice'
import { LogoMark } from '../../components/Logo'
import { ChatMessageList } from './ChatMessageList'
import { ModelPicker } from '../../components/ModelPicker'
import { NoAiBanner } from '../../components/NoAiBanner'
import { TranscriptLoader } from '../../components/TranscriptLoader'
import { UsageMeter } from '../../components/UsageMeter'
import { useAiGate } from '../../lib/ai-gate'
import { onStreamReconnect, useServer } from '../../stores/server'
import { useSessions, type MessageEntry } from '../../stores/sessions'
import { useSettings } from '../../stores/settings'
import { abortChat, sendChatMessage } from './actions'
import { useChat } from './store'

const EMPTY: MessageEntry[] = []

function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Buenos días'
  if (h >= 12 && h < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

const SUGGESTIONS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: PenLine, label: 'Redactar', prompt: 'Ayúdame a redactar un correo formal para ' },
  { icon: Lightbulb, label: 'Lluvia de ideas', prompt: 'Dame 10 ideas creativas para ' },
  { icon: BookOpen, label: 'Explicar', prompt: 'Explícame de forma simple cómo funciona ' },
  { icon: ListChecks, label: 'Planificar', prompt: 'Arma un plan paso a paso para ' },
  { icon: Languages, label: 'Traducir', prompt: 'Traduce al inglés el siguiente texto:\n\n' }
]

export function ChatView(): React.JSX.Element {
  const ready = useServer((s) => s.status.state === 'ready' && !!s.client)
  const activeId = useChat((s) => s.activeSessionId)
  const session = useSessions((s) => (activeId ? s.sessions[activeId] : undefined))
  const entries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const busy = useSessions((s) => (activeId ? (s.status[activeId] ?? 'idle') !== 'idle' : false))
  const error = useSessions((s) => (activeId ? s.errors[activeId] : null))
  const model = useSettings((s) => s.settings.defaultModel)
  const updateSettings = useSettings((s) => s.update)
  const { effective, gate, free } = useAiGate(model)
  const [sendError, setSendError] = useState<unknown>(null)
  const [insert, setInsert] = useState<{ text: string; key: number } | null>(null)

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

  const send = async (text: string): Promise<void> => {
    setSendError(null)
    try {
      await sendChatMessage(text)
    } catch (err) {
      const id = useChat.getState().activeSessionId
      if (id) useSessions.getState().setError(id, typeof err === 'object' && err ? err : String(err))
      else setSendError(err)
    }
  }

  const picker = (
    <div className="flex w-full items-center">
      <ModelPicker value={effective ?? model} onChange={(m) => void updateSettings({ defaultModel: m })} />
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
      placeholder={!ready ? 'Conectando con OpenCode…' : gate.blocked ? 'Conecta una IA para empezar' : 'Escribe un mensaje…'}
      footer={picker}
      autoFocusKey={activeId}
      showAttach
      insert={insert}
    />
  )

  const notices = (
    <div className="mx-auto w-full max-w-3xl px-6">
      {sendError != null && (
        <div className="mb-2">
          <ErrorNotice error={sendError} variant="chat" />
        </div>
      )}
      <NoAiBanner gate={gate} freeModel={free} onUseFree={(m) => void updateSettings({ defaultModel: m })} />
    </div>
  )

  if (!activeId) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-12 shrink-0" />
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
              <p className="mt-1.5 text-[15px] text-muted">¿En qué te ayudo hoy?</p>
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
                onClick={() => setInsert({ text: prompt, key: Date.now() })}
                className="no-drag inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1.5 text-[13px] text-muted shadow-xs transition-[color,border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:text-fg active:translate-y-0 disabled:opacity-50"
              >
                <Icon size={14} className="text-accent" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-center border-b border-border/70 bg-bg/80 px-24 backdrop-blur">
        <span className="truncate text-[13.5px] font-medium">{session?.title || 'Nueva conversación'}</span>
      </header>
      <TranscriptLoader sessionId={activeId} />
      <ChatMessageList entries={entries} busy={busy} error={error} onRetry={(text) => void send(text)} />
      {notices}
      {composer}
    </div>
  )
}
