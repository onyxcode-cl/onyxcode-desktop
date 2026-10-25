/**
 * Tarjeta de compactación: en lugar de que el resumen aparezca como una respuesta más, la conversación muestra qué se resumió, cuánto
 * contexto se liberó y qué se volvió a inyectar (plan, habilidades, instrucciones de carpeta, ayudantes). Las cifras las da el motor
 * propio (`compaction.lazunox`); con un motor anterior solo dice «Se resumió la conversación». El resumen en sí se abre con «Ver resumen».
 *
 * Presentacional y compartida por Code y Chat. Los números se escriben en texto (no solo color) y con «≈» si son estimados.
 */
import { useId, useState } from 'react'
import { ChevronRight, Loader2, Sparkles } from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import { hasTokenMetrics, tokensFreed, type CompactionMeta, type KeptKind } from '@shared/compaction'
import { useT } from '../../lib/i18n'
import { formatNumber } from '../../lib/format'

const KEEP_KEY: Record<KeptKind, MsgKey> = {
  plan: 'code.compaction.keep.plan',
  habilidades: 'code.compaction.keep.habilidades',
  instrucciones: 'code.compaction.keep.instrucciones',
  ayudantes: 'code.compaction.keep.ayudantes',
  gancho: 'code.compaction.keep.gancho'
}

export interface CompactionCardProps {
  meta: CompactionMeta
  /** El resumen todavía se está generando. */
  running?: boolean
  /** El resumen (se abre con «Ver resumen»). Sin él no hay botón. */
  children?: React.ReactNode
}

export function CompactionCard({ meta, running, children }: CompactionCardProps): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const metrics = hasTokenMetrics(meta) ? meta : null

  const title = running
    ? t('code.compaction.running')
    : meta.partial
      ? meta.messages !== null
        ? t('code.compaction.doneUpToCount', { count: meta.messages })
        : t('code.compaction.doneUpTo')
      : meta.messages !== null && meta.messages > 0
        ? t('code.compaction.doneCount', { count: meta.messages })
        : t('code.compaction.done')

  const kept = meta.kept.map((k) => t(KEEP_KEY[k.kind], { count: k.count }))
  const freed = metrics ? tokensFreed(metrics) : 0

  return (
    <section
      aria-label={t('code.compaction.title')}
      className="rounded-xl border border-border bg-elevated text-sm"
      data-testid="compaction-card"
    >
      <div className="flex items-start gap-2 px-3 py-2">
        {running ? (
          <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        ) : (
          <Sparkles size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p role={running ? 'status' : undefined} className="font-medium">
            {title}
          </p>
          {!running && meta.auto && <p className="text-xs text-muted">{t('code.compaction.auto')}</p>}
          {!running && metrics && (
            <p className="text-xs text-muted">
              <span aria-hidden>
                {t('code.compaction.context', { before: formatNumber(metrics.tokensBefore), after: formatNumber(metrics.tokensAfter) })}
                {freed > 0 && ` ${t('code.compaction.freed', { freed: formatNumber(freed) })}`}
              </span>
              <span className="sr-only">
                {freed > 0
                  ? t('code.compaction.contextAria', {
                      before: formatNumber(metrics.tokensBefore),
                      after: formatNumber(metrics.tokensAfter),
                      freed: formatNumber(freed)
                    })
                  : t('code.compaction.context', { before: formatNumber(metrics.tokensBefore), after: formatNumber(metrics.tokensAfter) })}
              </span>
            </p>
          )}
          {!running && kept.length > 0 && <p className="text-xs text-muted">{t('code.compaction.kept', { items: kept.join(', ') })}</p>}
        </div>
        {!running && children && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronRight size={12} aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {open ? t('code.compaction.hide') : t('code.compaction.view')}
          </button>
        )}
      </div>
      {open && children && (
        <div id={panelId} className="border-t border-border px-3 py-2">
          {children}
        </div>
      )}
    </section>
  )
}
