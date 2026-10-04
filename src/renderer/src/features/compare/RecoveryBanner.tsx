/** Franja de recuperación: comparaciones sin cerrar de un arranque anterior (y avisos breves de la función). */
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { CompareMode } from '@shared/ipc-code'
import { useT } from '../../lib/i18n'
import { compareAvailable } from './api'
import { clearNotice, closeCompare, openComparison, selectRecoverable, useCompare } from './store'

export function RecoveryBanner({ mode, directory }: { mode: CompareMode; directory: string | null }): React.JSX.Element | null {
  const t = useT()
  const list = useCompare(useShallow((s) => selectRecoverable(s, mode, directory).map((m) => m.id)))
  const notice = useCompare((s) => (s.notice && s.notice.mode === mode ? s.notice : null))
  const error = useCompare((s) => list.map((id) => s.errors[id]).find(Boolean))
  if (!compareAvailable()) return null
  if (list.length === 0 && !notice) return null
  return (
    <div className="flex flex-col">
      {notice && (
        <div
          role="status"
          className={`flex items-center gap-2 border-b border-border bg-inset px-4 py-1.5 text-[12.5px] ${notice.tone === 'warn' ? 'text-warning' : 'text-muted'}`}
        >
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          <button
            type="button"
            onClick={clearNotice}
            title={t('compare.error.dismiss')}
            aria-label={t('compare.error.dismiss')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-hover hover:text-fg"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {list.length > 0 && (
        <div
          data-testid="compare-recovery"
          role="status"
          className="flex items-center gap-3 border-b border-border bg-accent-soft px-4 py-1.5 text-[12.5px]"
        >
          <span className="min-w-0 flex-1 truncate text-fg">{t('compare.recovery', { count: list.length })}</span>
          {error && (
            <span role="alert" className="min-w-0 truncate text-danger">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={() => openComparison(list[0], directory)}
            className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover"
          >
            {t('compare.recovery.open')}
          </button>
          <button
            type="button"
            onClick={() => {
              for (const id of list) void closeCompare(id)
            }}
            className="shrink-0 rounded-md px-2 py-0.5 font-medium text-muted hover:bg-hover hover:text-fg"
          >
            {t('compare.recovery.discard')}
          </button>
        </div>
      )}
    </div>
  )
}
