import { withEsRest } from './with-es-rest'
import { Suspense, lazy, type ComponentProps } from 'react'
import { MobileSkeleton } from '@renderer/components/mobile/Skeleton'

const Real = lazy(() => withEsRest(import('@renderer/features/settings/impl/SettingsView').then((m) => ({ default: m.SettingsView }))))

export function SettingsView(props: ComponentProps<typeof Real>): React.JSX.Element {
  return (
    <Suspense fallback={<MobileSkeleton />}>
      <Real {...props} />
    </Suspense>
  )
}
