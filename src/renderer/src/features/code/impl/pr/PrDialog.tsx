/** Ventana «Rama y pull request»: carga el estado del repositorio y muestra las dos pestañas (publicar / revisar). */
import { useCallback, useEffect, useId, useState } from 'react'
import { GitPullRequest, Loader2, X } from 'lucide-react'
import type { PrRepoStatus } from '@shared/ipc-pr'
import { useT } from '../../../../lib/i18n'
import { errorMessage, nativeCode } from '../client'
import { PublishTab } from './PublishTab'
import { ReviewTab } from './ReviewTab'

type Tab = 'publish' | 'review'

export function PrDialog({ directory, onClose }: { directory: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const native = nativeCode()
  const titleId = useId()
  const [tab, setTab] = useState<Tab>('publish')
  const [status, setStatus] = useState<PrRepoStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!native) return
    try {
      setStatus(await native.pr.status(directory))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [native, directory])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[data-pr-confirm]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabBtn = (id: Tab, label: string): React.JSX.Element => (
    <button
      type="button"
      role="tab"
      id={`pr-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`pr-panel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          setTab(id === 'publish' ? 'review' : 'publish')
          requestAnimationFrame(() => document.getElementById(`pr-tab-${id === 'publish' ? 'review' : 'publish'}`)?.focus())
        }
      }}
      className={`border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <GitPullRequest size={16} className="text-accent" aria-hidden="true" />
          <h2 id={titleId} className="text-sm font-semibold">
            {t('pr.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pr.close')}
            className="ml-auto rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
        <div role="tablist" aria-label={t('pr.tabs.aria')} className="flex border-b border-border px-2">
          {tabBtn('publish', t('pr.tab.publish'))}
          {tabBtn('review', t('pr.tab.review'))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="tabpanel" id={`pr-panel-${tab}`} aria-labelledby={`pr-tab-${tab}`}>
          {!native ? (
            <div className="text-sm text-muted">{t('pr.noNative')}</div>
          ) : error ? (
            <div className="space-y-2">
              <div role="alert" className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
                {error}
              </div>
              <button
                type="button"
                onClick={() => void reload()}
                className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-hover"
              >
                {t('pr.retry')}
              </button>
            </div>
          ) : !status ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t('pr.loading')}
            </div>
          ) : !status.isRepo ? (
            <div className="text-sm text-muted">{t('pr.notRepo')}</div>
          ) : (
            <div className="space-y-3">
              {tab === 'publish' && <p className="text-xs leading-relaxed text-muted">{t('pr.intro')}</p>}
              {tab === 'publish' ? (
                <PublishTab directory={directory} status={status} reload={reload} />
              ) : status.remotes.length === 0 ? (
                <div className="text-sm text-muted">{t('pr.noRemote')}</div>
              ) : (
                <ReviewTab directory={directory} status={status} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
