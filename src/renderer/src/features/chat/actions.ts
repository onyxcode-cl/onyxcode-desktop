/**
 * Acciones del modo Chat sobre el SDK de OpenCode (v2).
 * Patrón reutilizable para Code/Cowork: cambiar `directory` y `agent`.
 */
import { CHAT_AGENT } from '@shared/types'
import { errorMessage } from '../../lib/opencode'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { useSettings } from '../../stores/settings'
import { useChat } from './store'

function ctx(): { client: NonNullable<ReturnType<typeof useServer.getState>['client']>; directory: string } {
  const { client, connection } = useServer.getState()
  if (!client || !connection) throw new Error('El servidor de OpenCode aún no está listo')
  return { client, directory: connection.chatDirectory }
}

export async function loadChatSessions(): Promise<void> {
  const chat = useChat.getState()
  chat.setListState({ listLoading: true, listError: null })
  try {
    const { client, directory } = ctx()
    await useSessions.getState().loadSessions(client, directory)
    chat.setListState({ listLoading: false })
  } catch (err) {
    chat.setListState({ listLoading: false, listError: errorMessage(err) })
  }
}

export async function openChatSession(sessionID: string | null): Promise<void> {
  useChat.getState().setActive(sessionID)
  if (!sessionID) return
  const { client, directory } = ctx()
  const store = useSessions.getState()
  if (!store.messages[sessionID]) {
    try {
      await store.loadMessages(client, sessionID, directory)
    } catch (err) {
      store.setError(sessionID, errorMessage(err))
    }
  }
}

export function newChat(): void {
  useChat.getState().setActive(null)
}

export async function sendChatMessage(text: string): Promise<void> {
  const { client, directory } = ctx()
  const sessions = useSessions.getState()
  const model = useSettings.getState().settings.defaultModel
  let sessionID = useChat.getState().activeSessionId

  if (!sessionID) {
    const res = await client.session.create({ directory, agent: CHAT_AGENT, metadata: { mode: 'chat' } })
    if (res.error || !res.data) throw new Error(errorMessage(res.error))
    sessions.upsertSession(res.data)
    sessionID = res.data.id
    useSessions.setState((s) => ({ messages: { ...s.messages, [res.data.id]: s.messages[res.data.id] ?? [] } }))
    useChat.getState().setActive(sessionID)
  }

  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  const res = await client.session.promptAsync({
    sessionID,
    directory,
    agent: CHAT_AGENT,
    model: { providerID: model.providerID, modelID: model.modelID },
    parts: [{ type: 'text', text }]
  })
  if (res.error) {
    sessions.setStatus(sessionID, 'idle')
    sessions.setError(sessionID, errorMessage(res.error))
  }
}

export async function abortChat(sessionID: string): Promise<void> {
  const { client, directory } = ctx()
  await client.session.abort({ sessionID, directory })
}

export async function renameChat(sessionID: string, title: string): Promise<void> {
  const { client, directory } = ctx()
  const res = await client.session.update({ sessionID, directory, title })
  if (res.data) useSessions.getState().upsertSession(res.data)
}

export async function deleteChat(sessionID: string): Promise<void> {
  const { client, directory } = ctx()
  await client.session.delete({ sessionID, directory })
  useSessions.getState().removeSession(sessionID)
  if (useChat.getState().activeSessionId === sessionID) useChat.getState().setActive(null)
}
