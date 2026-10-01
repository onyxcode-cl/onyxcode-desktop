import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useQuickNotice } from '../lib/quick-notice'
import { useUi } from '../stores/ui'

/** Aviso cerrable: el envío desde Quick Entry falló sin conversación activa. El texto se conserva en Chat. */
export function QuickEntryNotice(): React.JSX.Element | null {
  const t = useT()
  const notice = useQuickNotice((s) => s.notice)
  const dismiss = useQuickNotice((s) => s.dismiss)
  const mode = useUi((s) => s.mode)
  // Al abrir otra vista el aviso ya no tiene contexto.
  useEffect(() => {
    if (mode !== 'chat') dismiss()
  }, [mode, dismiss])
  if (!notice) return null
  const reason = notice.kind === 'unknown' ? (notice.detail ?? notice.message) : notice.message
  return (
    <div
      role="alert"
      data-testid="quick-entry-notice"
      className="flex animate-fade-in items-center gap-2.5 border-b border-danger/25 bg-danger/8 px-4 py-2 text-xs text-danger"
    >
      <AlertTriangle size={14} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{t('notices.quick.title')}</strong> {t('notices.quick.body', { reason })}
      </span>
      {notice.action === 'connect' && (
        <button
          type="button"
          onClick={() => {
            dismiss()
            useUi.getState().openSettingsAt('models', 'providers')
          }}
          className="shrink-0 rounded-md px-2 py-0.5 font-medium underline-offset-2 hover:underline"
        >
          {t('notices.quick.connect')}
        </button>
      )}
      <button
        type="button"
        aria-label={t('notices.close')}
        onClick={dismiss}
        className="flex shrink-0 items-center rounded-md p-0.5 transition-colors hover:bg-danger/15"
      >
        <X size={13} />
      </button>
    </div>
  )
}
