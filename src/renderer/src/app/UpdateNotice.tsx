import { Download, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { updateView } from '../lib/update-notice'
import { runUpdateAction, useUpdateState } from '../lib/use-update-state'

/**
 * Aviso NO bloqueante de versión nueva. «Actualizar» (si esta copia puede instalar sola) descarga, verifica y
 * deja la versión lista para «Reiniciar ahora»; si no, «Descargar» abre la página de la release como siempre.
 */
export function UpdateNotice(): React.JSX.Element | null {
  const [state, setState] = useUpdateState()
  const view = updateView(state)
  if (!view || !state) return null
  const act = (id: Parameters<typeof runUpdateAction>[0]): void => runUpdateAction(id, state, setState)
  const busy = view.phase === 'installing' || view.phase === 'restarting'
  const Icon = view.progress ? Loader2 : view.phase === 'ready' ? RefreshCw : Download

  return (
    <div
      role="status"
      data-testid="update-notice"
      data-phase={view.phase}
      className="flex animate-fade-in items-center gap-2.5 border-b border-accent/25 bg-accent-soft px-4 py-2 text-xs text-fg"
    >
      <Icon size={14} className={`shrink-0 text-accent ${view.progress ? 'animate-spin' : ''}`} />
      <span className="min-w-0 flex-1 truncate" data-testid="update-notice-text">
        {view.text}
      </span>
      {view.progress && !busy && <ProgressBar percent={view.percent} label={view.text} />}
      {view.percent !== null && (
        <span data-testid="update-percent" className="w-9 shrink-0 text-right font-mono tabular-nums text-muted">
          {view.percent} %
        </span>
      )}
      {view.actions.map((a) =>
        a.primary ? (
          <Button key={a.id} size="sm" variant="primary" onClick={() => act(a.id)} className="shrink-0 !py-0.5 !text-xs">
            {a.label}
          </Button>
        ) : (
          <button
            key={a.id}
            type="button"
            onClick={() => act(a.id)}
            className={`no-drag shrink-0 rounded-md px-2 py-0.5 transition-colors hover:bg-accent/15 ${
              a.id === 'download-manual' ? 'font-medium text-accent underline-offset-2 hover:underline' : ''
            }`}
          >
            {a.label}
          </button>
        )
      )}
      {!busy && view.phase !== 'downloading' && view.phase !== 'verifying' && (
        <button
          type="button"
          aria-label="Cerrar aviso"
          onClick={() => act('later')}
          className="flex shrink-0 items-center rounded-md p-0.5 transition-colors hover:bg-accent/15"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
