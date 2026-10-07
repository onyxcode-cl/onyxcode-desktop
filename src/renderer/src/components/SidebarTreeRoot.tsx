import { useMemo } from 'react'
import { useT } from '../lib/i18n'
import { onTreeKeyDown, SidebarTreeContext, type SidebarTreeValue } from './SidebarTree'

/** Contenedor `role="tree"` de la lista de la barra lateral de escritorio (solo lo importa `Sidebar.tsx`; aquí viven sus textos). */
export function SidebarTree({ children, onClickCapture }: { children: React.ReactNode; onClickCapture?: () => void }): React.JSX.Element {
  const t = useT()
  const value = useMemo<SidebarTreeValue>(
    () => ({
      stateAria: (title, state) =>
        state === 'waiting'
          ? `${title} · ${t('app.sidebar.state.waiting')}`
          : state === 'working'
            ? `${title} · ${t('app.sidebar.state.working')}`
            : state === 'done'
              ? `${title} · ${t('app.sidebar.state.done')}`
              : undefined
    }),
    [t]
  )
  return (
    <SidebarTreeContext.Provider value={value}>
      <div role="tree" aria-label={t('app.sidebar.tree')} onKeyDown={onTreeKeyDown} onClickCapture={onClickCapture}>
        {children}
      </div>
    </SidebarTreeContext.Provider>
  )
}
