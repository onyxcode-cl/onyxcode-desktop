/**
 * «La IA propone recordar esto» en Code: envoltorio fino de la tarjeta compartida (`features/memory`). Con una carpeta
 * de proyecto también se pueden aprobar notas «de este proyecto». El agente nunca escribe memoria: termina su turno con
 * un bloque ```lazunox-memoria``` y la persona elige.
 */
import { MemoryProposalCard, draftsFrom as sharedDraftsFrom } from '../../memory/MemoryProposalCard'
import type { Draft } from '../../tasks/impl/LearnedProposalList'
import type { CodeMessage } from './types'

/** `undefined` si no hay nada que pintar. Sin `allowProject`, descarta las propuestas `proyecto`. */
export function draftsFrom(messages: CodeMessage[], allowProject = false): Draft[] | undefined {
  return sharedDraftsFrom(messages, allowProject)
}

export function CodeMemoryProposalCard({
  sessionId,
  messages,
  folder
}: {
  sessionId: string
  messages: CodeMessage[]
  folder?: string | null
}): React.JSX.Element | null {
  return <MemoryProposalCard sessionId={sessionId} messages={messages} folder={folder} />
}
