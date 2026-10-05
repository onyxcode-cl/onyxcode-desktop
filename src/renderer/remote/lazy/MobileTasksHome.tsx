import { withEsRest } from './with-es-rest'
import { Suspense, lazy } from 'react'
import { MobileSkeleton } from '@renderer/components/mobile/Skeleton'

const Real = lazy(() => withEsRest(import('@renderer/features/tasks/impl/MobileTasksHome').then((m) => ({ default: m.MobileTasksHome }))))

export function MobileTasksHome(): React.JSX.Element {
  return (
    <Suspense fallback={<MobileSkeleton />}>
      <Real />
    </Suspense>
  )
}
