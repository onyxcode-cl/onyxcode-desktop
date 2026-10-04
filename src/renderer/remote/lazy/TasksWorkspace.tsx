import { withEsRest } from './with-es-rest'
import { Suspense, lazy } from 'react'
import { MobileSkeleton } from '@renderer/components/mobile/Skeleton'

// PWA del celular: Tareas se descarga solo al entrar en ese modo (código dividido con `import()`).
const Real = lazy(() => withEsRest(import('@renderer/features/tasks/impl/TasksWorkspace').then((m) => ({ default: m.TasksWorkspace }))))

export function TasksWorkspace(): React.JSX.Element {
  return (
    <Suspense fallback={<MobileSkeleton />}>
      <Real />
    </Suspense>
  )
}
