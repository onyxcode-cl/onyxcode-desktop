import { useEffect } from 'react'
import { Composer } from '../../components/Composer'
import { MessageList } from '../../components/MessageList'
import { ModelPicker } from '../../components/ModelPicker'
import { errorMessage } from '../../lib/opencode'
import { onStreamReconnect, useServer } from '../../stores/server'
import { useSessions, type MessageEntry } from '../../stores/sessions'
import { useSettings } from '../../stores/settings'
import { abortChat, sendChatMessage } from './actions'
import { useChat } from './store'

const EMPTY: MessageEntry[] = []

export function ChatView(): React.JSX.Element {
  const ready = useServer((s) => s.status.state === 'ready' && !!s.client)
  const activeId = useChat((s) => s.activeSessionId)
  const session = useSessions((s) => (activeId ? s.sessions[activeId] : undefined))
  const entries = useSessions((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY))
  const busy = useSessions((s) => (activeId ? (s.status[activeId] ?? 'idle') !== 'idle' : false))
  const error = useSessions((s) => (activeId ? s.errors[activeId] : null))
  const model = useSettings((s) => s.settings.defaultModel)
  const updateSettings = useSettings((s) => s.update)

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
    try {
      await sendChatMessage(text)
    } catch (err) {
      const id = useChat.getState().activeSessionId
      if (id) useSessions.getState().setError(id, errorMessage(err))
      else alert(errorMessage(err))
    }
  }

  const picker = <ModelPicker value={model} onChange={(m) => void updateSettings({ defaultModel: m })} />
  const composer = (
    <Composer
      onSend={send}
      onAbort={() => activeId && void abortChat(activeId)}
      busy={busy}
      disabled={!ready}
      placeholder={ready ? 'Escribe un mensaje…' : 'Conectando con OpenCode…'}
      footer={picker}
      autoFocusKey={activeId}
    />
  )

  if (!activeId) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-12 shrink-0" />
        <div className="flex flex-1 flex-col items-center justify-center pb-24">
          <h1 className="mb-8 text-3xl font-medium tracking-tight">¿En qué puedo ayudarte hoy?</h1>
          {composer}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-12 shrink-0 items-center justify-center border-b border-border px-4">
        <span className="truncate text-sm font-medium">{session?.title || 'Nueva conversación'}</span>
      </header>
      <MessageList entries={entries} busy={busy} error={error} />
      {composer}
    </div>
  )
}
