/**
 * Menú «Objetivo, presupuesto y revisión» de la barra de Code. Solo existe si la persona encendió alguna de las tres funciones
 * experimentales en Ajustes (`engineExperiments.codeExtras`, apagadas por defecto), hay una conversación abierta y estamos en el
 * escritorio (el celular no ve estas pantallas). Cada entrada abre su diálogo.
 */
import { useCallback, useRef, useState } from 'react'
import { Gauge, SearchCheck, Target } from 'lucide-react'
import { normalizeEngineExperiments } from '@shared/engine-experiments'
import { PortalMenu, PortalMenuItem } from '../../../components/PortalMenu'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { useSettings } from '../../../stores/settings'
import { BudgetDialog } from './BudgetDialog'
import { GoalDialog } from './GoalDialog'
import { ReviewDialog } from './ReviewDialog'

type Open = 'goal' | 'budget' | 'review' | null

export function SessionToolsMenu({
  sessionId,
  directory,
  busy
}: {
  sessionId: string | null
  directory?: string
  busy: boolean
}): React.JSX.Element | null {
  const t = useT()
  const stored = useSettings((s) => s.settings.engineExperiments)
  const extras = normalizeEngineExperiments(stored).codeExtras
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState<Open>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenu(false), [])
  const closeDialog = useCallback(() => setDialog(null), [])
  if (isRemoteSurface() || !sessionId || !(extras.goal || extras.budget || extras.review)) return null
  const pick = (d: Exclude<Open, null>) => (): void => {
    setMenu(false)
    setDialog(d)
  }
  const ic = { size: 14, strokeWidth: 1.75 } as const
  return (
    <>
      <div ref={anchor} className="no-drag relative flex shrink-0" data-testid="session-tools">
        <button
          type="button"
          title={t('code.extras.menu')}
          aria-label={t('code.extras.menu')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((o) => !o)}
          className={`flex size-7 items-center justify-center rounded-ctl-sm hover:bg-hover hover:text-fg ${menu ? 'bg-active text-fg' : 'text-muted'}`}
        >
          <Target size={15} strokeWidth={1.75} />
        </button>
        <PortalMenu open={menu} anchor={anchor} onClose={closeMenu} label={t('code.extras.menu')}>
          {extras.goal && <PortalMenuItem icon={<Target {...ic} />} label={t('code.extras.goal.open')} onClick={pick('goal')} />}
          {extras.budget && <PortalMenuItem icon={<Gauge {...ic} />} label={t('code.extras.budget.open')} onClick={pick('budget')} />}
          {extras.review && <PortalMenuItem icon={<SearchCheck {...ic} />} label={t('code.extras.review.open')} onClick={pick('review')} />}
        </PortalMenu>
      </div>
      {dialog === 'goal' && <GoalDialog sessionId={sessionId} directory={directory} onClose={closeDialog} />}
      {dialog === 'budget' && <BudgetDialog sessionId={sessionId} directory={directory} onClose={closeDialog} />}
      {dialog === 'review' && <ReviewDialog sessionId={sessionId} directory={directory} busy={busy} onClose={closeDialog} />}
    </>
  )
}
