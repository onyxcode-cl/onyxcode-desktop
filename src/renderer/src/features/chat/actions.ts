/**
 * Acciones del modo Chat sobre el SDK de OpenCode (v2).
 * Patrón reutilizable para Code/Tareas: cambiar `directory` y `agent`.
 */
import { NO_AI_ERROR } from '@shared/ai-errors'
import { t } from '@shared/i18n'
import { buildChatSystemPrompt } from '@shared/chat-prompt'
import type { ChatProjectContext } from '@shared/personal-context'
import { CHAT_AGENT } from '@shared/types'
import { isRemoteSurface } from '../../lib/platform'
import { useSettings } from '../../stores/settings'
import { loadPromptMemory } from '../memory/memory-client'
import { isSafeAttachmentUrl } from '../../lib/attachments'
import { pdfRoute } from '@shared/attach-adapt'
import { pdfToImages, pdfToText } from '../../lib/pdf-pages'
import { useProviders } from '../../stores/providers'
import { currentAiGate } from '../../lib/ai-gate'
import { errorMessage } from '../../lib/opencode'
import { reconcilePending, reconcileRunStatus, runStatusScope, unchangedSince } from '../../lib/session-reducer'
import { sameDir } from '../../stores/eventRouter'
import { onStreamReconnect, useServer } from '../../stores/server'
import { MAIN_SOURCE, useSessions, type MessageEntry } from '../../stores/sessions'
import { resolveModelForMode } from '../settings/impl/extras'
import { isArchivedSession } from '../tasks/impl/util'
import { useChat, type ChatPendingQuestion } from './store'
import { clearConversationInstructions, getConversationInstructions } from './conversation-instructions'
import { getExtras } from '../../lib/extrasApi'
import { useProjects } from '../projects/store'
import { markFirstStepDone, noteFirstStepsActivity } from '../../stores/first-steps'
import type { Part } from '@opencode-ai/sdk/v2/client'

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
  void loadChatQuestions() // una pregunta pudo llegar (o contestarse desde otro cliente) mientras no había stream
})

/**
 * Preguntas estructuradas pendientes del agente de Chat (herramienta `question`). Se RECONSTRUYEN desde el servidor
 * (como Code, F7-B16): lo contestado desde otro cliente no queda pegado y lo que llegó por evento durante la petición se
 * conserva. Si la petición falla no se toca nada.
 */
export async function loadChatQuestions(): Promise<void> {
  const { client, connection } = useServer.getState()
  if (!client || !connection) return
  const directory = connection.chatDirectory
  const before = useChat.getState().questions
  const res = await Promise.resolve()
    .then(() => client.question.list({ directory }))
    .catch(() => null)
  if (!res?.data) return
  const inChat = (sid: string): boolean => {
    const { sessions, sessionSource } = useSessions.getState()
    const s = sessions[sid]
    return !!s && (sessionSource[sid] ?? MAIN_SOURCE) === MAIN_SOURCE && sameDir(s.directory, directory)
  }
  const server: ChatPendingQuestion[] = res.data
    .filter((q) => inChat(q.sessionID))
    .map((q) => ({ id: q.id, sessionID: q.sessionID, questions: q.questions }))
  useChat
    .getState()
    .setQuestions(reconcilePending({ cur: useChat.getState().questions, before, server, inScope: (q) => inChat(q.sessionID) }))
}

/** Responde una pregunta del agente (una lista de respuestas por pregunta); la conversación sigue sola. */
export async function replyChatQuestion(q: ChatPendingQuestion, answers: string[][]): Promise<void> {
  const { client, directory } = ctx()
  const res = await client.question.reply({ requestID: q.id, answers, directory })
  if (res.error) throw new Error(errorMessage(res.error))
  useChat.getState().removeQuestion(q.id)
}

/** «Omitir»: rechaza la pregunta (el agente sigue sin esa respuesta). */
export async function rejectChatQuestion(q: ChatPendingQuestion): Promise<void> {
  const { client, directory } = ctx()
  const res = await client.question.reject({ requestID: q.id, directory })
  if (res.error) throw new Error(errorMessage(res.error))
  useChat.getState().removeQuestion(q.id)
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
  // Abrir una conversación saca de la pantalla de proyecto y suelta el proyecto elegido para la conversación nueva.
  useProjects.getState().closeProject()
  useProjects.getState().setPending(null)
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
  void loadChatQuestions() // una pregunta pendiente de esta conversación (p. ej. la app estaba cerrada) se muestra al abrirla
}

export function newChat(): void {
  useChat.getState().setActive(null)
  useProjects.getState().closeProject()
  useProjects.getState().setPending(null)
}

/** Adjunto de un mensaje de usuario que se vuelve a enviar tal cual (reintento / edición). */
export interface ResendFile {
  mime: string
  filename?: string
  url: string
}

/**
 * Cada PDF viaja como el modelo lo sabe leer: directo si lo acepta (ve el diseño), si no como imágenes de las páginas, y
 * si el modelo solo lee texto, como texto. Si no se sabe qué lee el modelo, se envía tal cual (como antes).
 */
async function adaptFilesForModel(files: ResendFile[], providerID: string, modelID: string): Promise<ResendFile[]> {
  if (!files.some((f) => f.mime === 'application/pdf')) return files
  const caps = useProviders.getState().providers.find((p) => p.id === providerID)?.models[modelID]?.capabilities.input
  const route = pdfRoute(caps)
  if (!route || route === 'direct') return files
  const out: ResendFile[] = []
  for (const f of files) {
    if (f.mime !== 'application/pdf') {
      out.push(f)
      continue
    }
    const name = f.filename ?? t('chat.attach.defaultName')
    const r = route === 'images' ? await pdfToImages(f.url, name) : await pdfToText(f.url, name)
    if (!r.ok) throw new Error(t(`chat.attach.pdf.err.${r.reason}.${route}`, { name }))
    out.push(...r.parts)
    if (r.truncated) out.push({ mime: 'text/plain', filename: `${name}.nota.txt`, url: textNote(t(`chat.attach.pdf.truncated.${route}`, { name })) })
  }
  return out
}

function textNote(text: string): string {
  return `data:text/plain;base64,${btoa(unescape(encodeURIComponent(text)))}`
}

/** Devuelve `true` si el motor aceptó el mensaje; `false` si lo rechazó (el error queda en la sesión). Lanza si no pudo ni intentarlo. */
export async function sendChatMessage(text: string, files: ResendFile[] = []): Promise<boolean> {
  // Seguridad: el agente `chat` no tiene acceso al disco, pero el motor LEE cualquier parte `file` con URL `file://`
  // sin pasar por los permisos del agente. Desde Chat solo salen adjuntos `data:` (contenido ya leído en el compositor).
  if (files.some((f) => !isSafeAttachmentUrl(f.url))) throw new Error(t('chat.attach.errUrl'))
  const { client, directory } = ctx()
  const sessions = useSessions.getState()
  // Modelo efectivo (el guardado si existe entre los proveedores cargados; si no, el de la primera IA conectada).
  const wanted = resolveModelForMode('chat')
  const { effective, gate } = currentAiGate(wanted, { strict: true })
  // El modelo elegido no existe: no se envía con otro a escondidas (mensaje claro, sin el error crudo del motor).
  if (gate.reason === 'model-unavailable') throw new Error(t('chat.modelUnavailable.send', { model: wanted.modelID }))
  if (gate.blocked || !effective) throw NO_AI_ERROR
  const model = effective
  files = await adaptFilesForModel(files, model.providerID, model.modelID)
  let sessionID = useChat.getState().activeSessionId
  // «Primeros pasos»: desde aquí hay actividad real de esta persona (no se la trata de usuaria antigua por la conversación que va a crear).
  noteFirstStepsActivity()

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
    // La conversación nueva nace en el proyecto elegido en el chip (si hay): se anota ANTES de armar el `system`.
    const pending = useProjects.getState().pendingId
    if (pending) {
      await useProjects.getState().assign(sessionID, pending)
      useProjects.getState().setPending(null)
    }
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
      // Instrucciones personalizadas + memoria aprobada (relevada justo ahora, para que lo aprobado hace un momento ya valga).
      // Nunca desde el celular: ver el comentario equivalente en `code/impl/store.ts`.
      system: await chatSystemPrompt(sessionID, text),
      // Un mensaje sin texto es válido si lleva adjuntos (reintento de un mensaje solo con archivos).
      parts: [
        ...(text || files.length === 0 ? [{ type: 'text' as const, text }] : []),
        ...files.map((f) => ({ type: 'file' as const, mime: f.mime, filename: f.filename, url: f.url }))
      ]
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
  // El motor aceptó el mensaje: paso «Haz tu primera pregunta» de los primeros pasos.
  if (text.trim()) {
    markFirstStepDone('message')
    markFirstStepDone('model') // si el motor respondió, ya hay un modelo en uso (también el gratuito del asistente)
  }
  return true
}

/** Instrucciones y pasajes del proyecto de la conversación (`null` si no es de un proyecto o no hay puente). Nunca bloquea el envío. */
async function chatProjectContext(sessionID: string, text: string): Promise<ChatProjectContext | null> {
  const x = getExtras()
  if (!x) return null
  const known = useProjects.getState().state
  if (known && !known.assignments[sessionID]) return null // la mayoría de las conversaciones: sin llamada
  try {
    // Una pregunta de seguimiento muy corta se apoya en el mensaje anterior de la persona.
    const entries = useSessions.getState().messages[sessionID] ?? []
    const prevId = lastUserMessageId(entries)
    const prev = prevId ? entries.find((e) => e.info.id === prevId) : undefined
    const recent = prev ? userMessageContent(prev).text.slice(0, 1000) : ''
    const r = await x.invoke('projects:context', { sessionId: sessionID, query: text.slice(0, 20_000), ...(recent ? { recent } : {}) })
    if (!r) return null
    return { name: r.name, instructions: r.instructions, passages: r.passages, hasFiles: r.hasFiles }
  } catch {
    return null
  }
}

/** `system` de Chat: instrucciones de la persona + las de esta conversación + las del proyecto y sus pasajes + memoria de usuario aprobada. `undefined` desde el celular. */
async function chatSystemPrompt(sessionID: string, text: string): Promise<string | undefined> {
  if (isRemoteSurface()) return undefined
  const s = useSettings.getState().settings
  const mem = s.learningEnabled === false ? null : await loadPromptMemory()
  return buildChatSystemPrompt({
    learningEnabled: s.learningEnabled,
    instructions: s.userInstructions,
    // Solo las de ESTA conversación (guardadas por sesión en este computador).
    conversationInstructions: getConversationInstructions(sessionID),
    learnedUser: mem?.usuario ?? null,
    project: await chatProjectContext(sessionID, text)
  })
}

/** Texto (sin partes sintéticas) y adjuntos de un mensaje de usuario. */
export function userMessageContent(entry: MessageEntry): { text: string; files: ResendFile[] } {
  const text = entry.parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text' && !p.synthetic && !p.ignored)
    .map((p) => p.text)
    .join('\n\n')
  const files = entry.parts
    .filter((p): p is Extract<Part, { type: 'file' }> => p.type === 'file')
    .map((p) => ({ mime: p.mime, filename: p.filename, url: p.url }))
  return { text, files }
}

/** Id del último mensaje del usuario de la conversación (o null). */
export function lastUserMessageId(entries: readonly MessageEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'user') return entries[i].info.id
  return null
}

/** Si la conversación está ocupada la detiene y espera (hasta `ms`) a que el motor la dé por inactiva. */
async function stopIfBusy(sessionID: string, ms = 5000): Promise<void> {
  const { client, directory } = ctx()
  if ((useSessions.getState().status[sessionID] ?? 'idle') === 'idle') return
  await client.session.abort({ sessionID, directory }).catch(() => null)
  const until = Date.now() + ms
  while (Date.now() < until) {
    const res = await client.session.status({ directory }).catch(() => null)
    const type = res?.data?.[sessionID]?.type
    if (!type || type === 'idle') break
    await new Promise((r) => setTimeout(r, 200))
  }
  useSessions.getState().setStatus(sessionID, 'idle')
}

/**
 * «Reintentar» / «Editar y reintentar»: deshace la conversación desde el mensaje de usuario `messageID`
 * (`session.revert`) y reenvía sus partes (texto, o `newText` si se editó, y los mismos adjuntos), de modo que
 * en el historial queda UN solo mensaje de usuario y no se pierden los archivos. Si el envío falla, deshace el
 * `revert` y recarga para no dejar la conversación recortada. Devuelve `false` si no se envió.
 */
export async function resendFromMessage(sessionID: string, messageID: string, newText?: string): Promise<boolean> {
  const { client, directory } = ctx()
  const entry = (useSessions.getState().messages[sessionID] ?? []).find((e) => e.info.id === messageID)
  if (!entry || entry.info.role !== 'user') return false
  const { text, files } = userMessageContent(entry)
  const sendText = newText === undefined ? text : newText.trim()
  if (!sendText && files.length === 0) return false
  await stopIfBusy(sessionID)
  const rev = await client.session.revert({ sessionID, directory, messageID })
  if (rev.error) throw new Error(errorMessage(rev.error))
  if (rev.data) useSessions.getState().upsertSession(rev.data)
  // Lo posterior se descarta ya en pantalla (el motor lo borra al aceptar el nuevo prompt).
  useSessions.setState((s) => ({
    messages: { ...s.messages, [sessionID]: (s.messages[sessionID] ?? []).filter((e) => e.info.id < messageID) }
  }))
  const undo = async (): Promise<void> => {
    const un = await client.session.unrevert({ sessionID, directory }).catch(() => null)
    if (un?.data) useSessions.getState().upsertSession(un.data)
    await useSessions
      .getState()
      .loadMessages(client, sessionID, directory)
      .catch(() => null)
  }
  let ok = false
  try {
    ok = await sendChatMessage(sendText, files)
  } catch (err) {
    await undo()
    throw err
  }
  if (!ok) await undo()
  return ok
}

/** «Reintentar» tras un error: reenvía el último mensaje del usuario sin duplicarlo. */
export async function retryChat(sessionID: string): Promise<boolean> {
  const id = lastUserMessageId(useSessions.getState().messages[sessionID] ?? [])
  return id ? resendFromMessage(sessionID, id) : false
}

/** «Compactar» (error de contexto): resume la conversación con `session.summarize`, como Code. */
export async function compactChat(sessionID: string): Promise<void> {
  const { client, directory } = ctx()
  const sessions = useSessions.getState()
  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  try {
    const model = currentAiGate(resolveModelForMode('chat'), { strict: true }).effective
    const res = await client.session.summarize({ sessionID, directory, providerID: model?.providerID, modelID: model?.modelID })
    const err = (res as { error?: unknown }).error
    if (err) throw err
  } catch (err) {
    sessions.setStatus(sessionID, 'idle')
    sessions.setError(sessionID, typeof err === 'object' && err ? err : String(err))
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
  clearConversationInstructions(sessionID)
  if (useProjects.getState().state?.assignments[sessionID]) void useProjects.getState().assign(sessionID, null)
  if (useChat.getState().activeSessionId === sessionID) useChat.getState().setActive(null)
  if (useChat.getState().pinned[directory]?.includes(sessionID)) useChat.getState().togglePin(directory, sessionID)
}

/** Fija o quita de fijadas una conversación (solo en este equipo; el motor no se entera). */
export function toggleChatPin(sessionID: string): void {
  const { connection } = useServer.getState()
  if (connection) useChat.getState().togglePin(connection.chatDirectory, sessionID)
}

/** Archiva una conversación con `session.update({ time: { archived } })`, igual que Code y Tareas. Si estaba abierta, se cierra. */
export async function archiveChat(sessionID: string): Promise<void> {
  const { client, directory } = ctx()
  const res = await client.session.update({ sessionID, directory, time: { archived: Date.now() } })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
  if (useChat.getState().activeSessionId === sessionID) useChat.getState().setActive(null)
}

/**
 * Restaura una conversación archivada (`archived: 0`). Si el servidor lo rechaza o sigue archivada, respaldo
 * `metadata.unarchivedAt` (como `restoreTask`).
 */
export async function restoreChat(sessionID: string): Promise<void> {
  const { client, directory } = ctx()
  const known = useSessions.getState().sessions[sessionID]
  const first = await client.session.update({ sessionID, directory, time: { archived: 0 } })
  let data = first.error ? undefined : first.data
  if (!data || isArchivedSession(data)) {
    const second = await client.session.update({
      sessionID,
      directory,
      metadata: { ...(data?.metadata ?? known?.metadata ?? {}), unarchivedAt: Date.now() }
    })
    if (second.error) throw new Error(errorMessage(second.error))
    data = second.data ?? data
  }
  if (data) useSessions.getState().upsertSession(data)
}
