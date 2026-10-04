import { Suspense, lazy } from 'react'
import { loadHljs } from '../shims/hljs-deferred'
import { PanelSkeleton } from './PanelSkeleton'

// PWA del celular: el panel de Cambios (con DiffView y `diff`) se baja al abrirlo.
// Espera también al resaltador de diffs para que el primer diff ya salga coloreado.
const Real = lazy(() =>
  Promise.all([import('@renderer/features/code/impl/panels/ChangesPanel'), loadHljs()]).then(([m]) => ({ default: m.ChangesPanel }))
)

export function ChangesPanel(props: { directory: string }): React.JSX.Element {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Real {...props} />
    </Suspense>
  )
}
