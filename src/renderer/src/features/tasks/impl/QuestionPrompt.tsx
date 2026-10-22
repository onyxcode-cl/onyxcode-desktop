/**
 * Preguntas estructuradas de Tareas (herramienta `question`): una tarjeta por solicitud. La tarjeta es la misma de
 * Chat y Code (`components/QuestionCard`); aquí solo se conectan las acciones de Tareas.
 */
import type { QuestionRequest } from '@opencode-ai/sdk/v2/client'
import { QuestionCard as SharedQuestionCard } from '../../../components/QuestionCard'
import { useT } from '../../../lib/i18n'
import { rejectQuestion, replyQuestion } from './actions'
import { useTaskSubagentOfRequest } from './subagent-of-request'

/** Tarjeta de una solicitud de pregunta (puede traer varias preguntas encadenadas). */
export function QuestionCard({ request }: { request: QuestionRequest }): React.JSX.Element {
  const t = useT()
  const sub = useTaskSubagentOfRequest(request.sessionID)
  return (
    <div id={`question-${request.id}`}>
      {sub.child && (
        <p className="mt-2 -mb-1 text-xs font-medium text-muted">
          {sub.name ? t('tasks.q.fromSubagent', { name: sub.name }) : t('tasks.q.fromSubagentAnon')}
        </p>
      )}
      <SharedQuestionCard
        questions={request.questions}
        onReply={(answers) => replyQuestion(request.id, answers)}
        onReject={() => rejectQuestion(request.id)}
      />
    </div>
  )
}
