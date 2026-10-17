/**
 * Bandeja «Resultados por revisar»: lo que dejó cada ejecución de una rutina (qué hizo, archivos, estado, errores) y
 * las ejecuciones perdidas que esperan decisión. Vive arriba de la lista de Rutinas y reutiliza su almacén.
 */
import { useMemo, useState } from 'react'
import { AlertCircle, CalendarX2, Check, CheckCircle2, ChevronDown, ExternalLink, FileText, Play, X } from 'lucide-react'
import type { RoutineInboxItem } from '@shared/ipc-tasks'
import { useT } from '../../../lib/i18n'
import { fullDate } from './schedule'
import { resolveInbox, selectInboxPending, useRoutines } from './store'

export function InboxCard({ item, onOpen }: { item: RoutineInboxItem; onOpen?: (item: RoutineInboxItem) => void }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const missed = item.kind === 'missed'
  const failed = item.runStatus === 'error'
  const Icon = missed ? CalendarX2 : failed ? AlertCircle : CheckCircle2
  const tone = missed ? 'text-warning' : failed ? 'text-danger' : 'text-success'
  const body = missed
    ? t('routines.inbox.missedBody', { when: item.dueAt ? fullDate(item.dueAt) : '', count: item.missedCount ?? 1 })
    : failed
      ? (item.error ?? '')
      : (item.summary ?? '')
  const files = item.files ?? []
  const triggers = item.triggerFiles ?? []
  return (
    <li
      data-testid="inbox-item"
      data-kind={item.kind}
      className="rounded-xl border border-border bg-elevated p-3 desk:rounded-card desk:border-transparent desk:bg-elevated desk:shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-sm font-medium">{item.routineName}</span>
            <span className="text-[11px] desk:text-meta text-subtle">{fullDate(item.createdAt)}</span>
          </div>
          <p className={`mt-0.5 text-xs text-muted ${open ? '' : 'line-clamp-2'}`}>{body}</p>
          {(files.length > 0 || triggers.length > 0 || (item.rejectedCount ?? 0) > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] desk:text-meta text-muted">
              {triggers.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-hover px-1.5 py-0.5" title={triggers.join('\n')}>
                  <FileText size={10} /> {t('routines.inbox.triggered', { name: triggers[0], count: triggers.length })}
                </span>
              )}
              {files.length > 0 && (
                <span className="rounded-full bg-hover px-1.5 py-0.5" title={files.join('\n')}>
                  {t('routines.inbox.files', { count: files.length })}
                </span>
              )}
              {(item.rejectedCount ?? 0) > 0 && (
                <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-danger">
                  {t('routines.inbox.rejected', { count: item.rejectedCount ?? 0 })}
                </span>
              )}
            </div>
          )}
          {open && !missed && (
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted" data-testid="inbox-detail">
              {files.length > 0 && (
                <ul className="space-y-0.5 font-mono text-[11px] desk:text-meta">
                  {files.map((f) => (
                    <li key={f} className="truncate">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              {item.sessionId && item.directory && onOpen && (
                <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => onOpen(item)}>
                  <ExternalLink size={12} /> {t('routines.inbox.openSession')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {!missed && (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-ctl-sm px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <ChevronDown size={12} className={open ? 'rotate-180' : ''} /> {t('routines.inbox.detail')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-ctl-sm px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
              onClick={() => void resolveInbox(item.id, 'run')}
            >
              <Play size={12} /> {t('routines.inbox.rerun')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-ctl-sm px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
              onClick={() => void resolveInbox(item.id, 'dismiss')}
            >
              <X size={12} /> {t('routines.inbox.dismiss')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-ctl-sm bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:opacity-90"
              onClick={() => void resolveInbox(item.id, 'approve')}
            >
              <Check size={12} /> {t('routines.inbox.approve')}
            </button>
          </>
        )}
        {missed && (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-ctl-sm px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
              onClick={() => void resolveInbox(item.id, 'skip')}
            >
              <X size={12} /> {t('routines.inbox.skip')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-ctl-sm bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:opacity-90"
              onClick={() => void resolveInbox(item.id, 'run')}
            >
              <Play size={12} /> {t('routines.inbox.runMissed')}
            </button>
          </>
        )}
      </div>
    </li>
  )
}

export function RoutineInbox({ onOpen }: { onOpen?: (item: RoutineInboxItem) => void }): React.JSX.Element | null {
  const t = useT()
  const inbox = useRoutines((s) => s.inbox)
  const items = useMemo(() => inbox.filter((i) => i.status === 'pending'), [inbox])
  const pending = useRoutines(selectInboxPending)
  if (items.length === 0) return null
  return (
    <section aria-label={t('routines.inbox.title')} data-testid="routine-inbox" className="mx-auto mb-4 max-w-5xl desk:max-w-[760px]">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-medium desk:px-2 desk:text-[11px] desk:font-semibold desk:tracking-[0.02em]">
        {t('routines.inbox.title')}
        <span className="rounded-full bg-accent-soft px-1.5 text-[11px] desk:text-meta text-accent" data-testid="inbox-count">
          {pending}
        </span>
      </h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <InboxCard key={i.id} item={i} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  )
}
