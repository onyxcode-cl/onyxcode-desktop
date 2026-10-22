/**
 * Eventos normalizados del motor.
 *
 * El adaptador traduce el stream global del motor (SSE) a esta unión discriminada: nombres propios
 * (`part.*` en lugar de `message.part.*`) y la carpeta (`directory`) en cada evento. Lo que no se
 * conoce llega como `unknown` con el evento original, para no perder eventos nuevos del motor.
 * El orden, los duplicados y la reconexión NO se tocan aquí: el adaptador solo traduce.
 */
import type { EngineError } from './errors'
import type {
  Message,
  Part,
  PermissionReply,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionDiffEntry,
  SessionErrorInfo,
  SessionStatus,
  Todo
} from './types'

/** Campos comunes: carpeta de la instancia que emitió el evento. */
interface EventBase {
  directory: string
}

export type EngineEvent =
  /** El stream quedó conectado (el motor manda `server.connected` al abrir). */
  | (EventBase & { type: 'connected' })
  | (EventBase & { type: 'session.created'; session: Session })
  | (EventBase & { type: 'session.updated'; session: Session })
  | (EventBase & { type: 'session.deleted'; session: Session })
  | (EventBase & { type: 'session.status'; sessionID: string; status: SessionStatus })
  | (EventBase & { type: 'session.idle'; sessionID: string })
  | (EventBase & { type: 'session.error'; sessionID?: string; error?: SessionErrorInfo })
  | (EventBase & { type: 'session.diff'; sessionID: string; diff: SessionDiffEntry[] })
  | (EventBase & { type: 'message.updated'; sessionID: string; info: Message })
  | (EventBase & { type: 'message.removed'; sessionID: string; messageID: string })
  | (EventBase & { type: 'part.updated'; sessionID: string; part: Part; time: number })
  | (EventBase & { type: 'part.delta'; sessionID: string; messageID: string; partID: string; field: string; delta: string })
  | (EventBase & { type: 'part.removed'; sessionID: string; messageID: string; partID: string })
  | (EventBase & { type: 'permission.asked'; request: PermissionRequest })
  | (EventBase & { type: 'permission.replied'; sessionID: string; requestID: string; reply: PermissionReply })
  | (EventBase & { type: 'question.asked'; request: QuestionRequest })
  | (EventBase & { type: 'question.replied'; sessionID: string; requestID: string; answers: QuestionAnswer[] })
  | (EventBase & { type: 'question.rejected'; sessionID: string; requestID: string })
  | (EventBase & { type: 'todo.updated'; sessionID: string; todos: Todo[] })
  | (EventBase & { type: 'file.edited'; file: string })
  | (EventBase & { type: 'vcs.branch'; branch?: string })
  /** Cualquier evento que esta capa aún no modela: `rawType` es el nombre original del motor. */
  | (EventBase & { type: 'unknown'; rawType: string; raw: unknown })

/** Tipo de un evento normalizado. */
export type EngineEventType = EngineEvent['type']
/** El evento de un `type` concreto (útil para handlers tipados). */
export type EngineEventOf<T extends EngineEventType> = Extract<EngineEvent, { type: T }>
export type EngineEventHandler = (event: EngineEvent) => void

export interface EngineEventOptions {
  /** El stream se abrió (también tras cada reconexión). */
  onOpen?(): void
  /** Fallo del stream o del handler. El stream se reconecta solo; esto es informativo. */
  onError?(error: EngineError): void
  /** Cierra la suscripción al abortar (equivale a llamar la función devuelta). */
  signal?: AbortSignal
}
