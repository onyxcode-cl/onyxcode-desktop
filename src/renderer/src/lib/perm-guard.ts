/**
 * Guardia de teclado para las tarjetas de permiso de escritorio (plan ND).
 *
 * Lógica pura, sin React ni DOM, para poder probarla con vitest. Decide qué hace cada tecla que llega
 * al contenedor de una tarjeta y cuándo se «arma» la tarjeta (permite responder tras 600 ms de
 * visibilidad continua, sin desplazarse). Invariantes de seguridad:
 *  - Enter SIN modificador NUNCA permite (sobre «Permitir» devuelve `block-enter` para que el botón lo bloquee).
 *  - ⌘↵ (Ctrl+↵ en Windows) permite «una vez» solo con foco en la tarjeta, ventana activa, tarjeta visible
 *    y armada, sin `repeat` ni composición IME y sin Alt/Shift. Nunca devuelve «always».
 *  - Esc rechaza (salvo en la textarea de «Rechazar con indicaciones», que cancela su propia nota).
 */

/** Milisegundos de visibilidad continua antes de armar la tarjeta. */
export const ARM_MS = 600
/** Desplazamiento vertical (px) que desarma la tarjeta mientras se ve. */
export const MAX_DRIFT_PX = 24

export type PermDecision = 'once' | 'reject' | 'block-enter' | 'none'

/** Tecla que llega al `onKeyDown` del contenedor de la tarjeta. */
export interface PermKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  isComposing: boolean
  /** El foco está en la textarea de «Rechazar con indicaciones». */
  targetIsNote: boolean
  /** El foco está en un botón «Permitir una vez» o «Permitir siempre». */
  targetIsPermit: boolean
}

/** Estado de la tarjeta y de la ventana en el momento de la tecla. */
export interface PermKeyContext {
  /** true en macOS (⌘↵); false en Windows (Ctrl+↵). */
  mac: boolean
  focusInCard: boolean
  windowFocused: boolean
  /** La tarjeta se ve ≥60 % (IntersectionObserver). */
  visible: boolean
  armed: boolean
  busy: boolean
  /** Hay observador de visibilidad/posición; sin él, el teclado no arma (el clic sí, por tiempo). */
  observing: boolean
}

export function decidePermKey(ev: PermKeyEvent, ctx: PermKeyContext): PermDecision {
  if (ev.key === 'Escape') {
    return ctx.focusInCard && !ev.targetIsNote ? 'reject' : 'none'
  }

  if (ev.key !== 'Enter') return 'none'

  // ⌘↵ (o Ctrl+↵) en la textarea de indicaciones NUNCA permite: envía la nota (rechazo).
  if (ev.targetIsNote) return 'none'

  const confirmMod = ctx.mac ? ev.metaKey : ev.ctrlKey

  if (confirmMod) {
    if (
      ctx.observing &&
      ctx.focusInCard &&
      ctx.windowFocused &&
      ctx.visible &&
      ctx.armed &&
      !ctx.busy &&
      !ev.repeat &&
      !ev.isComposing &&
      !ev.altKey &&
      !ev.shiftKey
    ) {
      return 'once'
    }
    return 'none'
  }

  // Enter sin modificador (ni ⌘/Ctrl ni Alt/Shift).
  if (!ev.altKey && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
    return ev.targetIsPermit ? 'block-enter' : 'none'
  }

  return 'none'
}

// ───────────────────────────── Armado ─────────────────────────────

export interface ArmState {
  armed: boolean
  /** Marca de tiempo en que empezó la visibilidad continua actual (o el último reset). */
  since: number
  /** Posición vertical del contenedor en el momento en que se armó. */
  y: number
}

export interface ArmInput {
  visible: boolean
  now: number
  /** Posición vertical actual del contenedor (para detectar desplazamiento). */
  y: number
}

/** Estado inicial de una tarjeta recién montada (desarmada, contando desde `now`). */
export function initialArmState(now: number, y: number): ArmState {
  return { armed: false, since: now, y }
}

/** Avanza el estado de armado: 600 ms de visibilidad continua sin desplazarse >24 px. */
export function armState(prev: ArmState, input: ArmInput): ArmState {
  if (!input.visible) {
    return { armed: false, since: input.now, y: input.y }
  }
  if (prev.armed) {
    if (Math.abs(input.y - prev.y) > MAX_DRIFT_PX) {
      return { armed: false, since: input.now, y: input.y }
    }
    return prev
  }
  if (input.now - prev.since >= ARM_MS) {
    return { armed: true, since: prev.since, y: input.y }
  }
  return { armed: false, since: prev.since, y: input.y }
}
