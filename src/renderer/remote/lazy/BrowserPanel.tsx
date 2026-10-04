import { Suspense, lazy, type ComponentProps } from 'react'
import { PanelSkeleton } from './PanelSkeleton'

// PWA del celular: el navegador integrado casi nunca se muestra; su panel se baja al usarlo.
const Real = lazy(() => import('@renderer/features/browser/BrowserPanel').then((m) => ({ default: m.BrowserPanel })))

export type { BrowserPanelProps } from '@renderer/features/browser/BrowserPanel'

export function BrowserPanel(props: ComponentProps<typeof Real>): React.JSX.Element {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Real {...props} />
    </Suspense>
  )
}
