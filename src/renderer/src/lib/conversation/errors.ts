import type { Message } from '@opencode-ai/sdk/v2/client'

/**
 * ¿El último mensaje del asistente ya lleva un error (que no sea un aborto)? El motor emite además `session.error`
 * con el mismo fallo: en ese caso el aviso de sesión sería un duplicado y no se muestra.
 */
export function lastAssistantFailed(entries: readonly { info: Message }[]): boolean {
  const last = entries[entries.length - 1]
  return !!last && last.info.role === 'assistant' && !!last.info.error && last.info.error.name !== 'MessageAbortedError'
}
