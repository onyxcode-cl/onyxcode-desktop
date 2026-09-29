import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { useServer } from '../stores/server'

/** Aviso superior cuando el sidecar no está listo. */
export function ServerBanner(): React.JSX.Element | null {
  const { status, error, restart } = useServer()
  if (status.state === 'ready' && !error) return null
  const failed = status.state === 'error' || !!error
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`relative flex animate-fade-in items-center gap-2.5 overflow-hidden border-b px-4 py-2 text-xs ${failed ? 'border-danger/25 bg-danger/8 text-danger' : 'border-border bg-accent-soft/50 text-muted'}`}
    >
      {!failed && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] bg-[length:50%_100%] bg-no-repeat"
          style={{ animation: 'shimmer 1.6s linear infinite' }}
        />
      )}
      {failed ? <AlertTriangle size={14} className="shrink-0" /> : <Loader2 size={14} className="shrink-0 animate-spin text-accent" />}
      <span className="flex-1 truncate" title={status.error ?? error ?? ''}>
        {failed
          ? `No se pudo conectar con OpenCode: ${(status.error ?? error ?? '').split('\n')[0]}`
          : (status.error ?? 'Iniciando OpenCode…')}
      </span>
      {failed && (
        <button
          type="button"
          onClick={() => void restart()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-danger/30 bg-elevated px-2 py-0.5 font-medium transition-colors hover:bg-danger/10"
        >
          <RotateCw size={12} /> Reintentar
        </button>
      )}
    </div>
  )
}
