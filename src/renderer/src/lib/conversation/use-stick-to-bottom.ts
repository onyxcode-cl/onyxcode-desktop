import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Distancia (px) al final a partir de la cual la lista deja de pegarse al final y aparece «Ir al final». */
export const STICK_THRESHOLD = 80

/** ¿Está el scroll a menos de `threshold` px del final? Pura (testeable sin DOM). */
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, threshold = STICK_THRESHOLD): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

/**
 * Pegado al final de una conversación (Chat, Code y Tareas). Si el usuario sube más de 80 px deja de seguir el
 * streaming y `atBottom` pasa a false (para mostrar «Ir al final»). `resetKey` (id del primer mensaje) vuelve a pegar.
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

  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const near = isNearBottom(el)
    stickRef.current = near
    setAtBottom(near) // React descarta el set si no cambia
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  })

  useEffect(() => {
    stickRef.current = true
    setAtBottom(true)
  }, [resetKey])

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  return { scrollRef, stickRef, atBottom, onScroll, scrollToBottom }
}
