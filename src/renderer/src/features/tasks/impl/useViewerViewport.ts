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
  hasViewport: boolean
}

export function useViewerViewport(panelVisible: boolean, ready = false): ViewerViewportState {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [overlayActive, setOverlayActive] = useState(hasOverlay)
  const [hasViewport, setHasViewport] = useState(false)

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
    let disposed = false
    let measurement = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const sync = (): void => {
      clearTimeout(retry)
      const r = el.getBoundingClientRect()
      const seq = ++measurement
      const usable = Math.round(r.width) > 0 && Math.round(r.height) > 0
      // La primera medida puede preceder al layout del tab. Observar solo el marcador absoluto
      // dejaba un 0x0 inicial como última medida; volver a medir el contenedor que participa del flex.
      if (!usable && shouldShowNative) retry = setTimeout(sync, 100)
      void cw('tasks:viewer:attach', {
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        // Adjunta la vista al panel mientras carga. Esperar a `ready` hacía que el motor
        // recibiera el drop con una WebContentsView que aún no formaba parte de la ventana.
        visible: shouldShowNative && usable
      }).then(
        (attached) => {
          if (!disposed && seq === measurement) setHasViewport(usable && attached)
        },
        () => {
          if (!disposed && seq === measurement) setHasViewport(false)
        }
      )
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(sync)
    })
    ro.observe(el)
    sync()
    window.addEventListener('resize', sync)
    return () => {
      disposed = true
      clearTimeout(retry)
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [shouldShowNative, ready])

  return { hostRef, shouldShowNative, hasViewport }
}
