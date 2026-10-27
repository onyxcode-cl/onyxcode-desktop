/** Chip del alcance en la caja de escribir: es la variante `chip` del selector único (`ScopePicker`). */
import { ScopePicker } from './ScopePicker'

export function AccessChip({ disabled }: { disabled?: boolean }): React.JSX.Element {
  return <ScopePicker variant="chip" disabled={disabled} />
}
