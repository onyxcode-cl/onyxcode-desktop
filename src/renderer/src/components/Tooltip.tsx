import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEvent, MouseEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { isRemoteSurface } from '../lib/platform'

/** Retraso antes del primer tooltip; con otro tooltip cerrado hace menos de `GROUP_MS` aparece sin esperar. */
export const TOOLTIP_DELAY_MS = 500
export const TOOLTIP_GROUP_MS = 300
const MAX_W = 240
const GAP = 6
const MARGIN = 8

let lastClosedAt = 0
let open = 0

type Side = 'top' | 'bottom'

interface Props {
  /** Texto del tooltip. Vacío = sin tooltip. Conserva el `aria-label` del control: el tooltip no lo sustituye. */
  label: string | undefined
  /** Atajo de teclado (`⌘K`), pintado con `.kbd`. */
  shortcut?: string
  side?: Side
  /** UN elemento del DOM (botón, enlace…): el tooltip no añade ningún nodo alrededor. */
  children: ReactElement<Record<string, unknown>>
}

/**
 * Tooltip propio de escritorio (reemplaza al `title=` nativo: sin retraso de ~1 s, con estilo y atajo). Sale con el ratón tras
 * 500 ms (0 ms si acaba de cerrarse otro) y al instante con el foco de teclado; se cierra con Esc, al salir, al pulsar y al perder
 * el foco. Lleva `role="tooltip"` y el control recibe `aria-describedby` mientras está visible. En la PWA del celular devuelve
 * el hijo tal cual (no hay puntero y su marcado no cambia).
 */
export function Tooltip({ label, shortcut, side = 'top', children }: Props): React.JSX.Element {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = !!label && !isRemoteSurface()

  const clear = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const hide = useCallback((): void => {
    clear()
    setAnchor(null)
  }, [clear])
  useEffect(() => clear, [clear])

  const visible = active && anchor !== null
  useEffect(() => {
    if (!visible) return undefined
    open++
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      open--
      lastClosedAt = Date.now()
    }
  }, [visible, hide])

  if (!active) return children

  const show = (el: HTMLElement, delay: number): void => {
    clear()
    if (delay <= 0) setAnchor(el)
    else timer.current = setTimeout(() => setAnchor(el), delay)
  }
  const props = children.props
  const call = (name: string, e: unknown): void => {
    const f = props[name]
    if (typeof f === 'function') f(e)
  }

  return (
    <>
      {cloneElement(children, {
        'aria-describedby': visible ? [props['aria-describedby'], id].filter(Boolean).join(' ') : props['aria-describedby'],
        onMouseEnter: (e: MouseEvent<HTMLElement>) => {
          call('onMouseEnter', e)
          const el = e.currentTarget
          const grouped = open > 0 || Date.now() - lastClosedAt < TOOLTIP_GROUP_MS
          show(el, grouped ? 0 : TOOLTIP_DELAY_MS)
        },
        onMouseLeave: (e: MouseEvent<HTMLElement>) => {
          call('onMouseLeave', e)
          hide()
        },
        onMouseDown: (e: MouseEvent<HTMLElement>) => {
          call('onMouseDown', e)
          hide()
        },
        onFocus: (e: FocusEvent<HTMLElement>) => {
          call('onFocus', e)
          const el = e.currentTarget
          let keyboard = true
          try {
            keyboard = el.matches(':focus-visible')
          } catch {
            /* sin :focus-visible: se trata como teclado */
          }
          if (keyboard) show(el, 0)
        },
        onBlur: (e: FocusEvent<HTMLElement>) => {
          call('onBlur', e)
          hide()
        }
      })}
      {visible && anchor && typeof document !== 'undefined'
        ? createPortal(<TooltipBubble id={id} anchor={anchor} side={side} label={label as string} shortcut={shortcut} />, document.body)
        : null}
    </>
  )
}

function TooltipBubble({
  id,
  anchor,
  side,
  label,
  shortcut
}: {
  id: string
  anchor: HTMLElement
  side: Side
  label: string
  shortcut?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const below = side === 'bottom' || r.top - h - GAP < MARGIN
    const top = below ? r.bottom + GAP : r.top - h - GAP
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN))
    setPos({ left, top })
  }, [anchor, side, label, shortcut])

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxWidth: MAX_W, zIndex: 500, visibility: pos ? 'visible' : 'hidden' }}
      className="pointer-events-none fixed flex items-center gap-2 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-fg shadow-lg desk:rounded-ctl-sm desk:text-meta desk:shadow-pop animate-fade-in"
    >
      <span>{label}</span>
      {shortcut && <kbd className="kbd">{shortcut}</kbd>}
    </div>
  )
}
