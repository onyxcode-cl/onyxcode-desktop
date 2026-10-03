import { Suspense, lazy } from 'react'

// PWA del celular: Tareas se descarga solo al entrar en ese modo (código dividido con `import()`).
const Real = lazy(() => import('@renderer/features/tasks/impl/TasksWorkspace').then((m) => ({ default: m.TasksWorkspace })))

export function TasksWorkspace(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Real />
    </Suspense>
  )
}
