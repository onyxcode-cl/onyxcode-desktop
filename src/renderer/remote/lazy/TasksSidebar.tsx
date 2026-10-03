import { Suspense, lazy } from 'react'

const Real = lazy(() => import('@renderer/features/tasks/impl/TasksSidebar').then((m) => ({ default: m.TasksSidebar })))

export function TasksSidebar(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Real />
    </Suspense>
  )
}
