import { useEffect, type RefObject } from 'react'

/** Lo mínimo que se lee de un `KeyboardEvent` de React (facilita probarlo con eventos falsos). */
export interface KeyEventLike {
  key: string
  shiftKey: boolean
  keyCode: number
  nativeEvent: { isComposing: boolean }
}

/**
 * ¿Hay una composición IME en curso? `keyCode === 229` cubre el Enter que confirma la composición
 * y que algunos navegadores entregan tras `compositionend` con `isComposing` ya en false.
 */
export function isImeComposing(e: Pick<KeyEventLike, 'keyCode' | 'nativeEvent'>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

/** Enter que envía: sin composición IME y sin Shift (salvo `allowShift`, p. ej. en un `<input>`). */
export function isSubmitKey(e: KeyEventLike, { allowShift = false }: { allowShift?: boolean } = {}): boolean {
  return e.key === 'Enter' && !isImeComposing(e) && (allowShift || !e.shiftKey)
}

/**
 * Ajusta el alto de un textarea a su contenido con tope `max`. Con `manageOverflow` también
 * alterna `overflowY` (auto solo cuando el contenido supera el tope).
 */
export function fitTextarea(el: HTMLTextAreaElement, max: number, manageOverflow = false): void {
  el.style.height = 'auto'
  const h = el.scrollHeight
  el.style.height = `${Math.min(h, max)}px`
  if (manageOverflow) el.style.overflowY = h > max ? 'auto' : 'hidden'
}

/** Autoajuste de alto al cambiar `value` (o cualquiera de `deps`). */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { max, manageOverflow = false, deps = [] }: { max: number; manageOverflow?: boolean; deps?: unknown[] }
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    fitTextarea(el, max, manageOverflow)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, max, manageOverflow, ...deps])
}
