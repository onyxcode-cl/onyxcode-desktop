/**
 * Tarjeta del entorno aislado de Tareas en Windows (distro por instalar, instalando, error, guías y estados bloqueados).
 * No pinta nada cuando está listo, en macOS ni sin Tareas; y solo ofrece los botones que hacen algo (`sandboxView`).
 */
import { useEffect } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { initSandbox, useSandbox } from './sandbox-store'
import { sandboxView } from './sandbox-view'

const BTN =
  'flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition hover:border-border-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 desk:rounded-ctl desk:border-transparent desk:bg-hover desk:hover:border-transparent desk:hover:bg-active'

export function SandboxSetupCard(): React.JSX.Element | null {
  const t = useT()
  const status = useSandbox((s) => s.status)
  const setup = useSandbox((s) => s.setup)
  const cancel = useSandbox((s) => s.cancel)
  const refresh = useSandbox((s) => s.refresh)

  useEffect(() => initSandbox(), [])

  const view = sandboxView(status, platformCaps().tasksSandbox)
  if (view.kind === 'hidden') return null
  if (view.kind === 'checking') {
    return (
      <p
        data-testid="sandbox-card"
        data-kind="checking"
        role="status"
        className="mx-6 mb-4 flex items-center justify-center gap-1.5 text-xs text-muted"
      >
        <Loader2 size={12} className="animate-spin" /> {view.body && t(view.body)}
      </p>
    )
  }
  const warn = view.kind === 'broken' || view.kind === 'setupError' || view.kind === 'policy' || view.kind === 'unavailable'
  const Icon = view.kind === 'installing' ? Loader2 : warn ? ShieldAlert : Download

  return (
    <section
      data-testid="sandbox-card"
      data-kind={view.kind}
      aria-live="polite"
      className={`mx-6 mb-5 rounded-2xl border bg-elevated p-4 shadow-sm sm:p-5 desk:rounded-card desk:border-transparent desk:shadow-raised ${
        warn ? 'border-warning/50' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${warn ? 'bg-warning/15 text-warning' : 'bg-accent-soft text-accent'}`}
        >
          <Icon size={15} className={view.kind === 'installing' ? 'animate-spin' : undefined} />
        </span>
        <div className="min-w-0 flex-1">
          {view.title && <h2 className="font-display text-base font-medium">{t(view.title)}</h2>}
          {view.error && (
            <p className="mt-0.5 flex items-start gap-1.5 text-[13px] text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {t(view.error)}
            </p>
          )}
          {view.body && <p className="mt-0.5 text-[13px] leading-snug text-muted">{t(view.body)}</p>}
          {view.detail && <p className="mt-1 font-mono text-[11px] text-subtle">{t('tasks.sandbox.detail', { detail: view.detail })}</p>}
          {view.kind === 'installing' && (
            <div className="mt-3">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={view.pct}
                aria-label={view.title ? t(view.title) : undefined}
                className="h-1.5 w-full overflow-hidden rounded-full bg-hover"
              >
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${view.pct ?? 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {view.phase && t(view.phase)} {view.pct}%
              </p>
            </div>
          )}
          {view.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {view.actions.includes('setup') && (
                <button type="button" className={BTN} onClick={() => void setup()}>
                  <Download size={13} /> {view.setupLabel && t(view.setupLabel)}
                </button>
              )}
              {view.actions.includes('cancel') && (
                <button type="button" className={BTN} onClick={() => void cancel()}>
                  <X size={13} /> {t('tasks.sandbox.installing.cancel')}
                </button>
              )}
              {view.actions.includes('recheck') && (
                <button type="button" className={BTN} onClick={() => void refresh()}>
                  <RefreshCw size={13} /> {t('tasks.sandbox.recheck')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
