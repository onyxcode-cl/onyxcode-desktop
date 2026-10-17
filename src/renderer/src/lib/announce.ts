/**
 * Avisos para lectores de pantalla (H20). UNA sola pareja de regiones vivas permanentes (`<LiveAnnouncer />`, montada en
 * `App.tsx`) en vez de un `role="status"` que aparece junto con su texto (muchos lectores no lo leen si la región se
 * crea ya con contenido). Dónde viven los avisos de la app:
 *  - `components/conversation/ConversationAnnouncer.tsx`: «Respuesta terminada» y el error de la respuesta (Chat, Code y
 *    Tareas); nunca el texto ni cada fragmento del streaming. «Respondiendo…» ya lo lee `ThinkingIndicator`/`ChatProgressHud`
 *    (`role="status"`): no se repite aquí para no leerlo dos veces.
 *  - `components/permission/PermissionShell.tsx` (`PermCardFrame`): «Se necesita tu aprobación: …» al aparecer una tarjeta.
 *  - `app/ServerBanner.tsx` y `app/EngineNotice.tsx`: errores de conexión con el motor (`role="alert"` propio).
 *  - Resultado de acciones (copiado, guardado, exportado): llaman a `announce()` — `CopyButton` y `ExportConversation`.
 * Quien llama a `announce()` NO debe además pintar un `role="status"` con el mismo texto (se leería dos veces).
 */
export type AnnounceTone = 'polite' | 'assertive'
export interface Announcement {
  id: number
  text: string
  tone: AnnounceTone
}

let nextId = 1
const listeners = new Set<(a: Announcement) => void>()

/** Anuncia `text` a los lectores de pantalla. `assertive` solo para errores. Sin región montada (PWA, pruebas) no hace nada. */
export function announce(text: string, tone: AnnounceTone = 'polite'): void {
  if (!text.trim()) return
  const a: Announcement = { id: nextId++, text, tone }
  for (const l of listeners) l(a)
}

export function subscribeAnnouncements(fn: (a: Announcement) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
