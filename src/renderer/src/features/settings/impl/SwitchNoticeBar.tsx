import { Check } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import type { SwitchNotice } from './reconcileModels'

/** Aviso breve «Ahora usas …» tras cambiar de cuenta, con «Deshacer». */
export function SwitchNoticeBar({ notice, onClose }: { notice: SwitchNotice | null; onClose: () => void }): React.JSX.Element | null {
  const t = useT()
  if (!notice) return null
  return (
    <div
      role="status"
      data-testid="switch-notice"
      className="mt-2 flex flex-wrap items-center gap-2 rounded-ctl bg-success/10 px-3 py-2 text-xs ring-1 ring-success/30 ring-inset"
    >
      <Check size={13} className="text-success" aria-hidden />
      <span className="min-w-0 flex-1 text-fg">{notice.text}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void notice.undo().finally(onClose)
        }}
      >
        {t('models.switched.undo')}
      </Button>
      <Button size="sm" variant="ghost" aria-label={t('models.switched.dismiss')} onClick={onClose}>
        ×
      </Button>
    </div>
  )
}
