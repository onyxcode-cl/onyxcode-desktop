import { Suspense, lazy } from 'react'
import { MobileSkeleton } from '@renderer/components/mobile/Skeleton'

const Real = lazy(() => import('@renderer/features/tasks/impl/TasksSidebar').then((m) => ({ default: m.TasksSidebar })))

export function TasksSidebar(): React.JSX.Element {
  return (
    <Suspense fallback={<MobileSkeleton />}>
      <Real />
    </Suspense>
  )
}
