import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { useServer } from '../stores/server'

/** Aviso superior cuando el sidecar no está listo. */
export function ServerBanner(): React.JSX.Element | null {
  const { status, error, restart } = useServer()
  if (status.state === 'ready' && !error) return null
  const failed = status.state === 'error' || !!error
  return (
    <div
      className={`flex items-center gap-2 border-b px-4 py-2 text-xs ${failed ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-sidebar text-muted'}`}
    >
      {failed ? <AlertTriangle size={14} /> : <Loader2 size={14} className="animate-spin" />}
      <span className="flex-1 truncate" title={status.error ?? error ?? ''}>
        {failed
          ? `No se pudo conectar con OpenCode: ${(status.error ?? error ?? '').split('\n')[0]}`
          : (status.error ?? 'Iniciando OpenCode…')}
      </span>
      {failed && (
        <button
          type="button"
          onClick={() => void restart()}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 hover:bg-hover"
        >
          <RotateCw size={12} /> Reintentar
        </button>
      )}
    </div>
  )
}
