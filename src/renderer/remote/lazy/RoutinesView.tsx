import { withEsRest } from './with-es-rest'
import { Suspense, lazy } from 'react'
import { MobileSkeleton } from '@renderer/components/mobile/Skeleton'

const Real = lazy(() => withEsRest(import('@renderer/features/routines/impl/RoutinesView').then((m) => ({ default: m.RoutinesView }))))

export function RoutinesView(): React.JSX.Element {
  return (
    <Suspense fallback={<MobileSkeleton />}>
      <Real />
    </Suspense>
  )
}
