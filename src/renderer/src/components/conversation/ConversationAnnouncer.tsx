import { useEffect, useRef, useState } from 'react'
import type { Message } from '@opencode-ai/sdk/v2/client'
import { friendlyError } from '@shared/ai-errors'
import { useT } from '../../lib/i18n'
import { lastAssistantFailed } from '../../lib/conversation/errors'

/**
 * Región `role="log"` solo para lectores de pantalla, ACOTADA: anuncia «Respuesta terminada» cuando una respuesta
 * deja de estar ocupada y los errores; nunca cada fragmento (delta) del streaming. La transcripción en sí NO es
 * una región viva, así que VoiceOver no lee el texto mientras llega.
 */
export function ConversationAnnouncer({
  busy,
  error,
  entries
}: {
  busy: boolean
  error?: unknown
  entries: readonly { info: Message }[]
}): React.JSX.Element {
  const t = useT()
  const [message, setMessage] = useState('')
  const sessionID = entries[0]?.info.sessionID ?? ''
  const prev = useRef({ busy, sessionID, errorKey: '' })

  const last = entries[entries.length - 1]
  const failed = lastAssistantFailed(entries)
  const errSource: unknown = error ?? (failed && last && last.info.role === 'assistant' ? last.info.error : null)
  const errorKey = errSource ? `${last?.info.id ?? ''}|${typeof errSource === 'string' ? errSource : JSON.stringify(errSource)}` : ''

  useEffect(() => {
    const p = prev.current
    if (p.sessionID !== sessionID) {
      // Otra conversación: no se anuncia nada por el cambio.
      prev.current = { busy, sessionID, errorKey }
      setMessage('')
      return
    }
    if (errorKey && errorKey !== p.errorKey) {
      setMessage(t('a11y.responseError', { message: friendlyError(errSource).message }))
    } else if (p.busy && !busy && !errorKey) {
      setMessage(t('a11y.responseDone'))
    }
    prev.current = { busy, sessionID, errorKey }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona a cambios de ocupado/error/sesión
  }, [busy, errorKey, sessionID])

  return (
    <div role="log" aria-live="polite" aria-relevant="additions text" aria-label={t('a11y.conversationLog')} className="sr-only">
      {message}
    </div>
  )
}
