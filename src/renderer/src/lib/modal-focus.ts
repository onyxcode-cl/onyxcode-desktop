/**
 * Foco de los diálogos modales (`aria-modal="true"`) en un solo sitio, para que cualquier diálogo —propio o futuro— cumpla:
 *  1. al abrirse, el foco entra (si el diálogo no lo llevó ya a un control, va al primero; si no hay ninguno, al propio diálogo);
 *  2. Tab y Mayús+Tab no salen del diálogo de más arriba (se respeta a los diálogos que ya lo hacen: no se pisa un Tab ya gestionado);
 *  3. al cerrarse, el foco vuelve al control que lo tenía antes de abrirlo (si sigue en pantalla y el foco se perdió).
 * Esc lo gestiona cada diálogo (unos piden confirmar si hay trabajo a medias). No añade IPC ni toca el DOM salvo `tabindex="-1"`
 * en un diálogo sin controles.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/**
 * Destino del foco al pulsar Tab dentro de un diálogo con `count` controles: `null` = lo resuelve el navegador (el foco sigue
 * dentro); un índice = hay que ponerlo ahí a mano. `current` es el índice del control con foco, o -1 si el foco no está en
 * ninguno de ellos (fuera del diálogo o en el propio contenedor).
 */
export function tabTarget(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null
  if (current < 0) return shift ? count - 1 : 0
  if (shift && current === 0) return count - 1
  if (!shift && current === count - 1) return 0
  return null
}

const visible = (el: HTMLElement): boolean => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible)
}

const modals = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
const insideModal = (el: Element | null): boolean => !!el && !!el.closest('[aria-modal="true"]')

let installed = false

/** Instala los oyentes (una vez). Devuelve la función que los quita (para pruebas). */
export function installModalFocus(): () => void {
  if (installed || typeof document === 'undefined') return () => {}
  installed = true
  let lastOutside: HTMLElement | null = null
  const known = new Map<HTMLElement, HTMLElement | null>() // diálogo → control que tenía el foco al abrirse

  const onFocusIn = (e: FocusEvent): void => {
    if (e.target instanceof HTMLElement && !insideModal(e.target)) lastOutside = e.target
  }

  const enter = (dlg: HTMLElement): void => {
    requestAnimationFrame(() => {
      if (!dlg.isConnected || dlg.contains(document.activeElement)) return
      const first = focusables(dlg)[0]
      if (first) first.focus()
      else {
        if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1')
        dlg.focus()
      }
    })
  }

  const sync = (): void => {
    const now = modals()
    for (const dlg of now) {
      if (known.has(dlg)) continue
      known.set(dlg, lastOutside)
      enter(dlg)
    }
    for (const [dlg, opener] of known) {
      if (dlg.isConnected) continue
      known.delete(dlg)
      const active = document.activeElement
      const lost = !active || active === document.body || !document.contains(active)
      if (lost && opener?.isConnected && modals().length === 0) opener.focus()
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const top = modals().at(-1)
    if (!top) return
    const items = focusables(top)
    if (items.length === 0) {
      e.preventDefault()
      top.focus()
      return
    }
    const target = tabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey)
    if (target !== null) {
      e.preventDefault()
      items[target].focus()
    } else if (!top.contains(document.activeElement)) {
      e.preventDefault()
      items[e.shiftKey ? items.length - 1 : 0].focus()
    }
  }

  const mo = new MutationObserver(sync)
  mo.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('keydown', onKeyDown)
  sync()
  return () => {
    installed = false
    mo.disconnect()
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('keydown', onKeyDown)
  }
}
