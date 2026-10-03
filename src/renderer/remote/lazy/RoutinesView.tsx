import { Suspense, lazy } from 'react'

const Real = lazy(() => import('@renderer/features/routines/impl/RoutinesView').then((m) => ({ default: m.RoutinesView })))

export function RoutinesView(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Real />
    </Suspense>
  )
}
