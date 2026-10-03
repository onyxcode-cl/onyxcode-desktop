import { Suspense, lazy } from 'react'

const Real = lazy(() => import('@renderer/features/settings/impl/SettingsView').then((m) => ({ default: m.SettingsView })))

export function SettingsView(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Real />
    </Suspense>
  )
}
