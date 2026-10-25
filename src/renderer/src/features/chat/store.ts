import { create } from 'zustand'
import type { QuestionInfo } from '@opencode-ai/sdk/v2/client'
import {
  parseElicitationRejected,
  parseElicitationReplied,
  parseElicitationRequest,
  rejectionNeedsNotice,
  type ElicitationNotice,
  type ElicitationRequest
} from '@shared/mcp-elicitation'
import type { OcEvent } from '../../lib/opencode'

/** Pregunta estructurada pendiente (herramienta `question`) de una conversación de Chat. */
export interface ChatPendingQuestion {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

/** Fijadas de Chat: mismo formato que `code.pinned` de Code (`{ [carpeta]: ids[] }`), solo en este equipo (localStorage). */
export const LS_CHAT_PINNED = 'chat.pinned'

function readPinned(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LS_CHAT_PINNED)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

interface ChatState {
  activeSessionId: string | null
  /** Conversaciones fijadas por carpeta de Chat. */
  pinned: Record<string, string[]>
  /** Vista «Archivadas» de la barra lateral. */
  showArchived: boolean
  togglePin: (directory: string, sessionID: string) => void
  setShowArchived: (v: boolean) => void
  listLoading: boolean
  listError: string | null
  /** Preguntas pendientes del agente, por id de solicitud. */
  questions: Record<string, ChatPendingQuestion>
  /** Formularios de conectores pendientes (`mcp.elicitation.asked`), por id. */
  elicitations: Record<string, ElicitationRequest>
  /** Avisos breves de rechazos de formularios que la persona no llegó a ver. */
  elicitationNotices: Record<string, ElicitationNotice>
  setElicitations: (e: Record<string, ElicitationRequest>) => void
  addElicitation: (e: ElicitationRequest) => void
  removeElicitation: (id: string) => void
  addElicitationNotice: (n: ElicitationNotice) => void
  dismissElicitationNotice: (id: string) => void
  setActive: (id: string | null) => void
  setListState: (s: { listLoading?: boolean; listError?: string | null }) => void
  setQuestions: (q: Record<string, ChatPendingQuestion>) => void
  addQuestion: (q: ChatPendingQuestion) => void
  removeQuestion: (id: string) => void
}

export const useChat = create<ChatState>((set) => ({
  activeSessionId: null,
  pinned: readPinned(),
  showArchived: false,
  togglePin: (directory, sessionID) =>
    set((s) => {
      const list = s.pinned[directory] ?? []
      const next = list.includes(sessionID) ? list.filter((x) => x !== sessionID) : [...list, sessionID]
      const pinned = { ...s.pinned, [directory]: next }
      try {
        localStorage.setItem(LS_CHAT_PINNED, JSON.stringify(pinned))
      } catch {
        // sin storage
      }
      return { pinned }
    }),
  setShowArchived: (showArchived) => set({ showArchived }),
  listLoading: false,
  listError: null,
  questions: {},
  elicitations: {},
  elicitationNotices: {},
  setElicitations: (elicitations) => set({ elicitations }),
  addElicitation: (e) => set((s) => ({ elicitations: { ...s.elicitations, [e.id]: e } })),
  removeElicitation: (id) =>
    set((s) => {
      if (!(id in s.elicitations)) return s
      const elicitations = { ...s.elicitations }
      delete elicitations[id]
      return { elicitations }
    }),
  addElicitationNotice: (n) => set((s) => ({ elicitationNotices: { ...s.elicitationNotices, [n.id]: n } })),
  dismissElicitationNotice: (id) =>
    set((s) => {
      if (!(id in s.elicitationNotices)) return s
      const elicitationNotices = { ...s.elicitationNotices }
      delete elicitationNotices[id]
      return { elicitationNotices }
    }),
  setActive: (activeSessionId) => set({ activeSessionId }),
  setListState: (s) => set(s),
  setQuestions: (questions) => set({ questions }),
  addQuestion: (q) => set((s) => ({ questions: { ...s.questions, [q.id]: q } })),
  removeQuestion: (id) =>
    set((s) => {
      if (!(id in s.questions)) return s
      const questions = { ...s.questions }
      delete questions[id]
      return { questions }
    })
}))

/**
 * Evento de pregunta (`question.asked|replied|rejected`) → estado de Chat. `accepts` decide si la sesión es de Chat
 * (solo para `asked`: lo respondido o rechazado se quita por id sin más, venga de donde venga).
 */
export function applyChatQuestionEvent(ev: OcEvent, accepts: (sessionID: string) => boolean): void {
  const st = useChat.getState()
  if (ev.type === 'question.asked') {
    const q = ev.properties
    if (accepts(q.sessionID)) st.addQuestion({ id: q.id, sessionID: q.sessionID, questions: q.questions })
  } else if (ev.type === 'question.replied' || ev.type === 'question.rejected') {
    st.removeQuestion(ev.properties.requestID)
  }
}

/**
 * Evento de formulario de conector (`mcp.elicitation.asked|replied|rejected`) → estado de Chat. `accepts` decide si la sesión es de
 * Chat (para `asked` y para el aviso de un rechazo inmediato sin tarjeta previa); lo contestado o rechazado se quita por id sin más.
 */
export function applyChatElicitationEvent(ev: OcEvent, accepts: (sessionID: string) => boolean): void {
  const type = ev.type as string
  const props = (ev as { properties?: unknown }).properties
  const st = useChat.getState()
  if (type === 'mcp.elicitation.asked') {
    const req = parseElicitationRequest(props)
    if (req && accepts(req.sessionID)) st.addElicitation(req)
  } else if (type === 'mcp.elicitation.replied') {
    const r = parseElicitationReplied(props)
    if (r) st.removeElicitation(r.id)
  } else if (type === 'mcp.elicitation.rejected') {
    const r = parseElicitationRejected(props)
    if (!r) return
    const hadCard = r.id in st.elicitations
    st.removeElicitation(r.id)
    if ((hadCard || accepts(r.sessionID)) && rejectionNeedsNotice(r.reason, hadCard)) {
      st.addElicitationNotice({ id: r.id, sessionID: r.sessionID, reason: r.reason })
    }
  }
}
