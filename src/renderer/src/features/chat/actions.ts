/**
 * Acciones del modo Chat sobre el SDK de OpenCode (v2).
 * Patrón reutilizable para Code/Tareas: cambiar `directory` y `agent`.
 */
import { NO_AI_ERROR } from '@shared/ai-errors'
import { t } from '@shared/i18n'
import { CHAT_AGENT } from '@shared/types'
import { currentAiGate } from '../../lib/ai-gate'
import { errorMessage } from '../../lib/opencode'
import { reconcileRunStatus, runStatusScope, unchangedSince } from '../../lib/session-reducer'
import { onStreamReconnect, useServer } from '../../stores/server'
import { MAIN_SOURCE, useSessions } from '../../stores/sessions'
import { useSettings } from '../../stores/settings'
import { useChat } from './store'

function ctx(): { client: NonNullable<ReturnType<typeof useServer.getState>['client']>; directory: string } {
  const { client, connection } = useServer.getState()
  if (!client || !connection) throw new Error(t('chat.server.notReady'))
  return { client, directory: connection.chatDirectory }
}

// Guarda del LRU de `messages`: la conversación abierta nunca se desaloja.
useSessions.getState().addEvictionGuard(() => {
  const id = useChat.getState().activeSessionId
  return id ? [id] : []
})

// F7-B14: al reconectar el stream (p. ej. tras reiniciar el sidecar) el historial cargado pudo cambiar sin que
// llegaran los eventos: se marca como no cargado (salvo la conversación abierta, que recarga `ChatView`).
// Vive aquí (y no en `ChatSidebar`) para actuar aunque la vista de Chat no esté montada.
onStreamReconnect(() => {
  const active = useChat.getState().activeSessionId
  useSessions.getState().invalidateLoaded((src) => src === MAIN_SOURCE, active ? [active] : [])
})

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

/**
 * Tras reconectar el stream: lee `session.status` del servidor y limpia los spinners de sesiones de
 * Chat que quedaron `busy` porque se perdió el evento de fin (F6-B5). Errores de red se ignoran.
 */
export async function syncChatRunStatus(): Promise<void> {
  const { client, connection } = useServer.getState()
  if (!client || !connection) return
  const directory = connection.chatDirectory
  const before = useSessions.getState().status
  const res = await client.session.status({ directory }).catch(() => null)
  const data = res?.data
  if (!data) return
  // Se lee el estado JUSTO antes del `set` (no antes del fetch) y se excluyen las sesiones que cambiaron durante
  // la petición. El ámbito incluye las entradas de `status` sin sesión (huérfanas tras reiniciar el sidecar).
  const { sessions, sessionSource, status } = useSessions.getState()
  const scope = unchangedSince(
    runStatusScope({ sessions, sessionSource, status }, directory, (src) => src === MAIN_SOURCE),
    before,
    status
  )
  const next = reconcileRunStatus(status, data, scope)
  if (next) useSessions.setState({ status: next })
}

export async function openChatSession(sessionID: string | null): Promise<void> {
  useChat.getState().setActive(sessionID)
  if (!sessionID) return
  const { client, directory } = ctx()
  const store = useSessions.getState()
  // Reabrir fija la sesión (activa + acceso) ANTES de cargar: así no se desaloja a mitad de la recarga.
  store.touchSession(sessionID)
  // `loaded` y no `messages[id]`: pueden existir mensajes parciales por eventos sueltos (F6-B12).
  if (!store.loaded[sessionID]) {
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

/** Devuelve `true` si el motor aceptó el mensaje; `false` si lo rechazó (el error queda en la sesión). Lanza si no pudo ni intentarlo. */
export async function sendChatMessage(text: string): Promise<boolean> {
  const { client, directory } = ctx()
  const sessions = useSessions.getState()
  // Modelo efectivo (el guardado si existe entre los proveedores cargados; si no, el de la primera IA conectada).
  const { effective, gate } = currentAiGate(useSettings.getState().settings.defaultModel)
  if (gate.blocked || !effective) throw NO_AI_ERROR
  const model = effective
  let sessionID = useChat.getState().activeSessionId

  if (!sessionID) {
    const res = await client.session.create({ directory, agent: CHAT_AGENT, metadata: { mode: 'chat' } })
    if (res.error || !res.data) throw new Error(errorMessage(res.error))
    sessions.upsertSession(res.data)
    sessionID = res.data.id
    useSessions.setState((s) => ({
      messages: { ...s.messages, [res.data.id]: s.messages[res.data.id] ?? [] },
      loaded: { ...s.loaded, [res.data.id]: true } // sesión nueva: no hay historial que cargar
    }))
    useChat.getState().setActive(sessionID)
  }

  sessions.touchSession(sessionID)
  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  let error: unknown
  try {
    const res = await client.session.promptAsync({
      sessionID,
      directory,
      agent: CHAT_AGENT,
      model: { providerID: model.providerID, modelID: model.modelID },
      parts: [{ type: 'text', text }]
    })
    error = (res as { error?: unknown }).error
  } catch (err) {
    // H4: sin respuesta del motor (red caída, excepción) la sesión no puede quedarse «ocupada» para siempre.
    sessions.setStatus(sessionID, 'idle')
    throw err
  }
  if (error) {
    sessions.setStatus(sessionID, 'idle')
    sessions.setError(sessionID, error)
    return false
  }
  return true
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
