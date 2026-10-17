import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useServer } from '../stores/server'

/** Aviso superior cuando el sidecar no está listo. */
export function ServerBanner(): React.JSX.Element | null {
  const t = useT()
  const { status, error, restart } = useServer()
  if (status.state === 'ready' && !error) return null
  const failed = status.state === 'error' || !!error
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`relative flex animate-fade-in items-center gap-2.5 overflow-hidden border-b px-4 py-2 text-xs desk:min-h-9 desk:pl-[calc(var(--header-inset,0px)+16px)] desk:pr-[calc(var(--controls-inset,0px)+16px)] desk:text-meta desk:[-webkit-app-region:drag] ${failed ? 'border-danger/25 bg-danger/8 text-danger desk:border-danger/30 desk:text-fg' : 'border-border bg-accent-soft/50 text-muted desk:bg-accent-soft desk:text-fg'}`}
    >
      {!failed && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] bg-[length:50%_100%] bg-no-repeat"
          style={{ animation: 'shimmer 1.6s linear infinite' }}
        />
      )}
      {failed ? (
        <AlertTriangle size={14} className="shrink-0 desk:text-danger" />
      ) : (
        <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
      )}
      <span className="flex-1 truncate desk:line-clamp-2 desk:whitespace-normal" title={status.error ?? error ?? ''}>
        {failed
          ? t('app.banner.failed', { error: (status.error ?? error ?? '').split('\n')[0] })
          : (status.error ?? t('app.banner.starting'))}
      </span>
      {failed && (
        <button
          type="button"
          onClick={() => void restart()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-danger/30 bg-elevated px-2 py-0.5 font-medium transition-colors hover:bg-danger/10 desk:h-7 desk:rounded-ctl-sm desk:[-webkit-app-region:no-drag]"
        >
          <RotateCw size={12} /> {t('app.banner.retry')}
        </button>
      )}
    </div>
  )
}
