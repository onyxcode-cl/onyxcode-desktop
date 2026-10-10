import { useEffect, useMemo, useRef, useState } from 'react'
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
  // `role="tree"` exige hijos `treeitem`: sin conversaciones (solo el texto de «aún no hay…») el contenedor queda como un div normal.
  const ref = useRef<HTMLDivElement>(null)
  const [hasItems, setHasItems] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = (): void => setHasItems(el.querySelector('[role="treeitem"]') !== null)
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])
  return (
    <SidebarTreeContext.Provider value={value}>
      <div
        ref={ref}
        role={hasItems ? 'tree' : undefined}
        aria-label={hasItems ? t('app.sidebar.tree') : undefined}
        onKeyDown={onTreeKeyDown}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </SidebarTreeContext.Provider>
  )
}
