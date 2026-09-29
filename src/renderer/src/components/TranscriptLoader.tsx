import { Loader2 } from 'lucide-react'
import { isTranscriptLoading, useSessions } from '../stores/sessions'

/**
 * Indicador «Cargando conversación…» al reabrir una sesión desalojada por el LRU de `messages`
 * (`!loaded && loadingMessages`). En cualquier otro caso no renderiza nada.
 */
export function TranscriptLoader({ sessionId }: { sessionId: string | null | undefined }): React.JSX.Element | null {
  const loading = useSessions((s) => isTranscriptLoading(s, sessionId))
  return loading ? <TranscriptLoading /> : null
}

/** Solo la presentación (Code la usa con su propio selector, `isCodeTranscriptLoading`). */
export function TranscriptLoading(): React.JSX.Element {
  return (
    <div role="status" className="flex shrink-0 items-center justify-center gap-2 py-2 text-[12.5px] text-muted">
      <Loader2 size={13} className="animate-spin" aria-hidden />
      Cargando conversación…
    </div>
  )
}
