/**
 * Ajustes › Control del Mac: cómo usa el agente las apps (en segundo plano por Accessibility API, o
 * con el ratón y el teclado reales), si oculta las demás apps mientras controla la pantalla, y los
 * permisos por app (concesión por app de "computer use", ya existente del Lote A).
 */
import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, MonitorCog } from 'lucide-react'
import { DEFAULT_COMPUTER_PREFS, type ComputerControlMode, type ComputerPrefs } from '@shared/ipc-tasks'
import { UI_LABELS } from '@shared/labels'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { ComputerGrantsList } from '../../tasks/impl/ComputerAccess'
import { Card, ErrorText, SectionHeader, SubTitle, Toggle } from './ui'
import { errText } from '../../../lib/format'
import { useT } from '../../../lib/i18n'

/** Fila-botón de una opción del modo (como un radio, pero con la descripción bajo el título). */
function ModeOption({
  active,
  icon,
  title,
  desc,
  onClick
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-hover"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{desc}</span>
      </span>
      {active && <Check size={15} className="mt-0.5 shrink-0 text-accent" />}
    </button>
  )
}

export function ComputerSection(): React.JSX.Element {
  const t = useT()
  const [prefs, setPrefs] = useState<ComputerPrefs>(DEFAULT_COMPUTER_PREFS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasTasksBridge()) return
    cw('computer:prefs:get')
      .then(setPrefs)
      .catch(() => undefined)
  }, [])

  const update = (patch: Partial<ComputerPrefs>): void => {
    setError(null)
    setBusy(true)
    void cw('computer:prefs:set', patch)
      .then(setPrefs)
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setBusy(false))
  }

  const setMode = (mode: ComputerControlMode): void => {
    if (mode === prefs.mode) return
    update({ mode })
  }

  return (
    <div>
      <SectionHeader title={UI_LABELS.computer} description={t('misc.computer.desc')} />

      <SubTitle>{t('misc.computer.howTitle')}</SubTitle>
      <Card>
        <div role="radiogroup" aria-label={t('misc.computer.howTitle')}>
          <ModeOption
            active={prefs.mode === 'background'}
            icon={<Eye size={16} className="text-accent" />}
            title={t('misc.computer.bgTitle')}
            desc={t('misc.computer.bgDesc')}
            onClick={() => setMode('background')}
          />
          <ModeOption
            active={prefs.mode === 'full'}
            icon={<MonitorCog size={16} className="text-amber-500" />}
            title={t('misc.computer.fullTitle')}
            desc={t('misc.computer.fullDesc')}
            onClick={() => setMode('full')}
          />
        </div>
      </Card>

      <SubTitle>{t('misc.computer.whileTitle')}</SubTitle>
      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
              <EyeOff size={13} className="text-muted" /> {t('misc.computer.hide')}
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {t('misc.computer.hideDesc', { short: TASKS_TERMS.fullControlShort.toLowerCase() })}
            </div>
          </div>
          <Toggle
            checked={prefs.hideOtherApps}
            onChange={(v) => update({ hideOtherApps: v })}
            label={t('misc.computer.hide')}
            disabled={busy}
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg">{t('misc.computer.unhide')}</div>
            <div className="mt-0.5 text-xs text-muted">{t('misc.computer.unhideDesc')}</div>
          </div>
          <Toggle
            checked={prefs.unhideOnFinish}
            onChange={(v) => update({ unhideOnFinish: v })}
            label={t('misc.computer.unhide')}
            disabled={busy || !prefs.hideOtherApps}
          />
        </div>
      </Card>
      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> {t('misc.computer.saving')}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <SubTitle>{t('misc.computer.perApp')}</SubTitle>
      <p className="mb-4 -mt-1 text-sm text-muted">{t('misc.computer.perAppDesc')}</p>
      <ComputerGrantsList />
    </div>
  )
}
