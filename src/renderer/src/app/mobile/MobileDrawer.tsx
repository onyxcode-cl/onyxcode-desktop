/**
 * Panel lateral de la PWA (rediseño F8-B102, T1). Aquí solo vive la puerta: el contenido (`DrawerPanel.tsx`: lista del modo, gestos,
 * foco, pie) se baja al abrir el panel por primera vez, para no engordar el arranque (`boot.js` casi no tiene margen en el
 * presupuesto). Mientras no está abierto no pinta nada. Si el trozo no llega, el panel se da por cerrado (el armazón no se queda
 * `inert` sin salida).
 */
import { Component, Suspense, lazy, type ReactNode } from 'react'
import { useMobileNavStore } from './nav'

const Panel = lazy(() => import('./DrawerPanel'))

/** Si el trozo del panel no se pudo bajar, cierra el panel (y el armazón vuelve a estar activo). */
class CloseOnError extends Component<{ children: ReactNode }, { f?: boolean }> {
  state: { f?: boolean } = {}
  static getDerivedStateFromError(): { f: boolean } {
    return { f: true }
  }
  componentDidCatch(): void {
    useMobileNavStore.getState().setDrawer(false)
  }
  render(): ReactNode {
    return this.state.f ? null : this.props.children
  }
}

export function MobileDrawer(): React.JSX.Element | null {
  const drawerOpen = useMobileNavStore((s) => s.drawerOpen)
  if (!drawerOpen) return null
  return (
    <CloseOnError>
      <Suspense fallback={null}>
        <Panel />
      </Suspense>
    </CloseOnError>
  )
}
