import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/** Ancho de cada acción revelada al deslizar. */
export const SWIPE_ACTION_W = 76
const LOCK_PX = 8
const FLICK_PX_PER_MS = 0.5

/**
 * Decide el eje del gesto tras `LOCK_PX`: si gana lo vertical se suelta (la lista hace scroll), si gana lo horizontal la fila
 * sigue al dedo. Hasta entonces `pending`.
 */
export function swipeAxis(dx: number, dy: number): 'pending' | 'horizontal' | 'vertical' {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < LOCK_PX && ay < LOCK_PX) return 'pending'
  return ay > ax ? 'vertical' : 'horizontal'
}

/**
 * Al soltar: `open` deja las acciones a la vista, `closed` las esconde. Es un atajo para ver acciones: NUNCA devuelve un
 * resultado de «borrar» (un deslizamiento largo solo abre; la acción destructiva siempre pide confirmación).
 * `offset` = desplazamiento actual de la fila (negativo = hacia la izquierda), `ms` = duración del arrastre.
 */
export function swipeDecision(offset: number, dx: number, ms: number, actionsWidth: number, wasOpen: boolean): 'open' | 'closed' {
  const velocity = ms > 0 ? dx / ms : 0
  if (velocity < -FLICK_PX_PER_MS) return 'open'
  if (velocity > FLICK_PX_PER_MS) return 'closed'
  const shown = Math.min(Math.max(-offset, 0), actionsWidth)
  // Cerrada: basta el 40 % para quedarse abierta. Abierta: se cierra si se arrastra más del 40 % hacia atrás.
  return wasOpen ? (shown < actionsWidth * 0.6 ? 'closed' : 'open') : shown > actionsWidth * 0.4 ? 'open' : 'closed'
}

// Una sola fila abierta a la vez: quien abre avisa al resto.
let openId: string | null = null
const listeners = new Set<(id: string | null) => void>()
function setOpenId(id: string | null): void {
  openId = id
  listeners.forEach((fn) => fn(id))
}

export interface SwipeAction {
  label: string
  tone: 'accent' | 'danger'
  icon?: ReactNode
  onClick: () => void
}

/**
 * Fila que se desliza a la izquierda para mostrar hasta dos acciones. Pointer Events, sin librerías; el contenedor deja pasar el
 * scroll vertical (`touch-action: pan-y`). Los botones revelados van `absolute` para que la regla global de objetivos táctiles
 * no amplíe su zona sobre la fila.
 */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }): React.JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const slider = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; t: number; axis: 'pending' | 'horizontal' | 'vertical'; base: number } | null>(null)
  const width = SWIPE_ACTION_W * Math.min(actions.length, 2)

  const move = useCallback((px: number, animate: boolean) => {
    const el = slider.current
    if (!el) return
    el.style.transition = animate ? 'transform 200ms var(--ease-out)' : 'none'
    el.style.transform = px === 0 ? '' : `translateX(${px}px)`
  }, [])

  useEffect(() => {
    const fn = (cur: string | null): void => {
      if (cur !== id) setOpen(false)
    }
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
      if (openId === id) openId = null
    }
  }, [id])

  useEffect(() => {
    move(open ? -width : 0, true)
    if (!open) return
    const close = (e: Event): void => {
      if (e.type === 'pointerdown' && slider.current?.parentElement?.contains(e.target as Node)) return
      setOpen(false)
      if (openId === id) openId = null
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('scroll', close, true)
    }
  }, [open, width, move, id])

  const onDown = (e: ReactPointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, axis: 'pending', base: open ? -width : 0 }
  }
  const onMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d || d.axis === 'vertical') return
    const dx = e.clientX - d.x
    if (d.axis === 'pending') {
      d.axis = swipeAxis(dx, e.clientY - d.y)
      if (d.axis === 'vertical') return
      if (d.axis === 'horizontal') e.currentTarget.setPointerCapture?.(e.pointerId)
      else return
    }
    move(Math.min(0, Math.max(-width, d.base + dx)), false)
  }
  const onUp = (e: ReactPointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d || d.axis !== 'horizontal') return
    const dx = e.clientX - d.x
    const offset = Math.min(0, Math.max(-width, d.base + dx))
    const next = swipeDecision(offset, dx, e.timeStamp - d.t, width, open) === 'open'
    setOpen(next)
    setOpenId(next ? id : openId === id ? null : openId)
    move(next ? -width : 0, true)
  }

  if (actions.length === 0) return <>{children}</>
  return (
    <div data-m="swipe-row" className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" style={{ width }} inert={!open || undefined} aria-hidden={!open || undefined}>
        {actions.slice(0, 2).map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setOpen(false)
              setOpenId(null)
              a.onClick()
            }}
            className={`absolute inset-y-0 flex flex-col items-center justify-center gap-1 text-[12px] font-medium ${a.tone === 'danger' ? 'bg-danger text-danger-fg' : 'bg-accent text-accent-fg'}`}
            style={{ width: SWIPE_ACTION_W, right: (actions.slice(0, 2).length - 1 - actions.indexOf(a)) * SWIPE_ACTION_W }}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <div
        ref={slider}
        className="relative bg-bg"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => {
          // Con las acciones abiertas, tocar la fila solo las cierra.
          if (open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
            setOpenId(null)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Pulsación larga (450 ms) sin mover el dedo más de 8 px: llama a `onLong` y evita el clic que sigue al soltar.
 * Devuelve los manejadores para esparcir en el elemento; con ratón no actúa.
 */
export function useLongPress(
  onLong: () => void,
  ms = 450
): {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onClickCapture: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
} {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cb = useRef(onLong)
  cb.current = onLong
  const clear = useCallback(() => {
    clearTimeout(timer.current)
    start.current = null
  }, [])
  useEffect(() => clear, [clear])
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fired.current = true
        start.current = null
        cb.current()
      }, ms)
    },
    onPointerMove: (e) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > LOCK_PX) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture: (e) => {
      if (fired.current) {
        fired.current = false
        e.preventDefault()
        e.stopPropagation()
      }
    },
    onContextMenu: (e) => {
      // En Android la pulsación larga también abre el menú del navegador: lo sustituye la hoja de acciones.
      if (start.current || fired.current) e.preventDefault()
    }
  }
}
