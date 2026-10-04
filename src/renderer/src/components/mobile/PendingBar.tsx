import { useEffect, useState, type RefObject } from 'react'
import { ArrowDown } from 'lucide-react'
import { useT } from '../../lib/i18n'

/** Selector de las tarjetas de permiso o pregunta (las marca `m('pending-card')`). */
export const PENDING_CARD = "[data-m='pending-card']"

/**
 * Barra «Aprobación pendiente ↓» (celular): aparece sobre el compositor cuando hay permisos o preguntas pendientes y
 * ninguna tarjeta está a la vista dentro del scroller. Al tocarla centra la primera tarjeta.
 */
export function PendingBar({
  scrollRef,
  count,
  onShownChange
}: {
  scrollRef: RefObject<HTMLElement | null>
  count: number
  /** Avisa si la barra se ve (para ocultar «Ir al final», que ocupa el mismo sitio). */
  onShownChange?: (shown: boolean) => void
}): React.JSX.Element | null {
  const t = useT()
  const [anyVisible, setAnyVisible] = useState(true)

  useEffect(() => {
    const root = scrollRef.current
    if (count <= 0 || !root || typeof IntersectionObserver === 'undefined') return
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting)
        setAnyVisible([...seen.values()].some(Boolean))
      },
      { root, threshold: 0.2 }
    )
    const cards = root.querySelectorAll(PENDING_CARD)
    if (cards.length === 0) {
      setAnyVisible(true)
      return
    }
    cards.forEach((c) => io.observe(c))
    return () => io.disconnect()
  }, [scrollRef, count])

  const shown = count > 0 && !anyVisible
  useEffect(() => {
    onShownChange?.(shown)
  }, [shown, onShownChange])

  if (!shown) return null
  return (
    <button
      type="button"
      onClick={() => scrollRef.current?.querySelector(PENDING_CARD)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
      className="absolute bottom-3 left-1/2 z-20 flex h-9 -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium whitespace-nowrap text-accent-fg shadow-md active:opacity-90"
    >
      {count === 1 ? t('mobile.pending.one') : t('mobile.pending.many', { count })}
      <ArrowDown size={15} />
    </button>
  )
}
