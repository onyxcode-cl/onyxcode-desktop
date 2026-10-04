import { Suspense, lazy } from 'react'
import { PanelSkeleton } from './PanelSkeleton'

// PWA del celular: el panel de Archivos se baja al abrirlo.
const Real = lazy(() => import('@renderer/features/code/impl/panels/FilesPanel').then((m) => ({ default: m.FilesPanel })))

export function FilesPanel(props: { directory: string }): React.JSX.Element {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Real {...props} />
    </Suspense>
  )
}
