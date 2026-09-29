/**
 * Mide el hueco donde vive la vista nativa (`WebContentsView`) y sincroniza sus bounds con main
 * (`browser:attach`). Un `MutationObserver` detecta overlays de React (menús, diálogos…) en
 * cualquier parte de la app: mientras uno esté presente, o el panel esté oculto, la vista se
 * desconecta (`visible:false`) y se muestra en su lugar una captura congelada (`browser:capture`).
 */
import { useEffect, useRef, useState } from 'react'
import type { BrowserCapture, BrowserOwner } from '@shared/ipc-browser'
import { br } from './bridge'
import { ownerKey } from './store'

/** Selectores que marcan un overlay de React que tapa la vista (nunca las tarjetas del navegador, que empujan la página en vez de superponerse). */
const OVERLAY_SELECTOR = '[role="dialog"],[role="menu"],[role="listbox"],[data-floating]'

export interface NativeViewportState {
  hostRef: React.RefObject<HTMLDivElement | null>
  /** `true` cuando un overlay de React tapa (o tapa parcialmente) la ventana. */
  overlayActive: boolean
  /** La vista nativa debería estar visible ahora mismo (ni oculta por el panel ni por un overlay). */
  shouldShowNative: boolean
  /** Captura congelada a mostrar como `<img>` mientras la vista nativa no está visible. */
  frozen: BrowserCapture | null
}

function hasOverlay(): boolean {
  try {
    return !!document.querySelector(OVERLAY_SELECTOR)
  } catch {
    return false
  }
}

export function useNativeViewport(owner: BrowserOwner, tabId: string | null, panelVisible: boolean): NativeViewportState {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [overlayActive, setOverlayActive] = useState(hasOverlay)
  const [frozen, setFrozen] = useState<BrowserCapture | null>(null)
  const key = ownerKey(owner)

  // Overlays de React en cualquier parte del árbol (no solo dentro del panel).
  useEffect(() => {
    const check = (): void => setOverlayActive(hasOverlay())
    check()
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-floating'] })
    return () => mo.disconnect()
  }, [])

  const shouldShowNative = panelVisible && !overlayActive

  // Mide el hueco (ResizeObserver) y sincroniza los bounds/visibilidad con main.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let raf = 0
    const sync = (): void => {
      const r = el.getBoundingClientRect()
      void br('browser:attach', {
        owner,
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
    // `key` (no `owner`) porque el objeto puede recrearse en cada render del padre con el mismo contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, shouldShowNative])

  // Al ocultarse la vista nativa (overlay o panel oculto), pide una captura congelada para mostrar.
  useEffect(() => {
    if (shouldShowNative || !tabId) {
      setFrozen(null)
      return
    }
    let cancelled = false
    void br('browser:capture', { owner, tabId })
      .then((cap) => !cancelled && setFrozen(cap))
      .catch(() => !cancelled && setFrozen(null))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowNative, tabId, key])

  // Al desmontar el panel, ya no hay hueco que alojar.
  useEffect(() => {
    return () => {
      void br('browser:detach', { owner }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { hostRef, overlayActive, shouldShowNative, frozen }
}
