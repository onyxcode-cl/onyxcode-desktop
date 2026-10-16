import { isPlaceholderTitle } from './session-title'
import { selectProjectSessions, useCode } from './store'

/** Respiro anti-doble-clic del «+» de un proyecto (ms): una segunda activación seguida no crea otra sesión. */
export const NEW_HERE_COOLDOWN_MS = 400

const lastActivation = new Map<string, number>()

/** Solo para pruebas. */
export function resetNewHereCooldown(): void {
  lastActivation.clear()
}

/**
 * Sesión de `directory` que sigue vacía: sin título propio (el del motor «New session - …»), sin mensajes cargados y sin archivar.
 * Si no se sabe con certeza que está vacía (mensajes aún sin cargar), no cuenta: ante la duda se crea una nueva.
 */
export function findEmptyUntitledSession(state: ReturnType<typeof useCode.getState>, directory: string): string | null {
  const found = selectProjectSessions(state, directory).find((s) => {
    if (s.time.archived || s.parentID || !isPlaceholderTitle(s.title)) return false
    const msgs = state.messages[s.id]
    return Array.isArray(msgs) && msgs.length === 0 && (state.runState[s.id] ?? 'idle') === 'idle'
  })
  return found ? found.id : null
}

/**
 * «+» de un proyecto: ignora una segunda activación en menos de 400 ms y, si ya hay una sesión vacía sin título,
 * la selecciona en vez de crear otra (como las apps de chat). El proyecto debe tener ya el foco del almacén.
 */
export async function newSessionHere(directory: string, now: number = Date.now()): Promise<string | null> {
  const prev = lastActivation.get(directory)
  if (prev !== undefined && now - prev < NEW_HERE_COOLDOWN_MS) return null
  lastActivation.set(directory, now)
  const st = useCode.getState()
  const existing = findEmptyUntitledSession(st, directory)
  if (existing) {
    if (directory === st.directory) await st.selectSession(existing)
    return existing
  }
  return st.newSessionAt(directory)
}

/** ¿El elemento tiene foco de teclado real (`:focus-visible`)? Donde no se pueda saber, se asume que sí. */
export function hasKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/** Devuelve el foco a un sitio neutro (el contenedor de la lista), nunca a un botón de fila. */
export function focusNeutral(): void {
  if (typeof document === 'undefined') return
  const el = document.querySelector<HTMLElement>('[data-session-list-root]')
  el?.focus({ preventScroll: true })
}
