import { Suspense, lazy, type ComponentProps } from 'react'

const Real = lazy(() => import('@renderer/features/settings/impl/SettingsView').then((m) => ({ default: m.SettingsView })))

export function SettingsView(props: ComponentProps<typeof Real>): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <Real {...props} />
    </Suspense>
  )
}
