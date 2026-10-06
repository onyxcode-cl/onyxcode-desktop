import { Download, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { useT } from '../lib/i18n'
import { updateView } from '../lib/update-notice'
import { platformCaps } from '../lib/platform'
import { runUpdateAction, useUpdateState } from '../lib/use-update-state'

/**
 * Aviso NO bloqueante de versión nueva. «Actualizar» (si esta copia puede instalar sola) descarga, verifica y
 * deja la versión lista para «Reiniciar ahora»; si no, «Descargar» abre la página de la release como siempre.
 */
export function UpdateNotice(): React.JSX.Element | null {
  const t = useT()
  const [state, setState] = useUpdateState()
  const view = updateView(state)
  if (!platformCaps().updater || !view || !state) return null
  const act = (id: Parameters<typeof runUpdateAction>[0]): void => runUpdateAction(id, state, setState)
  const busy = view.phase === 'installing' || view.phase === 'restarting'
  const Icon = view.progress ? Loader2 : view.phase === 'ready' ? RefreshCw : view.phase === 'error' ? TriangleAlert : Download

  return (
    <div
      role="status"
      data-testid="update-notice"
      data-phase={view.phase}
      className="drag flex min-h-9 animate-fade-in items-center gap-2.5 border-b border-accent/25 bg-accent-soft py-2 pr-4 pl-[calc(var(--header-inset,0px)+16px)] desk:pr-[calc(var(--controls-inset,0px)+16px)] text-meta text-fg"
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
          <Button key={a.id} size="sm" variant="primary" onClick={() => act(a.id)} className="shrink-0">
            {a.label}
          </Button>
        ) : (
          <button
            key={a.id}
            type="button"
            onClick={() => act(a.id)}
            className={`no-drag h-7 shrink-0 rounded-ctl-sm px-2 transition-colors hover:bg-accent/15 ${
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
          aria-label={t('notices.close')}
          onClick={() => act('later')}
          className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl-sm transition-colors hover:bg-accent/15"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
