/**
 * Registro mínimo (mismo patrón que `chatDocPreview.ts`) para que la tarjeta de un archivo en cualquier mensaje del chat muestre
 * el archivo en el panel lateral que gestiona `useChatDocPanel`, sin pasar la lógica por el árbol de props de la lista de mensajes.
 */
import type { ChatFileInfo } from '@shared/ipc-extras'

let handler: ((info: ChatFileInfo) => void) | null = null

export function setChatFileViewHandler(fn: ((info: ChatFileInfo) => void) | null): void {
  handler = fn
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
