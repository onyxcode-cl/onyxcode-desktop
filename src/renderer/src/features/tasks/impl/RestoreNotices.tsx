/**
 * Avisos de puntos de restauración en la conversación: «Esta vez no se guardó un punto de
 * restauración…» y el resultado de deshacer («Cambios deshechos…», con «Rehacer»).
 */
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Undo2, X } from 'lucide-react'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { redoRestore } from './actions'
import { failedText, restoreResultText } from './restore-logic'
import { useTasks } from './store'

export function RestoreNotices({ taskId }: { taskId: string }): React.JSX.Element | null {
  const warning = useTasks((s) => s.restoreWarning[taskId])
  const result = useTasks((s) => (s.restoreResult?.taskId === taskId ? s.restoreResult : null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!warning && !result) return null

  const redo = (): void => {
    setBusy(true)
    setError(null)
    redoRestore()
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2">
      {warning && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 break-words">{warning}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            className="shrink-0 rounded p-0.5 text-subtle hover:text-fg"
            onClick={() =>
              useTasks.setState((s) => {
                const restoreWarning = { ...s.restoreWarning }
                delete restoreWarning[taskId]
                return { restoreWarning }
              })
            }
          >
            <X size={13} />
          </button>
        </div>
      )}
      {result && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{restoreResultText(result)}</p>
            {result.failed.length > 0 && <p className="mt-0.5 break-words text-danger">{failedText(result.failed)}</p>}
            {error && <p className="mt-0.5 text-danger">{error}</p>}
          </div>
          {result.kind === 'undone' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={redo}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Rehacer
            </Button>
          )}
          <button
            type="button"
            aria-label="Cerrar aviso"
            className="shrink-0 rounded p-0.5 text-subtle hover:text-fg"
            onClick={() => useTasks.setState({ restoreResult: null })}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
