import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { isRemoteSurface } from './platform'

/** ¿El dedo se movió más de `slop` px desde donde empezó? (pura, para pruebas). */
export function exceededSlop(dx: number, dy: number, slop = 10): boolean {
  return Math.hypot(dx, dy) > slop
}

/** Elementos con su propio gesto (enlaces, código, tablas, controles): el mantener pulsado no actúa sobre ellos. */
export const LONG_PRESS_IGNORE = 'a,pre,table,button,textarea,input,select,[contenteditable="true"]'

/** ¿El objetivo del toque admite el mantener pulsado? */
export function longPressAllowed(target: EventTarget | null): boolean {
  const el = target as Element | null
  return !(el && typeof el.closest === 'function' && el.closest(LONG_PRESS_IGNORE))
}

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onContextMenu: (e: ReactMouseEvent) => void
}

/**
 * Mantener pulsado (450 ms) en el celular. Se cancela si el dedo se mueve más de `slop` px, al soltar o si un ancestro
 * hace scroll. Fuera del celular devuelve `undefined` (el escritorio no cambia). El menú contextual nativo del
 * mantener pulsado se suprime solo sobre lo que sí abre la hoja.
 */
export function useLongPress(
  onLong: () => void,
  { ms = 450, slop = 10 }: { ms?: number; slop?: number } = {}
): LongPressHandlers | undefined {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const cb = useRef(onLong)
  cb.current = onLong
  const fired = useRef(false)

  const cancel = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])

  useEffect(() => {
    // Un scroll de cualquier ancestro cancela (el scroll no emite `pointermove` fiable en iOS).
    const onScroll = (): void => cancel()
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      cancel()
    }
  }, [cancel])

  const remote = isRemoteSurface()
  if (!remote) return undefined
  return {
    onPointerDown: (e) => {
      cancel()
      fired.current = false
      if (!longPressAllowed(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        timer.current = null
        fired.current = true
        cb.current()
      }, ms)
    },
    onPointerMove: (e) => {
      const s = start.current
      if (s && exceededSlop(e.clientX - s.x, e.clientY - s.y, slop)) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => {
      if (longPressAllowed(e.target) && (fired.current || timer.current)) e.preventDefault()
    }
  }
}
