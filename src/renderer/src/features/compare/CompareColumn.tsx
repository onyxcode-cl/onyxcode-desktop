/**
 * Una columna de la comparación: cabecera con estado, métricas, conversación en vivo y acciones.
 * Las métricas vienen del manifiesto (las calcula main); lo que no se informa es `null` y se pinta «—», nunca «$0».
 */
import { memo, useMemo, useRef } from 'react'
import { Check, Loader2, Wrench } from 'lucide-react'
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { CompareColumnManifest, CompareManifest, CompareMode } from '@shared/ipc-code'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../components/Button'
import { Markdown } from '../../components/Markdown'
import { useT } from '../../lib/i18n'
import type { MessageEntry } from '../../lib/session-reducer'
import {
  columnView,
  costLabel,
  durationLabel,
  elapsedMs,
  isActiveColumn,
  liveMetrics,
  mergeMetrics,
  rateInfo,
  tokensLabel,
  type BadgeKind,
  type ColumnView
} from './model'
import type { AdoptFailure } from './store'
import type { PendingPermission } from '../code/impl/types'

const VIEW_LABEL: Record<ColumnView, MsgKey> = {
  queued: 'compare.state.queued',
  starting: 'compare.state.starting',
  running: 'compare.state.running',
  done: 'compare.state.done',
  error: 'compare.state.error',
  rateLimited: 'compare.state.rateLimited',
  cancelled: 'compare.state.cancelled',
  adopted: 'compare.state.adopted',
  interrupted: 'compare.state.interrupted',
  discarded: 'compare.state.discarded'
}

const VIEW_TONE: Record<ColumnView, string> = {
  queued: 'bg-inset text-muted',
  starting: 'bg-accent-soft text-accent',
  running: 'bg-accent-soft text-accent',
  done: 'bg-inset text-success',
  error: 'bg-inset text-danger',
  rateLimited: 'bg-inset text-warning',
  cancelled: 'bg-inset text-subtle',
  adopted: 'bg-accent-soft text-accent',
  interrupted: 'bg-inset text-warning',
  discarded: 'bg-inset text-subtle'
}

const BADGE_LABEL: Record<BadgeKind, MsgKey> = {
  cheapest: 'compare.badge.cheapest',
  fastest: 'compare.badge.fastest',
  smallest: 'compare.badge.smallest'
}

export function StatePill({ view }: { view: ColumnView }): React.JSX.Element {
  const t = useT()
  const spinning = view === 'starting' || view === 'running'
  return (
    <span
      role="status"
      aria-live="polite"
      data-state={view}
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${VIEW_TONE[view]}`}
    >
      {spinning && <Loader2 size={10} className="animate-spin" aria-hidden />}
      {view === 'adopted' && <Check size={10} aria-hidden />}
      {t(VIEW_LABEL[view])}
    </span>
  )
}

function ToolRow({ part }: { part: Extract<Part, { type: 'tool' }> }): React.JSX.Element {
  const t = useT()
  const st = part.state
  const title = 'title' in st && typeof st.title === 'string' ? st.title : ''
  const failed = st.status === 'error'
  return (
    <div
      className={`flex items-center gap-1.5 font-mono text-[11.5px] ${failed ? 'text-danger' : 'text-muted'}`}
      title={t('compare.column.tool', { name: part.tool })}
    >
      {st.status === 'running' || st.status === 'pending' ? (
        <Loader2 size={11} className="shrink-0 animate-spin" aria-hidden />
      ) : (
        <Wrench size={11} className="shrink-0" aria-hidden />
      )}
      <span className="shrink-0">{part.tool}</span>
      {title && <span className="min-w-0 truncate text-subtle">{title}</span>}
    </div>
  )
}

/** Conversación compacta de la columna: texto del asistente (Markdown) y las herramientas en una línea. */
export const ColumnConversation = memo(function ColumnConversation({
  entries,
  streaming
}: {
  entries: readonly MessageEntry[]
  streaming: boolean
}): React.JSX.Element | null {
  const blocks = useMemo(() => {
    const out: { key: string; part: Part }[] = []
    for (const e of entries) {
      if (e.info.role !== 'assistant') continue
      for (const p of e.parts) {
        if (p.type === 'text' && (p.synthetic || p.ignored || !p.text)) continue
        if (p.type === 'text' || p.type === 'tool') out.push({ key: `${e.info.id}:${p.id}`, part: p })
      }
    }
    return out
  }, [entries])
  if (blocks.length === 0) return null
  const lastText = [...blocks].reverse().find((b) => b.part.type === 'text')?.key
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map(({ key, part }) =>
        part.type === 'tool' ? (
          <ToolRow key={key} part={part} />
        ) : part.type === 'text' ? (
          <Markdown
            key={key}
            text={part.text}
            streaming={streaming && key === lastText}
            highlight={!(streaming && key === lastText)}
            className="text-[13px]"
          />
        ) : null
      )}
    </div>
  )
})

interface Props {
  manifest: CompareManifest
  column: CompareColumnManifest
  modelName: string
  entries: readonly MessageEntry[]
  now: number
  badges: BadgeKind[]
  permissions: PendingPermission[]
  mode: CompareMode
  busy: string | undefined
  failure: AdoptFailure | undefined
  /** Número de columnas que seguirían en pie si se elige esta (para el texto del botón). */
  onKeep: () => void
  onDiscard: () => void
  onCancel: () => void
  onRetry: () => void
  onViewDiff: (trigger: HTMLElement) => void
  onReply: (p: PendingPermission, reply: 'once' | 'reject') => void
  onOpenWorktree?: () => void
  onCopyPatch?: () => void
}

export function CompareColumn(props: Props): React.JSX.Element {
  const { manifest: m, column: c, modelName, entries, now, badges, permissions, mode, busy, failure } = props
  const t = useT()
  const view = columnView(c)
  const active = isActiveColumn(c)
  const rate = rateInfo(c, m, now)
  const metrics = useMemo(() => mergeMetrics(c.metrics, liveMetrics(entries, c.startedAt)), [c.metrics, entries, c.startedAt])
  const duration = elapsedMs(c, now) ?? metrics.durationMs
  const diffBtn = useRef<HTMLButtonElement>(null)
  const label = c.model.variant ? `${modelName} · ${c.model.variant}` : modelName
  const costTitle = metrics.costUsd === null ? t('compare.metrics.costUnknown') : undefined
  const breakdown = [
    `${t('compare.metrics.in')}: ${tokensLabel(metrics.inputTokens)}`,
    `${t('compare.metrics.out')}: ${tokensLabel(metrics.outputTokens)}`,
    `${t('compare.metrics.reasoning')}: ${tokensLabel(metrics.reasoningTokens)}`,
    `${t('compare.metrics.cache')}: ${tokensLabel(metrics.cacheReadTokens)}`,
    `${t('compare.metrics.calls')}: ${metrics.llmCalls}`
  ].join(' · ')
  const canKeep = c.state === 'done' && !c.adopted && !c.discarded
  const streaming = c.state === 'running' || c.state === 'starting'

  return (
    <section
      role="region"
      aria-label={label}
      data-testid={`compare-col-${c.index}`}
      data-state={view}
      className={`relative flex min-h-0 min-w-0 flex-col bg-bg ${c.adopted ? 'ring-2 ring-accent ring-inset' : ''} ${c.discarded ? 'opacity-60' : ''}`}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={label}>
          {label}
        </h3>
        <StatePill view={view} />
      </header>

      <div
        role="group"
        aria-label={t('compare.metrics.region', { model: label })}
        title={breakdown}
        className="flex h-8 shrink-0 items-center gap-3 border-b border-border px-3 font-mono text-[11.5px] text-muted tabular-nums"
      >
        <span>
          <span aria-hidden>↑</span>
          <span className="sr-only">{t('compare.metrics.in')} </span>
          {tokensLabel(metrics.inputTokens)}
          <span className="px-1" aria-hidden />
          <span aria-hidden>↓</span>
          <span className="sr-only">{t('compare.metrics.out')} </span>
          {tokensLabel(metrics.outputTokens)}
        </span>
        <span title={costTitle} data-testid={`compare-cost-${c.index}`}>
          <span className="sr-only">{t('compare.metrics.cost')} </span>
          {costLabel(metrics.costUsd)}
        </span>
        <span>
          <span className="sr-only">{t('compare.metrics.duration')} </span>
          {durationLabel(duration)}
        </span>
        {badges.length > 0 && (
          <span className="ml-auto flex min-w-0 shrink-0 gap-1">
            {badges.map((b) => (
              <span key={b} className="rounded bg-inset px-1.5 text-[10.5px] tracking-[0.06em] text-muted uppercase">
                {t(BADGE_LABEL[b])}
              </span>
            ))}
          </span>
        )}
      </div>

      {rate && (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-inset px-3 py-1.5 text-[12px] text-warning"
        >
          <span className="min-w-0 flex-1" data-testid={`compare-rate-${c.index}`}>
            {rate.kind === 'scheduled'
              ? rate.seconds > 0
                ? t('compare.rate.retryIn', { s: rate.seconds })
                : t('compare.rate.retrying')
              : t('compare.rate.paused')}
          </span>
          {rate.kind !== 'scheduled' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={props.onRetry}
              disabled={busy === 'retry'}
              aria-label={t('compare.rate.retryAria', { model: label })}
            >
              {t('compare.rate.retry')}
            </Button>
          )}
        </div>
      )}

      {c.stopUnconfirmed && (
        <p role="alert" className="shrink-0 border-b border-border bg-inset px-3 py-1.5 text-[12px] text-warning">
          {t('compare.cancel.unconfirmed')}
        </p>
      )}
      {c.interrupted && !c.discarded && (
        <p className="shrink-0 border-b border-border bg-inset px-3 py-1.5 text-[12px] text-warning">{t('compare.interrupted')}</p>
      )}
      {c.error && c.state === 'error' && (
        <p role="alert" className="shrink-0 border-b border-border bg-inset px-3 py-1.5 text-[12px] text-danger">
          {c.error.message}
        </p>
      )}

      <div
        role="log"
        aria-live="off"
        aria-label={label}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
      >
        {c.discarded ? (
          <p className="text-[12.5px] text-subtle">{t('compare.column.discarded')}</p>
        ) : entries.length === 0 || !entries.some((e) => e.info.role === 'assistant') ? (
          <p className="text-[12.5px] text-subtle">{active ? t('compare.column.empty') : ''}</p>
        ) : (
          <ColumnConversation entries={entries} streaming={streaming} />
        )}
        {permissions.map((p) => (
          <div
            key={p.id}
            role="group"
            aria-label={t('compare.column.waiting')}
            className="mt-3 rounded-lg border border-warning/40 bg-inset p-2.5 text-[12px]"
          >
            <div className="font-medium text-warning">{t('compare.column.waiting')}</div>
            <div className="mt-0.5 truncate font-mono text-muted" title={p.patterns.join(', ')}>
              {p.permission}
              {p.patterns.length ? ` · ${p.patterns.join(', ')}` : ''}
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => props.onReply(p, 'once')}>
                {t('compare.column.allow')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => props.onReply(p, 'reject')}>
                {t('compare.column.reject')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {failure && (
        <div role="alert" className="shrink-0 border-t border-border bg-inset px-3 py-2 text-[12px] text-danger">
          <p>
            {failure.reason === 'conflict'
              ? t('compare.keep.conflict')
              : failure.reason === 'empty'
                ? t('compare.keep.empty')
                : failure.reason === 'symlink'
                  ? t('compare.keep.symlink')
                  : failure.reason === 'dirty-overlap'
                    ? t('compare.keep.dirty', { count: failure.files.length })
                    : t('compare.keep.notReady')}
          </p>
          {failure.reason === 'conflict' && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {props.onOpenWorktree && (
                <Button size="sm" variant="secondary" onClick={props.onOpenWorktree}>
                  {t('compare.keep.openWorktree')}
                </Button>
              )}
              {props.onCopyPatch && (
                <Button size="sm" variant="ghost" onClick={props.onCopyPatch}>
                  {t('compare.keep.copyPatch')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {!c.discarded && (
        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
          {mode === 'code' && c.diff && (
            <>
              <span className="min-w-0 truncate text-[11.5px] text-muted tabular-nums">
                <span className="text-success">+{c.diff.additions}</span> <span className="text-danger">−{c.diff.deletions}</span>
                {' · '}
                {t('compare.diff.summary', { count: c.diff.files })}
              </span>
              <button
                ref={diffBtn}
                type="button"
                onClick={() => diffBtn.current && props.onViewDiff(diffBtn.current)}
                className="shrink-0 rounded text-[12px] font-medium text-accent underline-offset-2 hover:underline"
              >
                {t('compare.diff.view')}
              </button>
            </>
          )}
          <span className="ml-auto" />
          {active && (
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onCancel}
              disabled={busy === 'cancel'}
              aria-label={t('compare.cancel.aria', { model: label })}
            >
              {t('compare.cancel')}
            </Button>
          )}
          {!active && !c.adopted && (
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onDiscard}
              disabled={!!busy || c.stopUnconfirmed}
              aria-label={t('compare.discard.aria', { model: label })}
            >
              {t('compare.discard')}
            </Button>
          )}
          {canKeep && (
            <Button
              size="sm"
              variant="primary"
              onClick={props.onKeep}
              disabled={!!busy}
              aria-label={t('compare.keep.aria', { model: label })}
            >
              {mode === 'chat' ? t('compare.keepChat') : t('compare.keep')}
            </Button>
          )}
        </footer>
      )}
    </section>
  )
}
