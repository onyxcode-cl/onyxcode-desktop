import { create } from 'zustand'
import type { QuestionInfo } from '@opencode-ai/sdk/v2/client'
import type { OcEvent } from '../../lib/opencode'

/** Pregunta estructurada pendiente (herramienta `question`) de una conversación de Chat. */
export interface ChatPendingQuestion {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

interface ChatState {
  activeSessionId: string | null
  listLoading: boolean
  listError: string | null
  /** Preguntas pendientes del agente, por id de solicitud. */
  questions: Record<string, ChatPendingQuestion>
  setActive: (id: string | null) => void
  setListState: (s: { listLoading?: boolean; listError?: string | null }) => void
  setQuestions: (q: Record<string, ChatPendingQuestion>) => void
  addQuestion: (q: ChatPendingQuestion) => void
  removeQuestion: (id: string) => void
}

export const useChat = create<ChatState>((set) => ({
  activeSessionId: null,
  listLoading: false,
  listError: null,
  questions: {},
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
