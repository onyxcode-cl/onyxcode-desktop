/**
 * Diálogo previo a lanzar la comparación: avisa de que el uso se multiplica ×N (límites de uso del proveedor), de que los
 * cambios sin confirmar no entran en Code y de que cada copia parte sin dependencias. También explica por qué no se puede
 * lanzar (sin repositorio, adjuntos, otra comparación en curso).
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns3 } from 'lucide-react'
import type { CompareMode } from '@shared/ipc-code'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../components/Button'
import { formatCost } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { useProviders } from '../../stores/providers'
import { isLimitedProvider } from './model'
import { cancelConfirm, confirmStart, useCompare, type BlockerKind, type ConfirmRequest } from './store'

const BLOCKER_TEXT: Record<BlockerKind, MsgKey> = {
  noRepo: 'compare.confirm.noRepo',
  attachments: 'compare.launcher.attachments',
  busy: 'compare.launcher.busy',
  models: 'compare.launcher.min'
}

export function CompareConfirmDialog({ mode, directory }: { mode: CompareMode; directory: string | null }): React.JSX.Element | null {
  const c = useCompare((s) => s.confirm)
  const providers = useProviders((s) => s.providers)
  const [dontAsk, setDontAsk] = useState(false)
  const mine = !!c && c.mode === mode && (mode === 'chat' || c.directory === directory)

  useEffect(() => {
    if (!mine) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelConfirm()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [mine])

  if (!c || !mine) return null
  const nameOf = (providerID: string, modelID: string): string =>
    providers.find((p) => p.id === providerID)?.models[modelID]?.name ?? modelID
  const body = <ConfirmDialogBody c={c} nameOf={nameOf} dontAsk={dontAsk} onDontAsk={setDontAsk} />
  // Portal a <body>: dentro del compositor (que lleva `animate-rise-in`, con transform y apilamiento propios) el `fixed` queda
  // acotado a ese bloque y las tarjetas de sugerencias de Chat se pintan por encima del diálogo.
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}

/** Contenido del diálogo (sin acceso al store: se prueba con props). */
export function ConfirmDialogBody({
  c,
  nameOf,
  dontAsk,
  onDontAsk
}: {
  c: ConfirmRequest
  nameOf: (providerID: string, modelID: string) => string
  dontAsk: boolean
  onDontAsk: (v: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const limited = c.models.some((m) => isLimitedProvider(m.providerID))
  const pf = c.preflight
  const canStart = !c.blocker && !c.checking && !c.starting

  return (
    <div
      className="fixed inset-0 z-[300] flex animate-fade-in items-center justify-center bg-fg/30 p-6"
      onMouseDown={() => cancelConfirm()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-confirm-title"
        aria-describedby="compare-confirm-body"
        data-testid="compare-confirm"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] animate-rise-in rounded-modal bg-elevated p-6 shadow-modal"
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-card bg-accent-soft text-accent">
          <Columns3 size={20} />
        </div>
        <h3 id="compare-confirm-title" className="text-[17px] leading-6 font-semibold">
          {t('compare.confirm.title')}
        </h3>
        <div id="compare-confirm-body" className="mt-2 space-y-2 text-sm leading-5 text-muted">
          <p className="line-clamp-3 rounded-ctl bg-inset px-3 py-2 text-[13px] text-fg" aria-label={t('compare.confirm.prompt')}>
            {c.text}
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('compare.launcher.list')}>
            {c.models.map((m) => (
              <li
                key={`${m.providerID}/${m.modelID}/${m.variant ?? ''}`}
                className="rounded-full bg-inset px-2 py-0.5 text-[12px] text-fg desk:inline-flex desk:h-7 desk:items-center desk:rounded-ctl-sm desk:bg-active desk:px-2.5 desk:font-[family-name:var(--font-code)]"
              >
                {nameOf(m.providerID, m.modelID)}
                {m.variant ? ` · ${m.variant}` : ''}
              </li>
            ))}
          </ul>
          {c.blocker ? (
            <p role="alert" className="text-danger">
              {t(BLOCKER_TEXT[c.blocker])}
            </p>
          ) : (
            <>
              <p className="flex gap-2.5 rounded-ctl bg-accent-soft px-3 py-2.5 text-[13px] leading-[18px] text-fg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_30%,transparent)]">
                {c.spent !== null && c.spent > 0
                  ? t('compare.confirm.usage', { count: c.models.length, spent: formatCost(c.spent) })
                  : t('compare.confirm.usageNoSpent', { count: c.models.length })}
              </p>
              {limited && <p>{t('compare.confirm.limits')}</p>}
              {c.mode === 'code' && c.checking && <p role="status">{t('compare.confirm.checking')}</p>}
              {pf && !pf.clean && <p className="text-warning">{t('compare.confirm.dirty', { commit: pf.shortHead ?? '—' })}</p>}
              {c.mode === 'code' && pf && <p>{t('compare.confirm.deps')}</p>}
            </>
          )}
          {c.error && (
            <p role="alert" className="text-danger">
              {c.error}
            </p>
          )}
        </div>
        {!c.blocker && (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={dontAsk} onChange={(e) => onDontAsk(e.target.checked)} className="accent-[var(--accent)]" />
            {t('compare.confirm.dontAsk')}
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={() => cancelConfirm()}>
            {t('compare.confirm.cancel')}
          </Button>
          {!c.blocker && (
            <Button variant="primary" size="lg" autoFocus disabled={!canStart} onClick={() => void confirmStart({ dontAsk })}>
              {t('compare.confirm.start')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
