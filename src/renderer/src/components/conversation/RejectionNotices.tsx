import { useShallow } from 'zustand/react/shallow'
import { useT } from '../../lib/i18n'
import { useRejectionNotices, type RejectionNotice } from '../../stores/rejection-notices'

/** Explicación inmediata y determinista incluso si el motor termina el turno sin texto final. */
export function RejectionNotices({
  mode,
  directory,
  sessionID
}: Pick<RejectionNotice, 'mode' | 'directory' | 'sessionID'>): React.JSX.Element {
  const t = useT()
  const notices = useRejectionNotices(
    useShallow((s) => s.notices.filter((n) => n.mode === mode && n.directory === directory && n.sessionID === sessionID))
  )
  const dismiss = useRejectionNotices((s) => s.dismiss)
  return (
    <>
      {notices.map((notice) => (
        <div
          key={`${notice.kind}:${notice.requestID}`}
          role="status"
          className="my-2 rounded-xl border border-border bg-elevated px-4 py-3 text-sm"
        >
          <p>{t(notice.kind === 'permission' ? 'common.rejection.permission' : 'common.rejection.question')}</p>
          {notice.detail && (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{notice.detail}</pre>
          )}
          <div className="mt-2 flex items-center gap-3">
            <p className="flex-1 text-muted">{t('common.rejection.next')}</p>
            <button type="button" className="no-drag shrink-0 text-muted hover:underline" onClick={() => dismiss(notice)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
