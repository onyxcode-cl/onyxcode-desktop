/**
 * HUD flotante "Progreso": arriba a la derecha de la columna de CHAT (nunca del panel de documento
 * — ese es una vista nativa que pinta encima del DOM; ver `useChatDocViewport.ts`). Muestra la señal
 * de `useChatProgress` (razonando o generando un documento) con un cronómetro en vivo, mismo patrón
 * que `Elapsed` en `features/tasks/impl/TasksWorkspace.tsx`.
 */
import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { formatDuration } from '../../lib/turn-timing'
import { useChatProgress } from './useChatProgress'
import type { MessageEntry } from '../../stores/sessions'

export function ChatProgressHud({ entries, busy }: { entries: MessageEntry[]; busy: boolean }): React.JSX.Element | null {
  const t = useT()
  const progress = useChatProgress(entries, busy)
  const [dismissed, setDismissed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!progress.visible) setDismissed(false)
  }, [progress.visible])

  useEffect(() => {
    if (!progress.visible) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [progress.visible])

  if (isRemoteSurface() || !progress.visible || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-drag absolute top-3 right-3 z-10 hidden desk:right-[calc(var(--controls-inset,0px)+12px)] max-w-[260px] items-center gap-2 rounded-lg border border-border bg-elevated/95 px-2.5 py-1.5 text-[12.5px] shadow-md backdrop-blur desk:flex"
    >
      <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
      <span className="min-w-0 flex-1 truncate font-medium">{progress.label}</span>
      {progress.startedAt !== null && (
        <span className="shrink-0 font-mono text-subtle tabular-nums">{formatDuration(now - progress.startedAt)}</span>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('common.close')}
        className="shrink-0 rounded p-0.5 text-subtle hover:bg-hover hover:text-fg"
      >
        <X size={12} />
      </button>
    </div>
  )
}
