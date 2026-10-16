import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Menú «⋯» de las filas de la barra lateral de escritorio. Sale en un portal con posición FIJA (en `document.body`): la lista tiene scroll
 * y recortaba las opciones de abajo. Se abre hacia abajo si cabe (o si hay más sitio que arriba) y alineado al borde derecho del ancla.
 * Se cierra al pulsar fuera, con Esc (devolviendo el foco al ancla), al cambiar el tamaño de la ventana o al hacer scroll; ↑ ↓ recorren
 * las opciones. Sin textos propios: quien lo usa pone `label` y las opciones.
 */
export function PortalMenu({
  open,
  anchor,
  onClose,
  label,
  children
}: {
  open: boolean
  /** Contenedor del botón «⋯» (ancla de la posición y «dentro» para el cierre al pulsar fuera). */
  anchor: React.RefObject<HTMLElement | null>
  onClose: () => void
  label: string
  children: React.ReactNode
}): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const needed = 140
    const below = window.innerHeight - r.bottom
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      ...(below >= needed || below >= r.top ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 })
    })
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const n = e.target as Node
      if (!anchor.current?.contains(n) && !menuRef.current?.contains(n)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onClose)
    document.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('scroll', onClose, true)
    }
  }, [open, anchor, onClose])

  const placed = pos !== null
  useEffect(() => {
    if (open && placed) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open, placed])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      anchor.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  if (!open || !pos) return null
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={pos}
      className="fixed z-50 w-52 rounded-card bg-elevated p-1 shadow-pop"
    >
      {children}
    </div>,
    document.body
  )
}

/** Una opción del menú. `danger`: texto rojo (eliminar). */
export function PortalMenuItem({
  icon,
  label,
  onClick,
  danger
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`no-drag flex h-8 w-full items-center gap-2.5 rounded-ctl px-2.5 text-left text-ui hover:bg-hover focus-visible:bg-hover ${danger ? 'text-danger' : ''}`}
    >
      {icon}
      {label}
    </button>
  )
}

export function PortalMenuSeparator(): React.JSX.Element {
  return <div className="mx-1.5 my-1 h-px bg-border" role="separator" />
}
