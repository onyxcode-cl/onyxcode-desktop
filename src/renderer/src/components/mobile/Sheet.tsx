import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useT } from '../../lib/i18n'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** `half` = hasta ~60 % de la pantalla; `full` = casi toda (deja ver el borde superior). Por defecto `half`. */
  size?: 'half' | 'full'
  children: ReactNode
}

/** Distancia (px) o velocidad (px/ms) a partir de la cual soltar el gesto cierra la hoja. */
export const SHEET_CLOSE_DISTANCE = 90
export const SHEET_CLOSE_VELOCITY = 0.6

/** ¿Un gesto vertical de `dy` px en `ms` ms cierra la hoja? (puro, para pruebas). */
export function shouldCloseOnDrag(dy: number, ms: number): boolean {
  if (dy <= 0) return false
  return dy >= SHEET_CLOSE_DISTANCE || (dy > 24 && dy / Math.max(1, ms) >= SHEET_CLOSE_VELOCITY)
}

/** Pila de hojas abiertas: Esc solo cierra la de más arriba (puro, para pruebas). */
export function createSheetStack(): { open: () => symbol; close: (id: symbol) => void; isTop: (id: symbol) => boolean } {
  const items: symbol[] = []
  return {
    open: () => {
      const id = Symbol('sheet')
      items.push(id)
      return id
    },
    close: (id) => {
      const i = items.indexOf(id)
      if (i >= 0) items.splice(i, 1)
    },
    isTop: (id) => items[items.length - 1] === id
  }
}
const stack = createSheetStack()

/** Margen (ms) tras el cual una hoja que se está cerrando se desmonta aunque `animationend` no llegue. */
export const SHEET_CLOSE_SAFETY_MS = 300

/** Opacidad del fondo mientras se arrastra la hoja `dy` px hacia abajo (puro, para pruebas). */
export function dragBackdropOpacity(dy: number): number {
  return Math.min(1, Math.max(0, 1 - Math.max(0, dy) / 400))
}

/** Estilo de altura de la hoja según su tamaño (usa la altura visible real: con teclado abierto se encoge). */
export function sheetStyle(size: 'half' | 'full'): { height?: string; maxHeight?: string } {
  const vh = 'var(--vv-height, 100dvh)'
  return size === 'full'
    ? { height: `calc(${vh} - env(safe-area-inset-top, 0px) - 12px)` }
    : { maxHeight: `calc((${vh} - env(safe-area-inset-top, 0px)) * 0.6)` }
}

/**
 * Hoja inferior modal (superficie del celular). `role="dialog" aria-modal="true"`: el foco entra, se queda dentro y vuelve al
 * control que la abrió mediante `lib/modal-focus.ts` (se instala una sola vez al montar la interfaz; aquí no se duplica).
 * Se cierra con Esc, tocando el fondo, el botón «Cerrar» o arrastrando el asa hacia abajo. Sin animación con
 * `prefers-reduced-motion` (regla global de `globals.css`). Respeta la zona segura y el teclado (`--kb-inset`, `--vv-height`).
 */
export function Sheet({ open, onClose, title, size = 'half', children }: SheetProps): React.JSX.Element | null {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Salida animada: al pasar `open` a false la hoja sigue montada hasta que acaba `sheet-down` (o vence el temporizador seguro).
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(open ? 'open' : 'closed')
  const [gen, setGen] = useState(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  useEffect(() => {
    if (open) {
      if (phaseRef.current === 'closing') setGen((g) => g + 1) // reabierta durante la salida: instancia nueva
      setPhase('open')
    } else setPhase((p) => (p === 'open' ? 'closing' : p))
  }, [open])
  useEffect(() => {
    if (phase !== 'closing') return
    const timer = setTimeout(() => setPhase('closed'), SHEET_CLOSE_SAFETY_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (!open) return
    const me = stack.open()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || !stack.isTop(me)) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      stack.close(me)
    }
  }, [open])

  const visible = open || phase !== 'closed'
  if (!visible || typeof document === 'undefined') return null
  return createPortal(
    <SheetView key={gen} onClose={onClose} title={title} size={size} closing={!open} onClosed={() => setPhase('closed')}>
      {children}
    </SheetView>,
    document.body
  )
}

/** La hoja pintada (sin portal ni Esc): separada para poder probar su marcado sin DOM. */
export function SheetView({
  onClose,
  title,
  size = 'half',
  closing = false,
  onClosed,
  children
}: Omit<SheetProps, 'open'> & { closing?: boolean; onClosed?: () => void }): React.JSX.Element {
  const t = useT()
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; at: number; id: number } | null>(null)
  const veil = useRef<HTMLDivElement>(null)
  /** Mueve el panel `dy` px; `settle` = vuelta animada a 0 (al soltar sin cerrar). Durante el arrastre no hay transición. */
  const move = (dy: number, settle = false): void => {
    const el = panel.current
    if (!el) return
    el.style.transition = settle ? 'transform 200ms var(--ease-sheet)' : 'none'
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
    if (veil.current) {
      veil.current.style.transition = settle ? 'opacity 200ms var(--ease-sheet)' : 'none'
      veil.current.style.opacity = dy > 0 ? String(dragBackdropOpacity(dy)) : ''
    }
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { y: e.clientY, at: e.timeStamp, id: e.pointerId }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // sin captura: el gesto igual funciona dentro del asa
    }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (d && d.id === e.pointerId) move(e.clientY - d.y)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const dy = e.clientY - d.y
    if (shouldCloseOnDrag(dy, e.timeStamp - d.at)) onClose()
    else move(0, true)
  }

  return (
    <div
      data-sheet=""
      data-surface="mobile"
      className={`fixed inset-x-0 top-0 z-[80] ${closing ? 'pointer-events-none' : ''}`}
      style={{ bottom: 'var(--kb-inset, 0px)' }}
    >
      <div
        ref={veil}
        aria-hidden="true"
        className={`absolute inset-0 bg-[var(--m-backdrop)] ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-size={size}
        style={sheetStyle(size)}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClosed?.()
        }}
        className={`${closing ? 'animate-sheet-down' : 'animate-m-sheet-up'} absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[var(--m-radius-sheet,22px)] border-t border-border-strong bg-elevated text-fg shadow-xl`}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            drag.current = null
            move(0, true)
          }}
        >
          <span aria-hidden="true" title={t('mobile.sheet.grab')} className="h-[5px] w-9 rounded-full bg-border-strong" />
          <div className="flex w-full items-center gap-2 px-2">
            <span aria-hidden="true" className="h-11 w-11 shrink-0" />
            <h2 id={titleId} className="min-w-0 flex-1 truncate py-2 text-center font-display text-[17px] font-semibold tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              aria-label={t('mobile.sheet.close')}
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-hover"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border/70 pb-[max(12px,env(safe-area-inset-bottom,0px))]">
          {children}
        </div>
      </div>
    </div>
  )
}
