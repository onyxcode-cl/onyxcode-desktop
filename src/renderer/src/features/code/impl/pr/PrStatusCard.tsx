/** Estado de un pull request y de sus comprobaciones (CI): cargando, error, vacío y con datos. */
import type { MsgKey } from '@shared/i18n'
import type { PrCheckState, PrViewResult } from '@shared/ipc-pr'
import { AlertCircle, CheckCircle2, CircleDashed, ExternalLink, Loader2, MinusCircle, RefreshCw } from 'lucide-react'
import { useT } from '../../../../lib/i18n'
import { checksSummary } from './pr-logic'

interface Props {
  loading: boolean
  error: string | null
  data: PrViewResult | null
  onRefresh: () => void
  onOpen: (url: string) => void
}

const CHECK_META: Record<PrCheckState, { icon: typeof CheckCircle2; cls: string; label: MsgKey }> = {
  success: { icon: CheckCircle2, cls: 'text-success', label: 'pr.check.success' },
  failure: { icon: AlertCircle, cls: 'text-danger', label: 'pr.check.failure' },
  pending: { icon: CircleDashed, cls: 'text-warning', label: 'pr.check.pending' },
  neutral: { icon: MinusCircle, cls: 'text-muted', label: 'pr.check.neutral' },
  skipped: { icon: MinusCircle, cls: 'text-subtle', label: 'pr.check.skipped' }
}

export function PrStatusCard({ loading, error, data, onRefresh, onOpen }: Props): React.JSX.Element {
  const t = useT()
  const pr = data?.pr ?? null
  const refresh = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-40"
    >
      {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
      {t('pr.status.refresh')}
    </button>
  )

  if (loading && !pr) {
    return (
      <div role="status" className="flex items-center gap-2 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" /> {t('pr.status.loading')}
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-2">
        <div role="alert" className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          {error}
        </div>
        {refresh}
      </div>
    )
  }
  if (!pr) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted">{t('pr.status.none')}</div>
        {refresh}
      </div>
    )
  }
  const sum = checksSummary(pr.checks)
  const stateKey: MsgKey = pr.isDraft && pr.state === 'open' ? 'pr.status.state.draft' : (`pr.status.state.${pr.state}` as MsgKey)
  const review = pr.reviewDecision ? (`pr.status.review.${pr.reviewDecision}` as MsgKey) : null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          #{pr.number} {pr.title}
        </span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{t(stateKey)}</span>
        {review && <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-muted">{t(review)}</span>}
      </div>
      <div className="text-xs text-muted">
        <span className="font-mono">{pr.head}</span> → <span className="font-mono">{pr.base}</span>
      </div>
      <div className="text-xs font-medium">{t('pr.status.checks')}</div>
      {pr.checks.length === 0 ? (
        <div className="text-xs text-muted">{t('pr.status.noChecks')}</div>
      ) : (
        <>
          <div className="text-xs text-muted">{t('pr.status.checksSummary', { ok: sum.ok, bad: sum.bad, wait: sum.wait })}</div>
          <ul className="space-y-0.5 text-xs">
            {pr.checks.map((c, i) => {
              const m = CHECK_META[c.state]
              const Icon = m.icon
              return (
                <li key={`${c.name}-${i}`} className="flex items-center gap-1.5">
                  <Icon size={13} className={`shrink-0 ${m.cls}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className={m.cls}>{t(m.label)}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className="flex items-center gap-2">
        {refresh}
        <button
          type="button"
          onClick={() => onOpen(pr.url)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs hover:bg-hover"
        >
          <ExternalLink size={12} aria-hidden="true" /> {t('pr.status.openWeb')}
        </button>
      </div>
    </div>
  )
}
