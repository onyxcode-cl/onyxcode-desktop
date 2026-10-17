/**
 * Registro mínimo (mismo patrón que `chatDocPreview.ts`) para que la tarjeta de un archivo en cualquier mensaje del chat muestre
 * el archivo en el panel lateral que gestiona `useChatDocPanel`, sin pasar la lógica por el árbol de props de la lista de mensajes.
 */
import type { ChatFileInfo } from '@shared/ipc-extras'

let handler: ((info: ChatFileInfo) => void) | null = null

let pending: ChatFileInfo | null = null

export function setChatFileViewHandler(fn: ((info: ChatFileInfo) => void) | null): void {
  handler = fn
  // Un archivo pedido desde otro modo (la galería) espera a que el Chat monte su panel.
  if (fn && pending) {
    const info = pending
    pending = null
    fn(info)
  }
}

/** Como `viewChatFile`, pero si el Chat todavía no está en pantalla deja el pedido pendiente hasta que monte su panel. */
export function requestViewChatFile(info: ChatFileInfo): void {
  if (handler) handler(info)
  else pending = info
}

/** `true` si había un panel de chat al que mostrarle el archivo. */
export function viewChatFile(info: ChatFileInfo): boolean {
  if (!handler) return false
  handler(info)
  return true
}

export function canViewChatFileHere(): boolean {
  return handler !== null
}
