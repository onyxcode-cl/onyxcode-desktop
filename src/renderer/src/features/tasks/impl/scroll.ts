/**
 * Puente mínimo entre el panel "Contexto" / la búsqueda de tareas y la conversación: al hacer clic en
 * una entrada, `requestScrollToPart` pide a `TaskConversation` que abra el bloque que contiene
 * esa parte, haga scroll hasta ahí y lo resalte un momento.
 *
 * Si quien llama abre la tarea justo antes (los mensajes aún no están pintados), la petición queda
 * pendiente unos segundos y `TaskConversation` la atiende en cuanto el bloque exista.
 */
const EVENT = 'tasks:scroll-to-part'

/** Cuánto tiempo sigue vigente una petición que aún no encontró su bloque. */
export const PENDING_SCROLL_MS = 8000

let pending: { partId: string; at: number } | null = null

export function requestScrollToPart(partId: string): void {
  pending = { partId, at: Date.now() }
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: partId }))
}

export function onScrollToPart(listener: (partId: string) => void): () => void {
  const handler = (e: Event): void => listener((e as CustomEvent<string>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** Petición vigente que todavía no se ha atendido (sin consumirla). */
export function peekPendingScroll(now = Date.now()): string | null {
  if (!pending) return null
  if (now - pending.at > PENDING_SCROLL_MS) {
    pending = null
    return null
  }
  return pending.partId
}

/** Da por atendida la petición pendiente (solo si sigue siendo la de `partId`). */
export function clearPendingScroll(partId: string): void {
  if (pending?.partId === partId) pending = null
}
