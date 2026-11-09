import { Info } from 'lucide-react'
import { hasStalePlanBlock } from '@shared/permission-rules'
import { useT } from '../../../lib/i18n'
import { useCode } from './store'

/**
 * 1.8.12 (R4): la conversación pasó por «Solo explorar» y ahora está en otro modo. El motor no deja quitar las reglas de la sesión y los ayudantes heredan
 * su `edit/write: deny`, así que no pueden editar aunque el modo nuevo lo permita (falla cerrado). Sin este aviso solo se veía un icono rojo.
 * No aparece mientras la conversación está en «Solo explorar» ni en una conversación que nunca pasó por él.
 */
export function StalePlanNotice({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const t = useT()
  const rules = useCode((s) => s.sessions[sessionID]?.permission)
  const inPlan = useCode((s) => s.permissionMode === 'plan' || s.agent === 'plan')
  if (inPlan || !hasStalePlanBlock(rules)) return null
  return (
    <div
      role="status"
      data-testid="stale-plan-notice"
      className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted"
    >
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{t('code.mode.stalePlan')}</span>
    </div>
  )
}
