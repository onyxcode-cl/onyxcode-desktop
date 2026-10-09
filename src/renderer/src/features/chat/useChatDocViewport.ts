/**
 * Mide el hueco del panel de documento de Chat y sincroniza sus bounds con main
 * (`extras:chatDoc:attach`). Mismo patrón que `features/tasks/impl/useViewerViewport.ts`, con el
 * puente de `extras` en vez del de Tareas (Chat no tiene bridge propio de IPC).
 */
import { useEffect, useRef, useState } from 'react'
import { getExtras } from '../../lib/extrasApi'

const OVERLAY_SELECTOR = '[role="dialog"],[role="menu"],[role="listbox"],[data-floating]'

function hasOverlay(): boolean {
  try {
    return !!document.querySelector(OVERLAY_SELECTOR)
  } catch {
    return false
  }
}

export interface ChatDocViewportState {
  hostRef: React.RefObject<HTMLDivElement | null>
  shouldShowNative: boolean
}

export function useChatDocViewport(panelVisible: boolean): ChatDocViewportState {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [overlayActive, setOverlayActive] = useState(hasOverlay)

  useEffect(() => {
    const check = (): void => setOverlayActive(hasOverlay())
    check()
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-floating'] })
    return () => mo.disconnect()
  }, [])

  const shouldShowNative = panelVisible && !overlayActive

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let raf = 0
    const sync = (): void => {
      const r = el.getBoundingClientRect()
      const extras = getExtras()
      if (!extras) return
      void extras
        .invoke('extras:chatDoc:attach', {
          rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          visible: shouldShowNative
        })
        .catch(() => undefined)
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sync)
    })
    ro.observe(el)
    sync()
    window.addEventListener('resize', sync)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [shouldShowNative])

  return { hostRef, shouldShowNative }
}
