import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isRemoteSurface } from '../platform'

/** Distancia (px) al final a partir de la cual la lista deja de pegarse al final y aparece «Ir al final». */
export const STICK_THRESHOLD = 80

/** ¿Está el scroll a menos de `threshold` px del final? Pura (testeable sin DOM). */
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, threshold = STICK_THRESHOLD): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

/**
 * Celular: si el final está a más de 3 pantallas, salto instantáneo hasta 2 pantallas antes del final y después `smooth`
 * (un smooth desde muy arriba se ve a tirones). Devuelve el `scrollTop` al que saltar, o null si basta con `smooth`.
 */
export function jumpTarget(scrollHeight: number, scrollTop: number, clientHeight: number): number | null {
  if (scrollHeight - scrollTop - clientHeight <= 3 * clientHeight) return null
  return Math.max(0, scrollHeight - 2 * clientHeight)
}

/** Posiciones de scroll recordadas por conversación (R3-A). Solo en memoria y acotadas: la más antigua se descarta. */
export const SCROLL_MEMORY_MAX = 200
const scrollMemory = new Map<string, { top: number; stick: boolean }>()

export function rememberScroll(key: string, pos: { top: number; stick: boolean }): void {
  scrollMemory.delete(key) // reinsertar = más reciente
  scrollMemory.set(key, pos)
  while (scrollMemory.size > SCROLL_MEMORY_MAX) scrollMemory.delete(scrollMemory.keys().next().value as string)
}

export function recalledScroll(key: string): { top: number; stick: boolean } | undefined {
  return scrollMemory.get(key)
}

export function scrollMemorySize(): number {
  return scrollMemory.size
}

/** Solo pruebas. */
export function clearScrollMemory(): void {
  scrollMemory.clear()
}

/**
 * Pegado al final de una conversación (Chat, Code y Tareas). Si el usuario sube más de 80 px deja de seguir el
 * streaming y `atBottom` pasa a false (para mostrar «Ir al final»). `resetKey` (id del primer mensaje) identifica la
 * conversación: al volver a ella (p. ej. tras cambiar de modo, que desmonta la vista) se restaura su posición; si
 * estaba pegada al final vuelve al final, y una conversación nueva empieza pegada.
 */
export function useStickToBottom(resetKey: unknown): {
  scrollRef: React.RefObject<HTMLDivElement | null>
  stickRef: React.MutableRefObject<boolean>
  atBottom: boolean
  onScroll: () => void
  scrollToBottom: () => void
} {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const memoKey = typeof resetKey === 'string' && resetKey ? resetKey : null
  const memoKeyRef = useRef<string | null>(memoKey)
  // Celular: dedo apoyado sobre la lista. Mientras dura (y hasta que termina la inercia) el pegado al final no mueve nada.
  const touchingRef = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const near = isNearBottom(el)
    if (touchingRef.current) {
      // La decisión la toma `settle` al soltar; aquí solo se recuerda la posición y se puede soltar el pegado.
      if (!near) stickRef.current = false
    } else {
      stickRef.current = near
      // Sin `scrollend` (Safari antiguo): se reasienta 150 ms después del último scroll.
      if (isRemoteSurface() && !('onscrollend' in window)) {
        if (settleTimer.current) clearTimeout(settleTimer.current)
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null
          const cur = scrollRef.current
          if (cur && !touchingRef.current) {
            const n = isNearBottom(cur)
            stickRef.current = n
            setAtBottom(n)
          }
        }, 150)
      }
    }
    setAtBottom(near) // React descarta el set si no cambia
    if (memoKeyRef.current) rememberScroll(memoKeyRef.current, { top: el.scrollTop, stick: near })
  }, [])

  // Antes de pintar: recupera la posición de esta conversación (debe ir antes del efecto de «pegar al final»).
  useLayoutEffect(() => {
    memoKeyRef.current = memoKey
    const saved = memoKey ? recalledScroll(memoKey) : undefined
    const el = scrollRef.current
    if (saved && !saved.stick && el) {
      stickRef.current = false
      el.scrollTop = saved.top
    } else stickRef.current = true
  }, [memoKey])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current && !touchingRef.current) el.scrollTop = el.scrollHeight
  })

  // Celular: la intención del usuario manda. Al apoyar el dedo se suelta el pegado (en iOS el arrastre y la inercia se
  // anulaban en cada token); al soltar, y al terminar la inercia (`scrollend`), se recalcula con el umbral de 80 px.
  useEffect(() => {
    const el = scrollRef.current
    if (!isRemoteSurface() || !el) return
    const settle = (): void => {
      if (touchingRef.current) return
      const near = isNearBottom(el)
      stickRef.current = near
      setAtBottom(near)
    }
    const down = (): void => {
      touchingRef.current = true
      stickRef.current = false
    }
    const up = (): void => {
      touchingRef.current = false
      settle()
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchend', up, { passive: true })
    el.addEventListener('touchcancel', up, { passive: true })
    el.addEventListener('scrollend', settle, { passive: true })
    return () => {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', up)
      el.removeEventListener('touchcancel', up)
      el.removeEventListener('scrollend', settle)
      if (settleTimer.current) clearTimeout(settleTimer.current)
    }
  }, [])

  // Celular: si la altura visible cambia (cola de mensajes que se abre, compositor que crece, teclado) y la lista estaba pegada
  // al final, se queda pegada (si no, lo último —p. ej. una tarjeta de permiso— quedaba tapado). Escritorio no cambia.
  useEffect(() => {
    const el = scrollRef.current
    if (!isRemoteSurface() || !el || typeof ResizeObserver === 'undefined') return
    let last = el.clientHeight
    const ro = new ResizeObserver(() => {
      if (el.clientHeight === last) return
      last = el.clientHeight
      if (stickRef.current && !touchingRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const saved = memoKey ? recalledScroll(memoKey) : undefined
    setAtBottom(!saved || saved.stick)
  }, [memoKey])

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    if (isRemoteSurface()) {
      const to = jumpTarget(el.scrollHeight, el.scrollTop, el.clientHeight)
      if (to !== null) el.scrollTop = to
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  return { scrollRef, stickRef, atBottom, onScroll, scrollToBottom }
}
