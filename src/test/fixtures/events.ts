/**
 * Fábricas tipadas de eventos de OpenCode para tests. Cada fábrica devuelve un `TraceEvent`
 * (`{ event, directory }`), la misma forma que entrega `/global/event` al renderer.
 * Los ids de evento (`evt_0001`, …) son incrementales; `resetEventIds()` los reinicia.
 */
import type { AssistantMessage, Message, Part, Session, SessionStatus, UserMessage } from '@opencode-ai/sdk/v2/client'
import type { OcEvent } from '../../renderer/src/lib/opencode'

export interface TraceEvent {
  event: OcEvent
  directory: string
}

let counter = 0
export function resetEventIds(): void {
  counter = 0
}
export function nextEventId(): string {
  counter++
  return `evt_${String(counter).padStart(4, '0')}`
}

type Props<T extends OcEvent['type']> = Extract<OcEvent, { type: T }> extends { properties: infer P } ? P : never

/** Construye un evento con id incremental (o el dado). */
function make<T extends OcEvent['type']>(type: T, properties: Props<T>, directory: string, id?: string): TraceEvent {
  return { event: { id: id ?? nextEventId(), type, properties } as unknown as OcEvent, directory }
}

export function makeSession(id: string, directory: string, over: Partial<Session> = {}): Session {
  return {
    id,
    slug: id,
    projectID: 'proj_1',
    directory,
    title: `Sesión ${id}`,
    version: '1.0.0',
    time: { created: 1000, updated: 1000 },
    ...over
  }
}

export function userMessage(id: string, sessionID: string, over: Partial<UserMessage> = {}): UserMessage {
  return {
    id,
    sessionID,
    role: 'user',
    time: { created: 1000 },
    agent: 'build',
    model: { providerID: 'anthropic', modelID: 'claude' },
    ...over
  } as UserMessage
}

export function assistantMessage(id: string, sessionID: string, over: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id,
    sessionID,
    role: 'assistant',
    time: { created: 1000 },
    parentID: 'msg_user',
    modelID: 'claude',
    providerID: 'anthropic',
    mode: 'build',
    agent: 'build',
    path: { cwd: '/proj', root: '/proj' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...over
  }
}

export function textPart(id: string, messageID: string, sessionID: string, text = '', over: Record<string, unknown> = {}): Part {
  return { id, sessionID, messageID, type: 'text', text, ...over } as Part
}

export function reasoningPart(id: string, messageID: string, sessionID: string, text = '', end?: number): Part {
  return { id, sessionID, messageID, type: 'reasoning', text, time: { start: 1000, ...(end ? { end } : {}) } } as Part
}

export function toolPart(
  id: string,
  messageID: string,
  sessionID: string,
  tool: string,
  state: Record<string, unknown>,
  callID = `call_${id}`
): Part {
  return { id, sessionID, messageID, type: 'tool', callID, tool, state } as Part
}

// --- Fábricas de eventos -------------------------------------------------------------------

export const sessionCreated = (session: Session, directory = session.directory, id?: string): TraceEvent =>
  make('session.created', { sessionID: session.id, info: session }, directory, id)

export const sessionUpdated = (session: Session, directory = session.directory, id?: string): TraceEvent =>
  make('session.updated', { sessionID: session.id, info: session }, directory, id)

export const sessionDeleted = (session: Session, directory = session.directory, id?: string): TraceEvent =>
  make('session.deleted', { sessionID: session.id, info: session }, directory, id)

export const msgUpdated = (info: Message, directory: string, id?: string): TraceEvent =>
  make('message.updated', { sessionID: info.sessionID, info }, directory, id)

export const partUpdated = (part: Part, directory: string, id?: string): TraceEvent =>
  make('message.part.updated', { sessionID: part.sessionID, part, time: 1000 }, directory, id)

export const partDelta = (
  p: { sessionID: string; messageID: string; partID: string; field?: string; delta: string },
  directory: string,
  id?: string
): TraceEvent =>
  make(
    'message.part.delta',
    { sessionID: p.sessionID, messageID: p.messageID, partID: p.partID, field: p.field ?? 'text', delta: p.delta },
    directory,
    id
  )

export const status = (sessionID: string, s: SessionStatus, directory: string, id?: string): TraceEvent =>
  make('session.status', { sessionID, status: s }, directory, id)
export const statusBusy = (sessionID: string, directory: string, id?: string): TraceEvent =>
  status(sessionID, { type: 'busy' }, directory, id)
export const statusIdle = (sessionID: string, directory: string, id?: string): TraceEvent =>
  status(sessionID, { type: 'idle' }, directory, id)

export const permAsked = (
  p: { id: string; sessionID: string; permission?: string; patterns?: string[]; tool?: { messageID: string; callID: string } },
  directory: string,
  eventId?: string
): TraceEvent =>
  make(
    'permission.asked',
    {
      id: p.id,
      sessionID: p.sessionID,
      permission: p.permission ?? 'bash',
      patterns: p.patterns ?? ['ls *'],
      metadata: {},
      always: [],
      tool: p.tool
    },
    directory,
    eventId
  )

export const fileWatcherUpdated = (file: string, directory: string, id?: string): TraceEvent =>
  make('file.watcher.updated', { file, event: 'change' }, directory, id)
