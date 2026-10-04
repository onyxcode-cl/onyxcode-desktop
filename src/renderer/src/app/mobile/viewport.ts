/**
 * Teclado y zona visible en el celular. `window.visualViewport` da la altura REAL visible (el teclado la recorta y en iOS el
 * navegador desplaza el viewport de diseño); con ella el contenedor raíz del shell se ajusta sin tapar el compositor:
 *   --vv-height  altura visible (px)         --vv-top  desplazamiento superior del viewport visible (px)
 *   --kb-inset   hueco que ocupa el teclado debajo (px), para elementos pegados al borde inferior (hojas)
 * y `data-keyboard="open"` en <html> cuando el teclado está abierto (el CSS quita entonces el margen de la zona segura inferior).
 */
export interface ViewportMetrics {
  height: number
  top: number
  kb: number
}

/** Teclado «abierto» a partir de este hueco (px): evita confundirlo con la barra de direcciones que se encoge. */
export const KEYBOARD_MIN_INSET = 120

export function computeViewport(innerHeight: number, vv: { height: number; offsetTop: number } | null): ViewportMetrics {
  if (!vv) return { height: innerHeight, top: 0, kb: 0 }
  const top = Math.max(0, vv.offsetTop)
  return { height: Math.round(vv.height), top: Math.round(top), kb: Math.max(0, Math.round(innerHeight - vv.height - top)) }
}

/** Escribe las variables CSS y el atributo en `root`. Devuelve las métricas aplicadas. */
export function applyViewport(root: HTMLElement, m: ViewportMetrics): void {
  root.style.setProperty('--vv-height', `${m.height}px`)
  root.style.setProperty('--vv-top', `${m.top}px`)
  root.style.setProperty('--kb-inset', `${m.kb}px`)
  if (m.kb >= KEYBOARD_MIN_INSET) root.dataset.keyboard = 'open'
  else delete root.dataset.keyboard
}

/** Instala los oyentes de `visualViewport`. Devuelve la baja (que también limpia las variables). */
export function installViewportVars(win: Window = window, root: HTMLElement = win.document.documentElement): () => void {
  const vv = win.visualViewport
  let raf = 0
  const update = (): void => {
    raf = 0
    applyViewport(root, computeViewport(win.innerHeight, vv))
  }
  const schedule = (): void => {
    if (!raf) raf = win.requestAnimationFrame(update)
  }
  update()
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  win.addEventListener('resize', schedule)
  win.addEventListener('orientationchange', schedule)
  return () => {
    if (raf) win.cancelAnimationFrame(raf)
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    win.removeEventListener('resize', schedule)
    win.removeEventListener('orientationchange', schedule)
    for (const k of ['--vv-height', '--vv-top', '--kb-inset']) root.style.removeProperty(k)
    delete root.dataset.keyboard
  }
}

/** Altura máxima (px) del compositor en el celular: 38 % de lo visible (el teclado recorta la zona) con tope de 240. Pura. */
export function mobileComposerMax(visibleHeight: number): number {
  return Number.isFinite(visibleHeight) && visibleHeight > 0 ? Math.round(Math.min(240, 0.38 * visibleHeight)) : 240
}
