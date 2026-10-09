/**
 * Mide el hueco donde vive la vista nativa del visor de documentos y sincroniza sus bounds con
 * main (`tasks:viewer:attach`). Mismo patrón que `features/browser/useNativeViewport.ts`,
 * simplificado: un solo visor a la vez (sin "owner" ni pestañas). Un overlay de React (menú,
 * diálogo) en cualquier parte de la app oculta la vista nativa, igual que con el navegador.
 */
import { useEffect, useRef, useState } from 'react'
import { cw } from './bridge'

const OVERLAY_SELECTOR = '[role="dialog"],[role="menu"],[role="listbox"],[data-floating]'

function hasOverlay(): boolean {
  try {
    return !!document.querySelector(OVERLAY_SELECTOR)
  } catch {
    return false
  }
}

export interface ViewerViewportState {
  hostRef: React.RefObject<HTMLDivElement | null>
  shouldShowNative: boolean
}

export function useViewerViewport(panelVisible: boolean): ViewerViewportState {
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
      void cw('tasks:viewer:attach', {
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        visible: shouldShowNative
      }).catch(() => undefined)
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
