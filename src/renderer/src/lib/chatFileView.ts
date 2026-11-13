/**
 * Registro mínimo (mismo patrón que `chatDocPreview.ts`) para que la tarjeta de un archivo en cualquier mensaje del chat muestre
 * el archivo en el panel lateral que gestiona `useChatDocPanel`, sin pasar la lógica por el árbol de props de la lista de mensajes.
 */
import type { ArtifactContext, ChatFileInfo } from '@shared/ipc-extras'

let handler: ((info: ChatFileInfo, context?: ArtifactContext) => void) | null = null

let pending: { info: ChatFileInfo; context?: ArtifactContext } | null = null

export function setChatFileViewHandler(fn: ((info: ChatFileInfo, context?: ArtifactContext) => void) | null): void {
  handler = fn
  // Un archivo pedido desde otro modo (la galería) espera a que el Chat monte su panel.
  if (fn && pending) {
    const info = pending
    pending = null
    fn(info.info, info.context)
  }
}

/** Como `viewChatFile`, pero si el Chat todavía no está en pantalla deja el pedido pendiente hasta que monte su panel. */
export function requestViewChatFile(info: ChatFileInfo, context?: ArtifactContext): void {
  if (handler) handler(info, context)
  else pending = { info, context }
}

/** `true` si había un panel de chat al que mostrarle el archivo. */
export function viewChatFile(info: ChatFileInfo, context?: ArtifactContext): boolean {
  if (!handler) return false
  handler(info, context)
  return true
}

export function canViewChatFileHere(): boolean {
  return handler !== null
}
