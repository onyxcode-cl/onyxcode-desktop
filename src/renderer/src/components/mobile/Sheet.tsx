import { useEffect, useId, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
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

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <SheetView onClose={onClose} title={title} size={size}>
      {children}
    </SheetView>,
    document.body
  )
}

/** La hoja pintada (sin portal ni Esc): separada para poder probar su marcado sin DOM. */
export function SheetView({ onClose, title, size = 'half', children }: Omit<SheetProps, 'open'>): React.JSX.Element {
  const t = useT()
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; at: number; id: number } | null>(null)
  const move = (dy: number): void => {
    if (panel.current) panel.current.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
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
    else move(0)
  }

  return (
    <div data-sheet="" data-surface="mobile" className="fixed inset-x-0 top-0 z-[80]" style={{ bottom: 'var(--kb-inset, 0px)' }}>
      <div aria-hidden="true" className="absolute inset-0 animate-fade-in bg-black/45" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-size={size}
        style={sheetStyle(size)}
        className="animate-sheet-up absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[20px] border-t border-border-strong bg-elevated text-fg shadow-xl"
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            drag.current = null
            move(0)
          }}
        >
          <span aria-hidden="true" title={t('mobile.sheet.grab')} className="h-1 w-10 rounded-full bg-border-strong" />
          <div className="flex w-full items-center gap-2 pr-2 pl-4">
            <h2 id={titleId} className="min-w-0 flex-1 truncate py-2 font-display text-[16px] font-semibold tracking-tight">
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
