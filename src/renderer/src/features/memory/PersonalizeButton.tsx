/** Acceso desde Chat y Code a «Instrucciones y memoria» (Ajustes). Solo escritorio: en el celular esas pantallas no existen. */
import { BrainCircuit } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { useUi } from '../../stores/ui'

export function PersonalizeButton(): React.JSX.Element | null {
  const t = useT()
  if (isRemoteSurface()) return null
  return (
    <IconButton
      label={t('instr.open')}
      tooltip
      size="sm"
      className="no-drag"
      data-testid="personalize-button"
      onClick={() => useUi.getState().openSettingsAt('instructions')}
    >
      <BrainCircuit size={14} />
    </IconButton>
  )
}
