/**
 * Preguntas estructuradas de Tareas (herramienta `question`): una tarjeta por solicitud. La tarjeta es la misma de
 * Chat y Code (`components/QuestionCard`); aquí solo se conectan las acciones de Tareas.
 */
import type { QuestionRequest } from '@opencode-ai/sdk/v2/client'
import { QuestionCard as SharedQuestionCard } from '../../../components/QuestionCard'
import { rejectQuestion, replyQuestion } from './actions'

/** Tarjeta de una solicitud de pregunta (puede traer varias preguntas encadenadas). */
export function QuestionCard({ request }: { request: QuestionRequest }): React.JSX.Element {
  return (
    <div id={`question-${request.id}`}>
      <SharedQuestionCard
        questions={request.questions}
        onReply={(answers) => replyQuestion(request.id, answers)}
        onReject={() => rejectQuestion(request.id)}
      />
    </div>
  )
}
