import { Suspense, lazy } from 'react'
import type { ElementDetailPopoverProps } from '@renderer/features/browser/ElementDetailPopover'

// PWA del celular: el detalle del elemento (popover) se baja al abrirlo desde el chip.
const Real = lazy(() => import('@renderer/features/browser/ElementDetailPopover').then((m) => ({ default: m.ElementDetailPopover })))

export function ElementDetailPopover(props: ElementDetailPopoverProps): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Real {...props} />
    </Suspense>
  )
}
