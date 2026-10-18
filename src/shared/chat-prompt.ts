/**
 * `system` extra de Chat (módulo PURO): instrucciones personalizadas + memoria de usuario + invitación a proponer
 * memoria. Mismo marco de seguridad que Code (`personal-context.ts`).
 */
import { buildPersonalContext, memoryProposalInvite, type ChatProjectContext } from './personal-context'

export interface ChatPromptInput {
  /** `false` apaga la memoria: ni se inyecta ni se propone (las instrucciones personalizadas siguen). */
  learningEnabled?: boolean
  instructions?: string | null
  conversationInstructions?: string | null
  learnedUser?: string | null
  /** Proyecto de la conversación: instrucciones y pasajes de sus archivos (F8-B185). */
  project?: ChatProjectContext | null
}

/** Siempre devuelve texto (al menos el aviso de memoria encendida/apagada). */
export function buildChatSystemPrompt(i: ChatPromptInput): string {
  const on = i.learningEnabled !== false
  const ctx = buildPersonalContext({
    instructions: i.instructions,
    conversationInstructions: i.conversationInstructions,
    memoryUser: on ? i.learnedUser : null,
    chatProject: i.project
  })
  const parts: string[] = []
  if (ctx) parts.push(ctx)
  parts.push(
    on
      ? memoryProposalInvite(false)
      : 'La memoria está desactivada: no propongas memoria nueva (no termines el turno con un bloque lazunox-memoria).'
  )
  return parts.join('\n\n---\n\n')
}
